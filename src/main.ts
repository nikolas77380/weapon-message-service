import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { Pool } from 'pg';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // Проверяем подключение к базе данных и существование таблиц
  try {
    const pool = app.get<Pool>('DATABASE_POOL');
    const result = await pool.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'chat' 
        AND table_name IN ('chats', 'messages', 'read_messages', 'chat_context')
      ORDER BY table_name
    `);
    logger.log(`✅ Database connection successful. Found ${result.rows.length} tables in chat schema:`);
    result.rows.forEach((row) => {
      logger.log(`   - ${row.table_schema}.${row.table_name}`);
    });
  } catch (error) {
    logger.error('❌ Database connection check failed:', error.message);
  }

  // Логирование всех входящих запросов для отладки
  app.use((req: any, res: any, next: any) => {
    logger.debug(`${req.method} ${req.url}`);
    next();
  });

  // Глобальный exception filter для обработки ошибок
  app.useGlobalFilters(new HttpExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false, // Разрешаем дополнительные поля для обратной совместимости
      transform: true,
      transformOptions: {
        enableImplicitConversion: true, // Автоматическое преобразование типов
      },
    }),
  );

  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['Content-Type', 'Authorization'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`🚀 Message service is running on port ${port}`);
  console.log(`📡 Available routes:`);
  console.log(`   POST   /api/chats`);
  console.log(`   GET    /api/chats`);
  console.log(`   GET    /api/chats/:chatId`);
}
bootstrap();
