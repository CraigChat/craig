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
    const tasmOutputDir = process.env.CRAIG_TASMAS_OUTPUT_DIR ?? '';

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
        const summaryFile = fs.readdirSync(recordingDir).find((f) => f.startsWith('summary_') && f.endsWith('.md'));
        if (!summaryFile) {
          this.client.logger.warn(`No summary file found for recording ${recordingId}`);
          res.writeHead(404).end();
          return;
        }
        const content = fs.readFileSync(path.join(recordingDir, summaryFile), 'utf-8');

        const recording = await prisma.recording.findUnique({ where: { id: recordingId } });
        const guild = recording ? await prisma.guild.findUnique({ where: { id: recording.guildId } }) : null;
        const deliveryChannelId = guild?.summaryChannelId ?? recording?.messageChannelId;

        if (!deliveryChannelId) {
          this.client.logger.warn(`No summary channel for recording ${recordingId} — set one with /server-settings summary-channel set`);
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
  }

  async unload() {
    this.server?.close();
  }
}
