import { CommandContext, CommandOptionType, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis.js';
import GeneralCommand from '../slashCommand.js';
import { checkBan, mainBotCommandOnly } from '../util.js';

export default class Webapp extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'webapp',
      description: 'Enable/disable the Craig Webapp.',
      deferEphemeral: true,
      guildIDs: mainBotCommandOnly,
      options: [
        {
          type: CommandOptionType.SUB_COMMAND,
          name: 'on',
          description: 'Enable the Craig Webapp in future recordings.'
        },
        {
          type: CommandOptionType.SUB_COMMAND,
          name: 'off',
          description: 'Disable the Craig Webapp.'
        }
      ]
    });
  }

  async run(ctx: CommandContext) {
    const [t] = this.createT(ctx);
    if (!this.recorder.client.config.craig.webapp.on)
      return {
        content: t('webapp.not_enabled'),
        ephemeral: true
      };

    if (await checkBan(ctx.user.id))
      return {
        content: t('responses.banned'),
        ephemeral: true
      };

    const userCooldown = await processCooldown(`command:${ctx.user.id}:${this.client?.bot?.user?.id}`, 5, 3);
    if (userCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the webapp command, but was ratelimited.`
      );
      return {
        content: t('responses.ratelimited'),
        ephemeral: true
      };
    }

    switch (ctx.subcommands[0]) {
      case 'on': {
        await this.prisma.user.upsert({
          where: { id: ctx.user.id },
          update: { webapp: true },
          create: { id: ctx.user.id, webapp: true }
        });

        return {
          content: t('webapp.on'),
          ephemeral: true
        };
      }
      case 'off': {
        await this.prisma.user.upsert({
          where: { id: ctx.user.id },
          update: { webapp: false },
          create: { id: ctx.user.id, webapp: false }
        });

        return {
          content: t('webapp.off'),
          ephemeral: true
        };
      }
    }

    return {
      content: t('responses.unknown_subcommand'),
      ephemeral: true
    };
  }
}
