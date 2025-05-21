import { DexareClient } from 'dexare';
import { SlashCommand, SlashCommandOptions, SlashCreator } from 'slash-create';

import type { CraigBot, CraigBotConfig } from './bot';
import type RecorderModule from './modules/recorder';
import type ShardingModule from './modules/sharding';
import { prisma } from './prisma';
import { client as redisClient } from './redis';

export default abstract class GeneralCommand extends SlashCommand {
  constructor(creator: SlashCreator, opts: SlashCommandOptions) {
    super(creator, opts);
  }

  get client(): CraigBot {
    return this.creator.client as CraigBot;
  }

  get recorder(): RecorderModule<DexareClient<CraigBotConfig>> {
    return this.client.modules.get('recorder') as RecorderModule<any>;
  }

  get sharding(): ShardingModule {
    return this.client.modules.get('sharding') as ShardingModule;
  }

  get prisma() {
    return prisma;
  }

  get redis() {
    return redisClient;
  }
}
