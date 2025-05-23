import { CommandContext, SlashCreator } from 'slash-create';

import { processCooldown } from '../redis';
import GeneralCommand from '../slashCommand';
import { checkRecordingPermission } from '../util';

export default class Stop extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'stop',
      description: 'Parar a gravação atual.',
      dmPermission: false,
      deferEphemeral: true
    });

    this.filePath = __filename;
  }

  async run(ctx: CommandContext) {
    if (!ctx.guildID) return 'Este comando só pode ser usado em um servidor.';
    await ctx.defer(true);

    const userCooldown = await processCooldown(`command:${ctx.user.id}`, 5, 3);
    if (userCooldown !== true) {
      this.client.commands.logger.warn(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) tried to use the stop command, but was ratelimited.`
      );
      return {
        content: 'Espere alguns segundos antes de usar esse comando.',
        ephemeral: true
      };
    }

    const hasPermission = checkRecordingPermission(ctx.member!, await this.prisma.guild.findFirst({ where: { id: ctx.guildID } }));
    if (!hasPermission)
      return {
        content: 'Você não tem permissão para usar este comando.',
        ephemeral: true
      };
    if (!this.recorder.recordings.has(ctx.guildID))
      return {
        content: 'Não há gravações para parar.',
        ephemeral: true
      };
    const recording = this.recorder.recordings.get(ctx.guildID)!;
    await recording.stop(false, ctx.user.id);
    return {
      content: 'Gravação encerrada.',
      ephemeral: true
    };
  }
}
