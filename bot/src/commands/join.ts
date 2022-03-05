import { SlashCreator, CommandContext, CommandOptionType, ComponentType, ButtonStyle } from 'slash-create';
import Recording from '../modules/recorder/recording';
import GeneralCommand from '../slashCommand';

export default class Join extends GeneralCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'join',
      description: 'Start recording in a channel.',
      options: [
        {
          type: CommandOptionType.CHANNEL,
          name: 'channel',
          description: 'The channel to record in.',
          channel_types: [2, 13]
        }
      ]
    });
  }

  async run(ctx: CommandContext) {
    if (!ctx.guildID) return 'This command can only be used in a guild.';
    const guild = this.client.bot.guilds.get(ctx.guildID!)!;
    const member = guild.members.get(ctx.user.id) || (await guild.fetchMembers({ userIDs: [ctx.user.id] }))[0];
    // TODO check for permissions

    if (this.recorder.recordings.has(ctx.guildID)) {
      const recording = this.recorder.recordings.get(ctx.guildID)!;
      if (recording.messageID && recording.messageChannelID) {
        const message = await this.client.bot
          .getMessage(recording.messageChannelID, recording.messageID)
          .catch(() => null);
        if (message)
          return {
            content: 'Already recording in this channel.',
            components: [
              {
                type: ComponentType.ACTION_ROW,
                components: [
                  {
                    type: ComponentType.BUTTON,
                    style: ButtonStyle.LINK,
                    label: 'Jump to recording status',
                    url: `https://discordapp.com/channels/${ctx.guildID}/${recording.messageChannelID}/${recording.messageID}`
                  }
                ]
              }
            ]
          };
      }
      await ctx.send(recording.messageContent() as any);
      const { id: messageID } = await ctx.fetch();
      recording.messageID = messageID;
      recording.messageChannelID = ctx.channelID;
      return;
    }

    let channel = guild.channels.get(ctx.options.channel);
    if (!channel && member?.voiceState?.channelID) channel = guild.channels.get(member.voiceState.channelID);
    else if (!channel) return 'Please specify a channel to record in, or join a channel.';
    if (channel!.type !== 2 && channel!.type !== 13) return 'That channel is not a voice channel.';

    const recording = new Recording(this.recorder, channel as any, member.user);
    this.recorder.recordings.set(ctx.guildID, recording);
    await ctx.send(recording.messageContent() as any);
    const { id: messageID } = await ctx.fetch();
    recording.messageID = messageID;
    recording.messageChannelID = ctx.channelID;

    await recording.start();
  }
}
