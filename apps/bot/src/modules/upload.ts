import { type DexareClient, DexareModule } from 'dexare';
import Dysnomia from 'eris';
import fetch from 'node-fetch';
import { ButtonStyle, ComponentType, EditMessageOptions, MessageFlags } from 'slash-create';

import type { CraigBot, CraigBotConfig } from '../bot';
import { client as redis } from '../redis';
import type RecorderModule from './recorder';

const SERVICES: Record<string, string> = {
  google: 'Google Drive',
  dropbox: 'Dropbox',
  onedrive: 'OneDrive',
  box: 'Box',
  s3: 'S3'
};

const ERROR_COLOR = 0xe74c3c;
const SUCCESS_COLOR = 0x2ecc71;

const SERVICE_ERROR_MESSAGES: Record<string, string> = {
  auth_invalidated: 'The authentication for this service was invalidated, you may need to re-authenticate.',
  server_error: 'An unknown server error occurred.'
};

// @ts-ignore
export default class UploadModule extends DexareModule<CraigBot> {
  running = false;
  interval: any;
  KEY: string;

  constructor(client: any) {
    super(client, {
      name: 'upload',
      description: 'Messaging system and manager for cloud uploads'
    });

    this.filePath = __filename;
    this.KEY = `pending-upload-jobs:${this.client.config.applicationID}`;
  }

  get trpc() {
    return (this.client.modules.get('recorder') as any as RecorderModule<DexareClient<CraigBotConfig>>).trpc;
  }

  async dm(userId: string, embed: Dysnomia.EmbedOptions, linkButton?: { url: string; label: string; emoji?: Dysnomia.PartialEmoji }) {
    const dmChannel = await this.client.bot.getDMChannel(userId).catch(() => null);
    if (dmChannel)
      await dmChannel
        .createMessage({
          flags: MessageFlags.IS_COMPONENTS_V2,
          components: [
            {
              type: ComponentType.CONTAINER,
              accent_color: embed.color,
              components: [
                {
                  type: ComponentType.TEXT_DISPLAY,
                  content: `### ${embed.title}\n${embed.description}`
                },
                ...(linkButton
                  ? [
                      {
                        type: ComponentType.ACTION_ROW,
                        components: [
                          {
                            type: ComponentType.BUTTON,
                            style: ButtonStyle.LINK,
                            ...linkButton
                          }
                        ]
                      }
                    ]
                  : [])
              ]
            }
          ]
        } as EditMessageOptions as any)
        .catch(() => {});
  }

  async upload(recordingId: string, userId: string, driveService: string) {
    if (!this.client.config.kitchenURL) return await this.uploadWithTrpc(recordingId, userId, driveService);
    const service = SERVICES[driveService] ?? driveService;

    try {
      const response = await fetch(`${this.client.config.kitchenURL}/recordings/${recordingId}/upload/${userId}`, { method: 'POST' });
      // 204's means this ran fine but theres no recording coming out of it
      if (response.status > 299) {
        const error = (await response.json().catch(() => null))?.error ?? 'server_error';
        this.logger.error(`Failed to request upload for recording ${recordingId} for user ${userId} (${response.status}, ${error})`);
        // DM removed per user request - errors logged only
      } else if (response.status === 200) {
        const job = await response.json();
        this.logger.info(`Started an upload for recording ${recordingId} for user ${userId}`);
        await redis.sadd(this.KEY, job.id);
      }
    } catch (e) {
      this.logger.error(`Failed to request upload for recording ${recordingId} for user ${userId} due to fetch error`, e);
      // DM removed per user request - errors logged only
    }
  }

  async uploadWithTrpc(recordingId: string, userId: string, driveService: string) {
    const service = SERVICES[driveService] ?? driveService;
    const queryName = driveService === 's3' ? 's3Upload' : 'driveUpload';
    const response = await this.trpc.query(queryName, { recordingId, userId }).catch(() => null);

    if (!response) {
      this.logger.error(`Failed to upload recording ${recordingId} to ${service}: Could not connect to the server`);
      // DM removed per user request - errors logged only
      return;
    }

    if (response.error) {
      this.logger.error(`Failed to upload recording ${recordingId} to ${service}: ${response.error}`);
      // DM removed per user request - errors logged only
      return;
    }

    // Do not send success embeds or download buttons
  }

  async onTick() {
    if (this.running) return;
    this.running = true;

    const pendingJobs = await redis.smembers(this.KEY);

    for (const jobId of pendingJobs) {
      try {
        const response = await fetch(`${this.client.config.kitchenURL}/jobs/${jobId}`);
        if (response.ok) {
          const job = await response.json().catch(() => null);
          if (!job) {
            this.logger.error(`Failed to parse job info for job ${jobId}`);
            continue;
          }

          // Check if the job is done
          if (job.status !== 'idle' && job.status !== 'queued' && job.status !== 'running') {
            const recordingId = job.recordingId;
            const userId = job.postTaskOptions.userId;
            const driveService = job.outputData.uploadService;
            const service = SERVICES[driveService] ?? driveService;

            // All DM notifications removed per user request - errors/success logged only
            if (job.status === 'error') {
              this.logger.error(`Upload job ${jobId} failed for recording ${recordingId} to ${service}`);
            } else if (job.status === 'cancelled') {
              this.logger.warn(`Upload job ${jobId} cancelled for recording ${recordingId} to ${service}`);
            } else if (job.status === 'complete') {
              this.logger.info(`Upload job ${jobId} completed for recording ${recordingId} to ${service}`);
            }

            await redis.srem(this.KEY, jobId);
          }
        } else {
          this.logger.warn(`Failed to find pending job ${jobId}`);
          await redis.srem(this.KEY, jobId);
        }
      } catch (e) {
        this.logger.error(`Failed to request kitchen for job info for job ${jobId}`, e);
        break;
      }
    }

    this.running = false;
  }

  onReady() {
    clearInterval(this.interval);
    this.interval = setInterval(this.onTick.bind(this), 1000);
    this.logger.info('Started interval');
  }

  load() {
    const sharded = process.env.SHARD_ID !== undefined && process.env.SHARD_COUNT !== undefined;
    if (sharded && process.env.SHARD_ID !== '0') return void this.logger.info('Skipping...');
    if (!this.client.config.kitchenURL) return void this.logger.info('No kitchen URL specified, Skipping polling...');
    this.registerEvent('ready', this.onReady.bind(this));
    this.logger.info('Loaded');
  }

  unload() {
    clearInterval(this.interval);
    this.running = false;
    this.unregisterAllEvents();
  }
}
