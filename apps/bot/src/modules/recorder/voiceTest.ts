import { OpusEncoder } from '@discordjs/opus';
import { stripIndents } from 'common-tags';
import { DexareClient } from 'dexare';
import Eris from 'eris';
import { access } from 'fs/promises';
import path from 'path';
import { ButtonStyle, ComponentType, MessageFlags } from 'slash-create';
import { Readable } from 'stream';

import type { CraigBotConfig } from '../../bot';
import SlashModule from '../slash';
import type RecorderModule from '.';

const PACKET_TIME = 960; // 20ms
const GAP_CLOSE_THRESHOLD = PACKET_TIME * 10; // 200ms
const RECORDING_TIMEOUT = 10_000;

export enum VoiceTestState {
  IDLE,
  CONNECTING,
  RECORDING,
  PLAYBACK,
  NO_AUDIO,
  ENDED,
  CANCELLED,
  ERROR
}

export interface Chunk {
  data: Buffer;
  timestamp: number;
  time: number;
  userID: string;
}

export default class VoiceTest {
  recorder: RecorderModule<DexareClient<CraigBotConfig>>;
  guildId: string;
  channel: Eris.StageChannel | Eris.VoiceChannel;
  user: Eris.User;
  createdAt = new Date();
  active = false;
  state: VoiceTestState = VoiceTestState.IDLE;
  stateDescription?: string;

  connection: Eris.VoiceConnection | null = null;
  receiver: Eris.VoiceDataStream | null = null;

  messageChannelID: string | null = null;
  messageID: string | null = null;
  startTime: [number, number] | null = null;
  recordingEndTime: number | null = null;
  recordingTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  // Audio storage - userID -> packets
  userPackets: Map<string, Chunk[]> = new Map();

  constructor(
    recorder: RecorderModule<DexareClient<CraigBotConfig>>,
    guildId: string,
    channel: Eris.StageChannel | Eris.VoiceChannel,
    user: Eris.User
  ) {
    this.recorder = recorder;
    this.guildId = guildId;
    this.channel = channel;
    this.user = user;
  }

  async start(messageChannelID: string, messageID: string) {
    this.messageChannelID = messageChannelID;
    this.messageID = messageID;
    this.active = true;
    this.state = VoiceTestState.CONNECTING;
    await this.updateMessage();

    try {
      await this.connect();
    } catch (e) {
      this.recorder.logger.error(`Failed to connect for voice test in ${this.guildId}`, e);
      this.state = VoiceTestState.ERROR;
      this.stateDescription = 'Failed to connect to your channel, try again later.';
      this.updateMessage();
      await this.cleanup();
      return;
    }

    this.state = VoiceTestState.RECORDING;
    this.startTime = process.hrtime();
    this.recordingEndTime = Date.now() + RECORDING_TIMEOUT;
    this.updateMessage();
    await this.playSound('voicetest_on.opus');

    // Start 10-second timer
    this.recordingTimer = setTimeout(async () => {
      if (this.state === VoiceTestState.RECORDING) await this.stopRecording();
    }, RECORDING_TIMEOUT);
  }

  async stopRecording() {
    if (this.state !== VoiceTestState.RECORDING) return;

    clearTimeout(this.recordingTimer);
    this.connection!.stopPlaying();
    const hasAudio = Array.from(this.userPackets.values()).some((packets) => packets.length > 0);
    if (!hasAudio) {
      this.state = VoiceTestState.NO_AUDIO;
      this.stateDescription = 'No audio was detected during the test. Please check your microphone and try again.';
      this.updateMessage();
      await this.cleanup();
      return;
    }

    this.state = VoiceTestState.PLAYBACK;
    this.updateMessage();
    await this.playSound('voicetest_off.opus');
    await this.playRecordedAudio();

    this.state = VoiceTestState.ENDED;
    this.updateMessage();
    await this.cleanup();
  }

  async cancel() {
    if (this.state === VoiceTestState.RECORDING) clearTimeout(this.recordingTimer);

    this.state = VoiceTestState.CANCELLED;
    this.updateMessage();
    await this.cleanup();
  }

  async connect() {
    const connection = await this.channel.join({ opusOnly: true });
    this.connection = connection;
    const receiver = connection.receive('opus');
    receiver.on('data', this.onData.bind(this));
    this.receiver = receiver;

    connection.on('unknown', this.onConnectionUnknown.bind(this));

    // Get voice & rtc worker versions
    connection.sendWS(16, {});
  }

