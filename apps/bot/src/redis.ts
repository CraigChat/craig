import Redis, { RedisOptions } from 'ioredis';
import config from 'config';

const redisConfig: RedisOptions = config.get('redis');
export const client = new Redis({
  host: redisConfig.host || 'localhost',
  port: redisConfig.port || 6379,
  keyPrefix: redisConfig.keyPrefix || 'craig:',
  lazyConnect: true
});
