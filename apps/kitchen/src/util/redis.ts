import { JobUpdate, SavedJobsJSON } from '@craig/types/kitchen';
import { default as RedisModule } from 'ioredis';

import { REDIS_OPTIONS, UNIQUE_KITCHEN_ID } from './config.js';

// https://github.com/luin/ioredis/issues/1642
const Redis = RedisModule.default;

export const redis = new Redis(REDIS_OPTIONS);

export function writeSavedJobs(payload: SavedJobsJSON) {
  return redis.set(`savedJobs:${UNIQUE_KITCHEN_ID}`, JSON.stringify(payload), 'EX', 60 * 60 * 6);
}

export async function readSavedJobs() {
  const json = await redis.get(`savedJobs:${UNIQUE_KITCHEN_ID}`);
  if (!json) return null;
  return JSON.parse(json) as SavedJobsJSON;
}

export async function deleteSavedJobs() {
  return redis.del(`savedJobs:${UNIQUE_KITCHEN_ID}`);
}

export async function setStreamOpen(jobId: string) {
  return redis.set(`streamOpen:${jobId}`, '1', 'EX', 60 * 60 * 6);
}

export async function deleteStreamOpen(jobId: string) {
  return redis.del(`streamOpen:${jobId}`);
}

export async function pushJob(jobId: string, data: JobUpdate) {
  return redis.publish(`craig:job:${jobId}`, JSON.stringify(data));
}
