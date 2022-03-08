import { SlashCreator, CommandContext } from 'slash-create';
import GeneralCommand from '../slashCommand';
import { unblessServer } from '../util';

export default class Bless extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'unbless',
      description: 'Remove your blessing from this server.',
      deferEphemeral: true
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    if (!ctx.guildID) return 'This command can only be used in a guild.';
    return await unblessServer(ctx.user.id, ctx.guildID);
  }
}
