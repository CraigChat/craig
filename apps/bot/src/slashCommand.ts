import { prisma } from '@craig/db';
import { SlashCommand, SlashCommandOptions, SlashCreator } from 'slash-create';

import type { CraigBot } from './bot.js';
import type RecorderModule from './modules/recorder/index.js';
import { client as redisClient } from './redis.js';

export default abstract class GeneralCommand extends SlashCommand {
  constructor(creator: SlashCreator, opts: SlashCommandOptions) {
    super(creator, opts);
  }

  get client(): CraigBot {
    return this.creator.client as CraigBot;
  }

  get autoRecord() {
    return this.client.autorecord;
  }

  get recorder(): RecorderModule {
    return this.client.recorder;
  }

  get entitlements() {
    return this.client.entitlements;
  }

  get sharding() {
    return this.client.sharding;
  }

  get emojis() {
    return this.client.slash.emojis;
  }

  get prisma() {
    return prisma;
  }

  get redis() {
    return redisClient;
  }
}
