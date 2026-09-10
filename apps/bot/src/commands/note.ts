import { CommandContext, CommandOptionType, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis.js';
import GeneralCommand from '../slashCommand.js';
import { checkBan, checkRecordingPermission, cutoffText } from '../util.js';

export default class Note extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'note',
      description: 'Note something within the ongoing recording.',
      dmPermission: false,
      options: [
        {
          type: CommandOptionType.STRING,
          name: 'message',
          description: 'The note to create.',
          required: true
        }
      ]
    });
  }

  async run(ctx: CommandContext) {
    const [t] = this.createT(ctx);
    if (!ctx.guildID) return t('responses.guild_only');

    if (await checkBan(ctx.user.id))
      return {
        content: t('responses.banned'),
        ephemeral: true
      };

    const userCooldown = await processCooldown(`command:${ctx.user.id}:${this.client?.bot?.user?.id}`, 5, 3);
    if (userCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the note command, but was ratelimited.`
      );
      return {
        content: t('responses.ratelimited'),
        ephemeral: true
      };
    }

    const hasPermission = checkRecordingPermission(ctx.member!, await this.prisma.guild.findUnique({ where: { id: ctx.guildID } }));
    if (!hasPermission)
      return {
        content: t('recording.need_perms'),
        ephemeral: true
      };
    if (!this.recorder.recordings.has(ctx.guildID))
      return {
        content: t('recording.not_recording'),
        ephemeral: true
      };
    const recording = this.recorder.recordings.get(ctx.guildID)!;

    try {
      recording.note(ctx.options.message || '');
      recording.pushToActivity(
        `${t('recording.panel.added_note', { user: ctx.user.mention })}${
          ctx.options.message ? ` - ${cutoffText(ctx.options.message.replace(/\n/g, ' '), 100)}` : ''
        }`
      );
      return {
        content: t('recording.added_note'),
        ephemeral: true
      };
    } catch (e) {
      recording.recorder.logger.error(`Error adding note to recording ${recording.id}:`, e);
      return {
        content: t('recording.note_error'),
        ephemeral: true
      };
    }
  }
}
