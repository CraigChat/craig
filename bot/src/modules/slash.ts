import { DexareModule, DexareClient, BaseConfig } from 'dexare';
import { GatewayServer, SlashCreator, SlashCreatorOptions } from 'slash-create';
import path from 'node:path';

export interface SlashConfig extends BaseConfig {
  applicationID: string;
  slash?: SlashModuleOptions;
}

export interface SlashModuleOptions {
  creator?: SlashCreatorOptions;
}

export default class SlashModule<T extends DexareClient<SlashConfig>> extends DexareModule<T> {
  creator: SlashCreator;

  constructor(client: T) {
    super(client, {
      name: 'slash',
      description: 'Slash command handler'
    });

    this.creator = new SlashCreator({
      ...(this.client.config.slash?.creator ?? {}),
      token: this.client.config.token,
      applicationID: this.client.config.applicationID,
      client
    });
    this.filePath = __filename;
  }

  load() {
    this.creator
      .withServer(
        new GatewayServer((handler) =>
          this.registerEvent('rawWS', (_, event) => {
            if (event.t === 'INTERACTION_CREATE') handler(event.d as any);
          })
        )
      )
      .registerCommandsIn(path.join(__dirname, '../commands'));

    this.creator.on('warn', (message) => this.logger.warn(message));
    this.creator.on('error', (error) => this.logger.error(error.stack || error.toString()));
    this.creator.on('commandRun', (command, _, ctx) =>
      this.logger.debug(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) ran command ${command.commandName}`
      )
    );
    this.creator.on('commandError', (command, error) => {
      this.logger.error(`Command ${command.commandName} errored:`, error.stack || error.toString());
    });
  }

  unload() {
    this.unregisterAllEvents();
  }

  get config() {
    return this.client.config.slash;
  }
}
