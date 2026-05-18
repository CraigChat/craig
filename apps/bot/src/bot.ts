import { prisma } from '@craig/db';
import { Logger } from '@craig/logger';
import type Dysnomia from '@projectdysnomia/dysnomia';
import { Client } from '@projectdysnomia/dysnomia';

import packageJson from '../package.json';
import { type CraigBotConfig, getBotConfig } from './config.js';
import { init as i18nInit } from './i18n.js';
import AutorecordModule from './modules/autorecord.js';
import CacheModule from './modules/cache.js';
import EntitlementsModule from './modules/entitlements.js';
import MetricsModule from './modules/metrics.js';
import RecorderModule from './modules/recorder/index.js';
import ShardingModule from './modules/sharding.js';
import SlashModule from './modules/slash.js';
import UploadModule from './modules/upload.js';
import { client as redisClient } from './redis.js';
import type { LoggerExtra } from './runtime.js';
import { close as closeSentry } from './sentry.js';

export const version = packageJson.version;

export const PRODUCTION = process.env.NODE_ENV === 'production';

export class CraigBot {
  readonly config: CraigBotConfig;
  readonly bot: Dysnomia.Client;
  readonly cache: CacheModule;
  readonly entitlements: EntitlementsModule;
  readonly metrics: MetricsModule;
  readonly recorder: RecorderModule;
  readonly autorecord: AutorecordModule;
  readonly sharding: ShardingModule;
  readonly slash: SlashModule;
  readonly upload: UploadModule;
  readonly commands = {
    logger: {
      debug: (...args: any[]) => this.log('debug', 'commands', args),
      log: (...args: any[]) => this.log('debug', 'commands', args),
      info: (...args: any[]) => this.log('info', 'commands', args),
      warn: (...args: any[]) => this.log('warn', 'commands', args),
      error: (...args: any[]) => this.log('error', 'commands', args)
    }
  };

  _shard?: Dysnomia.Shard;
  private readonly loggers = new Map<string, Logger>();

  constructor(config: CraigBotConfig) {
    this.config = config;
    this.bot = new Client(config.token, {
      requestTimeout: 15000,
      allowedMentions: {
        everyone: false,
        roles: false,
        users: true
      },
      caching: {
        disableMaps: true
      },
      defaultImageFormat: 'png',
      defaultImageSize: 256,
      messageLimit: 0,
      gateway: config.gateway
    });
    this.cache = new CacheModule(this);
    this.entitlements = new EntitlementsModule(this);
    this.metrics = new MetricsModule(this);
    this.recorder = new RecorderModule(this);
    this.autorecord = new AutorecordModule(this);
    this.sharding = new ShardingModule(this);
    this.slash = new SlashModule(this);
    this.upload = new UploadModule(this);
    this.logDysnomiaEvents();
  }

  get shard() {
    if (!this._shard) this._shard = this.bot.shards.values().next().value as Dysnomia.Shard;
    return this._shard;
  }

  get prisma() {
    return prisma;
  }

  get version() {
    return version;
  }

  async connect() {
    this.bot.connect();
  }

  async disconnect() {
    this.bot.disconnect({ reconnect: false });
  }

  async loadModules() {
    await Promise.all([
      this.metrics,
      this.upload,
      this.entitlements,
      this.slash,
      this.sharding,
      this.cache,
      this.recorder,
      this.autorecord
    ].map((mod) => mod._load()))
  }

  logDysnomiaEvents() {
    this.bot.on('error', (error, id) => this.log('error', 'dysnomia', [error]));
    this.bot.removeAllListeners('warn').on('warn', (message, id) => {
      if (
        !((message as unknown) instanceof Error && (message as unknown as Error).message.startsWith('Unknown guild text channel type:')) &&
        !(typeof message === 'string' && message.startsWith('Unhandled MESSAGE_CREATE type'))
      )
        this.log('warn', 'dysnomia', [message]);
    });
    this.bot.on('debug', (message, id) => this.log('debug', 'dysnomia', [message]));
  }

  log(level: string, moduleName: string, args: any[], extra?: LoggerExtra) {
    const logger = this.getLogger(moduleName);
    const logArgs = extra && Object.keys(extra).length > 0 ? [...args, extra] : args;
    switch (level) {
      case 'error':
        logger.error(...logArgs);
        break;
      case 'warn':
        logger.warn(...logArgs);
        break;
      case 'info':
        logger.info(...logArgs);
        break;
      default:
        logger.debug(...logArgs);
        break;
    }
  }

  private getLogger(moduleName: string) {
    const existing = this.loggers.get(moduleName);
    if (existing) return existing;

    const logger = new Logger(moduleName, {
      level: this.config.logger.level || (PRODUCTION ? 'info' : 'debug')
    });
    this.loggers.set(moduleName, logger);
    return logger;
  }
}

export const client = new CraigBot(getBotConfig());

process.once('SIGINT', async () => {
  client.log('warn', 'sys', ['Caught SIGINT']);
  await disconnect();
  process.exit(0);
});

process.once('SIGTERM', async () => {
  client.log('warn', 'sys', ['Caught SIGTERM']);
  await disconnect();
  process.exit(0);
});

process.on('unhandledRejection', (r) => {
  client.log('error', 'sys', ['Unhandled rejection:', r]);
});

process.on('uncaughtException', (e) => {
  client.log('error', 'sys', ['Uncaught exception:', e, ...('errors' in e ? ((e as any).errors as Error[]) : [])]);
});

export async function connect() {
  await client.loadModules();

  await i18nInit();
  await redisClient.connect();
  await client.connect();
  await prisma.$connect();
  client.bot.editStatus('online', client.config.status);

  let botName = 'Craig';
  if (process.env.pm_pid_path && process.env.pm_id) {
    try {
      const pm2Name = process.env.pm_pid_path
        .split('\\')
        .reverse()[0]
        .split('/')
        .reverse()[0]
        .slice(0, -`-${process.env.pm_id}.pid`.length)
        .split('-')
        .join(' ');
      botName = `${pm2Name} [${process.env.pm_id}]`;
    } catch (e) {}
  }

  process.title = `${botName} - ${
    process.env.SHARD_ID ? `Shard #${process.env.SHARD_ID} (of ${process.env.SHARD_COUNT})` : `${client.bot.shards.size} shard(s)`
  }`;
}

export async function disconnect() {
  await client.disconnect();
  await closeSentry();
  await prisma.$disconnect();
  redisClient.disconnect();
}
