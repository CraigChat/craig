import { prisma } from '@craig/db';
import {
  ApplicationCommandOption,
  ApplicationCommandOptionChoice,
  CommandContext,
  SlashCommand,
  SlashCommandOptions,
  SlashCreator
} from 'slash-create';

import type { CraigBot } from './bot.js';
import { createCtxT, getDiscordLocalizations, init as i18nInit } from './i18n.js';
import type RecorderModule from './modules/recorder/index.js';
import { client as redisClient } from './redis.js';

function localizeChoices(choices: ApplicationCommandOptionChoice[], path: string) {
  for (const choice of choices) choice.name_localizations = getDiscordLocalizations(`${path}.${choice.name}.name`);
}

function localizeOptions(options: ApplicationCommandOption[], path: string) {
  for (const option of options) {
    const optionPath = `${path}.${option.name}`;
    option.name_localizations = getDiscordLocalizations(`${optionPath}.name`);
    option.description_localizations = getDiscordLocalizations(`${optionPath}.description`);

    if ('options' in option && option.options) localizeOptions(option.options, `${optionPath}.options`);
    if ('choices' in option && option.choices) localizeChoices(option.choices, `${optionPath}.choices`);
  }
}

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

  createT(ctx: CommandContext) {
    return createCtxT(ctx);
  }

  async onLocaleUpdate() {
    await i18nInit();

    const commandPath = `commands.${this.commandName}`;
    this.nameLocalizations = getDiscordLocalizations(`${commandPath}.name`);
    this.descriptionLocalizations = getDiscordLocalizations(`${commandPath}.description`);
    if (this.options) localizeOptions(this.options, `${commandPath}.options`);
  }
}
