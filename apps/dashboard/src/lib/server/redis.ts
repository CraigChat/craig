import Redis from 'ioredis';
import jwt from 'jsonwebtoken';

import { REDIS_OPTIONS } from './config';
import { getSemaphore } from '@henrygd/semaphore';
import { json, type RequestEvent } from '@sveltejs/kit';
import { JWT_SECRET } from '$env/static/private';

export const redis = new Redis(REDIS_OPTIONS);

export async function cacheData<T>(
  { key, ttl, allowThrows = false }: { key: string; ttl: number; allowThrows?: boolean },
  cacher: () => Promise<T>
): Promise<T | null> {
  const sem = getSemaphore(`redis/${key}`);
  await sem.acquire();
  try {
    const cached = await redis.get(key);
    if (cached) {
      try {
        return JSON.parse(cached) as T;
      } catch {}
    }
    try {
      const data = await cacher();
      if (data !== undefined && data !== null) {
        await redis.set(key, JSON.stringify(data), 'EX', ttl);
        return data;
      }
    } catch (e) {
      if (allowThrows) throw e;
      return null;
    }
    return null;
  } finally {
    sem.release();
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  reset: number;
};

export async function rateLimit(
  key: string,
  limit: number,
  ttlSeconds: number
): Promise<RateLimitResult> {
  try {
    const current = await redis.incr(key);
    if (current === 1) await redis.expire(key, ttlSeconds);
    else {
      const ttl = await redis.ttl(key);
      if (ttl === -1) await redis.expire(key, ttlSeconds);
    }

    const ttl = await redis.ttl(key);
    const allowed = current <= limit;

    return {
      allowed,
      remaining: Math.max(0, limit - current),
      reset: ttl > 0 ? ttl : ttlSeconds
    };
  } catch (e) {
    return {
      allowed: true,
      remaining: Number.POSITIVE_INFINITY,
      reset: 0
    };
  }
}

export async function rateLimitRequest(
  event: Pick<RequestEvent, 'cookies' | 'getClientAddress'>,
  { prefix, limit, window }: { prefix: string; limit: number; window: number }
) {
  let id = `ip:${event.getClientAddress()}`;
  try {
    const session = event.cookies.get('session');
    if (session) {
      const decoded: any = jwt.verify(session, JWT_SECRET);
      if (decoded?.id) id = `user:${decoded.id}`;
    }
  } catch {}

  const key = `rl:${id}:${prefix}`;
  const rl = await rateLimit(key, limit, window);
  if (!rl.allowed) return json({ error: 'Rate limited' }, { status: 429 });
}
