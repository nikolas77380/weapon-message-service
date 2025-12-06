import { Injectable, Logger, UnauthorizedException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import * as jwt from 'jsonwebtoken';
import Redis from 'ioredis';

export interface UserInfo {
  id: number;
  email: string;
  username: string;
  [key: string]: any;
}

interface JWTPayload {
  id: number;
  iat?: number;
  exp?: number;
  [key: string]: any;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly apiUrl: string;
  private readonly tokenCacheTTL = 600; // 10 минут кеш для токена

  constructor(
    private configService: ConfigService,
    @Inject('REDIS_CLIENT') private redis: Redis,
  ) {
    this.apiUrl = this.configService.get<string>('api.marketplaceApiUrl') || 'http://localhost:1337';
  }

  /**
   * Быстрая проверка JWT токена без запроса к API (только проверка exp)
   * @param token JWT токен
   * @returns userId если токен валиден, null если истек
   */
  private parseTokenLocally(token: string): number | null {
    try {
      // Парсим токен без верификации подписи (для проверки exp)
      const decoded = jwt.decode(token) as JWTPayload | null;
      
      if (!decoded || !decoded.id) {
        return null;
      }

      // Проверяем exp если он есть
      if (decoded.exp) {
        const now = Math.floor(Date.now() / 1000);
        if (decoded.exp < now) {
          return null; // Токен истек
        }
      }

      return decoded.id;
    } catch (error) {
      this.logger.debug(`Failed to parse token locally: ${error.message}`);
      return null;
    }
  }

  /**
   * Проверяет JWT токен через marketplace-api (полная проверка)
   * @param token JWT токен
   * @param useCache использовать ли кеш
   * @returns Информация о пользователе или null если токен невалиден
   */
  async verifyToken(token: string, useCache: boolean = true): Promise<UserInfo | null> {
    if (!token) {
      return null;
    }

    // Сначала проверяем кеш
    if (useCache) {
      const cachedUserId = await this.redis.get(`token:${token}:user`);
      if (cachedUserId) {
        // Токен в кеше, возвращаем минимальную информацию
        return {
          id: parseInt(cachedUserId, 10),
          email: '',
          username: '',
        };
      }
    }

    // Быстрая локальная проверка exp
    const localUserId = this.parseTokenLocally(token);
    if (!localUserId) {
      return null; // Токен истек локально
    }

    // Полная проверка через API
    try {
      const response = await axios.get(`${this.apiUrl}/api/users/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10 секунд таймаут (увеличено для медленных соединений)
      });

      if (response.data && response.data.id) {
        const userInfo = response.data as UserInfo;
        
        // Кешируем результат
        if (useCache) {
          await this.redis.setex(
            `token:${token}:user`,
            this.tokenCacheTTL,
            userInfo.id.toString()
          );
        }

        return userInfo;
      }

      return null;
    } catch (error) {
      if (error instanceof AxiosError) {
        const status = error.response?.status;
        const statusText = error.response?.statusText || 'Unknown';
        const errorCode = error.code;
        
        // Проверяем ошибки сети (нет response)
        // ECONNABORTED - таймаут запроса
        // ECONNREFUSED - соединение отклонено
        // ETIMEDOUT - таймаут соединения
        // ENOTFOUND - хост не найден
        if (errorCode === 'ECONNREFUSED' || errorCode === 'ETIMEDOUT' || errorCode === 'ENOTFOUND' || errorCode === 'ECONNABORTED') {
          this.logger.warn(`Cannot connect to marketplace-api at ${this.apiUrl}: ${errorCode}${errorCode === 'ECONNABORTED' ? ' (timeout)' : ''}`);
          // Если API недоступен, но токен валиден локально, разрешаем доступ
          // (fallback для высокой доступности)
          if (localUserId) {
            this.logger.warn(`API unavailable (${errorCode}), using local token validation for user ${localUserId}`);
            return {
              id: localUserId,
              email: '',
              username: '',
            };
          }
          throw new UnauthorizedException('Authentication service unavailable');
        }
        
        // Проверяем HTTP статусы
        if (status === 401) {
          // Токен истек или невалиден
          this.logger.debug(`Token verification failed: 401 Unauthorized`);
          return null;
        }
        if (status === 403) {
          // Доступ запрещен
          this.logger.debug(`Token verification failed: 403 Forbidden`);
          return null;
        }
        if (status === 500 || status === 502 || status === 503 || status === 504) {
          // Серверная ошибка API - используем fallback на локальную проверку
          this.logger.warn(
            `Marketplace API returned ${status} ${statusText}, using local token validation as fallback`
          );
          if (localUserId) {
            this.logger.warn(`Using local token validation for user ${localUserId} due to API error`);
            return {
              id: localUserId,
              email: '',
              username: '',
            };
          }
          // Если токен невалиден локально, возвращаем null
          return null;
        }
        
        // Другие ошибки HTTP
        if (status) {
          this.logger.error(
            `Unexpected HTTP error verifying token: ${status} ${statusText}`,
            error.response?.data
          );
        } else {
          // AxiosError без response (сетевая ошибка)
          this.logger.error(
            `Network error verifying token: ${errorCode || 'Unknown'} - ${error.message}`,
            error.stack
          );
        }
      } else if (error instanceof Error) {
        this.logger.error(`Error verifying token: ${error.message}`, error.stack);
      } else {
        this.logger.error(`Unknown error verifying token:`, error);
      }

      // В случае любой другой ошибки, если токен валиден локально, используем fallback
      if (localUserId) {
        this.logger.warn(`Using local token validation for user ${localUserId} due to error`);
        return {
          id: localUserId,
          email: '',
          username: '',
        };
      }

      return null;
    }
  }

  /**
   * Быстрая проверка токена (только локальная проверка exp, без запроса к API)
   * @param token JWT токен
   * @returns userId если токен валиден, null если истек
   */
  async verifyTokenFast(token: string): Promise<number | null> {
    if (!token) {
      return null;
    }

    // Проверяем кеш
    const cachedUserId = await this.redis.get(`token:${token}:user`);
    if (cachedUserId) {
      return parseInt(cachedUserId, 10);
    }

    // Локальная проверка exp
    return this.parseTokenLocally(token);
  }

  /**
   * Проверяет, истек ли токен (быстрая проверка без API)
   * @param token JWT токен
   * @returns true если токен истек
   */
  async isTokenExpired(token: string): Promise<boolean> {
    const userId = await this.verifyTokenFast(token);
    return userId === null;
  }

  /**
   * Инвалидирует кеш токена
   * @param token JWT токен
   */
  async invalidateTokenCache(token: string): Promise<void> {
    await this.redis.del(`token:${token}:user`);
  }
}

