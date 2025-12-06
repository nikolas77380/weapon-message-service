import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly apiUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.apiUrl =
      this.configService.get<string>('api.marketplaceApiUrl') ||
      'http://localhost:1337';
  }

  /**
   * Send email notification about a new chat message to an offline user.
   * This calls marketplace-api (Strapi) which actually sends the email.
   */
  async sendOfflineChatEmail(params: {
    recipientId: number;
    senderId: number;
    chatId: string;
    messageText: string;
    productId?: number;
  }): Promise<void> {
    this.logger.log(
      `[NOTIFICATIONS] Attempting to send offline chat email: recipient=${params.recipientId}, sender=${params.senderId}, chatId=${params.chatId}, apiUrl=${this.apiUrl}`,
    );
    console.log(
      `[NOTIFICATIONS] Attempting to send offline chat email: recipient=${params.recipientId}, sender=${params.senderId}, chatId=${params.chatId}, apiUrl=${this.apiUrl}`,
    );
    
    try {
      const response = await axios.post(
        `${this.apiUrl}/api/chat-email/offline-message`,
        {
          recipientId: params.recipientId,
          senderId: params.senderId,
          chatId: params.chatId,
          messageText: params.messageText,
          productId: params.productId ?? null,
        },
        {
          timeout: 5000,
        },
      );

      this.logger.log(
        `[NOTIFICATIONS] Offline chat email requested successfully for recipient ${params.recipientId} in chat ${params.chatId}, response status: ${response.status}`,
      );
      console.log(
        `[NOTIFICATIONS] ✅ Offline chat email requested successfully for recipient ${params.recipientId} in chat ${params.chatId}, response status: ${response.status}`,
      );
    } catch (error: any) {
      this.logger.error(
        `[NOTIFICATIONS] ❌ Failed to request offline chat email for recipient ${params.recipientId} in chat ${params.chatId}: ${error.message}`,
        error.response?.data ? JSON.stringify(error.response.data) : '',
        error.stack,
      );
      console.error(
        `[NOTIFICATIONS] ❌ Failed to request offline chat email:`,
        {
          recipientId: params.recipientId,
          chatId: params.chatId,
          error: error.message,
          response: error.response?.data,
          status: error.response?.status,
        },
      );
      throw error; // Пробрасываем ошибку дальше для обработки в gateway
    }
  }
}


