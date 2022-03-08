import Redis from 'ioredis';

export const client = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
  keyPrefix: 'craig:'
});
