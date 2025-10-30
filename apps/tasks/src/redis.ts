import config from 'config';
import Redis, { RedisOptions } from 'ioredis';

const redisConfig: RedisOptions = config.get('redis');
export const client = new Redis({
  host: redisConfig.host || 'localhost',
  port: redisConfig.port || 6379,
  password: (redisConfig as any).password || undefined,
  keyPrefix: redisConfig.keyPrefix || 'craig:',
  lazyConnect: true
});

export interface ReadyState {
  message?: string;
  file?: string;
  time?: string;
  progress?: number;
}

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
