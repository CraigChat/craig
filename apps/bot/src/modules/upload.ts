import Dysnomia from '@projectdysnomia/dysnomia';
import fetch from 'node-fetch';
import { ButtonStyle, ComponentType, EditMessageOptions, MessageFlags } from 'slash-create';

import type { CraigBot } from '../bot.js';
import { client as redis } from '../redis.js';
import { BotModule } from '../runtime.js';

const SERVICES: Record<string, string> = {
  google: 'Google Drive',
  dropbox: 'Dropbox',
  onedrive: 'OneDrive',
  box: 'Box'
};

const ERROR_COLOR = 0xe74c3c;
const SUCCESS_COLOR = 0x2ecc71;

const SERVICE_ERROR_MESSAGES: Record<string, string> = {
  auth_invalidated: 'The authentication for this service was invalidated, you may need to re-authenticate.',
  server_error: 'An unknown server error occurred.'
};

export default class UploadModule extends BotModule {
  running = false;
  interval: any;
  KEY: string;
  private readonly handleReady = this.onReady.bind(this);

  constructor(client: CraigBot) {
    super(client, {
      name: 'upload',
      description: 'Messaging system and manager for cloud uploads'
    });
    this.KEY = `pending-upload-jobs:${this.client.config.applicationID}`;
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
    if (!this.client.config.kitchenURL) {
      this.logger.info(`Skipping upload for recording ${recordingId}: KITCHEN_URL is not configured`);
      return;
    }
    const service = SERVICES[driveService] ?? driveService;

    try {
      const response = await fetch(`${this.client.config.kitchenURL}/recordings/${recordingId}/upload/${userId}`, { method: 'POST' });
      // 204's means this ran fine but theres no recording coming out of it
      if (response.status > 299) {
        const error = (await response.json().catch(() => null))?.error ?? 'server_error';
        this.logger.error(`Failed to request upload for recording ${recordingId} for user ${userId} (${response.status}, ${error})`);
        await this.dm(
          userId,
          {
            title: `Failed to upload to ${service}`,
            description: `${
              SERVICE_ERROR_MESSAGES[error] ?? SERVICE_ERROR_MESSAGES.server_error
            } You will need to manually upload your recording (\`${recordingId}\`) to ${service}.`,
            color: ERROR_COLOR
          },
          {
            label: 'Open Dashboard',
            url: this.client.config.craig.dashboardURL
          }
        );
      } else if (response.status === 200) {
        const job = await response.json();
        this.logger.info(`Started an upload for recording ${recordingId} for user ${userId}`);
        await redis.sadd(this.KEY, job.id);
      }
    } catch (e) {
      this.logger.error(`Failed to request upload for recording ${recordingId} for user ${userId} due to fetch error`, e);
      await this.dm(userId, {
        title: `Failed to upload to ${service}`,
        description: `Unable to connect to the Cloud Backup microservice. You will need to manually upload your recording (\`${recordingId}\`) to ${service}.`,
        color: ERROR_COLOR
      });
    }
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

            if (job.status === 'error')
              await this.dm(userId, {
                title: `Failed to upload to ${service}`,
                description: `${
                  job.outputData.uploadError ? 'An error occurred while uploading.' : 'An error occurred while creating the download.'
                } You will need to manually upload your recording (\`${recordingId}\`) to ${service}.`,
                color: ERROR_COLOR
              });
            else if (job.status === 'cancelled')
              await this.dm(userId, {
                title: `Failed to upload to ${service}`,
                description: `The download was cancelled, possibly due to server maintenance. You will need to manually upload your recording (\`${recordingId}\`) to ${service}.`,
                color: ERROR_COLOR
              });
            else if (job.status === 'complete')
              await this.dm(
                userId,
                {
                  title: `Uploaded to ${service}`,
                  description: `Recording \`${recordingId}\` was uploaded to ${service}.`,
                  color: SUCCESS_COLOR
                },
                {
                  label: `Open in ${service}`,
                  url: job.outputData.uploadFileURL
                }
              );

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
    this.client.bot.on('ready', this.handleReady);
    this.logger.info('Loaded');
  }

  unload() {
    clearInterval(this.interval);
    this.running = false;
    this.client.bot.removeListener('ready', this.handleReady);
  }
}
