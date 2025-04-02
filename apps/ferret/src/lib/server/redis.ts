import Redis from 'ioredis';

import { REDIS_OPTIONS } from './config';

export const REDIS_JOB_CHANNEL_PREFIX = 'craig:job:';

export const redis = new Redis(REDIS_OPTIONS);

export const redisSub = new Redis(REDIS_OPTIONS);

export async function isStreamOpen(jobId: string) {
  return !!(await redis.exists(`streamOpen:${jobId}`));
}
