import { OpusEncoder } from '@discordjs/opus';
import axios from 'axios';
import { stripIndents } from 'common-tags';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import { DexareClient } from 'dexare';
import Eris from 'eris';
import { access, writeFile } from 'fs/promises';
import { customAlphabet, nanoid } from 'nanoid';
import path from 'path';
import { ButtonStyle, ComponentType } from 'slash-create';

import type { CraigBot, CraigBotConfig } from '../../bot';
import { onRecordingEnd, onRecordingStart } from '../../influx';
import { prisma } from '../../prisma';
import { getSelfMember, ParsedRewards, stripIndentsAndLines, wait } from '../../util';
import type RecorderModule from '.';
import { UserExtraType, WebappOpCloseReason } from './protocol';
import { WebappClient } from './webapp';
import RecordingWriter from './writer';

dayjs.extend(duration);

const opus = new OpusEncoder(48000, 2);
const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const recNanoid = customAlphabet(alphabet, 10);
const recIndicator = / *!?\[RECORDING\] */;

export const NOTE_TRACK_NUMBER = 65536;
const USER_HARD_LIMIT = 10000;

const BAD_MESSAGE_CODES = [
  404,
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
  startTime: [number, number] = [0, 0];
  startedAt: Date | null = null;
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

  timeout: any;
  usageInterval: any;
  sizeLimit = 0;
  lastSize = 0;
  usedMinutes = 0;
  unusedMinutes = 0;
  silenceWarned = false;
  maintenceWarned = false;

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
      this.stateDescription = `Failed to connect to your channel: ${e}`;
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
        requester: this.user.username + '#' + this.user.discriminator,
        requesterExtra: {
          username: this.user.username,
          discriminator: this.user.discriminator,
          avatar: this.user.dynamicAvatarURL('png', 256)
        },
        requesterId: this.user.id,
        startTime: this.startedAt.toISOString(),
        expiresAfter: rewards.downloadExpiryHours,
        features: rewards.features.reduce((acc, cur) => ({ ...acc, [cur]: true }), {} as { [key: string]: boolean })
      }),
      { encoding: 'utf8' }
    );
    this.writer = new RecordingWriter(this, fileBase);
    this.writeToLog(`Connected to channel ${this.connection!.channelID} at ${this.connection!.endpoint}`);

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

      if (this.rewards && this.startedAt && this.started)
        await prisma.recording
          .upsert({
            where: { id: this.id },
            update: { endedAt: new Date() },
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
              endedAt: new Date()
            }
          })
          .catch((e) => this.recorder.logger.error(`Error writing end date to recording ${this.id}`, e));

      const timestamp = process.hrtime(this.startTime);
      const time = timestamp[0] * 1000 + timestamp[1] / 1000000;
      await onRecordingEnd(this.user.id, this.channel.guild.id, this.startedAt!, time, this.autorecorded, !!this.webapp, false).catch(() => {});

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

      if (this.started)
        await this.uploadToDrive().catch((e) => this.recorder.logger.error(`Failed to upload recording ${this.id} to ${this.user.id}`, e));
    } catch (e) {
      // This is pretty bad, make sure to clean up any reference
      this.recorder.logger.error(`Failed to stop recording ${this.id} by ${this.user.username}#${this.user.discriminator} (${this.user.id})`, e);
      this.recorder.recordings.delete(this.channel.guild.id);
    }
  }

  async uploadToDrive() {
    const user = await prisma.user.findUnique({ where: { id: this.user.id } });
    if (!user || !user.driveEnabled) return;

    const services: { [key: string]: string } = {
      google: 'Google Drive',
      dropbox: 'Dropbox',
      onedrive: 'OneDrive'
    };
    const service = services[user.driveService] ?? user.driveService;

    const response = await this.recorder.trpc
      .query('driveUpload', {
        recordingId: this.id,
        userId: this.user.id
      })
      .catch(() => null);

    if (!response) {
      this.recorder.logger.error(`Failed to upload recording ${this.id} to ${service}: Could not connect to the server`);
      const dmChannel = await this.user.getDMChannel().catch(() => null);
      if (dmChannel)
        await dmChannel.createMessage({
          embeds: [
            {
              title: `Failed to upload to ${service}`,
              description: `Unable to connect to the Cloud Backup microservice. You will need to manually upload your recording to your ${service}.`,
              color: 0xe74c3c
            }
          ]
        });
      return;
    }

    if (response.error) {
      this.recorder.logger.error(`Failed to upload recording ${this.id} to ${service}: ${response.error}`);
      if (response.notify) {
        const dmChannel = await this.user.getDMChannel().catch(() => null);
        if (dmChannel)
          await dmChannel.createMessage({
            embeds: [
              {
                title: `Failed to upload to ${service}`,
                description: `Failed to upload recording \`${this.id}\` to ${service}. You may need to manually upload it to your ${service}, or possibly re-connect your ${service}.\n\n- **\`${response.error}\`**`,
                color: 0xe74c3c
              }
            ]
          });
      }
      return;
    }

    if (response.notify) {
      const dmChannel = await this.user.getDMChannel().catch(() => null);
      if (dmChannel)
        await dmChannel.createMessage({
          embeds: [
            {
              title: `Uploaded to ${service}`,
              description: `Recording \`${this.id}\` was uploaded to ${service}.`,
              color: 0x2ecc71
            }
          ],
          components: [
            ...(response.url
              ? ([
                  {
                    type: ComponentType.ACTION_ROW,
                    components: [
                      {
                        type: ComponentType.BUTTON,
                        style: ButtonStyle.LINK,
                        label: `Open in ${service}`,
                        url: response.url
                      }
                    ]
                  }
                ] as any)
              : [])
          ]
        });
    }
  }

  async connect() {
    const connection = await this.channel.join({ opusOnly: true });
    connection.on('connect', this.onConnectionConnect.bind(this));
    connection.on('disconnect', this.onConnectionDisconnect.bind(this));
    connection.on('error', (err) => {
      this.writeToLog(`Error: ${err}`, 'connection');
      this.recorder.logger.error(`Error in connection for recording ${this.id}`, err);
    });
    connection.on('warn', (m) => {
      this.writeToLog(`Warning: ${m}`, 'connection');
      this.recorder.logger.debug(`Warning in connection for recording ${this.id}`, m);
    });
    connection.on('debug', (m) => {
      this.writeToLog(`Debug: ${m}`, 'connection');
      this.recorder.logger.debug(`Recording ${this.id}`, m);
    });
    connection.on('error', (err) => {
      this.writeToLog(`Connection error: ${err}`, 'error');
      this.recorder.logger.error(`Recording ${this.id}: Connection error`, err);
    });
    const receiver = connection.receive('opus');
    receiver.on('data', this.onData.bind(this));
    this.state = RecordingState.RECORDING;
    this.receiver = receiver;
    this.connection = connection;
  }

  async playNowRecording() {
    const filePath = path.join(__dirname, '../../../data/nowrecording.opus');

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
    }
  }

  async onConnectionConnect() {
    if (!this.active) return;
    this.writeToLog(`Connected to channel ${this.connection!.channelID} at ${this.connection!.endpoint} (state=${this.connection?.ws?.readyState})`);
    if (this.connection!.channelID !== this.channel.id) {
      this.stateDescription = '⚠️ I was moved to another channel! If you want me to leave, please press the stop button.';
      return await this.stop();
    } else this.pushToActivity('Reconnected.');
  }

  async onConnectionDisconnect(err?: Error) {
    if (!this.active) return;
    this.writeToLog(`Got disconnected, ${err}`);
    if (err) {
      this.state = RecordingState.RECONNECTING;
      this.pushToActivity('An error has disconnected me, reconnecting...');
      await this.connect();
    } else {
      this.pushToActivity(`The voice connection was closed, disconnecting... ([why?](https://link.snaz.in/craigstopped))`, false);
      try {
        await this.stop();
      } catch (e) {
        console.log(e);
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
    this.writer?.q.push({ type: 'writeLog', message });
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
    this.writer?.q.push({ type: 'writeChunk', streamNo, packetNo, chunk, buffer });
  }

  async onData(data: Buffer, userID: string, timestamp: number) {
    data = Buffer.from(data);
    if (!userID) return;

    let recordingUser = this.users[userID];
    const chunkTime = process.hrtime(this.startTime);
    const time = chunkTime[0] * 48000 + ~~(chunkTime[1] / 20833.333);
    if (!this.userPackets[userID]) this.userPackets[userID] = [];
    if (!recordingUser) {
      if (Object.keys(this.users).length >= USER_HARD_LIMIT) return;
      let user = this.recorder.client.bot.users.get(userID);
      this.users[userID] = {
        id: userID,
        username: user?.username ?? 'Unknown',
        discriminator: user?.discriminator ?? '0000',
        unknown: !user,
        track: this.trackNo++,
        packet: 2
      };
      recordingUser = this.users[userID];

      this.webapp?.monitorSetConnected(recordingUser.track, `${recordingUser.username}#${recordingUser.discriminator}`, true);

      try {
        this.writer?.q.push({ type: 'writeUserHeader', user: recordingUser });
      } catch (e) {
        this.recorder.logger.error(`Failed to write headers for recording ${this.id}`, e);
        this.writeToLog(
          `Failed to write headers for recording ${this.id} on track ${recordingUser.track} (${recordingUser.username}#${recordingUser.discriminator}): ${e}`
        );
      }

      if (recordingUser.unknown) {
        const member = (await this.channel.guild.fetchMembers({ userIDs: [userID] }))?.[0];
        recordingUser.username = member?.username ?? 'Unknown';
        recordingUser.discriminator = member?.discriminator ?? '0000';
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

      this.writer?.q.push({ type: 'writeUser', user: recordingUser });
      this.writeToLog(
        `New user ${recordingUser.username}#${recordingUser.discriminator} (${recordingUser.id}, track=${recordingUser.track})`,
        'recording'
      );
      this.pushToActivity(`<@${userID}> joined the recording.`);
      this.recorder.logger.debug(`User ${recordingUser.username}#${recordingUser.discriminator} (${userID}) joined recording ${this.id}`);
    }

    // Add packet to list
    if (this.userPackets[userID].length > 0) {
      const lastPacket = this.userPackets[userID][this.userPackets[userID].length - 1];
      this.userPackets[userID].push({ data, timestamp, time });
      // Reorder packets
      if (lastPacket.timestamp > timestamp)
        this.userPackets[userID].sort((a, b) => {
          return a.timestamp - b.timestamp;
        });
    } else this.userPackets[userID].push({ data, timestamp, time });

    // Flush packets if its getting long
    if (this.userPackets[userID].length >= 16) this.flush(recordingUser, 1);

    // Set speaking thru webapp
    this.webapp?.userSpeaking(recordingUser.track);
  }

  note(note?: string) {
    if (this.notePacketNo === 0) {
      this.writer?.q.push({ type: 'writeNoteHeader' });
      this.notePacketNo++;
    }
    const chunkTime = process.hrtime(this.startTime);
    const chunkGranule = chunkTime[0] * 48000 + ~~(chunkTime[1] / 20833.333);
    this.writer?.q.push({ type: 'writeNote', chunkGranule, packetNo: this.notePacketNo++, buffer: Buffer.from('NOTE' + note) });
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
    return {
      content: '',
      embeds: [
        {
          author: {
            name: `${this.user.username}#${this.user.discriminator}`,
            icon_url: this.user.dynamicAvatarURL()
          },
          color,
          title,
          description: stripIndents`
            ${this.stateDescription ?? ''}

            ${stripIndentsAndLines`
              ${this.autorecorded ? '- *Autorecorded*' : ''}
              **Recording ID:** \`${this.id}\`
              **Channel:** ${this.channel.mention}
              ${startedTimestamp ? `**Started:** <t:${startedTimestamp}:T> (<t:${startedTimestamp}:R>)` : ''}
            `}
          `,
          fields: this.logs.length
            ? [
                {
                  name: 'Activity',
                  value: this.logs.slice(0, 10).join('\n')
                }
              ]
            : [],
          footer: ![RecordingState.ENDED, RecordingState.ERROR].includes(this.state)
            ? {
                text: 'Is this panel stuck? Try running "/join" again for a new recording panel.'
              }
            : null
        }
      ],
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.BUTTON,
              style: ButtonStyle.DESTRUCTIVE,
              label: 'Stop recording',
              custom_id: `rec:${this.id}:stop`,
              disabled: this.state !== RecordingState.RECORDING && this.state !== RecordingState.RECONNECTING,
              emoji: { id: '968242879539576862' }
            },
            {
              type: ComponentType.BUTTON,
              style: ButtonStyle.PRIMARY,
              label: 'Add a note',
              custom_id: `rec:${this.id}:note`,
              disabled: this.state !== RecordingState.RECORDING && this.state !== RecordingState.RECONNECTING,
              emoji: { id: '968242878948192267' }
            }
          ]
        }
      ]
    } as Eris.AdvancedMessageContent;
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