  async playSound(filename: string): Promise<void> {
    const filePath = path.join(__dirname, '../../../data', filename);

    try {
      await access(filePath);
      this.connection!.play(filePath, { format: 'ogg' });
      return this.waitForPlayer();
    } catch (e) {
      return Promise.resolve();
    }
  }

  waitForPlayer() {
    return new Promise<void>((resolve, reject) => {
      const onEnd = () => {
        cleanup();
        resolve();
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const onDisconnect = (err?: Error) => {
        cleanup();
        reject(err || new Error('Voice connection disconnected during playback'));
      };

      const cleanup = () => {
        this.connection!.removeListener('end', onEnd);
        this.connection!.removeListener('error', onError);
        this.connection!.removeListener('disconnect', onDisconnect);
      };

      this.connection!.once('end', onEnd);
      this.connection!.once('error', onError);
      this.connection!.once('disconnect', onDisconnect);
    });
  }

  async playRecordedAudio() {
    let allChunks = Array.from(this.userPackets.values()).flat();
    if (allChunks.length === 0) return;

    const userChunks: Map<string, Chunk[]> = new Map();
    for (const chunk of allChunks) {
      if (!userChunks.has(chunk.userID!)) userChunks.set(chunk.userID!, []);
      userChunks.get(chunk.userID!)!.push(chunk);
    }
    for (const chunks of userChunks.values()) {
      chunks.sort((a, b) => a.time - b.time);
      for (let i = 1; i < chunks.length; i++) {
        const prevEnd = chunks[i - 1].time + PACKET_TIME;
        const gap = chunks[i].time - prevEnd;
        if (gap > 0 && gap < GAP_CLOSE_THRESHOLD) {
          // less than 200ms
          chunks[i].time = prevEnd;
        }
      }
    }

    // Recollect all chunks
    allChunks = [];
    for (const chunks of userChunks.values()) allChunks.push(...chunks);
    allChunks.sort((a, b) => a.time - b.time);

    const frames: Buffer[] = [];

    if (this.userPackets.size === 1) {
      // stream Opus packets with silence on single-user
      const silencePacket = Buffer.from([0xf8, 0xff, 0xfe]);
      let currentTime = allChunks[0].time;
      for (const chunk of allChunks) {
        // Fill silence for gaps
        while (currentTime < chunk.time) {
          frames.push(silencePacket);
          currentTime += PACKET_TIME;
        }
        frames.push(chunk.data);
        currentTime += PACKET_TIME;
      }
    } else {
      // mix with PCM then encode
      const minTime = Math.min(...allChunks.map((c) => c.time));
      const maxTime = Math.max(...allChunks.map((c) => c.time + PACKET_TIME));
      const totalSamples = maxTime - minTime + PACKET_TIME;
      const pcm = new Int16Array(totalSamples * 2);

      // Create separate decoder for each user to avoid state corruption
      const decoders = new Map<string, OpusEncoder>();
      for (const userID of this.userPackets.keys())
        decoders.set(userID, new OpusEncoder(48000, 2));

      // Mix audio into PCM buffer
      for (const chunk of allChunks) {
        let decoded: Buffer;
        try {
          const decoder = decoders.get(chunk.userID)!;
          decoded = decoder.decode(chunk.data);
        } catch (e) {
          continue;
        }
        const start = (chunk.time - minTime) * 2;
        const sampleCount = decoded.length / 2;
        for (let i = 0; i < sampleCount && start + i < pcm.length; i++) {
          // Clamp to prevent overflow during mixing
          const mixed = pcm[start + i] + decoded.readInt16LE(i * 2);
          pcm[start + i] = Math.max(-32768, Math.min(32767, mixed));
        }
      }

      // Encode to Opus packets, using silence for gaps
      const encoder = new OpusEncoder(48000, 2);
      const silencePacket = Buffer.from([0xf8, 0xff, 0xfe]);
      for (let frame = 0; frame < Math.ceil(pcm.length / (PACKET_TIME * 2)); frame++) {
        const frameStart = frame * (PACKET_TIME * 2);
        const framePcm = Buffer.alloc(PACKET_TIME * 4);
        let hasAudio = false;
        for (let i = 0; i < PACKET_TIME * 2 && frameStart + i < pcm.length; i++) {
          const val = pcm[frameStart + i];
          framePcm.writeInt16LE(val, i * 2);
          if (val !== 0) hasAudio = true;
        }
        if (hasAudio) {
          const encoded = encoder.encode(framePcm);
          frames.push(encoded);
        } else {
          frames.push(silencePacket);
        }
      }
    }

    const stream = new Readable({
      read() {
        this.push(frames.length === 0 ? null : frames.shift());
      }
    });

    this.connection!.play(stream, { format: 'opusPackets' });
    return this.waitForPlayer();
  }

  async onData(data: Buffer, userID: string, timestamp: number) {
    if (!this.active || this.state !== VoiceTestState.RECORDING) return;

    // Check for zero packets
    if (data[0] === 0) {
      const zeroCount = data.reduce((acc, byte) => acc + (byte === 0 ? 1 : 0), 0);
      if (zeroCount >= data.length - 1) return;
    }

    const chunkTime = process.hrtime(this.startTime!);
    const time = chunkTime[0] * 48000 + ~~(chunkTime[1] / 20833.333);

    const chunk: Chunk = { data, timestamp, time, userID };

    if (!this.userPackets.has(userID)) this.userPackets.set(userID, []);

    this.userPackets.get(userID)!.push(chunk);
  }

  async onConnectionUnknown(packet: any) {
    if (!this.recorder.client.config.craig.systemNotificationURL) return;

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
      if (!voiceEndpoint || !voiceEndpoint.endsWith('.discord.media'))
        return this.recorder.logger.warn(
          `Encountered an unknown voice region endpoint: ${voiceEndpoint} (voice: ${voiceVersion}, rtc worker: ${rtcWorkerVersion})`
        );

      await this.recorder.pushVoiceVersions(voiceEndpoint, voiceVersion, rtcWorkerVersion);
    }
  }

