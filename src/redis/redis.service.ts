import { Injectable, Inject, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject('REDIS_CLIENT') private redis: Redis) {}

  getClient(): Redis {
    return this.redis;
  }

  // Статус онлайн пользователя
  async setUserOnline(userId: number, socketId: string): Promise<void> {
    const key = `user:${userId}:online`;
    await this.redis.setex(key, 300, socketId); // 5 минут TTL
    await this.redis.sadd('online:users', userId.toString());
    this.logger.debug(`Set user ${userId} as online in Redis (key: ${key}, TTL: 300s)`);
  }

  async removeUserOnline(userId: number): Promise<void> {
    const key = `user:${userId}:online`;
    await this.redis.del(key);
    await this.redis.srem('online:users', userId.toString());
    this.logger.debug(`Removed user ${userId} online status from Redis (key: ${key})`);
  }

  async isUserOnline(userId: number): Promise<boolean> {
    const key = `user:${userId}:online`;
    const result = await this.redis.exists(key);
    const isOnline = result === 1;
    this.logger.debug(`User ${userId} online status check: ${isOnline} (key: ${key})`);
    return isOnline;
  }

  async getOnlineUsers(): Promise<number[]> {
    const userIds = await this.redis.smembers('online:users');
    // Проверяем, что пользователи действительно онлайн
    const onlineUserIds: number[] = [];
    for (const userId of userIds) {
      if (await this.isUserOnline(parseInt(userId, 10))) {
        onlineUserIds.push(parseInt(userId, 10));
      } else {
        await this.redis.srem('online:users', userId);
      }
    }
    return onlineUserIds;
  }

  // Статус "is typing"
  async setUserTyping(chatId: string, userId: number): Promise<void> {
    const key = `chat:${chatId}:typing:${userId}`;
    await this.redis.setex(key, 10, '1'); // 10 секунд TTL
  }

  async removeUserTyping(chatId: string, userId: number): Promise<void> {
    const key = `chat:${chatId}:typing:${userId}`;
    await this.redis.del(key);
  }

  async getTypingUsers(chatId: string): Promise<number[]> {
    const pattern = `chat:${chatId}:typing:*`;
    const keys = await this.redis.keys(pattern);
    const userIds: number[] = [];
    
    for (const key of keys) {
      const userId = key.split(':').pop();
      if (userId) {
        userIds.push(parseInt(userId, 10));
      }
    }
    
    return userIds;
  }

  // Кеширование проверки токена
  async cacheTokenVerification(token: string, userId: number, ttl: number = 600): Promise<void> {
    const key = `token:${token}:user`;
    await this.redis.setex(key, ttl, userId.toString());
  }

  async getCachedTokenUserId(token: string): Promise<number | null> {
    const key = `token:${token}:user`;
    const userId = await this.redis.get(key);
    return userId ? parseInt(userId, 10) : null;
  }

  async invalidateTokenCache(token: string): Promise<void> {
    const key = `token:${token}:user`;
    await this.redis.del(key);
  }

  // Кеширование связи socketId -> userId
  async cacheSocketUser(socketId: string, userId: number, ttl: number = 3600): Promise<void> {
    const key = `socket:${socketId}:user`;
    await this.redis.setex(key, ttl, userId.toString());
  }

  async getCachedSocketUser(socketId: string): Promise<number | null> {
    const key = `socket:${socketId}:user`;
    const userId = await this.redis.get(key);
    return userId ? parseInt(userId, 10) : null;
  }

  async invalidateSocketCache(socketId: string): Promise<void> {
    const key = `socket:${socketId}:user`;
    await this.redis.del(key);
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}

