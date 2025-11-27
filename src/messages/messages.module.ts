import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { ChatsController } from './chats.controller';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ChatsController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}

