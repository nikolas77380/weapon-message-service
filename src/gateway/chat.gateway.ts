import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards, Logger } from '@nestjs/common';
import { MessagesService } from '../messages/messages.service';
import { RedisService } from '../redis/redis.service';
import { AuthService } from '../auth/auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  SendMessageDto,
  TypingDto,
  JoinChatDto,
  CreateChatDto,
} from './dto/message.dto';
import { RefreshTokenDto } from './dto/auth.dto';
import { WsAuthGuard } from './guards/ws-auth.guard';

interface AuthenticatedSocket extends Socket {
  userId?: number;
  token?: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private userSockets = new Map<number, Set<string>>(); // userId -> Set of socketIds

  constructor(
    private messagesService: MessagesService,
    private redisService: RedisService,
    private authService: AuthService,
    private notificationsService: NotificationsService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    this.logger.log(`Client connecting: ${client.id}`);

    // Получаем токен из query параметров или auth объекта
    const token =
      (client.handshake.query.token as string) ||
      (client.handshake.auth?.token as string);

    if (!token) {
      this.logger.warn(`No token provided for socket ${client.id}`);
      client.emit('auth:error', {
        error: 'Authentication token required',
        code: 'TOKEN_REQUIRED',
      });
      client.disconnect();
      return;
    }

    // Проверяем токен через marketplace-api
    try {
      const userInfo = await this.authService.verifyToken(token);

      if (!userInfo) {
        this.logger.warn(`Invalid token for socket ${client.id}`);
        client.emit('auth:error', {
          error: 'Invalid or expired token',
          code: 'TOKEN_INVALID',
        });
        client.disconnect();
        return;
      }

      client.userId = userInfo.id;
      client.token = token;

      // Сохраняем связь socketId -> userId
      if (!this.userSockets.has(userInfo.id)) {
        this.userSockets.set(userInfo.id, new Set());
      }
      this.userSockets.get(userInfo.id)!.add(client.id);

      // Устанавливаем статус онлайн в Redis
      await this.redisService.setUserOnline(userInfo.id, client.id);
      this.logger.log(
        `User ${userInfo.id} set as online (socket: ${client.id})`,
      );

      // Уведомляем других пользователей о том, что пользователь онлайн
      this.server.emit('user:online', { userId: userInfo.id });

      // Присоединяем к комнатам всех чатов пользователя
      const chats = await this.messagesService.getUserChats(userInfo.id);
      for (const chat of chats) {
        client.join(`chat:${chat.id}`);
      }

      this.logger.log(`User ${userInfo.id} connected with socket ${client.id}`);
    } catch (error) {
      this.logger.error(`Error during authentication: ${error.message}`);
      client.emit('auth:error', {
        error: 'Authentication service error',
        code: 'AUTH_SERVICE_ERROR',
      });
      client.disconnect();
      return;
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    this.logger.log(`[DISCONNECT] Client disconnecting: ${client.id}, userId: ${client.userId}`);

    if (!client.userId) {
      this.logger.warn(`[DISCONNECT] Client ${client.id} disconnected without userId`);
      return;
    }

    const userId = client.userId;
    const userSocketSet = this.userSockets.get(userId);

    if (userSocketSet) {
      userSocketSet.delete(client.id);
      this.logger.log(
        `[DISCONNECT] Removed socket ${client.id} from user ${userId}, remaining sockets: ${userSocketSet.size}`,
      );

      // Если это был последний сокет пользователя, удаляем статус онлайн
      if (userSocketSet.size === 0) {
        this.userSockets.delete(userId);
        await this.redisService.removeUserOnline(userId);
        this.logger.log(`[DISCONNECT] User ${userId} marked as offline (last socket disconnected)`);
        this.server.emit('user:offline', { userId });
      } else {
        this.logger.log(
          `[DISCONNECT] User ${userId} still has ${userSocketSet.size} active socket(s), remains online`,
        );
      }
    } else {
      this.logger.warn(
        `[DISCONNECT] User ${userId} disconnected but was not found in userSockets map`,
      );
    }

    this.logger.log(`[DISCONNECT] Disconnect handling completed for user ${userId}`);
  }

  @SubscribeMessage('message:send')
  async handleMessage(
    @MessageBody() data: SendMessageDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    this.logger.log(
      `[MESSAGE:SEND] Received message send request: chatId=${data.chatId}, sender=${client.userId}, textLength=${data.text?.length || 0}`,
    );

    // Проверяем только наличие userId в сокете (быстрая проверка)
    if (!client.userId || !client.token) {
      this.logger.warn(
        `[MESSAGE:SEND] Unauthorized: missing userId or token`,
      );
      client.emit('auth:error', {
        error: 'Authentication required',
        code: 'TOKEN_REQUIRED',
      });
      return { error: 'Unauthorized' };
    }

    // Быстрая проверка токена (только локальная проверка exp, без API запроса)
    const userId = await this.authService.verifyTokenFast(client.token);
    if (!userId || userId !== client.userId) {
      client.emit('auth:token-expired', {
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
      });
      return { error: 'Token expired', code: 'TOKEN_EXPIRED' };
    }

    try {
      // Проверяем, что пользователь является участником чата
      const chat = await this.messagesService.getChatById(data.chatId);
      if (!chat) {
        this.logger.warn(`[MESSAGE:SEND] Chat not found: ${data.chatId}`);
        return { error: 'Chat not found' };
      }

      if (chat.buyer_id !== client.userId && chat.seller_id !== client.userId) {
        this.logger.warn(
          `[MESSAGE:SEND] Access denied: user ${client.userId} is not a participant of chat ${data.chatId}`,
        );
        return { error: 'Access denied' };
      }

      // Определяем получателя (другого участника чата)
      const recipientId =
        chat.buyer_id === client.userId ? chat.seller_id : chat.buyer_id;
      
      this.logger.log(
        `[MESSAGE:SEND] Processing message: sender=${client.userId}, recipient=${recipientId}, chatId=${data.chatId}`,
      );

      // Создаем сообщение
      const message = await this.messagesService.createMessage(
        data.chatId,
        client.userId,
        data.text,
        data.productId,
      );

      // Получаем обновленный счетчик непрочитанных для получателя
      const recipientUnreadCount =
        await this.messagesService.getUnreadCountForChat(
          data.chatId,
          recipientId,
        );

      // Отправляем сообщение всем участникам чата
      // Используем content из базы, но отправляем как text для совместимости
      this.server.to(`chat:${data.chatId}`).emit('message:new', {
        id: message.id,
        chatId: message.chat_id,
        senderId: message.sender_id,
        text: (message as any).content || (message as any).text,
        productId: message.product_id,
        createdAt: message.created_at,
      });

      // Отправляем обновленный счетчик непрочитанных получателю
      // Находим сокеты получателя и отправляем обновление
      const recipientSockets = this.userSockets.get(recipientId);
      if (recipientSockets) {
        recipientSockets.forEach((socketId) => {
          this.server.to(socketId).emit('unread:updated', {
            chatId: data.chatId,
            unreadCount: recipientUnreadCount,
          });
        });
      }

      // Если получатель офлайн, отправляем email через marketplace-api/Strapi
      const isRecipientOnline = await this.redisService.isUserOnline(recipientId);
      const messageTextLength = data.text?.trim().length || 0;
      
      this.logger.log(
        `[EMAIL-CHECK] Recipient ${recipientId} online status: ${isRecipientOnline}, message text length: ${messageTextLength}`,
      );
      console.log(
        `[EMAIL-CHECK] Recipient ${recipientId} online status: ${isRecipientOnline}, message text length: ${messageTextLength}`,
      );
      
      if (!isRecipientOnline && data.text && data.text.trim().length > 0) {
        this.logger.log(
          `[EMAIL-SEND] Recipient ${recipientId} is OFFLINE, attempting to send email notification`,
        );
        console.log(
          `[EMAIL-SEND] Recipient ${recipientId} is OFFLINE, attempting to send email notification`,
        );
        // Не ждем результата, но логируем внутри сервиса
        this.notificationsService.sendOfflineChatEmail({
          recipientId,
          senderId: client.userId,
          chatId: data.chatId,
          messageText: data.text,
          productId: data.productId,
        }).catch((error) => {
          this.logger.error(
            `[EMAIL-ERROR] Failed to send offline email notification: ${error.message}`,
            error.stack,
          );
          console.error(
            `[EMAIL-ERROR] Failed to send offline email notification: ${error.message}`,
            error,
          );
        });
      } else if (isRecipientOnline) {
        this.logger.log(
          `[EMAIL-SKIP] Recipient ${recipientId} is ONLINE, skipping email notification`,
        );
        console.log(
          `[EMAIL-SKIP] Recipient ${recipientId} is ONLINE, skipping email notification`,
        );
      } else {
        this.logger.log(
          `[EMAIL-SKIP] Skipping email: isRecipientOnline=${isRecipientOnline}, hasText=${!!data.text}, textLength=${messageTextLength}`,
        );
        console.log(
          `[EMAIL-SKIP] Skipping email: isRecipientOnline=${isRecipientOnline}, hasText=${!!data.text}, textLength=${messageTextLength}`,
        );
      }

      return { success: true, message };
    } catch (error) {
      this.logger.error(`Error sending message: ${error.message}`, error.stack);
      return { error: 'Failed to send message' };
    }
  }

  @SubscribeMessage('typing:start')
  async handleTypingStart(
    @MessageBody() data: TypingDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.userId || !client.token) {
      return;
    }

    // Быстрая проверка токена (без API запроса)
    const userId = await this.authService.verifyTokenFast(client.token);
    if (!userId || userId !== client.userId) {
      client.emit('auth:token-expired', {
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
      });
      return;
    }

    try {
      await this.redisService.setUserTyping(data.chatId, client.userId);

      // Уведомляем других участников чата
      client.to(`chat:${data.chatId}`).emit('typing:start', {
        chatId: data.chatId,
        userId: client.userId,
      });
    } catch (error) {
      this.logger.error(`Error setting typing status: ${error.message}`);
    }
  }

