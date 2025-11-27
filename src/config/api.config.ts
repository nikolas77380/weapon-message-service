import { registerAs } from '@nestjs/config';

export default registerAs('api', () => ({
  marketplaceApiUrl: process.env.MARKETPLACE_API_URL || 'http://localhost:1337',
}));

