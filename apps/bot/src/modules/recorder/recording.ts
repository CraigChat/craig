import { OpusEncoder } from '@discordjs/opus';
import axios from 'axios';
import { stripIndents } from 'common-tags';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import { DexareClient } from 'dexare';
import Eris from 'eris';
import { access, writeFile } from 'fs/promises';
import { customAlphabet, nanoid } from 'nanoid';
import fetch from 'node-fetch';
import path from 'path';
import semver from 'semver';
import { ButtonStyle, ComponentType, EditMessageOptions, MessageFlags, SeparatorSpacingSize } from 'slash-create';

import type { CraigBot, CraigBotConfig } from '../../bot';
import { onRecordingEnd, onRecordingStart } from '../../influx';
import { prisma } from '../../prisma';
import { getSelfMember, ParsedRewards, wait } from '../../util';
import type SlashModule from '../slash';
import type RecorderModule from '.';
import { UserExtraType, WebappOpCloseReason } from './protocol';
import { WebappClient } from './webapp';
import RecordingWriter from './writer';

dayjs.extend(duration);

const opus = new OpusEncoder(48000, 2);
const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const recNanoid = customAlphabet(alphabet, 12);
const recIndicator = / *!?\[RECORDING\] */;

export const NOTE_TRACK_NUMBER = 65536;
const USER_HARD_LIMIT = 10000;
const MAX_LATENCY_WARNING = 500;

const BAD_MESSAGE_CODES = [
  404,
  10003, // Unknown channel
  10008, //	Unknown message
  20009, // Explicit content cannot be sent to the desired recipient(s)
  40004, // Send messages has been temporarily disabled
  50001, // Missing access
  50005, // Cannot edit a message authored by another user
  50006, // Cannot send an empty message
  50008, // Cannot send messages in a non-text channel
  50013, // You lack permissions to perform that action
  50014, // Invalid authentication token provided
  50021 // Cannot execute action on a system message
];

export enum RecordingState {
  IDLE,
  CONNECTING,
  RECONNECTING,
  RECORDING,
  ERROR,
  ENDED
}

export enum WarningState {
  DEAFENED,
  MOVED,
  SILENT
}

export interface RecordingUser {
  id: string;
  username: string;
  discriminator: string;
  globalName?: string | null;
  bot: boolean;
  avatar?: string;
  avatarUrl?: string;
  unknown: boolean;
  track: number;
  packet: number;
}

export interface Chunk {
  data: Buffer;
  timestamp: number;
  time: number;
}

export default class Recording {
  recorder: RecorderModule<DexareClient<CraigBotConfig>>;
  id = recNanoid();
  accessKey = nanoid(6);
  deleteKey = nanoid(6);
  ennuiKey = nanoid(6);
  channel: Eris.StageChannel | Eris.VoiceChannel;
  user: Eris.User;
  active = false;
  started = false;
  closing = false;
  autorecorded = false;
  state: RecordingState = RecordingState.IDLE;
  warningState: WarningState | null = null;
  stateDescription?: string;
  connection: Eris.VoiceConnection | null = null;
  receiver: Eris.VoiceDataStream | null = null;
  webapp?: WebappClient;

  messageChannelID: string | null = null;
  messageID: string | null = null;
  startTime: [number, number] | null = null;
  startedAt: Date | null = null;
  createdAt = new Date();
  logs: string[] = [];
  lastMessageError: Error | null = null;
  rewards: ParsedRewards | null = null;

  users: { [key: string]: RecordingUser } = {};
  userPackets: { [key: string]: Chunk[] } = {};
  usersWarned: string[] = [];
  trackNo = 1;
  notePacketNo = 0;
  bytesWritten = 0;
  hardLimitHit = false;
  writer: RecordingWriter | null = null;
  participantJoinTimes: Map<string, Date> = new Map(); // Track when participants joined for payment calculation

  timeout: any;
  usageInterval: any;
  sizeLimit = 0;
  lastSize = 0;
  usedMinutes = 0;
  unusedMinutes = 0;
  latency: number | null = null;
  silenceWarned = false;
  maintenceWarned = false;
  latencyWarned = false;
  zeroPacketWarned = false;

  constructor(recorder: RecorderModule<DexareClient<CraigBotConfig>>, channel: Eris.StageChannel | Eris.VoiceChannel, user: Eris.User, auto = false) {
    this.recorder = recorder;
    this.channel = channel;
    this.user = user;
    this.autorecorded = auto;
    this.sizeLimit = this.recorder.client.config.craig.sizeLimit;
  }

  async sanityCheckIdClashing() {
    // Realistically, this should never happen, but just in case
    if (await prisma.recording.count({ where: { id: this.id } })) {
      this.id = recNanoid();
      await this.sanityCheckIdClashing();
    }
  }

  async sendWarning(text: string, pushToActivity = true) {
    if (pushToActivity) this.pushToActivity(`⚠️ ${text}`);

    if (this.messageChannelID && this.messageID) {
      const okay = await this.recorder.client.bot
        .createMessage(this.messageChannelID, {
          messageReference: {
            channelID: this.messageChannelID,
            messageID: this.messageID
          },
          content: `⚠️ <@${this.user.id}>: ${text}`,
          allowedMentions: {
            users: [this.user.id],
            roles: false,
            everyone: false
          }
        })
        .then(() => true)
        .catch(() => false);

      if (okay) return;
    }

    const dmChannel = await this.user.getDMChannel().catch(() => null);
    if (dmChannel) await dmChannel.createMessage(`⚠️ Warning for recording \`${this.id}\`: ${text}`).catch(() => null);
  }