  @SubscribeMessage('typing:stop')
  async handleTypingStop(
    @MessageBody() data: TypingDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.userId || !client.token) {
      return;
    }

    // Быстрая проверка токена (без API запроса)
    const userId = await this.authService.verifyTokenFast(client.token);
    if (!userId || userId !== client.userId) {
      client.emit('auth:token-expired', {
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
      });
      return;
    }

    try {
      await this.redisService.removeUserTyping(data.chatId, client.userId);

      // Уведомляем других участников чата
      client.to(`chat:${data.chatId}`).emit('typing:stop', {
        chatId: data.chatId,
        userId: client.userId,
      });
    } catch (error) {
      this.logger.error(`Error removing typing status: ${error.message}`);
    }
  }

  @SubscribeMessage('chat:join')
  async handleJoinChat(
    @MessageBody() data: JoinChatDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.userId || !client.token) {
      client.emit('auth:error', {
        error: 'Authentication required',
        code: 'TOKEN_REQUIRED',
      });
      return { error: 'Unauthorized' };
    }

    // Быстрая проверка токена (без API запроса)
    const userId = await this.authService.verifyTokenFast(client.token);
    if (!userId || userId !== client.userId) {
      client.emit('auth:token-expired', {
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
      });
      return { error: 'Token expired', code: 'TOKEN_EXPIRED' };
    }

    try {
      const chat = await this.messagesService.getChatById(data.chatId);
      if (!chat) {
        return { error: 'Chat not found' };
      }

      if (chat.buyer_id !== client.userId && chat.seller_id !== client.userId) {
        return { error: 'Access denied' };
      }

      client.join(`chat:${data.chatId}`);

      // Отправляем историю сообщений
      const messages = await this.messagesService.getMessages(data.chatId);

      return { success: true, messages };
    } catch (error) {
      this.logger.error(`Error joining chat: ${error.message}`);
      return { error: 'Failed to join chat' };
    }
  }

  @SubscribeMessage('chat:create')
  async handleCreateChat(
    @MessageBody() data: CreateChatDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.userId || !client.token) {
      client.emit('auth:error', {
        error: 'Authentication required',
        code: 'TOKEN_REQUIRED',
      });
      return { error: 'Unauthorized' };
    }

    // Быстрая проверка токена (без API запроса)
    const userId = await this.authService.verifyTokenFast(client.token);
    if (!userId || userId !== client.userId) {
      client.emit('auth:token-expired', {
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
      });
      return { error: 'Token expired', code: 'TOKEN_EXPIRED' };
    }

    try {
      // Проверяем, что пользователь является одним из участников
      if (client.userId !== data.buyerId && client.userId !== data.sellerId) {
        return { error: 'Access denied' };
      }

      const chat = await this.messagesService.createChat(
        data.buyerId,
        data.sellerId,
      );

      // Присоединяем обоих пользователей к комнате чата
      const buyerSockets = this.userSockets.get(data.buyerId);
      const sellerSockets = this.userSockets.get(data.sellerId);

      if (buyerSockets) {
        buyerSockets.forEach((socketId) => {
          this.server.sockets.sockets.get(socketId)?.join(`chat:${chat.id}`);
        });
      }

      if (sellerSockets) {
        sellerSockets.forEach((socketId) => {
          this.server.sockets.sockets.get(socketId)?.join(`chat:${chat.id}`);
        });
      }

      // Уведомляем обоих пользователей о создании чата
      this.server.to(`chat:${chat.id}`).emit('chat:created', {
        id: chat.id,
        buyerId: chat.buyer_id,
        sellerId: chat.seller_id,
        createdAt: chat.created_at,
      });

      return { success: true, chat };
    } catch (error) {
      this.logger.error(`Error creating chat: ${error.message}`);
      return { error: 'Failed to create chat' };
    }
  }

  @SubscribeMessage('users:online')
  async handleGetOnlineUsers(@ConnectedSocket() client: AuthenticatedSocket) {
    if (!client.userId || !client.token) {
      client.emit('auth:error', {
        error: 'Authentication required',
        code: 'TOKEN_REQUIRED',
      });
      return { error: 'Unauthorized' };
    }

    // Быстрая проверка токена (без API запроса)
    const userId = await this.authService.verifyTokenFast(client.token);
    if (!userId || userId !== client.userId) {
      client.emit('auth:token-expired', {
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
      });
      return { error: 'Token expired', code: 'TOKEN_EXPIRED' };
    }

    try {
      const onlineUsers = await this.redisService.getOnlineUsers();
      return { success: true, users: onlineUsers };
    } catch (error) {
      this.logger.error(`Error getting online users: ${error.message}`);
      return { error: 'Failed to get online users' };
    }
  }

  @SubscribeMessage('auth:refresh-token')
  async handleRefreshToken(
    @MessageBody() data: RefreshTokenDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!data.token) {
      return { error: 'Token required' };
    }

    try {
      const userInfo = await this.authService.verifyToken(data.token);

      if (!userInfo) {
        return { error: 'Invalid token' };
      }

      // Обновляем информацию о пользователе в сокете
      client.userId = userInfo.id;
      client.token = data.token;

      // Обновляем статус онлайн
      await this.redisService.setUserOnline(userInfo.id, client.id);

      this.logger.log(
        `Token refreshed for user ${userInfo.id} on socket ${client.id}`,
      );

      return { success: true, userId: userInfo.id };
    } catch (error) {
      this.logger.error(`Error refreshing token: ${error.message}`);
      return { error: 'Failed to refresh token' };
    }
  }

  @SubscribeMessage('message:mark-read')
  async handleMarkMessagesAsRead(
    @MessageBody() data: { chatId: string; messageIds?: string[] },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.userId || !client.token) {
      client.emit('auth:error', {
        error: 'Authentication required',
        code: 'TOKEN_REQUIRED',
      });
      return { error: 'Unauthorized' };
    }

    // Быстрая проверка токена
    const userId = await this.authService.verifyTokenFast(client.token);
    if (!userId || userId !== client.userId) {
      client.emit('auth:token-expired', {
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
      });
      return { error: 'Token expired', code: 'TOKEN_EXPIRED' };
    }

    try {
      const chat = await this.messagesService.getChatById(data.chatId);
      if (
        !chat ||
        (chat.buyer_id !== client.userId && chat.seller_id !== client.userId)
      ) {
        return { error: 'Access denied' };
      }

      // Если указаны конкретные сообщения, отмечаем их
      // Иначе отмечаем все сообщения в чате
      if (data.messageIds && data.messageIds.length > 0) {
        await Promise.all(
          data.messageIds.map((msgId) =>
            this.messagesService.markMessageAsRead(
              msgId,
              client.userId as number,
            ),
          ),
        );
      } else {
        await this.messagesService.markChatMessagesAsRead(
          data.chatId,
          client.userId,
        );
      }

      // Получаем обновленный счетчик
      const unreadCount = await this.messagesService.getUnreadCountForChat(
        data.chatId,
        client.userId,
      );

      // Отправляем обновление клиенту
      client.emit('unread:updated', {
        chatId: data.chatId,
        unreadCount: unreadCount,
      });

      // Уведомляем собеседника что его сообщения прочитаны
      const recipientId =
        chat.buyer_id === client.userId ? chat.seller_id : chat.buyer_id;

      this.server.to(`user:${recipientId}`).emit('message:read', {
        chatId: data.chatId,
        userId: client.userId, // кто прочитал
      });

      this.logger.log(
        `Messages marked as read in chat ${data.chatId} by user ${client.userId}, notified user ${recipientId}`,
      );

      return { success: true, unreadCount };
    } catch (error) {
      this.logger.error(`Error marking messages as read: ${error.message}`);
      return { error: 'Failed to mark messages as read' };
    }
  }
}
