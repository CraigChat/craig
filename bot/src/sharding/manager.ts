import EventEmitter from 'eventemitter3';
import * as logger from './logger';
import ManagerModule from './module';

export interface ManagerOptions {
  file: string;
  shardCount: number;
  readyTimeout?: number;
  respawn?: boolean;
  args?: string[];
  execArgv?: string[];
}

export default class ShardManager extends EventEmitter {
  readonly options: ManagerOptions;
  readonly modules = new Map<string, ManagerModule>();

  constructor(options: ManagerOptions) {
    super();
    this.options = Object.assign(
      {
        readyTimeout: options.readyTimeout ?? 30000,
        respawn: options.respawn ?? true,
        args: options.args ?? [],
        execArgv: options.execArgv ?? []
      },
      options
    );
  }

  async loadModules(...moduleObjects: any[]) {
    const modules = moduleObjects.map(this._resolveModule.bind(this));
    const loadOrder = this._getLoadOrder(modules);

    for (const modName of loadOrder) {
      const mod = modules.find((mod) => mod.options.name === modName)!;
      if (this.modules.has(mod.options.name))
        throw new Error(`A module in the client already has been named "${mod.options.name}".`);
      logger.log('debug', `Loading module "${modName}"`);
      this.modules.set(modName, mod);
      await mod._load();
    }
  }

  async loadModule(moduleObject: any) {
    const mod = this._resolveModule(moduleObject);
    if (this.modules.has(mod.options.name))
      throw new Error(`A module in the client already has been named "${mod.options.name}".`);
    logger.log('debug', `Loading module "${mod.options.name}"`);
    this.modules.set(mod.options.name, mod);
    await mod._load();
  }

  async unloadModule(moduleName: string) {
    if (!this.modules.has(moduleName)) return;
    const mod = this.modules.get(moduleName)!;
    logger.log('debug', `Unloading module "${moduleName}"`);
    await mod.unload();
    this.modules.delete(moduleName);
  }

  /** @hidden */
  private _resolveModule(moduleObject: any) {
    if (typeof moduleObject === 'function') moduleObject = new moduleObject(this);
    else if (typeof moduleObject.default === 'function') moduleObject = new moduleObject.default(this);

    if (typeof moduleObject.load !== 'function') throw new Error(`Invalid module object to load: ${moduleObject}`);
    return moduleObject as ManagerModule;
  }

  /** @hidden */
  private _getLoadOrder(modules: ManagerModule[]) {
    const loadOrder: string[] = [];

    const insert = (mod: ManagerModule) => {
      if (mod.options.requires && mod.options.requires.length)
        mod.options.requires.forEach((modName) => {
          const dep = modules.find((mod) => mod.options.name === modName) || this.modules.get(modName);
          if (!dep)
            throw new Error(`Module '${mod.options.name}' requires dependency '${modName}' which does not exist!`);
          if (!this.modules.has(modName)) insert(dep);
        });
      if (!loadOrder.includes(mod.options.name)) loadOrder.push(mod.options.name);
    };

    modules.forEach((mod) => insert(mod));

    return loadOrder;
  }
}
