import { AutoRecord } from '@prisma/client';
import { stripIndents } from 'common-tags';
import { DexareClient, DexareModule } from 'dexare';
import Eris from 'eris';
import { ButtonStyle, ComponentType } from 'slash-create';

import type { CraigBotConfig } from '../bot';
import { prisma } from '../prisma';
import { checkMaintenance, processCooldown } from '../redis';
import { reportAutorecordingError } from '../sentry';
import { cutoffText, getSelfMember, makeDownloadMessage, parseRewards } from '../util';
import type RecorderModule from './recorder';
import Recording, { RecordingState } from './recorder/recording';
import type SlashModule from './slash';

const TTL = 1000 * 60 * 60; // 1 hour

interface AutoRecordUpsert {
  guildId: string;
  channelId: string;
  userId: string;
  postChannelId: string | null;
  minimum: number;
  triggerUsers: string[];
  triggerRoles: string[];
}

// @ts-ignore
export default class AutorecordModule extends DexareModule<DexareClient<CraigBotConfig>> {
  debounceTimeouts = new Map<string, any>();
  autorecords = new Map<string, AutoRecord>();
  fetching = false;
  lastRefresh = 0;

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

  get emojis() {
    return (this.recorder.client.modules.get('slash') as SlashModule<any>).emojis;
  }

  async fetchAll() {
    if (this.fetching) return;
    this.fetching = true;
    const autorecords = (
      await prisma.autoRecord.findMany({
        where: {
          clientId: this.client.bot.user.id
        }
      })
    ).filter((autorecord) => this.client.bot.guilds.has(autorecord.guildId));

    this.logger.debug(`Fetched ${autorecords.length} autorecordings.`);

    Array.from(this.autorecords.keys()).forEach((channelId) => {
      if (!autorecords.find((autorecord) => autorecord.channelId === channelId)) this.autorecords.delete(channelId);
    });
    autorecords.forEach((autorecord) => this.autorecords.set(autorecord.channelId, autorecord));
    this.lastRefresh = Date.now();
    this.fetching = false;
  }

  async upsert(data: AutoRecordUpsert) {
    const autoRecording = await prisma.autoRecord.findFirst({
      where: { guildId: data.guildId, clientId: this.client.bot.user.id, channelId: data.channelId }
    });
    let newAutoRecording: AutoRecord | null = null;

    if (autoRecording)
      newAutoRecording = await prisma.autoRecord.update({
        where: { id: autoRecording.id },
        data: {
          userId: data.userId,
          minimum: data.minimum,
          triggerUsers: data.triggerUsers,
          triggerRoles: data.triggerRoles,
          postChannelId: data.postChannelId || null
        }
      });
    else
      newAutoRecording = await prisma.autoRecord.create({
        data: {
          clientId: this.client.bot.user.id,
          guildId: data.guildId,
          channelId: data.channelId,
          userId: data.userId,
          postChannelId: data.postChannelId || null,
          minimum: data.minimum,
          triggerUsers: data.triggerUsers,
          triggerRoles: data.triggerRoles
        }
      });

    if (newAutoRecording) this.autorecords.set(newAutoRecording.channelId, newAutoRecording);
  }

  async delete(autoRecording: AutoRecord) {
    await prisma.autoRecord.delete({
      where: { id: autoRecording.id }
    });

    this.autorecords.delete(autoRecording.channelId);
  }

  async find(channelId: string) {
    if (Date.now() - this.lastRefresh > TTL) await this.fetchAll();

    return this.autorecords.get(channelId);
  }