  async start(parsedRewards: ParsedRewards, webapp = false) {
    await this.sanityCheckIdClashing();

    this.recorder.logger.info(`Starting recording ${this.id} by ${this.user.username}#${this.user.discriminator} (${this.user.id})`);
    this.state = RecordingState.CONNECTING;

    try {
      await this.connect();
    } catch (e) {
      this.recorder.logger.error(
        `Failed to connect to ${this.channel.name} (${this.channel.id}) in ${this.channel.guild.name} (${this.channel.guild.id}) by ${this.user.username}#${this.user.discriminator} (${this.user.id})`,
        e
      );
      this.state = RecordingState.ERROR;
      this.stateDescription =
        'Failed to connect to your channel, try again later. If the issue persists, report it in the [support server](<https://discord.gg/craig>).';
      await this.stop(true);
      await this.pushToActivity('Failed to connect!');

      // If the last message update errored & we can still use the message, retry once
      if (this.lastMessageError && this.messageID) await this.updateMessage();
      return;
    }

    this.startTime = process.hrtime();
    this.startedAt = new Date();

    const fileBase = path.join(this.recorder.recordingPath, `${this.id}.ogg`);
    const { tier, rewards } = parsedRewards;
    this.rewards = { tier, rewards };
    if (rewards.sizeLimitMult) this.sizeLimit *= rewards.sizeLimitMult;
    await writeFile(
      fileBase + '.info',
      JSON.stringify({
        format: 1,
        key: this.accessKey,
        delete: this.deleteKey,
        guild: this.channel.guild.name,
        autorecorded: this.autorecorded,
        guildExtra: {
          name: this.channel.guild.name,
          id: this.channel.guild.id,
          icon: this.channel.guild.dynamicIconURL('png', 256)
        },
        channel: this.channel.name,
        channelExtra: {
          name: this.channel.name,
          id: this.channel.id,
          type: this.channel.type
        },
        requester: this.user.discriminator === '0' ? this.user.username : this.user.username + '#' + this.user.discriminator,
        requesterExtra: {
          username: this.user.username,
          globalName: this.user.globalName,
          discriminator: this.user.discriminator,
          avatar: this.user.dynamicAvatarURL('png', 256)
        },
        requesterId: this.user.id,
        clientId: this.recorder.client.bot.user.id,
        startTime: this.startedAt.toISOString(),
        expiresAfter: rewards.downloadExpiryHours,
        features: rewards.features.reduce((acc, cur) => ({ ...acc, [cur]: true }), {} as { [key: string]: boolean })
      }),
      { encoding: 'utf8' }
    );
    this.writer = new RecordingWriter(this, fileBase);
    this.writeToLog(`Connected to channel ${this.connection?.channelID} at ${this.connection?.endpoint}`);

    this.timeout = setTimeout(async () => {
      if (this.state !== RecordingState.RECORDING) return;
      this.writeToLog('Timeout reached, stopping recording');
      this.stateDescription = `⚠️ You've reached the maximum time limit of ${rewards.recordHours} hours for this recording.`;
      this.sendWarning(`You've reached the maximum time limit of ${rewards.recordHours} hours for this recording.`, false);
      await this.stop();
    }, rewards.recordHours * 60 * 60 * 1000);

    this.usageInterval = setInterval(async () => {
      if (this.state !== RecordingState.RECORDING) return;
      if (this.bytesWritten !== this.lastSize) {
        this.lastSize = this.bytesWritten;
        this.usedMinutes++;
        this.unusedMinutes = 0;
        return;
      }

      this.unusedMinutes++;
      if (this.usedMinutes === 0) {
        this.stateDescription = "⚠️ I haven't received any audio from anyone!";
        this.sendWarning(
          "I haven't received any audio from anyone in this recording, try switching to a different voice region if this problem persists.",
          false
        );
        await this.stop();
      } else if (this.unusedMinutes === 5 && !this.silenceWarned) {
        this.silenceWarned = true;
        this.sendWarning(
          "Hello? I haven't heard anything for five minutes. Make sure to stop the recording if you are done! If you are taking a break, disregard this message."
        );
      }
    }, 60000);

    this.active = true;
    this.started = true;
    await this.playNowRecording();
    this.updateMessage();

    // Send consent message if configured
    const consentMessage = this.recorder.client.config.craig.consentMessage;
    if (consentMessage && this.messageChannelID) {
      try {
        const guild = this.channel.guild;
        const channel = guild.channels.get(this.messageChannelID);
        if (channel && 'createMessage' in channel) {
          await (channel as any).createMessage({
            content: consentMessage,
            allowedMentions: { everyone: false, roles: false, users: false }
          });
        }
      } catch (e) {
        this.recorder.logger.warn(`Failed to send consent message for recording ${this.id}`, e);
      }
    }

    await prisma.recording.create({
      data: {
        id: this.id,
        accessKey: this.accessKey,
        deleteKey: this.deleteKey,
        userId: this.user.id,
        channelId: this.channel.id,
        guildId: this.channel.guild.id,
        clientId: this.recorder.client.bot.user.id,
        shardId: (this.recorder.client as unknown as CraigBot).shard!.id ?? -1,
        rewardTier: tier,
        autorecorded: this.autorecorded,
        expiresAt: new Date(this.startedAt.valueOf() + rewards.downloadExpiryHours * 60 * 60 * 1000),
        createdAt: this.startedAt
      }
    });

    if (webapp && this.recorder.client.config.craig.webapp.on) this.webapp = new WebappClient(this, parsedRewards);

    // Initialize participant tracking for users already in channel
    const voiceMembers = this.channel.voiceMembers;
    for (const [userId, member] of voiceMembers.entries()) {
      if (!member.user.bot && String(userId) !== this.recorder.client.bot.user.id) {
        this.participantJoinTimes.set(String(userId), this.startedAt || new Date());
      }
    }

    onRecordingStart(this.user.id, this.channel.guild.id, this.autorecorded);
  }

