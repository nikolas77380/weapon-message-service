import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { MessagesModule } from '../messages/messages.module';
import { RedisModule } from '../redis/redis.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [MessagesModule, RedisModule, AuthModule],
  providers: [ChatGateway],
})
export class GatewayModule {}

