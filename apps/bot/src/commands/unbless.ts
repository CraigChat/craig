import { CommandContext, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis';
import GeneralCommand from '../slashCommand';
import { checkBan, unblessServer } from '../util';

export default class Bless extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'unbless',
      description: 'Remove your blessing from this server.',
      deferEphemeral: true,
      dmPermission: false
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    if (!ctx.guildID) return 'This command can only be used in a guild.';

    if (await checkBan(ctx.user.id))
      return {
        content: 'You are not allowed to use the bot at this time.',
        ephemeral: true
      };

    const userCooldown = await processCooldown(`command:${ctx.user.id}`, 5, 3);
    if (userCooldown !== true)
      return {
        content: 'You are running commands too often! Try again in a few seconds.',
        ephemeral: true
      };

    return await unblessServer(ctx.user.id, ctx.guildID);
  }
}