  async stop(internal = false, userID?: string) {
    try {
      clearTimeout(this.timeout);
      clearInterval(this.usageInterval);
      this.active = false;
      this.recorder.logger.info(
        `Stopping recording ${this.id} by ${this.user.username}#${this.user.discriminator} (${this.user.id})${internal ? ' internally' : ''}${
          userID ? ` by ${userID}` : ''
        }`
      );
      if (!internal) {
        this.state = RecordingState.ENDED;
        if (userID) this.pushToActivity(`Recording stopped by <@${userID}>.`);
        else this.updateMessage();
      }
      this.channel.leave();
      for (const userID in this.userPackets) {
        const user = this.users[userID];
        this.flush(user, this.userPackets[userID].length);
      }

      // Close the output files and connection
      this.closing = true;
      this.webapp?.close(WebappOpCloseReason.RECORDING_ENDED);
      await wait(200);
      await this.writer?.end();

      this.recorder.recordings.delete(this.channel.guild.id);

      const endedAt = new Date();
      if (this.rewards && this.startedAt && this.started) {
        await prisma.recording
          .upsert({
            where: { id: this.id },
            update: { endedAt },
            create: {
              id: this.id,
              accessKey: this.accessKey,
              deleteKey: this.deleteKey,
              userId: this.user.id,
              channelId: this.channel.id,
              guildId: this.channel.guild.id,
              clientId: this.recorder.client.bot.user.id,
              shardId: (this.recorder.client as unknown as CraigBot).shard!.id ?? -1,
              rewardTier: this.rewards.tier,
              autorecorded: this.autorecorded,
              expiresAt: new Date(this.startedAt.valueOf() + this.rewards.rewards.downloadExpiryHours * 60 * 60 * 1000),
              createdAt: this.startedAt,
              endedAt
            }
          })
          .catch((e) => this.recorder.logger.error(`Error writing end date to recording ${this.id}`, e));
      }

      // Store endedAt for payment calculation
      (this as any).endedAt = endedAt;

      if (this.startedAt && this.startTime) {
        const timestamp = process.hrtime(this.startTime!);
        const time = timestamp[0] * 1000 + timestamp[1] / 1000000;
        await onRecordingEnd(this.user.id, this.channel.guild.id, this.startedAt, time, this.autorecorded, !!this.webapp, false).catch(() => {});
      }

      // Reset nickname
      if (this.recorder.client.config.craig.removeNickname) {
        const selfUser = await getSelfMember(this.channel.guild, this.recorder.client.bot);
        if (selfUser && selfUser.nick && recIndicator.test(selfUser.nick))
          try {
            await this.recorder.client.bot.editGuildMember(
              this.channel.guild.id,
              '@me',
              { nick: selfUser.nick.replace(recIndicator, '').trim() || null },
              'Removing recording status'
            );
          } catch (e) {
            this.recorder.logger.error('Failed to change nickname', e);
          }
      }

      if (this.started) {
        await this.uploadToDrive().catch((e) => this.recorder.logger.error(`Failed to upload recording ${this.id} to ${this.user.id}`, e));
        await this.calculateParticipantPayments().catch((e) => this.recorder.logger.error(`Failed to calculate payments for recording ${this.id}`, e));
      }
    } catch (e) {
      // This is pretty bad, make sure to clean up any reference
      this.recorder.logger.error(`Failed to stop recording ${this.id} by ${this.user.username}#${this.user.discriminator} (${this.user.id})`, e);
      this.recorder.recordings.delete(this.channel.guild.id);
    }
  }

  async uploadToDrive() {
    const user = await prisma.user.findUnique({ where: { id: this.user.id } });
    if (!user) return;

    // Always upload to S3 (global policy)
    await this.recorder.uploader.upload(this.id, this.user.id, 's3');

    // Optionally keep user drive uploads (if enabled)
    if (user.driveEnabled) {
      await this.recorder.uploader.upload(this.id, this.user.id, user.driveService);
    }
  }

  async calculateParticipantPayments() {
    const endedAt = (this as any).endedAt || new Date();
    if (!this.startedAt) return;

    // Process participants still in channel (those with no leftAt)
    const now = endedAt;
    for (const [userId, joinTime] of this.participantJoinTimes.entries()) {
      const durationSeconds = Math.floor((now.getTime() - joinTime.getTime()) / 1000);
      
      // Update or create participant record
      const existing = await prisma.recordingParticipant.findFirst({
        where: {
          recordingId: this.id,
          userId,
          leftAt: null
        }
      });

      if (existing) {
        await prisma.recordingParticipant.update({
          where: { id: existing.id },
          data: {
            leftAt: now,
            durationSeconds
          }
        }).catch(() => {});
      } else {
        await prisma.recordingParticipant.create({
          data: {
            recordingId: this.id,
            userId,
            joinedAt: joinTime,
            leftAt: now,
            durationSeconds
          }
        }).catch(() => {});
      }
    }

    // Get all participants for this recording
    const participants = await prisma.recordingParticipant.findMany({
      where: { recordingId: this.id }
    });

    // Get payment config from tasks service (we'll need to read it from config)
    // For now, use a default rate - this should ideally come from config
    const ratePerMinuteCents = 10; // $0.10 per minute default
    const minimumMinutesForPayment = 1;

    // Calculate payments for all participants
    for (const participant of participants) {
      const minutes = Math.floor(participant.durationSeconds / 60);
      
      if (minutes < minimumMinutesForPayment) continue;

      const paymentCents = minutes * ratePerMinuteCents;

      // Update participant with payment amount
      await prisma.recordingParticipant.update({
        where: { id: participant.id },
        data: { paymentCents }
      }).catch(() => {});

      // Add to user's balance
      await prisma.user.update({
        where: { id: participant.userId },
        data: {
          balanceCents: {
            increment: paymentCents
          }
        }
      }).catch(() => {});
    }
  }

