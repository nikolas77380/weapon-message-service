import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  UseGuards,
  Request,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  HttpException,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import { HttpAuthGuard } from '../auth/http-auth.guard';
import { CreateChatDto } from './dto/create-chat.dto';
import { FinishChatDto } from './dto/finish-chat.dto';
import { MarkAsReadDto } from './dto/mark-as-read.dto';
import { ToggleChatSettingDto } from './dto/toggle-chat-setting.dto';

@Controller('api/chats')
export class ChatsController {
  constructor(private messagesService: MessagesService) {}

  @Get()
  @UseGuards(HttpAuthGuard)
  async getUserChats(@Request() req) {
    const userId = req.userId;
    const chats = await this.messagesService.getUserChats(userId);

    // Получаем контекст (продукт), последние сообщения и непрочитанные счетчики для каждого чата
    const chatIds = chats.map((chat) => chat.id);
    const [contexts, lastMessages, unreadCounts] = await Promise.all([
      Promise.all(
        chats.map(async (chat) => ({
          chatId: chat.id,
          context: await this.messagesService.getChatContext(chat.id),
        })),
      ),
      this.messagesService.getLastMessagesForChats(chatIds),
      this.messagesService.getUnreadCountsForUserChats(userId),
    ]);

    const chatsWithContext = chats.map((chat) => {
      const contextData = contexts.find((c) => c.chatId === chat.id);
      const lastMessage = lastMessages.get(chat.id);
      const unreadCount = unreadCounts.get(chat.id) || 0;

      // getChatContext возвращает { current_product_id: number | null } | null
      const currentProductId = contextData?.context?.current_product_id ?? null;

      console.log(`[getUserChats] Chat ${chat.id}:`, {
        contextData,
        currentProductId,
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              text: (lastMessage as any).content || (lastMessage as any).text,
              created_at: lastMessage.created_at,
            }
          : null,
      });

      return {
        id: chat.id,
        buyer_id: chat.buyer_id,
        seller_id: chat.seller_id,
        created_at: chat.created_at,
        current_product_id: currentProductId,
        unread_count: unreadCount,
        is_archived: (chat as any).is_archived || false,
        is_favorite: (chat as any).is_favorite || false,
        last_message: lastMessage
          ? {
              id: lastMessage.id,
              text: (lastMessage as any).content || (lastMessage as any).text,
              sender_id: lastMessage.sender_id,
              created_at: lastMessage.created_at,
            }
          : null,
      };
    });

