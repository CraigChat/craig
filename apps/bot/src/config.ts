import path from 'node:path';

import type Dysnomia from '@projectdysnomia/dysnomia';
import type { RedisOptions } from 'ioredis';
import type { SlashCreatorOptions } from 'slash-create';

export interface RewardTier {
  recordHours: number;
  downloadExpiryHours: number;
  features: string[];
  sizeLimitMult?: number;
  discordSkuId?: string;
}

export interface CraigBotConfig {
  token: string;
  applicationID: string;
  elevated: string[];
  gateway: Dysnomia.ClientOptions['gateway'];
  prefix: string | string[];
  mentionPrefix: boolean;
  status: Dysnomia.ActivityPartial<Dysnomia.ActivityType>;
  kitchenURL?: string;

  craig: {
    emoji: string;
    downloadProtocol: string;
    downloadDomain: string;
    dashboardURL: string;
    systemNotificationURL?: string;
    nowRecordingOpus?: string;
    homepage: string;
    recordingFolder: string;
    alistair?: boolean;
    sizeLimit: number;
    sizeLimitWeb: number;
    sizeLimitWebOpus: number;
    inviteID?: string;
    webapp: {
      on: boolean;
      url: string;
      token: string;
      connectUrl: string;
    };
    rewardTiers: Record<string, RewardTier>;
    entitlementWebhookURLs?: { url: string; key: string }[];
  };

  logger: {
    level: string;
    inspectOptions?: unknown;
  };

  slash: {
    creator?: Partial<SlashCreatorOptions>;
  };
}

function intFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number.`);
  return parsed;
}

function optionalIntFromEnv(name: string): number | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number.`);
  return parsed;
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function listFromEnv(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

const defaultRewardTiers: Record<string, RewardTier> = {
  '-1': {
    recordHours: 24,
    downloadExpiryHours: 720,
    features: ['mix', 'auto', 'drive', 'glowers', 'eccontinuous', 'ecflac', 'mp3']
  },
  '0': {
    recordHours: 6,
    downloadExpiryHours: 168,
    features: []
  },
  '10': {
    recordHours: 6,
    downloadExpiryHours: 336,
    features: ['drive', 'glowers'],
    sizeLimitMult: 2
  },
  '20': {
    recordHours: 24,
    downloadExpiryHours: 720,
    features: ['mix', 'auto', 'drive', 'glowers', 'eccontinuous'],
    sizeLimitMult: 2
  },
  '30': {
    recordHours: 24,
    downloadExpiryHours: 720,
    features: ['mix', 'auto', 'drive', 'glowers', 'eccontinuous', 'ecflac'],
    sizeLimitMult: 2
  },
  '100': {
    recordHours: 24,
    downloadExpiryHours: 720,
    features: ['mix', 'auto', 'drive', 'glowers', 'eccontinuous', 'ecflac', 'mp3'],
    sizeLimitMult: 5
  }
};

function rewardTiersFromEnv(): Record<string, RewardTier> {
  if (!process.env.REWARD_TIERS_JSON) return defaultRewardTiers;
  return JSON.parse(process.env.REWARD_TIERS_JSON);
}

export function getRedisOptions(): RedisOptions {
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: intFromEnv('REDIS_PORT', 6379),
    db: intFromEnv('REDIS_DATABASE', 0),
    keyPrefix: process.env.REDIS_PREFIX || 'craig:',
    lazyConnect: true
  };
}

export interface SentryOptions {
  dsn: string;
  env?: string;
  sampleRate?: string;
}

export function getSentryOptions(): SentryOptions | null {
  if (!process.env.SENTRY_DSN) return null;
  return {
    dsn: process.env.SENTRY_DSN,
    env: process.env.SENTRY_ENV,
    sampleRate: process.env.SENTRY_SAMPLE_RATE
  };
}

