import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthService } from './auth.service';
import { HttpAuthGuard } from './http-auth.guard';
import { RedisModule } from '../redis/redis.module';
import apiConfig from '../config/api.config';

@Module({
  imports: [ConfigModule.forFeature(apiConfig), RedisModule],
  providers: [AuthService, HttpAuthGuard],
  exports: [AuthService, HttpAuthGuard],
})
export class AuthModule {}

