import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';

export interface Message {
  id: string;
  chat_id: string;
  sender_id: number;
  text?: string; // Для обратной совместимости, реальное поле в БД - content
  content?: string; // Реальное поле в БД
  product_id?: number;
  created_at: Date;
}

export interface Chat {
  id: string;
  buyer_id: number;
  seller_id: number;
  created_at: Date;
}

@Injectable()
export class MessagesService {
  constructor(@Inject('DATABASE_POOL') private pool: Pool) {}

  async getChatById(chatId: string): Promise<Chat | null> {
    const result = await this.pool.query(
      'SELECT * FROM chat.chats WHERE id = $1',
      [chatId],
    );
    return result.rows[0] || null;
  }

  async getChatByUsers(
    buyerId: number,
    sellerId: number,
  ): Promise<Chat | null> {
    const result = await this.pool.query(
      `SELECT * FROM chat.chats 
       WHERE (buyer_id = $1 AND seller_id = $2) 
          OR (buyer_id = $2 AND seller_id = $1)`,
      [buyerId, sellerId],
    );
    return result.rows[0] || null;
  }

  async createChat(
    buyerId: number,
    sellerId: number,
    productId?: number,
  ): Promise<Chat> {
    const result = await this.pool.query(
      `INSERT INTO chat.chats (buyer_id, seller_id) 
       VALUES ($1, $2) 
       ON CONFLICT (buyer_id, seller_id) 
       DO UPDATE SET buyer_id = EXCLUDED.buyer_id
       RETURNING *`,
      [buyerId, sellerId],
    );
    const chat = result.rows[0];

    if (productId && chat) {
      const context = await this.getChatContext(chat.id);

      if (!context || !context.current_product_id) {
        await this.updateChatContext(chat.id, productId);
      } else {
        await this.createProductContextMessage(chat.id, buyerId, productId);
      }
    }

    return chat;
  }

