import { SlashCreator, CommandContext } from 'slash-create';
import GeneralCommand from '../slashCommand';
import { blessServer } from '../util';

export default class Bless extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'bless',
      description: 'Bless this server, giving it your perks.',
      deferEphemeral: true
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    if (!ctx.guildID) return 'This command can only be used in a guild.';
    return await blessServer(ctx.user.id, ctx.guildID);
  }
}