    return chatsWithContext;
  }

  @Post()
  @UseGuards(HttpAuthGuard)
  async createChat(@Request() req, @Body() createChatDto: CreateChatDto) {
    const userId = req.userId;
    const { participantIds, productId } = createChatDto;

    if (!participantIds || participantIds.length === 0) {
      throw new BadRequestException('At least one participant is required');
    }

    // Находим второго участника (не текущего пользователя)
    const otherParticipantId = participantIds.find((id) => id !== userId);

    if (!otherParticipantId) {
      throw new BadRequestException('Cannot create chat with yourself');
    }

    // Определяем buyer и seller (текущий пользователь - buyer, другой - seller)
    const buyerId = userId;
    const sellerId = otherParticipantId;

    try {
      // Создаем чат с продуктом (если передан)
      const chat = await this.messagesService.createChat(
        buyerId,
        sellerId,
        createChatDto.productId,
      );

      return {
        id: chat.id,
        buyer_id: chat.buyer_id,
        seller_id: chat.seller_id,
        created_at: chat.created_at,
      };
    } catch (error) {
      throw new HttpException(
        'Failed to create chat',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':chatId')
  @UseGuards(HttpAuthGuard)
  async getChat(@Request() req, @Param('chatId') chatId: string) {
    const userId = req.userId;
    const chat = await this.messagesService.getChatWithMessages(chatId, userId);

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    // Получаем контекст чата (текущий продукт)
    const context = await this.messagesService.getChatContext(chatId);

    return {
      id: chat.id,
      buyer_id: chat.buyer_id,
      seller_id: chat.seller_id,
      created_at: chat.created_at,
      current_product_id: context?.current_product_id || null,
      messages: chat.messages.map((msg) => ({
        id: msg.id,
        chat_id: msg.chat_id,
        sender_id: msg.sender_id,
        text: (msg as any).content || (msg as any).text,
        product_id: msg.product_id,
        created_at: msg.created_at,
      })),
    };
  }

  @Get(':chatId/messages')
  @UseGuards(HttpAuthGuard)
  async getChatMessages(
    @Request() req,
    @Param('chatId') chatId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    const userId = req.userId;

    // Проверяем, что пользователь имеет доступ к чату
    const chat = await this.messagesService.getChatById(chatId);
    if (!chat || (chat.buyer_id !== userId && chat.seller_id !== userId)) {
      throw new NotFoundException('Chat not found or access denied');
    }

    const messages = await this.messagesService.getChatMessages(
      chatId,
      limit,
      offset,
    );

    // Получаем статус прочитанности для всех сообщений
    const messageIds = messages.map((msg) => msg.id);
    const readStatus = await this.messagesService.getMessagesReadStatus(
      messageIds,
      userId,
    );

    // Определяем получателя (другого участника чата)
    const recipientId =
      chat.buyer_id === userId ? chat.seller_id : chat.buyer_id;

    // Получаем статус прочитанности для собственных сообщений (прочитал ли получатель)
    const ownMessagesReadStatus =
      await this.messagesService.getMessagesReadStatus(
        messageIds.filter((id) => {
          const msg = messages.find((m) => m.id === id);
          return msg && msg.sender_id === userId;
        }),
        recipientId,
      );

    return messages.map((msg) => {
      // Для собственных сообщений проверяем, прочитал ли их получатель
      // Для чужих сообщений проверяем, прочитали ли мы их
      const isOwnMessage = msg.sender_id === userId;
      const isRead = isOwnMessage
        ? ownMessagesReadStatus.get(msg.id) || false
        : readStatus.get(msg.id) || false;

      console.log(`[getChatMessages] Message ${msg.id}:`, {
        sender_id: msg.sender_id,
        userId,
        isOwnMessage,
        isRead,
        readStatus: readStatus.has(msg.id),
        ownReadStatus: ownMessagesReadStatus.has(msg.id),
      });

      return {
        id: msg.id,
        chat_id: msg.chat_id,
        sender_id: msg.sender_id,
        text: (msg as any).content || (msg as any).text,
        product_id: msg.product_id,
        created_at: msg.created_at,
        is_read: isRead,
      };
    });
  }

  @Put(':chatId/mark-read')
  @UseGuards(HttpAuthGuard)
  async markChatAsRead(@Request() req, @Param('chatId') chatId: string) {
    const userId = req.userId;

    // Проверяем доступ
    const chat = await this.messagesService.getChatById(chatId);
    if (!chat || (chat.buyer_id !== userId && chat.seller_id !== userId)) {
      throw new NotFoundException('Chat not found or access denied');
    }

    // Используем новый метод для пометки всех сообщений как прочитанных
    await this.messagesService.markChatMessagesAsRead(chatId, userId);

    // Возвращаем обновленный счетчик непрочитанных (должен быть 0)
    const unreadCount = await this.messagesService.getUnreadCountForChat(
      chatId,
      userId,
    );

    return { success: true, unread_count: unreadCount };
  }

  @Put(':chatId/finish')
  @UseGuards(HttpAuthGuard)
  async finishChat(
    @Request() req,
    @Param('chatId') chatId: string,
    @Body() finishChatDto: FinishChatDto,
  ) {
    const userId = req.userId;

    // Проверяем доступ
    const chat = await this.messagesService.getChatById(chatId);
    if (!chat || (chat.buyer_id !== userId && chat.seller_id !== userId)) {
      throw new NotFoundException('Chat not found or access denied');
    }

    const updatedChat = await this.messagesService.updateChatStatus(
      chatId,
      finishChatDto.status,
    );

    if (!updatedChat) {
      throw new HttpException(
        'Failed to update chat status',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return {
      id: updatedChat.id,
      buyer_id: updatedChat.buyer_id,
      seller_id: updatedChat.seller_id,
      created_at: updatedChat.created_at,
    };
  }

  @Put('messages/mark-read')
  @UseGuards(HttpAuthGuard)
  async markMessagesAsRead(
    @Request() req,
    @Body() markAsReadDto: MarkAsReadDto,
  ) {
    const userId = req.userId;

    if (!markAsReadDto.messageIds || markAsReadDto.messageIds.length === 0) {
      return { success: true };
    }

    await this.messagesService.markMessagesAsRead(
      markAsReadDto.messageIds,
      userId,
    );

    return { success: true };
  }

  @Put(':chatId/archive')
  @UseGuards(HttpAuthGuard)
  async toggleArchive(
    @Request() req,
    @Param('chatId') chatId: string,
    @Body() dto: ToggleChatSettingDto,
  ) {
    const userId = req.userId;

    // Проверяем доступ
    const chat = await this.messagesService.getChatById(chatId);
    if (!chat || (chat.buyer_id !== userId && chat.seller_id !== userId)) {
      throw new NotFoundException('Chat not found or access denied');
    }

    await this.messagesService.toggleChatArchive(chatId, userId, dto.value);

    return { success: true, is_archived: dto.value };
  }

  @Put(':chatId/favorite')
  @UseGuards(HttpAuthGuard)
  async toggleFavorite(
    @Request() req,
    @Param('chatId') chatId: string,
    @Body() dto: ToggleChatSettingDto,
  ) {
    const userId = req.userId;

    // Проверяем доступ
    const chat = await this.messagesService.getChatById(chatId);
    if (!chat || (chat.buyer_id !== userId && chat.seller_id !== userId)) {
      throw new NotFoundException('Chat not found or access denied');
    }

    await this.messagesService.toggleChatFavorite(chatId, userId, dto.value);

    return { success: true, is_favorite: dto.value };
  }
}