  async checkAutorecord(channelId: string, guildId: string) {
    const recording = this.recorder.recordings.get(guildId);
    if (recording && (!recording.autorecorded || recording.channel.id !== channelId)) return;

    const autoRecording = await this.find(channelId);
    if (!autoRecording) return;

    // Determine min and trigger users
    const guild = this.client.bot.guilds.get(guildId);
    if (!guild) return;
    const channel = guild.channels.get(channelId) as Eris.StageChannel | Eris.VoiceChannel;
    if (!channel) return;

    const memberCount = channel.voiceMembers.filter((m) => !m.bot).length;
    let shouldRecord = autoRecording.minimum === 0 ? false : memberCount >= autoRecording.minimum;
    if (
      !shouldRecord &&
      autoRecording.triggerUsers.length > 0 &&
      channel.voiceMembers.some((member) => !member.bot && autoRecording.triggerUsers.includes(member.id))
    )
      shouldRecord = true;
    if (
      !shouldRecord &&
      autoRecording.triggerRoles.length > 0 &&
      channel.voiceMembers.some((member) => !member.bot && autoRecording.triggerRoles.some((r) => r !== guildId && member.roles.includes(r)))
    )
      shouldRecord = true;

    if (!shouldRecord && recording) {
      this.logger.info(`Stopping autorecord for ${channelId} in ${autoRecording.userId} (${autoRecording.id})...`, false);
      recording.pushToActivity('Autorecord stopped due to lack of users.');
      await recording.stop();
      return;
    }

    if (shouldRecord && !recording) {
      // Get rewards
      const userData = await prisma.user.findFirst({ where: { id: autoRecording.userId } });
      const blessing = await prisma.blessing.findFirst({ where: { guildId: guildId } });
      const blessingUser = blessing ? await prisma.user.findFirst({ where: { id: blessing.userId } }) : null;
      const parsedRewards = parseRewards(this.recorder.client.config, userData?.rewardTier ?? 0, blessingUser?.rewardTier ?? 0);

      // Remove auto-recording if they lost the ability to autorecord
      if (!parsedRewards.rewards.features.includes('auto')) return void (await this.delete(autoRecording));

      // Check maintenence
      const maintenence = await checkMaintenance(this.client.bot.user.id);
      if (maintenence) return;

      this.logger.info(`Starting to autorecord ${channelId} in ${autoRecording.userId} (${autoRecording.id})...`);
      // Check permissions
      if (!channel.permissionsOf(this.client.bot.user.id).has('voiceConnect'))
        return void this.logger.debug(`Could not connect to ${channelId}: Missing voice connect permissions`);
      if (!guild.permissionsOf(this.client.bot.user.id).has('changeNickname'))
        return void this.logger.debug(`Could not connect to ${channelId}: Missing nickname permissions`);

      // Find member
      const member = guild.members.get(autoRecording.userId) || (await guild.fetchMembers({ userIDs: [autoRecording.userId] }))[0];
      if (!member) return void (await this.delete(autoRecording));

      // Check if user can record (sanity check)
      if (parsedRewards.rewards.recordHours <= 0) return void (await this.delete(autoRecording));

      // Check guild-wide cooldown, skip if hit
      const guildCooldown = await processCooldown(`join:guild:${guildId}`, 30, 2);
      if (guildCooldown !== true) return;

      // Nickname the bot
      const selfUser = await getSelfMember(guild, this.client.bot);
      const recNick = cutoffText(`![RECORDING] ${selfUser ? selfUser.nick ?? selfUser.username : this.client.bot.user.username}`, 32);
      if (selfUser && (!selfUser.nick || !selfUser.nick.includes('[RECORDING]')))
        try {
          await this.client.bot.editGuildMember(guildId, '@me', { nick: recNick }, 'Setting recording status');
        } catch (e) {
          return void this.logger.warn(`Could not connect to ${channelId} while autorecording: An error occurred while changing my nickname`, e);
        }

      // Start recording
      const recording = new Recording(this.recorder, channel as any, member.user, true);
      this.recorder.recordings.set(guildId, recording);
      if (autoRecording.postChannelId) {
        const postChannel = guild.channels.get(autoRecording.postChannelId);
        if (
          postChannel &&
          channel.permissionsOf(this.client.bot.user.id).has('sendMessages') &&
          channel.permissionsOf(this.client.bot.user.id).has('embedLinks')
        ) {
          const message = await this.client.bot.createMessage(postChannel.id, recording.messageContent() as any).catch(() => null);
          if (message) {
            recording.messageID = message.id;
            recording.messageChannelID = message.channel.id;
          }
        }
      }

      const error = await recording
        .start(parsedRewards, userData?.webapp ?? false)
        .then(() => (recording.state === RecordingState.ERROR ? recording.stateDescription || 'Unknown error' : false))
        .catch((e) => e);

      if (error !== false) {
        this.client.commands.logger.error(
          `Failed to start auto-recording ${recording.id} (${guild.name}, ${guild.id}) (${member.username}#${member.discriminator}, ${member.id})`,
          error
        );
        reportAutorecordingError(member, guildId, channelId, error, recording);

        if (recording.state !== RecordingState.ERROR) {
          recording.state = RecordingState.ERROR;
          await recording.stop(true).catch(() => {});
        }

        if (recording.messageID && recording.messageChannelID)
          await this.client.bot
            .editMessage(recording.messageChannelID, recording.messageID, {
              embeds: [
                {
                  color: 0xe74c3c,
                  title: 'An error occurred.',
                  description: stripIndents`
                    An error occurred while trying to start the recording. Try again in a few minutes.
                    If this problem persists, please join the support server with the button below.

                    **Recording ID:** \`${recording.id}\`
                  `
                }
              ],
              components: [
                {
                  type: ComponentType.ACTION_ROW,
                  components: [
                    {
                      type: ComponentType.BUTTON,
                      style: ButtonStyle.LINK,
                      label: 'Support Server',
                      url: 'https://discord.gg/craig'
                    }
                  ]
                }
              ]
            })
            .catch(() => {});
        return;
      }

      // Try to DM user
      const dmChannel = await member.user.getDMChannel().catch(() => null);
      if (dmChannel) await dmChannel.createMessage(makeDownloadMessage(recording, parsedRewards, this.client.config, this.emojis)).catch(() => null);
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