  private async createProductContextMessage(
    chatId: string,
    senderId: number,
    productId: number,
  ): Promise<void> {
    const lastProduct = await this.pool.query(
      `SELECT product_id
       FROM chat.messages
       WHERE chat_id = $1
         AND product_id IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [chatId],
    );

    if (lastProduct.rows[0]?.product_id === productId) {
      return;
    }

    await this.pool.query(
      `INSERT INTO chat.messages (chat_id, sender_id, content, product_id)
       VALUES ($1, $2, $3, $4)`,
      [chatId, senderId, '', productId],
    );
  }

  /**
   * Обновляет контекст чата (текущий продукт)
   * Контекст устанавливается только при создании чата, если его еще нет
   * После начала переписки контекст не меняется - каждый продукт отображается в своих сообщениях
   */
  async updateChatContext(chatId: string, newProductId: number): Promise<void> {
    // Проверяем, есть ли уже сообщения в чате
    const messagesCount = await this.pool.query(
      `SELECT COUNT(*) as count
       FROM chat.messages
       WHERE chat_id = $1`,
      [chatId],
    );

    const hasMessages = parseInt(messagesCount.rows[0].count, 10) > 0;

    // Если в чате уже есть сообщения, не меняем контекст
    // Каждый продукт будет отображаться в своих сообщениях через product_id
    if (hasMessages) {
      return;
    }

    // Если сообщений нет, устанавливаем контекст только если его еще нет
    const contextResult = await this.pool.query(
      `SELECT current_product_id 
       FROM chat.chat_context 
       WHERE chat_id = $1`,
      [chatId],
    );

    const existingContext = contextResult.rows[0];

    if (!existingContext || !existingContext.current_product_id) {
      // Контекста нет - создаем его
      await this.pool.query(
        `INSERT INTO chat.chat_context (chat_id, current_product_id, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (chat_id)
         DO UPDATE SET current_product_id = $2, updated_at = NOW()`,
        [chatId, newProductId],
      );
    }
    // Если контекст уже есть - не меняем его
  }

  /**
   * Получает текущий продукт из контекста чата
   */
  async getChatContext(
    chatId: string,
  ): Promise<{ current_product_id: number | null } | null> {
    const result = await this.pool.query(
      `SELECT current_product_id 
       FROM chat.chat_context 
       WHERE chat_id = $1`,
      [chatId],
    );
    return result.rows[0] || null;
  }

  async createMessage(
    chatId: string,
    senderId: number,
    text: string,
    productId?: number,
  ): Promise<Message> {
    const result = await this.pool.query(
      `INSERT INTO chat.messages (chat_id, sender_id, content, product_id) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, chat_id, sender_id, content as text, product_id, created_at`,
      [chatId, senderId, text, productId || null],
    );
    return result.rows[0];
  }

  async getMessages(
    chatId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<Message[]> {
    const result = await this.pool.query(
      `SELECT id, chat_id, sender_id, content as text, product_id, created_at 
       FROM chat.messages 
       WHERE chat_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [chatId, limit, offset],
    );
    return result.rows.reverse(); // Возвращаем в хронологическом порядке
  }

  async getUserChats(userId: number): Promise<Chat[]> {
    const result = await this.pool.query(
      `SELECT c.*, 
              COALESCE(ucs.is_archived, FALSE) as is_archived,
              COALESCE(ucs.is_favorite, FALSE) as is_favorite
       FROM chat.chats c
       LEFT JOIN chat.user_chat_settings ucs ON c.id = ucs.chat_id AND ucs.user_id = $1
       WHERE c.buyer_id = $1 OR c.seller_id = $1 
       ORDER BY c.created_at DESC`,
      [userId],
    );
    return result.rows;
  }

  /**
   * Получает последнее сообщение для чата
   */
  async getLastMessage(chatId: string): Promise<Message | null> {
    const result = await this.pool.query(
      `SELECT id, chat_id, sender_id, content as text, product_id, created_at 
       FROM chat.messages 
       WHERE chat_id = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [chatId],
    );
    return result.rows[0] || null;
  }

  /**
   * Получает последние сообщения для списка чатов
   */
  async getLastMessagesForChats(
    chatIds: string[],
  ): Promise<Map<string, Message>> {
    if (chatIds.length === 0) {
      return new Map();
    }

    // Используем подзапрос для получения последнего сообщения каждого чата
    const result = await this.pool.query(
      `SELECT m.id, m.chat_id, m.sender_id, m.content as text, m.product_id, m.created_at
       FROM chat.messages m
       INNER JOIN (
         SELECT chat_id, MAX(created_at) as max_created_at
         FROM chat.messages
         WHERE chat_id = ANY($1::uuid[])
         GROUP BY chat_id
       ) latest ON m.chat_id = latest.chat_id AND m.created_at = latest.max_created_at
       WHERE m.chat_id = ANY($1::uuid[])`,
      [chatIds],
    );

    const messagesMap = new Map<string, Message>();
    result.rows.forEach((row) => {
      messagesMap.set(row.chat_id, row);
    });

    return messagesMap;
  }

  async getChatMessages(
    chatId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<Message[]> {
    return this.getMessages(chatId, limit, offset);
  }

  async markChatAsRead(chatId: string, userId: number): Promise<void> {
    // Пока просто логируем, можно добавить таблицу read_messages позже
    // Для MVP можно использовать Redis для отслеживания прочитанных сообщений
    await this.pool.query(
      `UPDATE chat.messages 
       SET created_at = created_at 
       WHERE chat_id = $1 AND sender_id != $2`,
      [chatId, userId],
    );
  }

  async markMessagesAsRead(
    messageIds: string[],
    userId: number,
  ): Promise<void> {
    // Аналогично - можно добавить таблицу read_messages позже
    if (messageIds.length === 0) return;

    await this.pool.query(
      `UPDATE chat.messages 
       SET created_at = created_at 
       WHERE id = ANY($1::uuid[]) AND sender_id != $2`,
      [messageIds, userId],
    );
  }

  async updateChatStatus(chatId: string, status: string): Promise<Chat | null> {
    // Добавим колонку status в таблицу chats если её нет
    // Пока просто возвращаем чат
    const result = await this.pool.query(
      `SELECT * FROM chat.chats WHERE id = $1`,
      [chatId],
    );
    return result.rows[0] || null;
  }

  async getChatWithMessages(
    chatId: string,
    userId: number,
  ): Promise<(Chat & { messages: Message[] }) | null> {
    const chatResult = await this.pool.query(
      `SELECT * FROM chat.chats WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2)`,
      [chatId, userId],
    );

    if (chatResult.rows.length === 0) {
      return null;
    }

    const messages = await this.getMessages(chatId, 100, 0);

    return {
      ...chatResult.rows[0],
      messages,
    };
  }

  /**
   * Mark a single message as read by a user
   */
  async markMessageAsRead(messageId: string, userId: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO chat.read_messages (message_id, user_id, read_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (message_id, user_id) DO NOTHING`,
      [messageId, userId],
    );
  }

  /**
   * Mark all messages in a chat as read by a user
   */
  async markChatMessagesAsRead(chatId: string, userId: number): Promise<void> {
    // Mark all messages in the chat that weren't sent by this user
    await this.pool.query(
      `INSERT INTO chat.read_messages (message_id, user_id, read_at)
       SELECT m.id, $2, NOW()
       FROM chat.messages m
       WHERE m.chat_id = $1 AND m.sender_id != $2
       ON CONFLICT (message_id, user_id) DO NOTHING`,
      [chatId, userId],
    );
  }

