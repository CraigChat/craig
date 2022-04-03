import { TaskJob } from '../types';
import config from 'config';
import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
const recordingConfig = config.get('recording') as {
  fallbackExpiration: number;
  path: string;
  skipIds: string[];
  skipAll?: boolean;
};

export default class CleanRecordings extends TaskJob {
  constructor() {
    super('cleanRecordings', '*/30 * * * *');
  }

  async run() {
    this.logger.log('Cleaning recordings...');
    if (recordingConfig.skipAll) return;
    const recPath = path.join(__dirname, '..', '..', recordingConfig.path);
    const files = await readdir(recPath);
    const recordingExts: { [file: string]: string[] } = {};

    for (const file of files) {
      const [id, ext, type] = file.split('.');
      if (ext !== 'ogg') continue;
      if (recordingConfig.skipIds.includes(id)) continue;

      if (!recordingExts[id]) recordingExts[id] = [];
      recordingExts[id].push(type);
    }

    this.logger.info(`Found ${Object.keys(recordingExts).length} recordings.`);

    for (const id of Object.keys(recordingExts)) {
      const types = recordingExts[id];

      if (!types.includes('info')) {
        this.logger.error(`Missing info file for ${id}.`, types);
        continue;
      }

      const s = await stat(path.join(recPath, `${id}.ogg.info`)).catch(() => null);
      if (!s) {
        this.logger.error(`Failed to get info stat for ${id}.`, types);
        continue;
      }

      try {
        const info = JSON.parse(await readFile(path.join(recPath, `${id}.ogg.info`), 'utf8'));
        const shouldExpire =
          info.expiresAfter !== undefined
            ? Date.parse(info.startTime) + info.expiresAfter * 60 * 60 * 1000 < Date.now()
            : s.mtime.getTime() + recordingConfig.fallbackExpiration < Date.now();

        if (shouldExpire) {
          this.logger.log(`Deleting ${id}.`);
          await Promise.all(types.map((type) => unlink(path.join(recPath, `${id}.ogg.${type}`))));
        }
      } catch (e) {
        this.logger.error(`Failed to read info file for ${id}.`, types);
        continue;
      }
    }

    this.logger.info('OK.');
  }
}
