import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import redisConfig from '../config/redis.config';
import { RedisService } from './redis.service';

const redisFactory = {
  provide: 'REDIS_CLIENT',
  useFactory: (configService: ConfigService) => {
    const redisConfig = configService.get('redis');
    
    if (redisConfig.url) {
      return new Redis(redisConfig.url);
    }
    
    return new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
      db: redisConfig.db,
    });
  },
  inject: [ConfigService],
};

@Global()
@Module({
  imports: [ConfigModule.forFeature(redisConfig)],
  providers: [redisFactory, RedisService],
  exports: ['REDIS_CLIENT', RedisService],
})
export class RedisModule {}

