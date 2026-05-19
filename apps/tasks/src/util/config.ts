import './env.js';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ms, { type StringValue } from 'ms';

function listFromEnv(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function boolFromEnv(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function durationFromEnv(name: string, fallback: StringValue): number {
  const value = process.env[name] as StringValue | undefined;
  const parsed = ms(value || fallback);
  if (typeof parsed !== 'number') throw new Error(`${name} must be a valid duration.`);
  return parsed;
}

export const TASKS_TIMEZONE = process.env.TASKS_TIMEZONE || 'America/New_York';
export const TASKS_IGNORE = new Set(listFromEnv('TASKS_IGNORE'));

export const PATREON_REFRESH_CRON = process.env.PATREON_REFRESH_CRON || '0 * * * *';
export const RECORDING_CLEAN_CRON = process.env.RECORDING_CLEAN_CRON || '*/30 * * * *';

export const PATREON_CAMPAIGN_ID = process.env.PATREON_CAMPAIGN_ID || '';
export const PATREON_CLIENT_ID = process.env.PATREON_CLIENT_ID || '';
export const PATREON_CLIENT_SECRET = process.env.PATREON_CLIENT_SECRET || '';
export const PATREON_TIER_MAP: Record<string, number> = JSON.parse(process.env.PATREON_TIER_MAP || '{}');
export const PATREON_CREDENTIALS_FILE = path.resolve(
  process.env.PATREON_CREDENTIALS_FILE || fileURLToPath(new URL('../../config/.patreon-credentials.json', import.meta.url))
);

export const REC_DIRECTORY = fileURLToPath(new URL(process.env.REC_DIRECTORY || '../../../../rec', import.meta.url));
export const RECORDING_FALLBACK_EXPIRATION = durationFromEnv('RECORDING_FALLBACK_EXPIRATION', '24h');
export const RECORDING_SKIP_IDS = new Set(listFromEnv('RECORDING_SKIP_IDS'));
export const RECORDING_SKIP_ALL = boolFromEnv('RECORDING_SKIP_ALL');
