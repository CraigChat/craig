import { DexareClient } from 'dexare';
import { SlashCommand, SlashCommandOptions, SlashCreator } from 'slash-create';
import { CraigBot, CraigBotConfig } from './bot';
import RecorderModule from './modules/recorder';
import { prisma } from './prisma';

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

  get prisma() {
    return prisma;
  }
}
