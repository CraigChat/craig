import ShardManager, { CommandHandler } from './manager';

export interface ModuleOptions {
  name: string;
  requires?: string[];
  description?: string;
}

export default class ShardManagerModule {
  readonly options: ModuleOptions;
  readonly manager: ShardManager;
  loaded = false;
  filePath?: string;
  registeredCommands: string[] = [];

  constructor(manager: ShardManager, options: ModuleOptions) {
    this.options = options;
    this.manager = manager;
  }

  /** @hidden */
  async _load() {
    this.loaded = true;
    await this.load();
  }

  registerCommand(name: string, handler: CommandHandler) {
    this.registeredCommands.push(name);
    this.manager.commands.set(name, handler);
  }

  unregisterCommand(name: string) {
    const index = this.registeredCommands.indexOf(name);
    if (index === -1) return;
    this.registeredCommands.splice(index, 1);
    this.manager.commands.delete(name);
  }

  unregisterAllCommands() {
    for (const name of this.registeredCommands) this.manager.commands.delete(name);
    this.registeredCommands = [];
  }

  /** Fired when this module is loaded. */
  load() {}

  /** Fired when this module is being unloaded. */
  unload() {}
}
