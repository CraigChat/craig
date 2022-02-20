import ShardManager from './manager';

export interface ModuleOptions {
  name: string;
  requires?: string[];
  description?: string;
}

export default class ManagerModule {
  readonly options: ModuleOptions;
  readonly manager: ShardManager;
  loaded = false;
  filePath?: string;

  constructor(manager: ShardManager, options: ModuleOptions) {
    this.options = options;
    this.manager = manager;
  }

  /** @hidden */
  async _load() {
    this.loaded = true;
    await this.load();
  }

  /** Fired when this module is loaded. */
  load() {}

  /** Fired when this module is being unloaded. */
  unload() {}
}
