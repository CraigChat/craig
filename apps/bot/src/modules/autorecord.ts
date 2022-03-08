import { DexareModule, DexareClient } from 'dexare';
import Eris from 'eris';
import { CraigBotConfig } from '../bot';
import { prisma } from '../prisma';
import { processCooldown } from '../redis';
import { makeDownloadMessage, parseRewards } from '../util';
import RecorderModule from './recorder';
import Recording from './recorder/recording';

// @ts-ignore
export default class AutorecordModule extends DexareModule<DexareClient<CraigBotConfig>> {
  debounceTimeouts = new Map<string, any>();

  constructor(client: any) {
    super(client, {
      name: 'autorecord',
      requires: ['recorder'],
      description: 'Module for handle auto recording.'
    });

    this.filePath = __filename;
  }

  load() {
    this.logger.info('Loaded');
    this.registerEvent('voiceChannelJoin', this.onVoiceChannelJoin.bind(this));
    this.registerEvent('voiceChannelLeave', this.onVoiceChannelLeave.bind(this));
    this.registerEvent('voiceChannelSwitch', this.onVoiceChannelSwitch.bind(this));
  }

  unload() {
    this.unregisterAllEvents();
  }

  get recorder() {
    // @ts-ignore
    return this.client.modules.get('recorder') as RecorderModule<DexareClient<CraigBotConfig>>;
  }

  async checkAutorecord(channelId: string, guildId: string) {
    const recording = this.recorder.recordings.get(guildId);
    if (recording && (!recording.autorecorded || recording.channel.id !== channelId)) return;

    const autoRecording = await prisma.autoRecord.findFirst({
      where: {
        guildId,
        channelId,
        clientId: this.client.bot.user.id
      }
    });
    if (!autoRecording) return;

    // Get rewards
    const userData = await prisma.user.findFirst({ where: { id: autoRecording.userId } });
    const blessing = await prisma.blessing.findFirst({ where: { guildId: guildId } });
    const blessingUser = blessing ? await prisma.user.findFirst({ where: { id: blessing.userId } }) : null;
    const parsedRewards = parseRewards(
      this.recorder.client.config,
      userData?.rewardTier ?? 0,
      blessingUser?.rewardTier ?? 0
    );

    // Remove auto-recording if they lost the ability to autorecord
    if (!parsedRewards.rewards.features.includes('auto'))
      return void (await prisma.autoRecord.delete({
        where: { id: autoRecording.id }
      }));

    // Determine min and trigger users
    const guild = this.client.bot.guilds.get(guildId)!;
    const channel = guild.channels.get(channelId)! as Eris.StageChannel | Eris.VoiceChannel;

    const memberCount = channel.voiceMembers.filter((m) => !m.bot).length;
    let shouldRecord = memberCount >= autoRecording.minimum;
    if (
      autoRecording.triggerUsers.length > 0 &&
      channel.voiceMembers.some((member) => autoRecording.triggerUsers.includes(member.id) && !member.bot)
    )
      shouldRecord = true;

    if (!shouldRecord && recording) {
      this.logger.debug(`Stoppping autorecord for ${channelId} (${autoRecording.id})...`, false);
      recording.pushToActivity('Autorecord stopped due to lack of users.');
      await recording.stop();
      return;
    }

    if (shouldRecord && !recording) {
      this.logger.debug(`Starting to autorecord for ${channelId} (${autoRecording.id})...`);
      // Check permissions
      if (!channel.permissionsOf(this.client.bot.user.id).has('voiceConnect'))
        return void this.logger.debug(`Could not connect to ${channelId}: Missing voice connect permissions`);
      if (!guild.permissionsOf(this.client.bot.user.id).has('changeNickname'))
        return void this.logger.debug(`Could not connect to ${channelId}: Missing nickname permissions`);

      // Find member
      const member =
        guild.members.get(autoRecording.userId) || (await guild.fetchMembers({ userIDs: [autoRecording.userId] }))[0];
      if (!member)
        return void (await prisma.autoRecord.delete({
          where: { id: autoRecording.id }
        }));

      // Check guild-wide cooldown, skip if hit
      const guildCooldown = await processCooldown(`join:guild:${guildId}`, 30, 2);
      if (guildCooldown !== true) return;

      // Check if user can record (sanity check)
      if (parsedRewards.rewards.recordHours <= 0)
        return void (await prisma.autoRecord.delete({
          where: { id: autoRecording.id }
        }));

      // Start recording
      const recording = new Recording(this.recorder, channel as any, member.user, true);
      this.recorder.recordings.set(guildId, recording);
      await recording.start(parsedRewards);

      // Try to DM user
      const dmChannel = await member.user.getDMChannel().catch(() => null);
      if (dmChannel)
        await dmChannel
          .createMessage(makeDownloadMessage(recording, parsedRewards, this.client.config))
          .catch(() => null);
    }
  }

  async debounceCheck(channelId: string, guildId: string) {
    if (this.debounceTimeouts.has(channelId)) {
      clearTimeout(this.debounceTimeouts.get(channelId));
      this.debounceTimeouts.delete(channelId);
    }

    this.debounceTimeouts.set(
      channelId,
      setTimeout(async () => {
        await this.checkAutorecord(channelId, guildId);
        this.debounceTimeouts.delete(channelId);
      }, 2000)
    );
  }

  onVoiceChannelJoin(_: any, member: Eris.Member, newChannel: Eris.StageChannel | Eris.VoiceChannel) {
    if (member.bot) return;
    this.debounceCheck(newChannel.id, member.guild.id);
  }

  onVoiceChannelLeave(_: any, member: Eris.Member, oldChannel: Eris.StageChannel | Eris.VoiceChannel) {
    if (member.bot) return;
    this.debounceCheck(oldChannel.id, member.guild.id);
  }

  onVoiceChannelSwitch(
    _: any,
    member: Eris.Member,
    newChannel: Eris.StageChannel | Eris.VoiceChannel,
    oldChannel: Eris.StageChannel | Eris.VoiceChannel
  ) {
    if (member.bot) return;
    this.debounceCheck(newChannel.id, member.guild.id);
    this.debounceCheck(oldChannel.id, member.guild.id);
  }
}
