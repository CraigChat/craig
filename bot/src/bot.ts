import { DexareClient, BaseConfig } from 'dexare';
import config from 'config';
import path from 'node:path';
import Eris from 'eris';
import LoggerModule from './modules/logger';
import SlashModule from './modules/slash';
import { SlashCreatorOptions } from 'slash-create';
import { iterateFolder } from 'dexare/lib/util';

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
    inviteID?: string;
  };

  logger: {
    level: string;
    inspectOptions?: any;
  };

  slash: {
    creator?: SlashCreatorOptions;
  };
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
}

export const client = new CraigBot(config.get('dexare') as CraigBotConfig);

client.loadModules(LoggerModule, SlashModule);
client.commands.registerDefaults(['eval', 'ping', 'kill', 'exec', 'load', 'unload', 'reload']);

// Makes custom emojis with the name 'craig' work as prefixes
client.events.register(
  'prefixer',
  'messageCreate',
  (event, message) => {
    if (message.content.startsWith('<:craig:') && /^<a?:craig:\d+>/.test(message.content))
      event.set('prefix', message.content.match(/^<a?:craig:\d+>/)![0]);
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
  await client.connect();
  client.bot.editStatus('online', client.config.status);
}

export async function disconnect() {
  await client.disconnect();
}
