import { db } from '@craig/db';
import { getSemaphore } from '@henrygd/semaphore';
import type Dysnomia from '@projectdysnomia/dysnomia';
import { CronJob } from 'cron';
import { access, mkdir } from 'fs/promises';
import path from 'path';
import { ComponentType, MessageFlags } from 'slash-create';
import { isLessThan } from 'verkit';

import type { CraigBot } from '../../bot.js';
import { checkMaintenance } from '../../redis.js';
import { BotModule } from '../../runtime.js';
import Recording, { RecordingState } from './recording.js';
import { VoiceTestState } from './voiceTest.js';

const RECORDING_TTL = 5 * 60 * 1000;
const VOICE_OBSERVATORY_URL = 'https://vo-api.snaz.in';
const VOICE_OBSERVATORY_TIMEOUT = 1500;
const SYSTEM_NOTIFICATION_TIMEOUT = 5000;

interface VoiceTraceOptions {
  connection: Dysnomia.VoiceConnection | null;
  voiceVersion?: string;
  rtcWorkerVersion?: string;
  code?: number;
}

export default class RecorderModule extends BotModule {
  recordings = new Map<string, Recording>();
  voiceTests = new Map<string, import('./voiceTest.js').default>();
  private readonly seenVoiceVersions = new Set<string>();
  recordingPath: string;
  recordingsChecked = false;
  cron: CronJob;
  private readonly handleReady = this.onReady.bind(this);
  private readonly handleVoiceStateUpdate = this.onVoiceStateUpdate.bind(this);
  private readonly handleGuildLeave = this.onGuildLeave.bind(this);
  private readonly handleGuildUnavailable = this.onGuildUnavailable.bind(this);

  constructor(client: CraigBot) {
    super(client, {
      name: 'recorder',
      description: 'Recording handler'
    });

    this.recordingPath = path.resolve(this.client.config.craig.recordingFolder);
    this.cron = new CronJob('* * * * *', this.onCron.bind(this), null, false, 'America/New_York');
  }

  /** Claim a guild's recording so subsequent requests don't run over */
  claimStart(guildId: string) {
    if (this.recordings.has(guildId) || this.voiceTests.has(guildId)) return null;
    const lock = getSemaphore(`recorder/start/${guildId}`);
    if (lock.size() > 0) return null;
    lock.acquire();
    return lock;
  }

  get uploader() {
    return this.client.upload;
  }

  get metrics() {
    return this.client.metrics;
  }

  async load() {
    this.client.bot.on('ready', this.handleReady);
    this.client.bot.on('voiceStateUpdate', this.handleVoiceStateUpdate);
    this.client.bot.on('guildDelete', this.handleGuildLeave);
    this.client.bot.on('guildUnavailable', this.handleGuildUnavailable);
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
    this.client.bot.removeListener('ready', this.handleReady);
    this.client.bot.removeListener('voiceStateUpdate', this.handleVoiceStateUpdate);
    this.client.bot.removeListener('guildDelete', this.handleGuildLeave);
    this.client.bot.removeListener('guildUnavailable', this.handleGuildUnavailable);
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

    for (const [guildID, voiceTest] of this.voiceTests.entries()) {
      if (now - voiceTest.createdAt.valueOf() > RECORDING_TTL) {
        this.logger.warn(
          `Voice test seems to be a stale test, removing from map... (${guildID}:${voiceTest.state}, by ${
            voiceTest.user.id
          }, created ${voiceTest.createdAt.toISOString()})`
        );
        this.voiceTests.delete(guildID);
      }
    }
  }

  find(id: string) {
    for (const recording of this.recordings.values()) {
      if (recording.id === id) return recording;
    }
  }

  traceVoiceConnection({ connection, voiceVersion, rtcWorkerVersion }: VoiceTraceOptions) {
    const endpoint = connection?.endpoint?.host;
    if (!endpoint || !voiceVersion || !rtcWorkerVersion) return;
    this.postVoiceObservatory('/v1/traces/voice', {
      endpoint,
      dave_version: connection?.daveProtocolVersion ?? 0,
      voice_version: voiceVersion,
      rtc_worker_version: rtcWorkerVersion
    });
  }

  traceVoiceError({ connection, voiceVersion, rtcWorkerVersion, code }: VoiceTraceOptions) {
    if (code === undefined || (code > 0 && code <= 1000)) return;
    this.postVoiceObservatory('/v1/traces/error', {
      endpoint: connection?.endpoint?.host,
      code,
      dave_version: connection?.daveProtocolVersion ?? 0,
      voice_version: voiceVersion,
      rtc_worker_version: rtcWorkerVersion
    });
  }

