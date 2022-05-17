import { CommandContext, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis';
import GeneralCommand from '../slashCommand';
import { blessServer } from '../util';

export default class Bless extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'bless',
      description: 'Bless this server, giving it your perks.',
      deferEphemeral: true,
      dmPermission: false
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    if (!ctx.guildID) return 'This command can only be used in a guild.';

    const userCooldown = await processCooldown(`command:${ctx.user.id}`, 5, 3);
    if (userCooldown !== true)
      return {
        content: 'You are running commands too often! Try again in a few seconds.',
        ephemeral: true
      };

    return await blessServer(ctx.user.id, ctx.guildID);
  }
}