  async connect() {
    const alreadyConnected = this.recorder.client.bot.voiceConnections.has(this.channel.guild.id);

    if (alreadyConnected)
      this.recorder.logger.warn(`Recording ${this.id} (channel: ${this.channel.id}, server: ${this.channel.guild.id}) was already connected`);

    if (!alreadyConnected) {
      this.connection?.removeAllListeners('connect');
      this.connection?.removeAllListeners('disconnect');
      this.connection?.removeAllListeners('resumed');
      this.connection?.removeAllListeners('error');
      this.connection?.removeAllListeners('warn');
      this.connection?.removeAllListeners('debug');
      this.connection?.removeAllListeners('pong');
      this.connection?.removeAllListeners('ready');
      this.connection?.removeAllListeners('transitioned');
      this.connection?.removeAllListeners('unknown');
      this.receiver?.removeAllListeners('data');
    }

    const connection = await this.channel.join({ opusOnly: true });
    // If we've already connected, Eris will use the same connection, so we don't need to re-add listeners
    if (!alreadyConnected) {
      connection.on('ready', this.onConnectionReady.bind(this));
      connection.on('connect', this.onConnectionConnect.bind(this));
      connection.on('disconnect', this.onConnectionDisconnect.bind(this));
      connection.on('pong', this.onConnectionPong.bind(this));
      connection.on('resumed', this.onConnectionResumed.bind(this));
      connection.on('unknown', this.onConnectionUnknown.bind(this));
      connection.on('transitioned', (transitionId: number) => {
        this.writeToLog(`DAVE session transitioned to ${transitionId} (v${this.connection?.daveProtocolVersion})`, 'connection');
      });
      connection.on('error', (err: any) => {
        this.writeToLog(`Error: ${err}`, 'connection');
        this.recorder.logger.error(`Error in connection for recording ${this.id}`, err);
      });
      connection.on('warn', (m: string) => {
        this.writeToLog(`Warning: ${m}`, 'connection');
        this.recorder.logger.debug(`Warning in connection for recording ${this.id}`, m);
      });
      connection.on('debug', (m) => {
        this.writeToLog(`Debug: ${m}`, 'connection');
        this.recorder.logger.debug(`Recording ${this.id}`, m);
      });
    }

    if (!alreadyConnected || !this.connection || !this.receiver) {
      const receiver = connection.receive('opus');
      receiver.on('data', this.onData.bind(this));
      this.receiver = receiver;
      this.connection = connection;
    }

    // Get voice & rtc worker versions
    connection.sendWS(16, {});

    const reconnected = this.state === RecordingState.RECONNECTING;
    this.state = RecordingState.RECORDING;
    if (reconnected) this.pushToActivity('Reconnected.');
  }

  async retryConnect() {
    for (let i = 1; i < 4; i++) {
      this.writeToLog(`Trying to reconnect (attempt ${i})`, 'connection');
      try {
        await wait(500);
        await this.connect();
        break;
      } catch (e) {
        this.writeToLog(`Reconnection attempt ${i} failed: ${e}`, 'connection');
      }
    }
    if (this.state !== RecordingState.RECORDING) {
      this.pushToActivity('Failed to reconnect after 3 tries.', false);
      this.sendWarning(
        'I could not reconnect properly to the voice channel after 3 tries. Please restart the recording, and if this problem persists, please join the support server.',
        false
      );
      this.recorder.logger.warn(`Recording ${this.id} could not properly reconnect`);
      try {
        await this.stop();
      } catch (e) {
        this.recorder.logger.debug(`Recording ${this.id} failed to stop after failed reconnect`, e);
      }
    }
  }

  async playNowRecording() {
    const fileName = this.recorder.client.config.craig.alistair ? 'nowrecording_alistair.opus' : 'nowrecording.opus';
    const filePath = this.recorder.client.config.craig.nowRecordingOpus || path.join(__dirname, '../../../data', fileName);

    try {
      await access(filePath);
      this.connection!.play(filePath, { format: 'ogg' });
    } catch (e) {}
  }

  // Event handlers //

  async onVoiceStateUpdate(member: Eris.Member, oldState: Eris.OldVoiceState) {
    if (member.id === this.recorder.client.bot.user.id) {
      if (member.voiceState.deaf && !oldState.deaf) {
        this.warningState = WarningState.DEAFENED;
        this.stateDescription = 'The bot has been deafened! Please undeafen me to continue recording.';
        this.pushToActivity('I was deafened!');
      } else if (!member.voiceState.deaf && oldState.deaf && this.warningState === WarningState.DEAFENED) {
        this.warningState = null;
        delete this.stateDescription;
        this.pushToActivity('I was undeafened.');
      }
      this.logWrite(`${new Date().toISOString()}: Bot's voice state updated ${JSON.stringify(member.voiceState)} -> ${JSON.stringify(oldState)}\n`);
      return;
    }

    // Track participants for payment system
    if (!this.active || !this.started) return;

    const wasInChannel = (oldState as any).channelID === this.channel.id;
    const isInChannel = member.voiceState.channelID === this.channel.id;
    const userId = member.id;

    // Skip bots
    if (member.user.bot) return;

    // User joined the recording channel
    if (!wasInChannel && isInChannel) {
      const joinTime = new Date();
      this.participantJoinTimes.set(userId, joinTime);
      
      // Create participant record if it doesn't exist
      const existing = await prisma.recordingParticipant.findFirst({
        where: { recordingId: this.id, userId, leftAt: null }
      });

      if (!existing) {
        await prisma.recordingParticipant.create({
          data: {
            recordingId: this.id,
            userId,
            joinedAt: joinTime
          }
        }).catch(() => {});
      }
    }

    // User left the recording channel
    if (wasInChannel && !isInChannel) {
      const joinTime = this.participantJoinTimes.get(userId);
      if (joinTime) {
        const now = new Date();
        const durationSeconds = Math.floor((now.getTime() - joinTime.getTime()) / 1000);
        this.participantJoinTimes.delete(userId);

        // Update participant record with leave time and duration
        await prisma.recordingParticipant.updateMany({
          where: {
            recordingId: this.id,
            userId,
            leftAt: null
          },
          data: {
            leftAt: now,
            durationSeconds
          }
        }).catch(() => {});
      }
    }
  }

