import { stripIndents } from 'common-tags';
import { DexareClient } from 'dexare';
import Eris from 'eris';
import { createWriteStream, WriteStream } from 'fs';
import { writeFile, access } from 'fs/promises';
import { nanoid } from 'nanoid';
import path from 'path';
import { ButtonStyle, ComponentType } from 'slash-create';
import RecorderModule from '.';
import { CraigBotConfig } from '../../bot';
import OggEncoder, { BOS } from './ogg';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
dayjs.extend(duration);

const OPUS_HEADERS = [
  Buffer.from([
    0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 0x01, 0x02, 0x00, 0x0f, 0x80, 0xbb, 0x00, 0x00, 0x00, 0x00, 0x00
  ]),
  Buffer.from([
    0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73, 0x09, 0x00, 0x00, 0x00, 0x6e, 0x6f, 0x64, 0x65, 0x2d, 0x6f, 0x70,
    0x75, 0x73, 0x00, 0x00, 0x00, 0x00, 0xff
  ])
];

const EMPTY_BUFFER = Buffer.alloc(0);

const NOTE_TRACK_NUMBER = 65536;
const USER_HARD_LIMIT = 10000;

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
  unknown: boolean;
  track: number;
  packet: number;
}

export interface Chunk {
  data: Buffer;
  timestamp: number;
  time: number;
}

// TODO stop when a size limit is hit
export default class Recording {
  recorder: RecorderModule<DexareClient<CraigBotConfig>>;
  id = nanoid(18);
  accessKey = nanoid(8);
  deleteKey = nanoid(8);
  channel: Eris.StageChannel | Eris.VoiceChannel;
  user: Eris.User;
  active = false;
  state: RecordingState = RecordingState.IDLE;
  warningState: WarningState | null = null;
  stateDescription?: string;
  connection: Eris.VoiceConnection | null = null;
  receiver: Eris.VoiceDataStream | null = null;

  messageChannelID: string | null = null;
  messageID: string | null = null;
  startTime: [number, number] = [0, 0];
  startedAt: Date | null = null;
  logs: string[] = [];

  users: { [key: string]: RecordingUser } = {};
  userPackets: { [key: string]: Chunk[] } = {};
  trackNo = 1;
  notePacketNo = 0;
  dataEncoder: OggEncoder | null = null;
  usersStream: WriteStream | null = null;
  logStream: WriteStream | null = null;
  headerEncoder1: OggEncoder | null = null;
  headerEncoder2: OggEncoder | null = null;

  constructor(
    recorder: RecorderModule<DexareClient<CraigBotConfig>>,
    channel: Eris.StageChannel | Eris.VoiceChannel,
    user: Eris.User
  ) {
    this.recorder = recorder;
    this.channel = channel;
    this.user = user;
  }

  async start() {
    this.recorder.logger.debug(
      `Starting recording ${this.id} by ${this.user.username}#${this.user.discriminator} (${this.user.id})`
    );
    this.state = RecordingState.CONNECTING;

    try {
      await this.connect();
    } catch (e) {
      this.state = RecordingState.ERROR;
      this.stateDescription = `Failed to connect to your channel: ${e}`;
      this.pushToActivity('Failed to connect!');
      return await this.stop(true);
    }

    this.startTime = process.hrtime();
    this.startedAt = new Date();

    const fileBase = path.join(this.recorder.recordingPath, `${this.id}.ogg`);
    await writeFile(
      fileBase + '.info',
      JSON.stringify({
        format: 1,
        key: this.accessKey,
        delete: this.deleteKey,
        guild: this.channel.guild.name,
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
        startTime: this.startedAt.toISOString()
        // TODO
        // expiresAfter: f.limits.download,
        // features: f
      }),
      { encoding: 'utf8' }
    );
    this.dataEncoder = new OggEncoder(createWriteStream(fileBase + '.data'));
    this.headerEncoder1 = new OggEncoder(createWriteStream(fileBase + '.header1'));
    this.headerEncoder2 = new OggEncoder(createWriteStream(fileBase + '.header2'));
    this.usersStream = createWriteStream(fileBase + '.users');
    this.logStream = createWriteStream(fileBase + '.log');
    this.usersStream.write('"0":{}\n');

    this.active = true;
    await this.playNowRecording();
    this.updateMessage();
  }

  async stop(internal = false, userID?: string) {
    this.active = false;
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

    // Close the output files
    this.headerEncoder1?.end();
    this.headerEncoder2?.end();
    this.dataEncoder?.end();
    this.usersStream?.end();
    this.logStream?.end();

    this.recorder.recordings.delete(this.channel.guild.id);
  }

