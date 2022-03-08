import { TaskJob } from '../types';
import config from 'config';
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
const downloadConfig = config.get('downloads') as {
  path: string;
  expiration: number;
};

export default class CleanDownloads extends TaskJob {
  constructor() {
    super('cleanDownloads', '0 * * * *');
  }

  async run() {
    this.logger.log('Cleaning downloads...');
    const downloadPath = path.join(__dirname, '..', '..', downloadConfig.path);

    for (const file of await readdir(downloadPath)) {
      try {
        const s = await stat(path.join(downloadPath, file));
        if (s.mtime.getTime() + downloadConfig.expiration < Date.now()) {
          this.logger.log(`Deleting ${file}`);
          await unlink(path.join(downloadPath, file));
        }
      } catch (e) {}
    }
    this.logger.info('OK.');
  }
}
