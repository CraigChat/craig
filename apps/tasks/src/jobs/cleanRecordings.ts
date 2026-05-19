import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import { REC_DIRECTORY, RECORDING_CLEAN_CRON, RECORDING_FALLBACK_EXPIRATION, RECORDING_SKIP_ALL, RECORDING_SKIP_IDS } from '../util/config.js';
import { TaskJob } from './job.js';

interface RecordingInfo {
  expiresAfter?: number;
  startTime?: string;
}

export class CleanRecordingsJob extends TaskJob {
  constructor() {
    super('cleanRecordings', RECORDING_CLEAN_CRON);
  }

  async run() {
    if (RECORDING_SKIP_ALL) {
      this.logger.info('Skipping recording cleanup because RECORDING_SKIP_ALL is enabled.');
      return;
    }

    const files = await readdir(REC_DIRECTORY);
    const recordingFiles = new Map<string, Set<string>>();

    for (const file of files) {
      const match = /^(.+)\.ogg\.([^.]+)$/.exec(file);
      if (!match) continue;

      const [, id, type] = match;
      if (RECORDING_SKIP_IDS.has(id)) continue;

      const types = recordingFiles.get(id) ?? new Set<string>();
      types.add(type);
      recordingFiles.set(id, types);
    }

    this.logger.info(`Found ${recordingFiles.size.toLocaleString()} recordings to inspect.`);

    for (const [id, types] of recordingFiles) {
      if (!types.has('info')) {
        this.logger.warn(`Skipping ${id}; missing info file.`);
        continue;
      }

      const infoPath = path.join(REC_DIRECTORY, `${id}.ogg.info`);
      const infoStat = await stat(infoPath).catch(() => null);
      if (!infoStat) {
        this.logger.warn(`Skipping ${id}; failed to stat info file.`);
        continue;
      }

      let info: RecordingInfo;
      try {
        info = JSON.parse(await readFile(infoPath, 'utf8')) as RecordingInfo;
      } catch (e) {
        this.logger.warn(`Skipping ${id}; failed to parse info file:`, e);
        continue;
      }

      const expiresAt =
        info.expiresAfter !== undefined && info.startTime
          ? Date.parse(info.startTime) + info.expiresAfter * 60 * 60 * 1000
          : infoStat.mtime.getTime() + RECORDING_FALLBACK_EXPIRATION;

      if (!Number.isFinite(expiresAt) || expiresAt >= Date.now()) continue;

      this.logger.info(`Deleting expired recording ${id}.`);
      await Promise.all(
        [...types].map(async (type) => {
          const file = path.join(REC_DIRECTORY, `${id}.ogg.${type}`);
          await unlink(file);
        })
      );
    }
  }
}
