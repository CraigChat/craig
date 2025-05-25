import './env.js';

import { fileURLToPath } from 'node:url';

import { RedisOptions } from 'ioredis';
import ms from 'ms';

export const TMP_DIRECTORY = fileURLToPath(new URL(process.env.TMP_DIRECTORY || '../../.tmp', import.meta.url));
export const REC_DIRECTORY = fileURLToPath(new URL(process.env.REC_DIRECTORY || '../../../../rec', import.meta.url));
export const OUTPUT_DIRECTORY = fileURLToPath(new URL(process.env.OUTPUT_DIRECTORY || '../../../../output', import.meta.url));
export const DOWNLOADS_DIRECTORY = fileURLToPath(new URL(process.env.DOWNLOADS_DIRECTORY || '../../../../downloads', import.meta.url));

export const JOB_EXPIRATION = ms((process.env.JOB_EXPIRATION as ms.StringValue) || '1d');
export const TMP_EXPIRATION = ms((process.env.TMP_EXPIRATION as ms.StringValue) || '6h');

export const SAVE_JOBS = process.env.SAVE_JOBS === 'true';
export const KITCHEN_CRON_TIME = process.env.KITCHEN_CRON_TIME || '0 * * * *';
export const KITCHEN_CLEAN_FILES = process.env.KITCHEN_CLEAN_FILES !== 'false';
export const QUEUE_SIZE = process.env.QUEUE_SIZE ? parseInt(process.env.QUEUE_SIZE, 10) : null;

export const PROC_NICENESS = process.env.PROC_NICENESS ? parseInt(process.env.PROC_NICENESS, 10) : 10;
export const PROC_TASKSET_CPU_MAP = process.env.PROC_TASKSET_CPU_MAP ?? null;
export const PROC_IONICE = process.env.PROC_IONICE ? parseInt(process.env.PROC_IONICE, 10) : 3;
export const PROC_CHRT_IDLE = process.env.PROC_CHRT_IDLE === 'true';

export const UNIQUE_KITCHEN_ID = process.env.UNIQUE_KITCHEN_ID || 'primary';

export const AVATAR_CDN = process.env.AVATAR_CDN;

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

export const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
export const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
export const MICROSOFT_CLIENT_REDIRECT = process.env.MICROSOFT_CLIENT_REDIRECT;

export const DROPBOX_CLIENT_ID = process.env.DROPBOX_CLIENT_ID;
export const DROPBOX_CLIENT_SECRET = process.env.DROPBOX_CLIENT_SECRET;
export const DROPBOX_FOLDER_NAME = process.env.DROPBOX_FOLDER_NAME;

export const REDIS_OPTIONS: RedisOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
  db: process.env.REDIS_DATABASE ? parseInt(process.env.REDIS_DATABASE, 10) : 0,
  keyPrefix: process.env.REDIS_PREFIX || 'craig:',
  lazyConnect: true
};
