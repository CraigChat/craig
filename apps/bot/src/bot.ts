import { DexareClient, BaseConfig } from 'dexare';
import config from 'config';
import path from 'node:path';
import Eris from 'eris';
import { SlashCreatorOptions } from 'slash-create';
import LoggerModule from './modules/logger';
import SlashModule from './modules/slash';
import { iterateFolder } from 'dexare/lib/util';
import ShardingModule from './modules/sharding';
import RecorderModule from './modules/recorder';
import AutorecordModule from './modules/autoRecord';
import { prisma } from './prisma';
import { client as redisClient } from './redis';

export const PRODUCTION = process.env.NODE_ENV === 'production';

export interface CraigBotConfig extends BaseConfig {
  applicationID: string;
  prefix: string | string[];
  mentionPrefix: boolean;
  status: Eris.ActivityPartial<Eris.BotActivityType>;

  craig: {
    emoji: string;
    downloadDomain: string;
    homepage: string;
    recordingFolder: string;
    removeNickname: boolean;
    sizeLimit: number;
    inviteID?: string;
    rewardTiers: { [tier: string]: RewardTier };
  };

  logger: {
    level: string;
    inspectOptions?: any;
  };

  slash: {
    creator?: SlashCreatorOptions;
  };
}

export interface RewardTier {
  recordHours: number;
  downloadExpiryHours: number;
  features: string[];
}

export class CraigBot extends DexareClient<CraigBotConfig> {
  _shard?: Eris.Shard;

  constructor(config: CraigBotConfig) {
    super(config);
  }

  get shard() {
    if (!this._shard) this._shard = this.bot.shards.values().next().value;
    return this._shard;
  }

  get prisma() {
    return prisma;
  }
}

const dexareConfig = Object.assign({}, config.get('dexare')) as CraigBotConfig;
if (process.env.SHARD_ID !== undefined && process.env.SHARD_COUNT !== undefined) {
  dexareConfig.erisOptions = Object.assign({}, dexareConfig.erisOptions, {
    firstShardID: parseInt(process.env.SHARD_ID, 10),
    lastShardID: parseInt(process.env.SHARD_ID, 10),
    maxShards: parseInt(process.env.SHARD_COUNT, 10)
  });
}
export const client = new CraigBot(dexareConfig);
client.loadModules(LoggerModule, SlashModule, ShardingModule, RecorderModule, AutorecordModule);
client.commands.registerDefaults(['eval', 'ping', 'kill', 'exec', 'load', 'unload', 'reload']);

// Makes custom emojis with the name 'craig' work as prefixes
client.events.register(
  'prefixer',
  'messageCreate',
  (event, message) => {
    if (/^<a?:craig:\d+>,?/.test(message.content)) event.set('prefix', message.content.match(/^<a?:craig:\d+>,?/)![0]);
  },
  { after: ['commands'] }
);

process.once('SIGINT', async () => {
  client.emit('logger', 'warn', 'sys', ['Caught SIGINT']);
  await client.disconnect();
  process.exit(0);
});

process.once('beforeExit', async () => {
  client.emit('logger', 'warn', 'sys', ['Exiting....']);
  await client.disconnect();
  process.exit(0);
});

export async function connect() {
  await iterateFolder(path.join(__dirname, config.get('commandsPath' as string)), async (file) =>
    client.commands.register(require(file))
  );
  await redisClient.connect();
  await client.connect();
  client.bot.editStatus('online', client.config.status);
}

export async function disconnect() {
  await client.disconnect();
  redisClient.disconnect();
}
