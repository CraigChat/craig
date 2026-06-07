import fs from 'fs';
import http from 'http';
import path from 'path';
import { DexareClient, DexareModule } from 'dexare';

import type { CraigBotConfig } from '../bot';
import { prisma } from '../prisma';

export default class InternalApiModule<T extends DexareClient<CraigBotConfig>> extends DexareModule<T> {
  private server: http.Server | null = null;

  constructor(client: T) {
    super(client, { name: 'internalApi', description: 'Internal HTTP API for sidecar services' });
    this.filePath = __filename;
  }

  async load() {
    const port = parseInt(process.env.CRAIG_INTERNAL_PORT ?? '3001', 10);
    const secret = process.env.CRAIG_INTERNAL_SECRET ?? '';
    const tasmOutputDir = '/app/rec/tasmas';

    this.server = http.createServer(async (req, res) => {
      if (req.method !== 'POST' || req.url !== '/deliver-summary') {
        res.writeHead(404).end();
        return;
      }

      if (secret && req.headers.authorization !== `Bearer ${secret}`) {
        res.writeHead(401).end();
        return;
      }

      let body = '';
      for await (const chunk of req) body += chunk;

      let recordingId: string;
      try {
        ({ recordingId } = JSON.parse(body));
        if (!recordingId) throw new Error('missing recordingId');
      } catch {
        res.writeHead(400).end();
        return;
      }

      try {
        const recordingDir = path.join(tasmOutputDir, recordingId);
        const summaryFile = fs.readdirSync(recordingDir).find((f) => f.endsWith('_summary.md'));
        if (!summaryFile) {
          this.client.logger.warn(`No summary file found for recording ${recordingId}`);
          res.writeHead(404).end();
          return;
        }
        const content = fs.readFileSync(path.join(recordingDir, summaryFile), 'utf-8');

        const recording = await prisma.recording.findUnique({ where: { id: recordingId } });
        let deliveryChannelId: string | null = null;

        if (recording) {
          // Fire-and-forget: upload summary markdown to the user's Google Drive
          const recorder = this.client.modules.get('recorder') as any;
          if (recorder?.trpc) {
            const fireAndForget = (query: string, label: string) =>
              recorder.trpc
                .query(query, { recordingId, userId: recording.userId })
                .then((result: any) => {
                  if (result?.uploaded) {
                    this.client.logger.info(`[deliver-summary] ${label} uploaded to Drive for ${recordingId}: ${result.url}`);
                  } else if (result?.error) {
                    const silent = ['not_enabled', 'unsupported_service', 'user_not_found', 'data_not_found'].includes(result.error);
                    (silent ? this.client.logger.info : this.client.logger.warn).call(
                      this.client.logger,
                      `[deliver-summary] ${label} not uploaded to Drive for ${recordingId}: ${result.error}`
                    );
                  }
                })
                .catch((err: any) => {
                  this.client.logger.warn(`[deliver-summary] Drive ${label} upload failed for ${recordingId}`, err);
                });

            fireAndForget('driveSummaryUpload', 'summary');
            fireAndForget('driveTranscriptUpload', 'transcript');
          }

          const erisGuild = this.client.bot.guilds.get(recording.guildId)
            ?? await this.client.bot.getRESTGuild(recording.guildId).catch(() => null);

          this.client.logger.info(
            `[deliver-summary] recording=${recordingId} guild=${recording.guildId} ` +
            `systemChannelID=${erisGuild?.systemChannelID ?? 'null'} messageChannelId=${recording.messageChannelId ?? 'null'}`
          );

          deliveryChannelId = erisGuild?.systemChannelID ?? recording.messageChannelId ?? null;

          if (!deliveryChannelId && recording.autorecorded) {
            const autoRecord = await prisma.autoRecord.findFirst({
              where: { voiceChannelId: recording.voiceChannelId, guildId: recording.guildId }
            });
            deliveryChannelId = autoRecord?.postChannelId ?? null;
            this.client.logger.info(
              `[deliver-summary] autoRecord postChannelId=${autoRecord?.postChannelId ?? 'null'}`
            );
          }
        }

        if (!deliveryChannelId) {
          this.client.logger.warn(`No summary channel for recording ${recordingId} — no system channel, no message channel, and no autorecord post channel`);
          res.writeHead(404).end();
          return;
        }

        // Split into ≤2000-char chunks on newline boundaries
        const full = `\`${recordingId}\`\n` + content;
        const chunks: string[] = [];
        let current = '';
        for (const line of full.split('\n')) {
          const candidate = current ? `${current}\n${line}` : line;
          if (candidate.length > 2000) {
            if (current) chunks.push(current);
            current = line;
          } else {
            current = candidate;
          }
        }
        if (current) chunks.push(current);

        for (const chunk of chunks) {
          await this.client.bot.createMessage(deliveryChannelId, chunk);
        }

        res.writeHead(200).end();
      } catch (err) {
        this.client.logger.error('InternalApi delivery error', err);
        res.writeHead(500).end();
      }
    });

    this.server.listen(port, '0.0.0.0', () => {
      this.client.logger.info(`Internal API listening on port ${port}`);
    });
    this.server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EADDRINUSE') {
        this.client.logger.error('InternalApi server error', err);
      }
    });
  }

  async unload() {
    this.server?.close();
  }
}
