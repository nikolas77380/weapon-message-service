import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { AuthService } from './auth.service';

@Injectable()
export class HttpAuthGuard implements CanActivate {
  private readonly logger = new Logger(HttpAuthGuard.name);

  constructor(private authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      this.logger.warn('Missing or invalid authorization header', {
        url: request.url,
        method: request.method,
      });
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    try {
      const userInfo = await this.authService.verifyToken(token);

      if (!userInfo) {
        this.logger.warn('Invalid or expired token', {
          url: request.url,
          method: request.method,
        });
        throw new UnauthorizedException('Invalid or expired token');
      }

      // Добавляем информацию о пользователе в request
      request.user = userInfo;
      request.userId = userInfo.id;

      this.logger.debug(`User ${userInfo.id} authenticated for ${request.method} ${request.url}`);

      return true;
    } catch (error) {
      this.logger.error('Authentication error', {
        error: error.message,
        url: request.url,
        method: request.method,
      });
      throw error;
    }
  }
}