export function getBotConfig(): CraigBotConfig {
  if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required.');
  if (!process.env.BOT_APPLICATION_ID) throw new Error('BOT_APPLICATION_ID is required.');

  const shardId = optionalIntFromEnv('SHARD_ID');
  const shardCount = optionalIntFromEnv('SHARD_COUNT');
  const gateway: NonNullable<Dysnomia.ClientOptions['gateway']> = {
    autoreconnect: true,
    intents: ['guilds', 'guildVoiceStates'],
    ...(shardId !== undefined && shardCount !== undefined
      ? {
          firstShardID: shardId,
          lastShardID: shardId,
          maxShards: shardCount
        }
      : {
          maxShards: 1
        })
  };

  return {
    token: process.env.BOT_TOKEN,
    applicationID: process.env.BOT_APPLICATION_ID,
    elevated: listFromEnv('ELEVATED_USERS'),
    gateway,
    kitchenURL: process.env.KITCHEN_URL || undefined,
    prefix: [],
    mentionPrefix: false,
    status: {
      type: 4,
      name: 'craig',
      state: process.env.BOT_STATUS_TEXT || 'Recording VCs • craig.chat'
    },
    craig: {
      emoji: process.env.CRAIG_EMOJI_ID || '297187944295301122',
      downloadProtocol: process.env.DOWNLOAD_PROTOCOL || 'https',
      downloadDomain: process.env.DOWNLOAD_DOMAIN || 'localhost:5029',
      dashboardURL: process.env.DASHBOARD_URL || 'https://my.craig.chat',
      systemNotificationURL: process.env.SYSTEM_NOTIFICATION_URL,
      nowRecordingOpus: process.env.NOW_RECORDING_OPUS,
      homepage: process.env.CRAIG_HOMEPAGE || 'https://craig.chat/',
      recordingFolder: process.env.REC_DIRECTORY || path.resolve(process.cwd(), '../../rec'),
      alistair: boolFromEnv('CRAIG_ALISTAIR', false),
      sizeLimit: intFromEnv('SIZE_LIMIT', 536870912),
      sizeLimitWeb: intFromEnv('SIZE_LIMIT_WEB', 4294967296),
      sizeLimitWebOpus: intFromEnv('SIZE_LIMIT_WEB_OPUS', 1073741824),
      inviteID: process.env.INVITE_CLIENT_ID || undefined,
      webapp: {
        on: boolFromEnv('WEBAPP_ENABLED', true),
        url: process.env.WEBAPP_URL || 'ws://127.0.0.1:9001/shard',
        token: process.env.WEBAPP_TOKEN || '',
        connectUrl: process.env.WEBAPP_CONNECT_URL || 'http://localhost:5000?id={id}&key={key}'
      },
      rewardTiers: rewardTiersFromEnv(),
      entitlementWebhookURLs: process.env.ENTITLEMENT_WEBHOOKS_JSON ? JSON.parse(process.env.ENTITLEMENT_WEBHOOKS_JSON) : undefined
    },
    logger: {
      level: process.env.LOGGER_LEVEL || 'debug'
    },
    slash: {
      creator: {
        allowedMentions: {
          everyone: false,
          roles: false,
          users: true
        },
        defaultImageFormat: 'png',
        defaultImageSize: 256
      }
    }
  };
}

export interface ShardManagerEnvOptions {
  file: string;
  shardCount?: number;
  concurrency?: number;
  readyTimeout: number;
  respawn: boolean;
  metricsPort?: number;
  control: {
    host: string;
    port?: number;
    token?: string;
    allowEval: boolean;
  };
}

export function getShardManagerEnvOptions(): ShardManagerEnvOptions {
  return {
    file: process.env.BOT_WORKER_FILE || './dist/index.mjs',
    shardCount: optionalIntFromEnv('BOT_SHARD_COUNT'),
    concurrency: optionalIntFromEnv('BOT_SHARD_CONCURRENCY'),
    readyTimeout: intFromEnv('BOT_READY_TIMEOUT', 60000),
    respawn: boolFromEnv('BOT_RESPAWN', true),
    metricsPort: optionalIntFromEnv('METRICS_PORT'),
    control: {
      host: process.env.BOT_CONTROL_HOST || '127.0.0.1',
      port: optionalIntFromEnv('BOT_CONTROL_PORT'),
      token: process.env.BOT_CONTROL_TOKEN,
      allowEval: boolFromEnv('BOT_CONTROL_ALLOW_EVAL', false)
    }
  };
}
