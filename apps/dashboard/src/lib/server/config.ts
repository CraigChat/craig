import type { RedisOptions } from 'ioredis';

import { dev } from '$app/env';
import { REDIS_DATABASE, REDIS_HOST, REDIS_PORT, REDIS_PREFIX } from '$app/env/private';

export const debug = dev;

export const REDIS_OPTIONS: RedisOptions = {
  host: REDIS_HOST || 'localhost',
  port: REDIS_PORT ? parseInt(REDIS_PORT, 10) : 6379,
  db: REDIS_DATABASE ? parseInt(REDIS_DATABASE, 10) : 0,
  keyPrefix: REDIS_PREFIX || 'craig:',
  lazyConnect: true
};
