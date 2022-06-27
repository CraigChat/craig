import { CommandContext, CommandOptionType, SlashCreator } from 'slash-create';

import GeneralCommand from '../slashCommand';
import { checkBan, checkRecordingPermission, cutoffText } from '../util';

export default class Note extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'note',
      description: 'Note something within the recording.',
      dmPermission: false,
      options: [
        {
          type: CommandOptionType.STRING,
          name: 'message',
          description: 'The note to put down.',
          required: true
        }
      ]
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

    const hasPermission = checkRecordingPermission(ctx.member!, await this.prisma.guild.findFirst({ where: { id: ctx.guildID } }));
    if (!hasPermission)
      return {
        content: 'You need the `Manage Server` permission or have an access role to manage recordings.',
        ephemeral: true
      };
    if (!this.recorder.recordings.has(ctx.guildID))
      return {
        content: "You aren't recording in this server.",
        ephemeral: true
      };
    const recording = this.recorder.recordings.get(ctx.guildID)!;

    try {
      recording.note(ctx.options.message || '');
      recording.pushToActivity(
        `${ctx.user.mention} added a note.${ctx.options.message ? ` - ${cutoffText(ctx.options.message.replace(/\n/g, ' '), 100)}` : ''}`
      );
      return {
        content: 'Added the note to the recording!',
        ephemeral: true
      };
    } catch (e) {
      recording.recorder.logger.error(`Error adding note to recording ${recording.id}:`, e);
      return {
        content: 'An error occurred while adding the note.',
        ephemeral: true
      };
    }
  }
}