  traceVoiceTimeout(connection: Dysnomia.VoiceConnection | null) {
    this.postVoiceObservatory('/v1/traces/error', {
      endpoint: connection?.endpoint?.host,
      code: 0
    });
  }

  parseVoiceDisconnectCode(err: Error) {
    const match = err.message.match(/\b(\d{4})\b/);
    return match ? Number(match[1]) : undefined;
  }

  private postVoiceObservatory(path: string, body: Record<string, string | number | undefined>) {
    const token = process.env.VOICE_OBSERVATORY_TOKEN;
    if (!token) return;

    void globalThis
      .fetch(`${VOICE_OBSERVATORY_URL}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined))),
        signal: AbortSignal.timeout(VOICE_OBSERVATORY_TIMEOUT)
      })
      .catch(() => {});
  }

  async pushVoiceVersions(voiceEndpoint: string, voiceVersion: string, rtcWorkerVersion: string) {
    const regionId = voiceEndpoint.startsWith('c-')
      ? voiceEndpoint.replace(/\d+?-[\da-f]+\.discord\.media$/, '')
      : voiceEndpoint.replace(/\d+\.discord\.media$/, '');

    this.metrics.onVoiceServerConnect(regionId);

    // Skip the DB entirely for combinations this process has already recorded (or is recording)
    const key = `${regionId}|${voiceVersion}|${rtcWorkerVersion}`;
    if (this.seenVoiceVersions.has(key)) return;
    this.seenVoiceVersions.add(key);

    try {
      await this.recordVoiceVersions(regionId, voiceEndpoint, voiceVersion, rtcWorkerVersion);
    } catch (e) {
      this.seenVoiceVersions.delete(key);
      this.logger.error(`Failed to push voice versions (region: ${regionId}, voice: ${voiceVersion}, rtc worker: ${rtcWorkerVersion})`, e);
    }
  }

  private async recordVoiceVersions(regionId: string, voiceEndpoint: string, voiceVersion: string, rtcWorkerVersion: string) {
    const [regionResult, voiceVersionResult, rtcWorkerVersionResult, lastVoiceVersion, lastRtcWorkerVersion] = await db.transaction().execute(
      async (tx) =>
        [
          await tx
            .insertInto('VoiceRegion')
            .values({ id: regionId })
            .onConflict((oc) => oc.doNothing())
            .executeTakeFirst(),
          await tx
            .insertInto('VoiceVersion')
            .values({ version: voiceVersion, regionId, endpoint: voiceEndpoint })
            .onConflict((oc) => oc.doNothing())
            .executeTakeFirst(),
          await tx
            .insertInto('RtcVersion')
            .values({ version: rtcWorkerVersion, regionId, endpoint: voiceEndpoint })
            .onConflict((oc) => oc.doNothing())
            .executeTakeFirst(),
          await tx.selectFrom('RegionVoiceVersion').select('version').where('regionId', '=', regionId).executeTakeFirst(),
          await tx.selectFrom('RegionRtcVersion').select('version').where('regionId', '=', regionId).executeTakeFirst()
        ] as const
    );
    const existingRegion = !regionResult.numInsertedOrUpdatedRows;
    const voiceVersionSeen = !voiceVersionResult.numInsertedOrUpdatedRows;
    const rtcWorkerVersionSeen = !rtcWorkerVersionResult.numInsertedOrUpdatedRows;

    // Update latest region voice & rtc worker versions
    await Promise.all([
      !lastVoiceVersion || isLessThan(lastVoiceVersion.version, voiceVersion)
        ? db
            .insertInto('RegionVoiceVersion')
            .values({ regionId, version: voiceVersion, endpoint: voiceEndpoint })
            .onConflict((oc) => oc.column('regionId').doUpdateSet({ version: voiceVersion, endpoint: voiceEndpoint, seenAt: new Date() }))
            .execute()
        : null,
      !lastRtcWorkerVersion || isLessThan(lastRtcWorkerVersion.version, rtcWorkerVersion)
        ? db
            .insertInto('RegionRtcVersion')
            .values({ regionId, version: rtcWorkerVersion, endpoint: voiceEndpoint })
            .onConflict((oc) => oc.column('regionId').doUpdateSet({ version: rtcWorkerVersion, endpoint: voiceEndpoint, seenAt: new Date() }))
            .execute()
        : null
    ]);

    if (this.client.config.craig.systemNotificationURL && (!existingRegion || !voiceVersionSeen || !rtcWorkerVersionSeen)) {
      const title = `New ${[
        !existingRegion ? 'Voice Region' : undefined,
        !voiceVersionSeen ? 'Voice Version' : undefined,
        !rtcWorkerVersionSeen ? 'RTC Worker Version' : undefined
      ]
        .filter((v) => !!v)
        .join(', ')}`;
      await fetch(`${this.client.config.craig.systemNotificationURL}?with_components=true`, {
        method: 'POST',
        signal: AbortSignal.timeout(SYSTEM_NOTIFICATION_TIMEOUT),
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
                  type: ComponentType.SEPARATOR
                },
                {
                  type: ComponentType.TEXT_DISPLAY,
                  content: [
                    `**Voice Server Endpoint:** \`${voiceEndpoint}\``,
                    `**Bot**: <@${this.client.bot.user.id}> (${this.client.bot.user.id})`,
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

  async checkForErroredRecordings(force = false) {
    if (this.recordingsChecked && !force) return;
    this.recordingsChecked = true;
    const badRecordings = (
      await db
        .selectFrom('Recording')
        .select(['id', 'guildId', 'channelId', 'userId'])
        .where('clientId', '=', this.client.bot.user.id)
        .where('shardId', '=', this.client.shard.id)
        .where('errored', '=', false)
        .where('endedAt', 'is', null)
        .execute()
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

      const channel = guild.channels.get(badRecordings.find((r) => r.guildId === guildId)!.channelId) as
        | Dysnomia.StageChannel
        | Dysnomia.VoiceChannel;
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
    await db
      .deleteFrom('Recording')
      .where(
        'id',
        'in',
        badRecordings.map((r) => r.id)
      )
      .execute()
      .catch((e) => this.logger.error('Failed to delete errored recordings', e));
  }

  async checkForMaintenance() {
    const maintenance = await checkMaintenance(this.client.bot.user.id);
    if (maintenance) {
      const recordings = Array.from(this.recordings.values());
      for (const recording of recordings) {
        if (recording.state === RecordingState.RECORDING) {
          recording.maintenceWarned = true;
          recording.pushToActivity(`⚠️ ${recording.t('recording.panel.maintenance')}`, false);
          recording.stateDescription = `__${recording.t('join_command.maintenance')}__${maintenance.message ? `\n\n${maintenance.message}` : ''}`;
          await recording.stop().catch(() => null);
        }
      }
    }
  }

  onVoiceStateUpdate(member: Dysnomia.Member, oldState: Dysnomia.OldVoiceState) {
    const recording = this.recordings.get(member.guild.id);
    if (!recording) return;

    recording.onVoiceStateUpdate(member, oldState);
  }

  async onGuildLeave(guild: Dysnomia.PossiblyUncachedGuild) {
    if (this.recordings.has(guild.id)) {
      const recording = this.recordings.get(guild.id)!;
      this.logger.warn(`Left guild ${guild.id} during a recording... (${recording.id})`);
      recording.state = RecordingState.ERROR;
      recording.stateDescription = `⚠️ ${recording.t('recording.went_unavailable')}`;
      await recording.stop(true).catch(() => {});
      await recording.updateMessage();
    }
    if (this.voiceTests.has(guild.id)) {
      const voiceTest = this.voiceTests.get(guild.id)!;
      this.logger.warn(`Left guild ${guild.id} during a voice test...`);
      voiceTest.state = VoiceTestState.ERROR;
      voiceTest.stateDescription = `⚠️ ${voiceTest.t('voicetest.went_unavailable')}`;
      await voiceTest.cancel().catch(() => {});
      await voiceTest.updateMessage();
    }
  }

  async onGuildUnavailable(guild: Dysnomia.UnavailableGuild) {
    this.logger.warn(`Guild ${guild.id} is now unavailable...`);
    if (this.recordings.has(guild.id)) {
      const recording = this.recordings.get(guild.id)!;
      this.logger.warn(`Guild ${guild.id} went unavailable during a recording... (${recording.id})`);
      recording.state = RecordingState.ERROR;
      recording.stateDescription = `⚠️ ${recording.t('recording.went_unavailable')}`;
      await recording.stop(true).catch(() => {});
      await recording.updateMessage();
    }
    if (this.voiceTests.has(guild.id)) {
      const voiceTest = this.voiceTests.get(guild.id)!;
      this.logger.warn(`Left guild ${guild.id} during a voice test...`);
      voiceTest.state = VoiceTestState.ERROR;
      voiceTest.stateDescription = `⚠️ ${voiceTest.t('voicetest.went_unavailable')}`;
      await voiceTest.cancel().catch(() => {});
      await voiceTest.updateMessage();
    }
  }
}
