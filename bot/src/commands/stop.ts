import { SlashCreator, CommandContext, CommandOptionType } from 'slash-create';
import Recording from '../modules/recorder/recording';
import GeneralCommand from '../slashCommand';

export default class Stop extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'stop',
      description: 'Stop your current recording.'
    });
  }

  async run(ctx: CommandContext) {
    if (!ctx.guildID) return 'This command can only be used in a guild.';
    if (!this.recorder.recordings.has(ctx.guildID)) return 'There is no recording to stop.';
    const recording = this.recorder.recordings.get(ctx.guildID)!;
    await recording.stop();
    this.recorder.recordings.delete(ctx.guildID);
    return 'Recording stopped.';
  }
}
