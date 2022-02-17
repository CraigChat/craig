import { DexareClient, BaseConfig } from 'dexare';
import config from 'config';
import path from 'path';
import LoggerModule from './modules/logger';
import Eris from 'eris';

export const PRODUCTION = process.env.NODE_ENV === 'production';

export interface CraigBotConfig extends BaseConfig {
  prefix: string | string[];
  mentionPrefix: boolean;

  status: Eris.ActivityPartial<Eris.BotActivityType>;

  logger: {
    level: string;
    inspectOptions?: any;
  };
}

export class CraigBot extends DexareClient<CraigBotConfig> {
  _shard?: Eris.Shard;

  constructor(config: CraigBotConfig) {
    super(config);
  }

  get shard() {
    if (!this._shard)
      this._shard = this.bot.shards.get(this.bot.shards.keys().next().value);
    return this._shard;
  }
}

export const client = new CraigBot(config.get('dexare') as CraigBotConfig);

client.loadModules(LoggerModule);
client.commands.registerDefaults(['eval', 'help', 'ping', 'kill', 'exec', 'load', 'unload', 'reload']);
client.commands.registerFromFolder(path.join(config.get('commandsPath' as string)));

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

client.events.register('main', 'interactionCreate', async (event, interaction) => {
  if (interaction.type === 1) return interaction.pong();
});

export async function connect() {
  await client.connect();
  client.bot.editStatus('online', client.config.status);
}

export async function disconnect() {
  await client.disconnect();
}