  get emojis() {
    return (this.recorder.client.modules.get('slash') as SlashModule<any>).emojis;
  }

  messageContent() {
    let color: number | undefined = undefined;
    let title = 'Loading...';

    switch (this.state) {
      case VoiceTestState.IDLE:
        color = 0x3498db;
        break;

      case VoiceTestState.CONNECTING:
        title = 'Connecting...';
        color = 0xf39c12;
        break;

      case VoiceTestState.RECORDING: {
        title = '🔴 Recording voice test...';
        color = 0x2ecc71;
        break;
      }

      case VoiceTestState.PLAYBACK:
        title = `${this.emojis.getMarkdown('playingaudio')} Playing back audio...`;
        color = 0x3498db;
        break;

      case VoiceTestState.NO_AUDIO:
        title = 'No audio recorded!';
        color = 0xe74c3c;
        break;

      case VoiceTestState.ENDED:
        title = `${this.emojis.getMarkdown('check')} Voice test finished.`;
        color = 0x2ecc71;
        break;

      case VoiceTestState.CANCELLED:
        title = 'Voice test cancelled.';
        color = 0x333333;
        break;

      case VoiceTestState.ERROR:
        title = '❌ Voice test failed!';
        color = 0xe74c3c;
        break;
    }

    const components = [
      {
        type: ComponentType.CONTAINER,
        accent_color: color,
        components: [
          {
            type: ComponentType.TEXT_DISPLAY,
            content: stripIndents`
              ### ${title}
              ${this.stateDescription ?? ''}
              ${
                this.state === VoiceTestState.RECORDING && this.recordingEndTime
                  ? `\n-# Recording will end <t:${Math.floor(this.recordingEndTime / 1000)}:R>`
                  : ''
              }
            `
          },
          ...(this.state === VoiceTestState.RECORDING
            ? [
                {
                  type: ComponentType.ACTION_ROW,
                  components: [
                    {
                      type: ComponentType.BUTTON,
                      style: ButtonStyle.DESTRUCTIVE,
                      label: 'Stop & Listen',
                      custom_id: 'voicetest:stop',
                      emoji: this.emojis.getPartial('stop')
                    },
                    {
                      type: ComponentType.BUTTON,
                      style: ButtonStyle.SECONDARY,
                      label: 'Cancel',
                      custom_id: 'voicetest:cancel'
                    }
                  ]
                }
              ]
            : [])
        ]
      }
    ];

    return {
      flags: MessageFlags.IS_COMPONENTS_V2,
      allowedMentions: {
        everyone: false,
        users: false,
        roles: false
      },
      components
    } as any;
  }

  async updateMessage() {
    if (!this.messageChannelID || !this.messageID) return false;

    try {
      await this.recorder.client.bot.editMessage(this.messageChannelID, this.messageID, this.messageContent());
      return true;
    } catch (e) {
      this.recorder.logger.error(`Failed to update voice test message ${this.messageID} for guild ${this.guildId}`, e);
      return false;
    }
  }

  async cleanup() {
    this.active = false;
    this.channel.leave();
    this.recorder.voiceTests.delete(this.guildId);
  }
}
