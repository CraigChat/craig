import type { CraigBot } from './bot.js';

export interface LoggerExtra {
  [key: string]: unknown;
}

export interface ModuleOptions {
  name: string;
  description?: string;
}

export class BotModule {
  readonly client: CraigBot;
  readonly options: ModuleOptions;
  loaded = false;

  constructor(client: CraigBot, options: ModuleOptions) {
    this.client = client;
    this.options = options;
  }

  get logger() {
    const moduleName = this.options.name;
    return {
      debug: (...args: any[]) => this.client.log('debug', moduleName, args),
      log: (...args: any[]) => this.client.log('debug', moduleName, args),
      info: (...args: any[]) => this.client.log('info', moduleName, args),
      warn: (...args: any[]) => this.client.log('warn', moduleName, args),
      error: (...args: any[]) => this.client.log('error', moduleName, args)
    };
  }

  async _load() {
    this.loaded = true;
    await this.load();
  }

  load(): void | Promise<void> {}

  unload(): void | Promise<void> {}
}
