import Redis from 'ioredis';
import type { ReadyState } from './util/cook';

export const client = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
  keyPrefix: 'craig:',
  lazyConnect: true
});

export async function getReadyState(recordingId: string) {
  const data = await client.get(`ready:${recordingId}`);
  if (!data) return null;
  return JSON.parse(data);
}

export async function setReadyState(recordingId: string, data: ReadyState) {
  return await client.set(`ready:${recordingId}`, JSON.stringify(data), 'EX', 60 * 5);
}

export async function clearReadyState(recordingId: string) {
  return await client.del(`ready:${recordingId}`);
}
