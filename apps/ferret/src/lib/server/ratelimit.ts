import { logger } from './logger';
import { redis } from './redis';

export interface RateLimit {
  name: string;
  limit: number;
  windowSeconds: number;
}

export const RateLimits = {
  api: { name: 'api', limit: 120, windowSeconds: 60 },
  write: { name: 'write', limit: 10, windowSeconds: 60 },
  failedKey: { name: 'failed_key', limit: 10, windowSeconds: 600 }
} satisfies Record<string, RateLimit>;

function windowKey(rl: RateLimit, id: string) {
  const window = Math.floor(Date.now() / 1000 / rl.windowSeconds);
  return { key: `ratelimit:${rl.name}:${id}:${window}`, resetsIn: (window + 1) * rl.windowSeconds - Math.floor(Date.now() / 1000) };
}

export async function hitRateLimit(rl: RateLimit, id: string): Promise<number | null> {
  const { key, resetsIn } = windowKey(rl, id);
  try {
    const results = await redis.multi().incr(key).expire(key, rl.windowSeconds).exec();
    const count = results?.[0]?.[1] as number | undefined;
    return count !== undefined && count > rl.limit ? resetsIn : null;
  } catch (e) {
    logger.error(`Failed to check rate limit ${rl.name}`, e);
    return null;
  }
}

export async function checkRateLimit(rl: RateLimit, id: string): Promise<number | null> {
  const { key, resetsIn } = windowKey(rl, id);
  try {
    const count = parseInt((await redis.get(key)) ?? '0', 10);
    return count >= rl.limit ? resetsIn : null;
  } catch (e) {
    logger.error(`Failed to check rate limit ${rl.name}`, e);
    return null;
  }
}
