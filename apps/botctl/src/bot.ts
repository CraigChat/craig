import { Logger } from '@craig/logger';
import { Client } from '@projectdysnomia/dysnomia';
import { GatewayServer, SlashCreator } from 'slash-create';

import CtlCommand from './commands/ctl.js';
import { type BotCTLConfig, getConfig } from './config.js';
import { EndpointStore } from './store.js';

export class BotCTLBot {
  readonly config: BotCTLConfig;
  readonly bot: Client;
  readonly creator: SlashCreator;
  readonly store: EndpointStore;
  readonly logger: Logger;
  private interactionHandler?: (event: any) => void;

  constructor(config = getConfig()) {
    if (!config.discordToken) throw new Error('BOTCTL_DISCORD_TOKEN is required.');
    if (!config.discordApplicationID) throw new Error('BOTCTL_DISCORD_APPLICATION_ID is required.');

    this.config = config;
    this.logger = new Logger('botctl', { level: config.loggerLevel });
    this.store = new EndpointStore(config.storePath);
    this.bot = new Client(config.discordToken, {
      allowedMentions: {
        everyone: false,
        roles: false,
        users: true
      },
      gateway: {
        intents: ['guilds']
      }
    });
    this.creator = new SlashCreator({
      token: config.discordToken,
      applicationID: config.discordApplicationID,
      client: this,
      allowedMentions: {
        everyone: false,
        roles: false,
        users: true
      }
    });
  }

  async start() {
    this.creator.withServer(
      new GatewayServer((handler) => {
        this.interactionHandler = (event: any) => {
          if (event.t === 'INTERACTION_CREATE') handler(event.d);
        };
        this.bot.on('rawWS', this.interactionHandler);
      })
    );

    this.creator.registerCommand(new CtlCommand(this.creator));
    this.creator.on('warn', (message) => this.logger.warn(message));
    this.creator.on('error', (error) => this.logger.error(error.stack || error.toString()));
    this.creator.on('commandRun', (command, _, ctx) =>
      this.logger.info(`${ctx.user.username} (${ctx.user.id}) ran /${command.commandName} ${ctx.subcommands.join(' ')}`)
    );
    this.creator.on('commandError', (command, error) =>
      this.logger.error(`Command ${command.commandName} errored:`, error.stack || error.toString())
    );

    this.bot.on('error', (error) => this.logger.error(error));
    this.bot.on('warn', (message) => this.logger.warn(message));
    this.bot.on('ready', () => {
      this.logger.info('Craig BotCTL Discord bot ready.');
      if (process.send) process.send('ready');
    });
    this.bot.connect();
  }

  async stop() {
    if (this.interactionHandler) this.bot.removeListener('rawWS', this.interactionHandler);
    this.bot.disconnect({ reconnect: false });
  }
}
