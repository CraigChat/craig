import { fileURLToPath } from 'node:url';

import type { RedisOptions } from 'ioredis';

import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

export const debug = dev;

const rootDir = '../../../../..';
export const KITCHEN_URL = env.KITCHEN_URL;
export const REC_DIRECTORY = fileURLToPath(new URL(env.REC_DIRECTORY || `${rootDir}/rec`, import.meta.url));
export const DOWNLOADS_DIRECTORY = fileURLToPath(new URL(env.DOWNLOADS_DIRECTORY || `${rootDir}/downloads`, import.meta.url));

export const REDIS_OPTIONS: RedisOptions = {
  host: env.REDIS_HOST || 'localhost',
  port: env.REDIS_PORT ? parseInt(env.REDIS_PORT, 10) : 6379,
  db: env.REDIS_DATABASE ? parseInt(env.REDIS_DATABASE, 10) : 0,
  keyPrefix: env.REDIS_PREFIX || 'craig:',
  lazyConnect: true
};