  async onVoiceChannelEffectSend(effect: Eris.VoiceChannelEffect) {
    // TODO add soundboard sounds in a .ogg.soundboard file
  }

  async onConnectionConnect() {
    if (!this.active) return;
    this.writeToLog(
      `Connected to channel ${this.connection!.channelID} at ${this.connection!.endpoint} (state=${this.connection?.ws?.readyState})`,
      'connection'
    );
    this.recorder.logger.debug(`Recording ${this.id} connected`);
    if (this.connection!.channelID !== this.channel.id) {
      this.stateDescription = '⚠️ I was moved to another channel! If you want me to leave, please press the stop button.';
      return await this.stop();
    } else if (this.state === RecordingState.RECONNECTING) {
      this.state = RecordingState.RECORDING;
      this.pushToActivity('Reconnected.');
    }
  }

  async onConnectionReady() {
    if (!this.active) return;
    this.writeToLog(`Voice connection ready (state=${this.connection?.ws?.readyState}, mode=${this.connection?.mode}, dave=${this.connection?.daveProtocolVersion})`, 'connection');
    this.recorder.logger.debug(`Recording ${this.id} ready (mode=${this.connection?.mode}, dave=${this.connection?.daveProtocolVersion})`);
    this.pushToActivity('Automatically reconnected.');

    // Get voice & rtc worker versions
    this.connection?.sendWS(16, {});
  }

  async onConnectionResumed() {
    if (!this.active) return;
    this.writeToLog(`Voice connection resumed (seq=${this.connection?.wsSequence})`, 'connection');
    this.recorder.logger.debug(`Recording ${this.id} resumed`);
  }

  async onConnectionPong(latency: number) {
    this.latency = latency;
    this.writeToLog(`Voice server latency: ${latency}ms`, 'connection');
    if (latency && latency > MAX_LATENCY_WARNING && !this.latencyWarned) {
      this.latencyWarned = true;
      this.pushToActivity(`⚠️ High voice server latency: ${latency}ms, this may cause issues with the recording.`, true);
    } else await this.updateMessage();
  }

  async onConnectionDisconnect(err?: Error) {
    if (!this.active) return;
    this.writeToLog(`Got disconnected, ${err}`);
    this.recorder.logger.debug(`Recording ${this.id} disconnected`, err);
    if (err) {
      this.state = RecordingState.RECONNECTING;
      if (err.message.startsWith('4006')) this.pushToActivity('Discord requested us to reconnect, reconnecting...');
      else this.pushToActivity('An error has disconnected me, reconnecting...');
      this.channel.leave();
      await this.retryConnect();
    } else if (this.state !== RecordingState.RECONNECTING) {
      this.pushToActivity(`The voice connection was closed, disconnecting... ([why?](https://link.snaz.in/craigstopped))`, false);
      try {
        await this.stop();
      } catch (e) {
        this.recorder.logger.debug(`Recording ${this.id} failed to stop after disconnect`, e);
      }
    }
  }

