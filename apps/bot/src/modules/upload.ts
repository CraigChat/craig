import { type DexareClient, DexareModule } from 'dexare';
import Dysnomia from 'eris';
import fetch from 'node-fetch';
import { ButtonStyle, ComponentType } from 'slash-create';

import type { CraigBot, CraigBotConfig } from '../bot';
import { client as redis } from '../redis';
import type RecorderModule from './recorder';

const KEY = 'pending-upload-jobs';

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

// @ts-ignore
export default class UploadModule extends DexareModule<CraigBot> {
  running = false;
  interval: any;

  constructor(client: any) {
    super(client, {
      name: 'upload',
      description: 'Messaging system and manager for cloud uploads'
    });

    this.filePath = __filename;
  }

  get trpc() {
    return (this.client.modules.get('recorder') as any as RecorderModule<DexareClient<CraigBotConfig>>).trpc;
  }

  async dm(userId: string, embed: Dysnomia.EmbedOptions, linkButton?: { url: string; label: string; emoji?: Dysnomia.PartialEmoji }) {
    const dmChannel = await this.client.bot.getDMChannel(userId).catch(() => null);
    if (dmChannel)
      await dmChannel
        .createMessage({
          embeds: [embed],
          components: linkButton
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
            : []
        })
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
        await this.dm(userId, {
          title: `Failed to upload to ${service}`,
          description: `${
            SERVICE_ERROR_MESSAGES[error] ?? SERVICE_ERROR_MESSAGES.server_error
          } You will need to manually upload your recording (\`${recordingId}\`) to ${service}.`,
          color: ERROR_COLOR
        });
      } else if (response.status === 200) {
        const job = await response.json();
        this.logger.info(`Started an upload for recording ${recordingId} for user ${userId}`);
        await redis.sadd(KEY, job.id);
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

  async uploadWithTrpc(recordingId: string, userId: string, driveService: string) {
    const service = SERVICES[driveService] ?? driveService;
    const response = await this.trpc.query('driveUpload', { recordingId, userId }).catch(() => null);

    if (!response) {
      this.logger.error(`Failed to upload recording ${recordingId} to ${service}: Could not connect to the server`);
      await this.dm(userId, {
        title: `Failed to upload to ${service}`,
        description: `Unable to connect to the Cloud Backup microservice. You will need to manually upload your recording to ${service}.`,
        color: ERROR_COLOR
      });
      return;
    }

    if (response.error) {
      this.logger.error(`Failed to upload recording ${recordingId} to ${service}: ${response.error}`);
      if (response.notify)
        await this.dm(userId, {
          title: `Failed to upload to ${service}`,
          description: `Failed to upload recording \`${recordingId}\` to ${service}. You may need to manually upload it to ${service}, or possibly re-connect to ${service}.\n\n- **\`${response.error}\`**`,
          color: ERROR_COLOR
        });
      return;
    }

    if (response.notify) {
      await this.dm(
        userId,
        {
          title: `Uploaded to ${service}`,
          description: `Recording \`${recordingId}\` was uploaded to ${service}.`,
          color: SUCCESS_COLOR
        },
        {
          label: `Open in ${service}`,
          url: response.url!
        }
      );
    }
  }

  async onTick() {
    if (this.running) return;
    this.running = true;

    const pendingJobs = await redis.smembers(KEY);

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

            await redis.srem(jobId);
          }
        } else {
          this.logger.warn(`Failed to find pending job ${jobId}`);
          await redis.srem(jobId);
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
