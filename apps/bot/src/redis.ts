import config from 'config';
import Redis, { RedisOptions } from 'ioredis';

const redisConfig: RedisOptions = config.get('redis');
export const client = new Redis({
  host: redisConfig.host || 'localhost',
  port: redisConfig.port || 6379,
  keyPrefix: redisConfig.keyPrefix || 'craig:',
  lazyConnect: true
});

interface Cooldown {
  uses: number;
  expires: number;
}

interface Maintenence {
  message: string;
}

export async function processCooldown(key: string, duration: number, uses: number) {
  const currentTime = Date.now();
  const cooldownString = await client.get(`cooldown:${key}`);
  const cooldown: Cooldown = cooldownString ? JSON.parse(cooldownString) : { uses, expires: currentTime + duration * 1000 };
  cooldown.uses--;
  if (cooldown.uses <= 0 && currentTime < cooldown.expires) return cooldown;
  const expiry = (cooldown.expires - currentTime) / 1000;
  if (Math.round(expiry) > 0) await client.set(`cooldown:${key}`, JSON.stringify(cooldown), 'EX', Math.round(expiry));
  return true;
}

export async function checkMaintenence(clientId: string): Promise<Maintenence | false> {
  const maintenenceString = await client.get(`maintenence:${clientId}`);
  if (!maintenenceString) return false;
  return JSON.parse(maintenenceString);
}

export async function setMaintenence(clientId: string, data: Maintenence): Promise<void> {
  await client.set(`maintenence:${clientId}`, JSON.stringify(data));
}

export async function removeMaintenence(clientId: string): Promise<void> {
  await client.del(`maintenence:${clientId}`);
}