  async connect() {
    const connection = await this.channel.join({ opusOnly: true });
    connection.on('connect', this.onConnectionConnect.bind(this));
    connection.on('disconnect', this.onConnectionDisconnect.bind(this));
    connection.on('error', (err) => {
      this.writeToLog(`Connection error: ${err}`);
      this.recorder.logger.error(`Error in connection for recording ${this.id}`, err);
    });
    connection.on('warn', (m) => {
      this.writeToLog(`Connection warning: ${m}`);
      this.recorder.logger.debug(`Warning in connection for recording ${this.id}`, m);
    });
    connection.on('debug', (m) => this.recorder.logger.debug(`Recording ${this.id}`, m));
    const receiver = connection.receive('opus');
    receiver.on('data', this.onData.bind(this));
    this.state = RecordingState.RECORDING;
    this.receiver = receiver;
    this.connection = connection;
    this.writeToLog(`Connected to channel ${this.connection!.channelID} at ${this.connection!.endpoint}`);
  }

  async playNowRecording() {
    const filePath = path.join(__dirname, '../../../../data/nowrecording.opus');

    try {
      await access(filePath);
      this.connection!.play(filePath, { format: 'ogg' });
    } catch (e) {}
  }

  async onVoiceStateUpdate(member: Eris.Member, oldState: Eris.OldVoiceState) {
    if (member.id === this.recorder.client.bot.user.id) {
      if (member.voiceState.deaf && !oldState.deaf) {
        this.warningState = WarningState.DEAFENED;
        this.stateDescription = 'The bot has been deafened! Please undeafen me to continue recording.';
      } else if (!member.voiceState.deaf && oldState.deaf && this.warningState === WarningState.DEAFENED) {
        this.warningState = null;
        delete this.stateDescription;
      }
      this.logStream?.write(
        `${new Date().toISOString()}: Bot's voice state updated ${JSON.stringify(
          member.voiceState
        )} -> ${JSON.stringify(oldState)}\n`
      );
      await this.updateMessage();
    }
  }

