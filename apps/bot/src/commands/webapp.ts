import { SlashCreator, CommandContext, CommandOptionType } from 'slash-create';
import { processCooldown } from '../redis';
import GeneralCommand from '../slashCommand';

export default class Webapp extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'webapp',
      description: 'Enable/disable the Craig Webapp.',
      deferEphemeral: true,
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

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    if (!this.recorder.client.config.craig.webapp.on)
      return {
        content: 'This instance of Craig does not have a webapp.',
        ephemeral: true
      };

    const userCooldown = await processCooldown(`command:${ctx.user.id}`, 5, 3);
    if (userCooldown !== true)
      return {
        content: 'You are running commands too often! Try again in a few seconds.',
        ephemeral: true
      };

    switch (ctx.subcommands[0]) {
      case 'on': {
        await this.prisma.user.upsert({
          where: { id: ctx.user.id },
          update: { webapp: true },
          create: { id: ctx.user.id, webapp: true }
        });

        return {
          content: 'Enabled the Craig Webapp in future recordings. You should get a Webapp link in your recording DM.',
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
          content: 'Disabled the Craig Webapp.',
          ephemeral: true
        };
      }
    }

    return {
      content: 'Unknown sub-command.',
      ephemeral: true
    };
  }
}