  /**
   * Get unread message count for a specific chat
   */
  async getUnreadCountForChat(chatId: string, userId: number): Promise<number> {
    const result = await this.pool.query(
      `SELECT COUNT(*)::int as count
       FROM chat.messages m
       WHERE m.chat_id = $1 
         AND m.sender_id != $2
         AND NOT EXISTS (
           SELECT 1 FROM chat.read_messages rm 
           WHERE rm.message_id = m.id AND rm.user_id = $2
         )`,
      [chatId, userId],
    );
    return result.rows[0]?.count || 0;
  }

  /**
   * Get unread message counts for all of a user's chats
   * Returns a Map of chatId -> unread count
   */
  async getUnreadCountsForUserChats(
    userId: number,
  ): Promise<Map<string, number>> {
    const result = await this.pool.query(
      `SELECT 
         m.chat_id,
         COUNT(*)::int as unread_count
       FROM chat.messages m
       INNER JOIN chat.chats c ON m.chat_id = c.id
       WHERE (c.buyer_id = $1 OR c.seller_id = $1)
         AND m.sender_id != $1
         AND NOT EXISTS (
           SELECT 1 FROM chat.read_messages rm 
           WHERE rm.message_id = m.id AND rm.user_id = $1
         )
       GROUP BY m.chat_id`,
      [userId],
    );

    const unreadCounts = new Map<string, number>();
    result.rows.forEach((row) => {
      unreadCounts.set(row.chat_id, row.unread_count);
    });
    return unreadCounts;
  }

  /**
   * Get list of unread message IDs for a chat
   */
  async getUnreadMessageIds(chatId: string, userId: number): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT m.id
       FROM chat.messages m
       WHERE m.chat_id = $1 
         AND m.sender_id != $2
         AND NOT EXISTS (
           SELECT 1 FROM chat.read_messages rm 
           WHERE rm.message_id = m.id AND rm.user_id = $2
         )
       ORDER BY m.created_at ASC`,
      [chatId, userId],
    );
    return result.rows.map((row) => row.id);
  }

  /**
   * Check if a message has been read by a user
   */
  async isMessageRead(messageId: string, userId: number): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT EXISTS(
         SELECT 1 FROM chat.read_messages 
         WHERE message_id = $1 AND user_id = $2
       ) as is_read`,
      [messageId, userId],
    );
    return result.rows[0]?.is_read || false;
  }

  /**
   * Get read status for multiple messages
   * Returns a Map of messageId -> isRead
   */
  async getMessagesReadStatus(
    messageIds: string[],
    userId: number,
  ): Promise<Map<string, boolean>> {
    if (messageIds.length === 0) {
      return new Map();
    }

    const result = await this.pool.query(
      `SELECT message_id
       FROM chat.read_messages
       WHERE message_id = ANY($1::uuid[]) AND user_id = $2`,
      [messageIds, userId],
    );

    const readStatus = new Map<string, boolean>();
    // Initialize all as unread
    messageIds.forEach((id) => readStatus.set(id, false));
    // Mark read ones as true
    result.rows.forEach((row) => readStatus.set(row.message_id, true));

    return readStatus;
  }

  /**
   * Toggle archive status for a chat
   */
  async toggleChatArchive(
    chatId: string,
    userId: number,
    isArchived: boolean,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO chat.user_chat_settings (chat_id, user_id, is_archived, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (chat_id, user_id) 
       DO UPDATE SET is_archived = $3, updated_at = NOW()`,
      [chatId, userId, isArchived],
    );
  }

  /**
   * Toggle favorite status for a chat
   */
  async toggleChatFavorite(
    chatId: string,
    userId: number,
    isFavorite: boolean,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO chat.user_chat_settings (chat_id, user_id, is_favorite, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (chat_id, user_id) 
       DO UPDATE SET is_favorite = $3, updated_at = NOW()`,
      [chatId, userId, isFavorite],
    );
  }

  /**
   * Get chat settings for a user
   */
  async getChatSettings(
    chatId: string,
    userId: number,
  ): Promise<{ is_archived: boolean; is_favorite: boolean } | null> {
    const result = await this.pool.query(
      `SELECT is_archived, is_favorite
       FROM chat.user_chat_settings
       WHERE chat_id = $1 AND user_id = $2`,
      [chatId, userId],
    );
    return result.rows[0] || { is_archived: false, is_favorite: false };
  }
}