  async onConnectionConnect() {
    if (!this.active) return;
    this.writeToLog(`Connected to channel ${this.connection!.channelID} at ${this.connection!.endpoint}`);
    if (this.connection!.channelID !== this.channel.id) {
      this.stateDescription =
        '⚠️ I was moved to another channel! If you want me to leave, please press the stop button.';
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
      this.pushToActivity('The voice connection was closed, disconnecting...');
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
    for (var i = 0; i < ct; i++) {
      const chunk = this.userPackets[user.id].shift();
      try {
        this.encodeChunk(user, this.dataEncoder!, user.track, packetNo, chunk!);
        packetNo += 2;
      } catch (ex) {
        this.recorder.logger.error(`Failed to encode packet ${packetNo} for user ${user.id}`, ex);
      }
    }
    user.packet = packetNo;
  }

  write(stream: OggEncoder, granulePos: number, streamNo: number, packetNo: number, chunk: Buffer, flags?: number) {
    stream.write(granulePos, streamNo, packetNo, chunk, flags);
  }

  encodeChunk(user: RecordingUser, oggStream: OggEncoder, streamNo: number, packetNo: number, chunk: Chunk) {
    let buffer = chunk.data;

    if (buffer.length > 4 && buffer[0] === 0xbe && buffer[1] === 0xde) {
      // There's an RTP header extension here. Strip it.
      const rtpHLen = buffer.readUInt16BE(2);
      let off = 4;

      for (var rhs = 0; rhs < rtpHLen && off < buffer.length; rhs++) {
        var subLen = (buffer[off] & 0xf) + 2;
        off += subLen;
      }
      while (off < buffer.length && buffer[off] === 0) off++;
      if (off >= buffer.length) off = buffer.length;

      buffer = buffer.slice(off);
    }

    // TODO Occasionally check that it's valid Opus data
    // if (packetNo % 50 === 49) {
    //   try {
    //     opus.decode(chunk, 960);
    //   } catch (ex) {
    //     if (!corruptWarn[user.id]) {
    //       sReply(true, l('corrupt', lang, user.username, user.discriminator));
    //       corruptWarn[user.id] = true;
    //     }
    //   }
    // }

    // Write out the chunk itself
    this.write(oggStream, chunk.time, streamNo, packetNo, buffer);
    // Then the timestamp for reference
    this.write(oggStream, chunk.timestamp ? chunk.timestamp : 0, streamNo, packetNo + 1, EMPTY_BUFFER);
  }

  async onData(data: Buffer, userID: string, timestamp: number, sequence: number) {
    data = Buffer.from(data);
    // TODO log unusual data
    if (!userID) return;

    let recordingUser = this.users[userID];
    const chunkTime = process.hrtime(this.startTime);
    const time = chunkTime[0] * 48000 + ~~(chunkTime[1] / 20833.333);
    if (!this.userPackets[userID]) this.userPackets[userID] = [];
    if (!recordingUser) {
      if (Object.keys(this.users).length >= USER_HARD_LIMIT) return;
      const user = this.recorder.client.bot.users.get(userID);
      this.users[userID] = {
        id: userID,
        username: user?.username ?? 'Unknown',
        discriminator: user?.discriminator ?? '0000',
        // TODO add avatars to users
        // avatar: user?.dynamicAvatarURL() ?? '',
        unknown: !user,
        track: this.trackNo++,
        packet: 2
      };
      recordingUser = this.users[userID];

      try {
        this.write(this.headerEncoder1!, 0, recordingUser.track, 0, OPUS_HEADERS[0], BOS);
        this.write(this.headerEncoder2!, 0, recordingUser.track, 1, OPUS_HEADERS[1]);
      } catch (e) {
        this.recorder.logger.debug(`Failed to write headers for recording ${this.id}`, e);
      }

      if (recordingUser.unknown) {
        const member = (await this.channel.guild.fetchMembers({ userIDs: [userID] }))?.[0];
        recordingUser.username = member?.username ?? 'Unknown';
        recordingUser.discriminator = member?.discriminator ?? '0000';
        recordingUser.unknown = !member;
      }
      this.usersStream?.write(`,"${recordingUser.track}":${JSON.stringify(recordingUser)}\n`);
      this.writeToLog(`New user ${recordingUser.username}#${recordingUser.discriminator} (${recordingUser.id})`);

      this.pushToActivity(`<@${userID}> joined the recording.`);
      this.recorder.logger.debug(
        `User ${recordingUser.username}#${recordingUser.discriminator} (${userID}) joined recording ${this.id}`
      );
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
  }

  note(note: string) {
    if (this.notePacketNo === 0) {
      this.write(this.headerEncoder1!, 0, NOTE_TRACK_NUMBER, 0, Buffer.from('STREAMNOTE'), BOS);
      this.notePacketNo++;
    }
    const chunkTime = process.hrtime(this.startTime);
    const chunkGranule = chunkTime[0] * 48000 + ~~(chunkTime[1] / 20833.333);
    this.write(this.dataEncoder!, chunkGranule, NOTE_TRACK_NUMBER, this.notePacketNo++, Buffer.from('NOTE' + note));
  }

  // Message handling //

  pushToActivity(log: string) {
    if (this.startTime) {
      const timestamp = process.hrtime(this.startTime);
      const time = timestamp[0] * 1000 + timestamp[1] / 1000000;
      this.logs.push(`\`${dayjs.duration(time).format('HH:mm:ss')}\`: ${log}`);
    } else this.logs.push(`<t:${Math.floor(Date.now() / 1000)}:R>: ${log}`);
    this.logStream?.write(`${new Date().toISOString()} [To user]: ${log}\n`);
    this.updateMessage();
  }

  writeToLog(log: string) {
    this.logStream?.write(`${new Date().toISOString()}: ${log}\n`);
  }

  messageContent() {
    let color = 0;
    let title = 'Loading...';
    switch (this.state) {
      case RecordingState.IDLE: {
        color = 0x3498db;
        break;
      }
      case RecordingState.RECORDING: {
        title = 'Recording...';
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

            **Recording ID:** \`${this.id}\`
            **Channel:** ${this.channel.mention}
            ${startedTimestamp ? `**Started:** <t:${startedTimestamp}:T> (<t:${startedTimestamp}:R>)` : ''}
          `,
          fields: this.logs.length
            ? [
                {
                  name: 'Activity',
                  value: this.logs.slice(0, 10).join('\n')
                }
              ]
            : []
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
              emoji: { name: '⏹' }
            },
            {
              type: ComponentType.BUTTON,
              style: ButtonStyle.PRIMARY,
              label: 'Add a note',
              custom_id: `rec:${this.id}:note`,
              disabled: this.state !== RecordingState.RECORDING && this.state !== RecordingState.RECONNECTING,
              emoji: { name: '📝' }
            }
          ]
        }
      ]
    } as Eris.AdvancedMessageContent;
  }

  async updateMessage() {
    if (!this.messageChannelID || !this.messageID) return;

    try {
      await this.recorder.client.bot.editMessage(this.messageChannelID!, this.messageID!, this.messageContent());
    } catch (e) {
      this.recorder.logger.debug(`Failed to update message ${this.messageID} for recording ${this.id}`, e);
      this.messageChannelID = null;
      this.messageID = null;
    }
  }
}
