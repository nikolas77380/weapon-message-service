import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { AuthService } from '../../auth/auth.service';

interface AuthenticatedSocket extends Socket {
  userId?: number;
  token?: string;
}

@Injectable()
export class WsAuthGuard implements CanActivate {
  private readonly logger = new Logger(WsAuthGuard.name);

  constructor(private authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: AuthenticatedSocket = context.switchToWs().getClient();
    
    // Получаем токен из query параметров или auth объекта
    const token = 
      client.handshake.query.token as string ||
      client.handshake.auth?.token as string ||
      client.token;

    if (!token) {
      this.logger.warn(`No token provided for socket ${client.id}`);
      throw new WsException('Authentication token required');
    }

    // Проверяем токен
    const userInfo = await this.authService.verifyToken(token);

    if (!userInfo) {
      this.logger.warn(`Invalid token for socket ${client.id}`);
      throw new WsException('Invalid or expired token');
    }

    // Сохраняем информацию о пользователе в сокете
    client.userId = userInfo.id;
    client.token = token;

    return true;
  }
}

