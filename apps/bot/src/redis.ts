import { getSemaphore } from '@henrygd/semaphore';
import { Redis, type RedisOptions } from 'ioredis';

import { getRedisOptions } from './config.js';

const redisConfig: RedisOptions = getRedisOptions();
export const client = new Redis(redisConfig);

export async function cacheData<T>(
  { key, ttl, allowThrows = false }: { key: string; ttl: number; allowThrows?: boolean },
  cacher: () => Promise<T>
): Promise<T | null> {
  const sem = getSemaphore(`redis/${key}`);
  await sem.acquire();
  try {
    const cached = await client.get(key);
    if (cached) {
      try {
        return JSON.parse(cached) as T;
      } catch {}
    }
    try {
      const data = await cacher();
      if (data !== undefined && data !== null) {
        await client.set(key, JSON.stringify(data), 'EX', ttl);
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

interface Cooldown {
  uses: number;
  expires: number;
}

interface Maintenance {
  message: string;
}

const processCooldownScript = `
local currentTime = tonumber(ARGV[1])
local duration = tonumber(ARGV[2])
local initialUses = tonumber(ARGV[3])
local cooldownString = redis.call('GET', KEYS[1])
local cooldown

if cooldownString then
  cooldown = cjson.decode(cooldownString)
else
  cooldown = { uses = initialUses, expires = currentTime + duration * 1000 }
end

cooldown.uses = cooldown.uses - 1

if cooldown.uses <= 0 and currentTime < cooldown.expires then
  return { 0, cjson.encode(cooldown) }
end

local expiry = math.floor(((cooldown.expires - currentTime) / 1000) + 0.5)
if expiry > 0 then
  redis.call('SET', KEYS[1], cjson.encode(cooldown), 'EX', expiry)
end

return { 1 }
`;

export async function processCooldown(key: string, duration: number, uses: number) {
  const currentTime = Date.now();
  const [allowed, cooldownString] = (await client.eval(processCooldownScript, 1, `cooldown:${key}`, currentTime, duration, uses)) as [
    number,
    string?
  ];

  if (allowed === 0 && cooldownString) return JSON.parse(cooldownString) as Cooldown;
  return true;
}

export async function checkMaintenance(clientId: string): Promise<Maintenance | false> {
  const maintenanceString = await client.get(`maintenance:${clientId}`);
  if (!maintenanceString) return false;
  return JSON.parse(maintenanceString);
}

export async function setMaintenance(clientId: string, data: Maintenance): Promise<void> {
  await client.set(`maintenance:${clientId}`, JSON.stringify(data));
}

export async function removeMaintenance(clientId: string): Promise<void> {
  await client.del(`maintenance:${clientId}`);
}
