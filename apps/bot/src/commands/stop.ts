import { CommandContext, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis';
import GeneralCommand from '../slashCommand';
import { checkBan, checkRecordingPermission } from '../util';

export default class Stop extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'stop',
      description: 'Stop your current recording.',
      dmPermission: false,
      deferEphemeral: true
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    if (!ctx.guildID) return 'This command can only be used in a guild.';
    await ctx.defer(true);

    if (await checkBan(ctx.user.id))
      return {
        content: 'You are not allowed to use the bot at this time.',
        ephemeral: true
      };

    const userCooldown = await processCooldown(`command:${ctx.user.id}:${this.client?.bot?.user?.id}`, 5, 3);
    if (userCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the stop command, but was ratelimited.`
      );
      return {
        content: 'You are running commands too often! Try again in a few seconds.',
        ephemeral: true
      };
    }

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
