import { SlashCommand, SlashCommandOptions, SlashCreator } from 'slash-create';
import { CraigBot } from './bot';
import { prisma } from './prisma';

export default abstract class GeneralCommand extends SlashCommand {
  constructor(creator: SlashCreator, opts: SlashCommandOptions) {
    super(creator, opts);
  }

  get client(): CraigBot {
    return this.creator.client as CraigBot;
  }

  get prisma() {
    return prisma;
  }
}
