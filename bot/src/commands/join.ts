import { oneLine } from 'common-tags';
import { SlashCreator, CommandContext, CommandOptionType, ComponentType, ButtonStyle } from 'slash-create';
import Recording from '../modules/recorder/recording';
import GeneralCommand from '../slashCommand';
import { checkRecordingPermission, cutoffText } from '../util';

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
    const hasPermission = checkRecordingPermission(
      ctx.member!,
      await this.prisma.guild.findFirst({ where: { id: ctx.guildID } })
    );
    if (!hasPermission) return 'You need the `Manage Server` permission or have an access role to manage recordings.';
    const member = guild.members.get(ctx.user.id) || (await guild.fetchMembers({ userIDs: [ctx.user.id] }))[0];

    if (this.recorder.recordings.has(ctx.guildID)) {
      const recording = this.recorder.recordings.get(ctx.guildID)!;
      if (recording.messageID && recording.messageChannelID) {
        const message = await this.client.bot
          .getMessage(recording.messageChannelID, recording.messageID)
          .catch(() => null);
        if (message)
          return {
            content: 'Already recording in this guild.',
            components: [
              {
                type: ComponentType.ACTION_ROW,
                components: [
                  {
                    type: ComponentType.BUTTON,
                    style: ButtonStyle.LINK,
                    label: 'Jump to recording panel',
                    url: `https://discordapp.com/channels/${ctx.guildID}/${recording.messageChannelID}/${recording.messageID}`,
                    emoji: { id: '949782524131942460' }
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

    // Check permissions
    if (!channel!.permissionsOf(this.client.bot.user.id).has('voiceConnect'))
      return `I do not have permission to connect to <#${channel!.id}>.`;
    if (!guild.permissionsOf(this.client.bot.user.id).has('changeNickname'))
      return 'I do not have permission to change my nickname. I will not record without this permission.';

    const selfUser = (await guild.fetchMembers({ userIDs: [this.client.bot.user.id] }))[0];
    const recNick = cutoffText(`![RECORDING] ${selfUser.nick ?? selfUser.username}`, 32);
    await ctx.defer();
    let nickChanged = false;
    if (!selfUser.nick || !selfUser.nick.includes('[RECORDING]'))
      try {
        const nickWarnTimeout = setTimeout(() => {
          if (!nickChanged)
            ctx.editOriginal(oneLine`
              Due to recent changes to Discord's rate limiting, it's taking a while for me to change my nick to indicate that I'm recording.
              I cannot start recording until I've changed my nick. Please be patient.
            `);
        }, 3000) as unknown as number;
        await guild.editNickname(recNick);
        nickChanged = true;
        clearTimeout(nickWarnTimeout);
      } catch (e) {
        nickChanged = true;
        this.client.commands.logger.error('Failed to change nickname', e);
        return `An error occurred while changing my nickname: ${e}`;
      }

    const recording = new Recording(this.recorder, channel as any, member.user);
    this.recorder.recordings.set(ctx.guildID, recording);
    await ctx.editOriginal(recording.messageContent() as any);
    const { id: messageID } = await ctx.fetch();
    recording.messageID = messageID;
    recording.messageChannelID = ctx.channelID;

    await recording.start();
  }
}
