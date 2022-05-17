import { CommandContext, SlashCreator } from 'slash-create';

import GeneralCommand from '../slashCommand';
import { checkRecordingPermission } from '../util';

export default class Stop extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'stop',
      description: 'Stop your current recording.',
      dmPermission: false
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    if (!ctx.guildID) return 'This command can only be used in a guild.';
    const hasPermission = checkRecordingPermission(ctx.member!, await this.prisma.guild.findFirst({ where: { id: ctx.guildID } }));
    if (!hasPermission)
      return {
        content: 'You need the `Manage Server` permission or have an access role to manage recordings.',
        ephemeral: true
      };
    if (!this.recorder.recordings.has(ctx.guildID))
      return {
        content: 'There is no recording to stop.',
        ephemeral: true
      };
    const recording = this.recorder.recordings.get(ctx.guildID)!;
    await recording.stop(false, ctx.user.id);
    return {
      content: 'Stopped recording.',
      ephemeral: true
    };
  }
}