  async onConnectionUnknown(packet: any) {
    const client = this.recorder.client;
    if (!client.config.craig.systemNotificationURL) return;

    if (
      typeof packet === 'object' &&
      'op' in packet &&
      packet.op === 16 &&
      typeof packet.d === 'object' &&
      typeof packet.d.voice === 'string' &&
      typeof packet.d.rtc_worker === 'string'
    ) {
      const { voice: voiceVersion, rtc_worker: rtcWorkerVersion } = packet.d;
      const voiceEndpoint = this.connection?.endpoint?.hostname;
      this.writeToLog(`Voice version ${voiceVersion} / RTC worker version ${rtcWorkerVersion}`, 'connection');
      if (!voiceEndpoint || !voiceEndpoint.endsWith('.discord.media')) {
        return this.recorder.logger.warn(
          `Encountered an unknown voice region endpoint: ${voiceEndpoint} (voice: ${voiceVersion}, rtc worker: ${rtcWorkerVersion})`
        );
      }
      const regionId = voiceEndpoint.startsWith('c-')
        ? voiceEndpoint.replace(/\d+?-[\da-f]+\.discord\.media$/, '')
        : voiceEndpoint.replace(/\d+\.discord\.media$/, '');

      this.recorder.metrics.onVoiceServerConnect(regionId);

      const existingRegion = await prisma.voiceRegion.findUnique({ where: { id: regionId } });

      await prisma.voiceRegion.upsert({
        where: { id: regionId },
        update: {},
        create: { id: regionId }
      });

      // Detect and track versions
      const voiceVersionSeen = await prisma.voiceVersion.findFirst({
        where: { version: voiceVersion }
      });

      if (!voiceVersionSeen)
        await prisma.voiceVersion.create({
          data: { version: voiceVersion, regionId, endpoint: voiceEndpoint }
        });

      const rtcWorkerVersionSeen = await prisma.rtcVersion.findFirst({
        where: { version: rtcWorkerVersion }
      });

      if (!rtcWorkerVersionSeen)
        await prisma.rtcVersion.create({
          data: { version: rtcWorkerVersion, regionId, endpoint: voiceEndpoint }
        });

      // Update latest region voice version
      const lastVoiceVersion = await prisma.regionVoiceVersion.findUnique({
        where: { regionId }
      });

      if (!lastVoiceVersion || semver.lt(lastVoiceVersion.version, voiceVersion))
        await prisma.regionVoiceVersion.upsert({
          where: { regionId },
          update: {
            version: voiceVersion,
            endpoint: voiceEndpoint,
            seenAt: new Date()
          },
          create: {
            regionId,
            version: voiceVersion,
            endpoint: voiceEndpoint
          }
        });

      // Update latest rtc worker version
      const lastRtcWorkerVersion = await prisma.regionRtcVersion.findUnique({
        where: { regionId }
      });

      if (!lastRtcWorkerVersion || semver.lt(lastRtcWorkerVersion.version, rtcWorkerVersion))
        await prisma.regionRtcVersion.upsert({
          where: { regionId },
          update: {
            version: rtcWorkerVersion,
            endpoint: voiceEndpoint,
            seenAt: new Date()
          },
          create: {
            regionId,
            version: rtcWorkerVersion,
            endpoint: voiceEndpoint
          }
        });

      if (!existingRegion || !voiceVersionSeen || !rtcWorkerVersionSeen) {
        const title = `New ${[
          !existingRegion ? 'Voice Region' : undefined,
          !voiceVersionSeen ? 'Voice Version' : undefined,
          !rtcWorkerVersionSeen ? 'RTC Worker Version' : undefined
        ]
          .filter((v) => !!v)
          .join(', ')}`;
        await fetch(`${client.config.craig.systemNotificationURL}?with_components=true`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            flags: MessageFlags.IS_COMPONENTS_V2,
            components: [
              {
                type: ComponentType.CONTAINER,
                accent_color: 5793266,
                components: [
                  {
                    type: ComponentType.TEXT_DISPLAY,
                    content: [
                      `# 🔊 ${title}`,
                      `**Region:** \`${regionId}\` ${!existingRegion ? '**🆕**' : ''}`,
                      `**Voice Version:** ${voiceVersion} ${!voiceVersionSeen ? '**🆕**' : ''}`,
                      `**RTC Worker Version:** ${rtcWorkerVersion} ${!rtcWorkerVersionSeen ? '**🆕**' : ''}`
                    ].join('\n')
                  },
                  {
                    type: ComponentType.SEPARATOR,
                    divider: true,
                    spacing: SeparatorSpacingSize.SMALL
                  },
                  {
                    type: ComponentType.TEXT_DISPLAY,
                    content: [
                      `**Voice Server Endpoint:** \`${voiceEndpoint}\``,
                      `**Bot**: <@${client.bot.user.id}> (${client.bot.user.id})`,
                      `-# <t:${Math.floor(Date.now() / 1000)}:F>`
                    ].join('\n')
                  }
                ]
              }
            ]
          })
        });
      }
    }
  }

  // Data streaming //

  flush(user: RecordingUser, ct: number) {
    let packetNo = user.packet;
    for (let i = 0; i < ct; i++) {
      const chunk = this.userPackets[user.id].shift();
      try {
        this.encodeChunk(user, user.track, packetNo, chunk!);
        packetNo += 2;
      } catch (ex) {
        this.recorder.logger.error(`Failed to encode packet ${packetNo} for user ${user.id}`, ex);
      }
    }
    user.packet = packetNo;
  }

  increaseBytesWritten(size: number) {
    this.bytesWritten += size;
    if (this.sizeLimit && this.bytesWritten >= this.sizeLimit) {
      if (!this.hardLimitHit) {
        this.hardLimitHit = true;
        this.stateDescription = '⚠️ The recording has reached the size limit and has been automatically stopped.';
        this.sendWarning('The recording has reached the size limit and has been automatically stopped.', false);
        this.stop();
      }
      return true;
    }
    return false;
  }

  private logWrite(message: string) {
    if (this.closing) return void this.recorder.logger.error(`Tried to write log stream while closing! (message: ${message}, recording: ${this.id})`);
    this.writer?.writeLog(message);
  }

  encodeChunk(user: RecordingUser, streamNo: number, packetNo: number, chunk: Chunk) {
    let buffer = chunk.data;

    if (buffer.length > 4 && buffer[0] === 0xbe && buffer[1] === 0xde) {
      // There's an RTP header extension here. Strip it.
      const rtpHLen = buffer.readUInt16BE(2);
      let off = 4;

      for (let rhs = 0; rhs < rtpHLen && off < buffer.length; rhs++) {
        const subLen = (buffer[off] & 0xf) + 2;
        off += subLen;
      }
      while (off < buffer.length && buffer[off] === 0) off++;
      if (off >= buffer.length) off = buffer.length;

      buffer = buffer.slice(off);
    }

    // Occasionally check that it's valid Opus data
    if (packetNo % 50 === 49) {
      try {
        opus.decode(chunk.data);
      } catch (ex) {
        if (!(user.id in this.usersWarned)) {
          this.pushToActivity(`⚠️ User <@${user.id}> has corrupt data! I will not be able to correctly process their audio!`);
          this.usersWarned.push(user.id);
        }
      }
    }

    // Write out the chunk itself
    this.writer?.writeChunk(streamNo, packetNo, chunk, buffer);
  }

  async getOrCreateRecordingUser(userID: string) {
    if (!this.userPackets[userID]) this.userPackets[userID] = [];
    if (this.users[userID]) return this.users[userID];
    if (Object.keys(this.users).length >= USER_HARD_LIMIT) return;
    let user = this.recorder.client.bot.users.get(userID);
    this.users[userID] = {
      id: userID,
      username: user?.username ?? 'Unknown',
      discriminator: user?.discriminator ?? '0000',
      globalName: user?.globalName,
      bot: user?.bot ?? false,
      unknown: !user,
      track: this.trackNo++,
      packet: 2
    };
    const recordingUser = this.users[userID];

    this.webapp?.monitorSetConnected(recordingUser.track, `${recordingUser.username}#${recordingUser.discriminator}`, true);

    try {
      this.writeToLog(
        `Writing headers on track ${recordingUser.track} (${recordingUser.username}#${recordingUser.discriminator}, ${recordingUser.id})`,
        'recording'
      );
      this.writer?.writeUserHeader(recordingUser);
    } catch (e) {
      this.recorder.logger.error(`Failed to write headers for recording ${this.id}`, e);
      this.writeToLog(`Failed to write headers on track ${recordingUser.track} (${recordingUser.username}#${recordingUser.discriminator}): ${e}`);
    }

    if (recordingUser.unknown) {
      const member = this.channel.voiceMembers.get(userID) || (await this.channel.guild.fetchMembers({ userIDs: [userID] }))?.[0];
      recordingUser.username = member?.username ?? 'Unknown';
      recordingUser.discriminator = member?.discriminator ?? '0000';
      recordingUser.globalName = member?.user?.globalName;
      recordingUser.bot = member?.user?.bot ?? false;
      recordingUser.unknown = !member;
      if (member) user = member.user;
    }

    if (user) {
      try {
        const { data } = await axios.get(user.dynamicAvatarURL('png', 2048), { responseType: 'arraybuffer' });
        recordingUser.avatar = 'data:image/png;base64,' + Buffer.from(data, 'binary').toString('base64');
      } catch (e) {
        this.recorder.logger.warn(`Failed to fetch avatar for recording ${this.id}`, e);
        this.writeToLog(`Failed to fetch avatar for recording ${this.id}: ${e}`);
      }

      recordingUser.avatarUrl = user.dynamicAvatarURL('png', 256);
      if (recordingUser.avatarUrl) this.webapp?.monitorSetUserExtra(recordingUser.track, UserExtraType.AVATAR, recordingUser.avatarUrl);
    }

    this.writer?.writeUser(recordingUser);
    this.writeToLog(
      `New user ${recordingUser.username}#${recordingUser.discriminator} (${recordingUser.id}, track=${recordingUser.track})`,
      'recording'
    );
    this.pushToActivity(`<@${userID}> joined the recording.`);
    this.recorder.logger.debug(`User ${recordingUser.username}#${recordingUser.discriminator} (${userID}) joined recording ${this.id}`);
    return recordingUser;
  }

  async onData(data: Buffer, userID: string, timestamp: number) {
    if (!this.active) return;
    if (!userID) return;

    // Check if the packet is mostly zeros (all but one byte are zero)
    // Cloudflare voice servers (prefixed with `c-`) tend to do this for no reason at all
    if (data[0] === 0) {
      const zeroCount = data.reduce((acc, byte) => acc + (byte === 0 ? 1 : 0), 0);
      if (zeroCount >= data.length - 1) {
        if (!this.zeroPacketWarned) {
          this.zeroPacketWarned = true;
          this.writeToLog(`Received mostly zero audio packet from user ${userID}`, 'recording');
        }
        return;
      }
    }

    const chunkTime = process.hrtime(this.startTime!);
    const time = chunkTime[0] * 48000 + ~~(chunkTime[1] / 20833.333);
    const recordingUser = await this.getOrCreateRecordingUser(userID);
    if (!recordingUser) return;

    // Add packet to list
    if (this.userPackets[userID].length > 0) {
      const lastPacket = this.userPackets[userID][this.userPackets[userID].length - 1];
      this.userPackets[userID].push({ data, timestamp, time });
      // Reorder packets
      if (lastPacket.timestamp > timestamp) this.userPackets[userID].sort((a, b) => a.timestamp - b.timestamp);
    } else this.userPackets[userID].push({ data, timestamp, time });

    // Flush packets if its getting long
    if (this.userPackets[userID].length >= 16) this.flush(recordingUser, 1);

    // Set speaking thru webapp
    this.webapp?.userSpeaking(recordingUser.track);
  }

  note(note?: string) {
    if (this.notePacketNo === 0) {
      this.writer?.writeNoteHeader();
      this.notePacketNo++;
    }
    const chunkTime = process.hrtime(this.startTime!);
    const chunkGranule = chunkTime[0] * 48000 + ~~(chunkTime[1] / 20833.333);
    this.writer?.writeNote(chunkGranule, this.notePacketNo++, Buffer.from('NOTE' + note));
  }

  // Message handling //

  async pushToActivity(log: string, update = true) {
    if (this.startTime) {
      const timestamp = process.hrtime(this.startTime);
      const time = timestamp[0] * 1000 + timestamp[1] / 1000000;
      this.logs.push(`\`${dayjs.duration(time).format('HH:mm:ss')}\`: ${log}`);
    } else this.logs.push(`<t:${Math.floor(Date.now() / 1000)}:R>: ${log}`);
    this.logWrite(`<[Activity] ${new Date().toISOString()}>: ${log}\n`);
    if (update) return this.updateMessage();
  }

  writeToLog(log: string, type?: string) {
    if (!this.closing) this.logWrite(`<[Internal:${type}] ${new Date().toISOString()}>: ${log}\n`);
  }

  get emojis() {
    return (this.recorder.client.modules.get('slash') as SlashModule<any>).emojis;
  }

  messageContent() {
    let color: number | undefined = undefined;
    let title = 'Loading...';
    switch (this.state) {
      case RecordingState.IDLE: {
        color = 0x3498db;
        break;
      }
      case RecordingState.RECORDING: {
        title = '🔴 Recording...';
        if (this.warningState === null) color = 0x2ecc71;
        else color = 0xf1c40f;
        break;
      }
      case RecordingState.CONNECTING: {
        title = 'Connecting...';
        color = 0xf39c12;
        break;
      }
      case RecordingState.RECONNECTING: {
        title = 'Reconnecting...';
        color = 0xf39c12;
        break;
      }
      case RecordingState.ERROR: {
        title = 'An error occurred.';
        color = 0xe74c3c;
        break;
      }
      case RecordingState.ENDED: {
        title = 'Recording ended.';
        break;
      }
    }

    if (this.warningState !== null)
      switch (this.warningState) {
        case WarningState.DEAFENED: {
          title = '⚠️ I was deafened!';
          break;
        }
      }

    const startedTimestamp = this.startedAt ? Math.floor(this.startedAt.valueOf() / 1000) : null;
    const voiceRegion = this.connection?.endpoint?.hostname;
    return {
      flags: MessageFlags.IS_COMPONENTS_V2,
      allowedMentions: {
        everyone: false,
        users: false,
        roles: false
      },
      components: [
        {
          type: ComponentType.CONTAINER,
          accent_color: color,
          components: [
            {
              type: ComponentType.TEXT_DISPLAY,
              content: stripIndents`
                -# ${this.user.mention}'s recording
                ## ${title}
                ${this.stateDescription ?? ''}
              `
            },
            {
              type: ComponentType.SEPARATOR,
              divider: true,
              spacing: SeparatorSpacingSize.SMALL
            },
            {
              type: ComponentType.TEXT_DISPLAY,
              content: [
                `**Recording ID:** \`${this.id}\``,
                `**Channel:** ${this.channel.mention}`,
                startedTimestamp ? `**Started:** <t:${startedTimestamp}:T> (<t:${startedTimestamp}:R>)` : '',
                voiceRegion ? `**Voice Region:** ${voiceRegion.replace(/\.discord\.media$/, '')}` : '',
                this.latency ? `**Voice Server Latency:** ${this.latency}ms${this.latency > MAX_LATENCY_WARNING ? ' ⚠️' : ''}` : ''
              ]
                .filter((v) => !!v)
                .join('\n')
            },
            ...(this.logs.length
              ? [
                  {
                    type: ComponentType.SEPARATOR,
                    divider: true,
                    spacing: SeparatorSpacingSize.SMALL
                  },
                  {
                    type: ComponentType.TEXT_DISPLAY,
                    content: `### Activity\n${this.logs.slice(0, 10).join('\n')}`
                  }
                ]
              : []),
            {
              type: ComponentType.SEPARATOR,
              divider: true,
              spacing: SeparatorSpacingSize.SMALL
            },
            {
              type: ComponentType.ACTION_ROW,
              components: [
                {
                  type: ComponentType.BUTTON,
                  style: ButtonStyle.DESTRUCTIVE,
                  label: 'Stop recording',
                  custom_id: `rec:${this.id}:stop`,
                  disabled: this.state !== RecordingState.RECORDING && this.state !== RecordingState.RECONNECTING,
                  emoji: this.emojis.getPartial('stop')
                },
                {
                  type: ComponentType.BUTTON,
                  style: ButtonStyle.PRIMARY,
                  label: 'Add a note',
                  custom_id: `rec:${this.id}:note`,
                  disabled: this.state !== RecordingState.RECORDING && this.state !== RecordingState.RECONNECTING,
                  emoji: this.emojis.getPartial('addnote')
                },
                ...(this.connection?.daveProtocolVersion && this.connection.daveProtocolVersion > 0
                  ? [
                      {
                        type: ComponentType.BUTTON,
                        style: ButtonStyle.SECONDARY,
                        custom_id: `rec:${this.id}:e2ee`,
                        disabled: this.state !== RecordingState.RECORDING && this.state !== RecordingState.RECONNECTING,
                        emoji: this.emojis.getPartial('e2ee')
                      }
                    ]
                  : [])
              ]
            }
          ]
        },
        ...(![RecordingState.ENDED, RecordingState.ERROR].includes(this.state)
          ? [
              {
                type: ComponentType.TEXT_DISPLAY,
                content: '-# Is this panel stuck? Try running `/join` again for a new recording panel.'
              }
            ]
          : [])
      ]
    } as EditMessageOptions as any;
  }

  async updateMessage() {
    if (!this.messageChannelID || !this.messageID) return false;

    try {
      this.lastMessageError = null;
      await this.recorder.client.bot.editMessage(this.messageChannelID!, this.messageID!, this.messageContent());
      return true;
    } catch (e) {
      this.recorder.logger.error(`Failed to update message ${this.messageID} for recording ${this.id}`, e);
      this.writeToLog(`Failed to update message ${this.messageID} for recording ${this.id}`, 'message');
      this.lastMessageError = e as Error;
      if (e instanceof Eris.DiscordRESTError && BAD_MESSAGE_CODES.includes(e.code)) {
        this.messageChannelID = null;
        this.messageID = null;
      }
      return false;
    }
  }
}
