import { DexareClient } from 'dexare';
import { SlashCommand, SlashCommandOptions, SlashCreator } from 'slash-create';

import type { CraigBot, CraigBotConfig } from './bot';
import AutorecordModule from './modules/autorecord';
import type RecorderModule from './modules/recorder';
import type ShardingModule from './modules/sharding';
import type SlashModule from './modules/slash';
import { prisma } from './prisma';
import { client as redisClient } from './redis';

export default abstract class GeneralCommand extends SlashCommand {
  constructor(creator: SlashCreator, opts: SlashCommandOptions) {
    super(creator, opts);
  }

  get client(): CraigBot {
    return this.creator.client as CraigBot;
  }

  get autoRecord(): AutorecordModule {
    return this.client.modules.get('autorecord') as unknown as AutorecordModule;
  }

  get recorder(): RecorderModule<DexareClient<CraigBotConfig>> {
    return this.client.modules.get('recorder') as RecorderModule<any>;
  }

  get sharding(): ShardingModule {
    return this.client.modules.get('sharding') as ShardingModule;
  }

  get emojis() {
    return (this.client.modules.get('slash') as SlashModule<any>).emojis;
  }

  get prisma() {
    return prisma;
  }

  get redis() {
    return redisClient;
  }
}
