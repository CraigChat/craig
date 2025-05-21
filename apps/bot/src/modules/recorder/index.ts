import { createTRPCClient } from '@trpc/client';
import { httpLink } from '@trpc/client/links/httpLink';
import type { Procedure } from '@trpc/server/dist/declarations/src/internals/procedure';
import type { DefaultErrorShape, Router } from '@trpc/server/dist/declarations/src/router';
import { CronJob } from 'cron';
import { DexareClient, DexareModule } from 'dexare';
import Eris from 'eris';
import { access, mkdir } from 'fs/promises';
import fetch from 'node-fetch';
import path from 'path';

import type { CraigBotConfig } from '../../bot';
import { onRecordingEnd } from '../../influx';
import { prisma } from '../../prisma';
import { checkMaintenance } from '../../redis';
import Recording, { RecordingState } from './recording';

type TRPCRouter = Router<
  unknown,
  unknown,
  Record<
    'driveUpload',
    Procedure<
      unknown,
      unknown,
      {
        recordingId: string;
        userId: string;
      },
      {
        recordingId: string;
        userId: string;
      },
      {
        error: string | null;
        notify: boolean;
        id?: string | undefined;
        url?: string | undefined;
      }
    >
  >,
  any,
  any,
  DefaultErrorShape
>;

const RECORDING_TTL = 5 * 60 * 1000;

export default class RecorderModule<T extends DexareClient<CraigBotConfig>> extends DexareModule<T> {
  recordings = new Map<string, Recording>();
  recordingPath: string;
  recordingsChecked = false;
  trpc = createTRPCClient<TRPCRouter>({
    fetch: fetch as any,
    links: [httpLink({ url: 'http://localhost:2022' })]
  });
  cron: CronJob;

  constructor(client: T) {
    super(client, {
      name: 'recorder',
      description: 'Recording handler'
    });

    this.recordingPath = path.resolve(__dirname, '../../..', this.client.config.craig.recordingFolder);
    this.filePath = __filename;
    this.cron = new CronJob('* * * * *', this.onCron.bind(this), null, false, 'America/New_York');
  }

  async load() {
    this.registerEvent('ready', this.onReady.bind(this));
    this.registerEvent('voiceStateUpdate', this.onVoiceStateUpdate.bind(this));
    this.registerEvent('guildDelete', this.onGuildLeave.bind(this));
    this.registerEvent('guildUnavailable', this.onGuildUnavailable.bind(this));
    this.cron.start();

    try {
      await access(this.recordingPath);
    } catch (e) {
      this.logger.info('Recording folder not found, creating...');
      await mkdir(this.recordingPath);
      return;
    }
  }

  async onReady() {
    this.checkForErroredRecordings();
  }

  unload() {
    this.unregisterAllEvents();
    this.cron.stop();
  }

  onCron() {
    const now = Date.now();
    for (const [guildID, recording] of this.recordings.entries()) {
      if (
        (recording.state === RecordingState.IDLE || recording.state === RecordingState.CONNECTING) &&
        now - recording.createdAt.valueOf() > RECORDING_TTL
      ) {
        this.logger.warn(
          `Recording ${recording.id} seems to be a dead recording, removing from map... (${guildID}:${recording.state}, by ${
            recording.user.id
          }, created ${recording.createdAt.toISOString()})`
        );
        this.recordings.delete(guildID);
      }
    }
  }

  find(id: string) {
    for (const recording of this.recordings.values()) {
      if (recording.id === id) return recording;
    }
  }

  async checkForErroredRecordings(force = false) {
    if (this.recordingsChecked && !force) return;
    this.recordingsChecked = true;
    const badRecordings = (
      await prisma.recording.findMany({
        where: {
          clientId: this.client.bot.user.id,
          shardId: this.client.bot.shards.keys().next().value,
          errored: false,
          endedAt: null
        }
      })
    ).filter((br) => !this.find(br.id));

    this.logger.info(
      `Found ${badRecordings.length} errored recordings.`,
      badRecordings.map((br) => br.id)
    );
    if (!badRecordings.length) return;

    // Make craig leave from dead channels
    const guildIds = [...new Set<string>(badRecordings.map((r) => r.guildId))];
    for (const guildId of guildIds) {
      const recording = this.recordings.get(guildId);
      if (recording) continue;

      const guild = this.client.bot.guilds.get(guildId);
      if (!guild) continue;

      const channel = guild.channels.get(badRecordings.find((r) => r.guildId === guildId)!.channelId) as Eris.StageChannel | Eris.VoiceChannel;
      if (!channel) continue;

      await channel.join().catch(() => null);
      channel.leave();
    }

    // Warn users
    const userIds = [...new Set<string>(badRecordings.map((r) => r.userId))];
    for (const userId of userIds) {
      const user = this.client.bot.users.get(userId);
      if (!user) continue;

      const dmChannel = await user.getDMChannel().catch(() => null);
      if (!dmChannel) continue;

      await dmChannel
        .createMessage(
          `**⚠️ The following recordings have abruptly ended, please start a new recording from the slash command as the recording interface is no longer valid.**\n\n${badRecordings
            .filter((r) => r.userId === userId)
            .map((r) => `- \`${r.id}\` in <#${r.channelId}>`)
            .join('\n')}`
        )
        .catch(() => null);
    }

    // Delete errored recordings
    for (const recording of badRecordings) {
      await prisma.recording.delete({ where: { id: recording.id } }).catch(() => {});
      await onRecordingEnd(
        recording.userId,
        recording.guildId,
        recording.createdAt,
        Date.now() - recording.createdAt.valueOf(),
        false
      ).catch(() => {});
    }
  }

  async checkForMaintenance() {
    const maintenance = await checkMaintenance(this.client.bot.user.id);
    if (maintenance) {
      const recordings = Array.from(this.recordings.values());
      for (const recording of recordings) {
        if (recording.state === RecordingState.RECORDING) {
          recording.maintenceWarned = true;
          recording.pushToActivity('⚠️ The bot is undergoing maintenance, recording will be stopped.', false);
          recording.stateDescription = `__The bot is undergoing maintenance.__${maintenance.message ? `\n\n${maintenance.message}` : ''}`;
          await recording.stop().catch(() => null);
        }
      }
    }
  }

  onVoiceStateUpdate(_: any, member: Eris.Member, oldState: Eris.OldVoiceState) {
    const recording = this.recordings.get(member.guild.id);
    if (!recording) return;

    recording.onVoiceStateUpdate(member, oldState);
  }

  async onGuildLeave(_: any, guild: Eris.PossiblyUncachedGuild) {
    if (this.recordings.has(guild.id)) {
      const recording = this.recordings.get(guild.id)!;
      this.logger.warn(`Left guild ${guild.id} during a recording... (${recording.id})`);
      recording.state = RecordingState.ERROR;
      recording.stateDescription = '⚠️ This guild went unavailable during recording! To prevent further errors, this recording has ended.';
      await recording.stop(true).catch(() => {});
      await recording.updateMessage();
    }
  }

  async onGuildUnavailable(_: any, guild: Eris.UnavailableGuild) {
    this.logger.warn(`Guild ${guild.id} is now unavailable...`);
    if (this.recordings.has(guild.id)) {
      const recording = this.recordings.get(guild.id)!;
      this.logger.warn(`Guild ${guild.id} went unavailable during a recording... (${recording.id})`);
      recording.state = RecordingState.ERROR;
      recording.stateDescription = '⚠️ This guild went unavailable during recording! To prevent further errors, this recording has ended.';
      await recording.stop(true).catch(() => {});
      await recording.updateMessage();
    }
  }
}
