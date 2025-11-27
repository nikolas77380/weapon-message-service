import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import databaseConfig from '../config/database.config';

const databasePoolFactory = {
  provide: 'DATABASE_POOL',
  useFactory: (configService: ConfigService) => {
    const dbConfig = configService.get('database');

    const poolConfig = dbConfig.connectionString
      ? { connectionString: dbConfig.connectionString }
      : {
          host: dbConfig.host,
          port: dbConfig.port,
          database: dbConfig.database,
          user: dbConfig.user,
          password: dbConfig.password,
          ssl: dbConfig.ssl,
        };

    const pool = new Pool({
      ...poolConfig,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000,
    });

    // Ensure all queries use fully qualified schema.table names
    // Don't modify search_path to avoid conflicts with public.messages table

    // Проверяем подключение и существование таблиц при создании пула
    pool.on('connect', async (client) => {
      try {
        // Проверяем, что мы подключены к правильной базе данных
        const dbResult = await client.query(
          'SELECT current_database(), current_user',
        );
        const dbName = dbResult.rows[0].current_database;
        const dbUser = dbResult.rows[0].current_user;
        console.log(`[Database] Connected to: ${dbName} as ${dbUser}`);

        // Проверяем существование схемы chat
        const schemaCheck = await client.query(`
          SELECT EXISTS(
            SELECT 1 FROM information_schema.schemata WHERE schema_name = 'chat'
          ) as exists
        `);

        if (!schemaCheck.rows[0].exists) {
          console.error(
            `[Database] ❌ Schema 'chat' does not exist in database ${dbName}!`,
          );
          return;
        }

        // Проверяем существование таблиц в схеме chat
        const tablesResult = await client.query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'chat' 
            AND table_name IN ('chats', 'messages', 'read_messages', 'chat_context')
          ORDER BY table_name
        `);

        const foundTables = tablesResult.rows.map((r) => r.table_name);
        const expectedTables = [
          'chats',
          'messages',
          'read_messages',
          'chat_context',
        ];
        const missingTables = expectedTables.filter(
          (t) => !foundTables.includes(t),
        );

        if (tablesResult.rows.length === 4) {
          console.log(
            `[Database] ✅ All required tables found in chat schema: ${foundTables.join(', ')}`,
          );
        } else {
          console.warn(
            `[Database] ⚠️  Only ${tablesResult.rows.length}/4 tables found: ${foundTables.join(', ')}`,
          );
          if (missingTables.length > 0) {
            console.error(
              `[Database] ❌ Missing tables: ${missingTables.join(', ')}`,
            );
            console.error(
              `[Database] Please run migration: migrations/001_create_read_messages_table.sql`,
            );
          }
        }

        // Дополнительная проверка через pg_tables
        const pgTablesResult = await client.query(`
          SELECT tablename 
          FROM pg_tables 
          WHERE schemaname = 'chat' 
            AND tablename IN ('chats', 'messages', 'read_messages', 'chat_context')
          ORDER BY tablename
        `);
        console.log(
          `[Database] pg_tables check: ${pgTablesResult.rows.map((r) => r.tablename).join(', ')}`,
        );
      } catch (error) {
        console.error('[Database] Error checking connection:', error.message);
        console.error('[Database] Error stack:', error.stack);
      }
    });

    return pool;
  },
  inject: [ConfigService],
};

@Global()
@Module({
  imports: [ConfigModule.forFeature(databaseConfig)],
  providers: [databasePoolFactory],
  exports: ['DATABASE_POOL'],
})
export class DatabaseModule {}
