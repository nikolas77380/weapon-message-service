import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  database: process.env.DATABASE_NAME || 'weapon-marketplace',
  user: process.env.DATABASE_USERNAME || 'nikolaykipniak',
  password: process.env.DATABASE_PASSWORD || 'desktop0',
  ssl: process.env.DATABASE_SSL === 'true' ? {
    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
  } : false,
  connectionString: process.env.DATABASE_URL,
}));

