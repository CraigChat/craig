import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';
import { clearDownload, setDownload } from '../cache';
import { nanoid } from 'nanoid';
import { CronJob } from 'cron';
import { captureException, withScope } from '@sentry/node';

export interface DownloadState {
  file: string;
  format: string;
  container: string;
  dynaudnorm: boolean;
  type: string;
}

export const downloadPath = path.join(__dirname, '..', '..', 'downloads');

export const cron = new CronJob('0 * * * *', clean, null, false, 'America/New_York');

const DOWNLOAD_EXPIRATION = 24 * 60 * 60 * 1000;

export async function writeToFile(
  stream: Readable,
  id: string,
  ext: string,
  format: string,
  container: string,
  dynaudnorm: boolean,
  type = 'default'
) {
  const file = `craig-${id}-${nanoid(15)}.${ext}`;
  await setDownload(id, { file, format, container, dynaudnorm, type });
  const writer = fs.createWriteStream(path.join(downloadPath, file));
  writer.on('finish', () => console.log(`Finished writing ${id} to ${file} (${format}.${container})`));
  writer.on('error', async () => {
    console.error(`Error writing ${id} to ${file} (${format}.${container})`);
    await clearDownload(id);
    await removeFile(file);
  });
  console.log(`Writing ${id} to ${file} (${format}.${container})`);
  stream.pipe(writer);
}

export async function removeFile(file: string) {
  try {
    await fs.promises.unlink(path.join(downloadPath, file));
  } catch (err) {
    console.error(`Failed to delete file ${file}`, err);
  }
}

async function clean(timestamp = new Date()) {
  try {
    for (const file of await fs.promises.readdir(downloadPath)) {
      const stat = await fs.promises.stat(path.join(downloadPath, file));
      if (stat.mtime.getTime() + DOWNLOAD_EXPIRATION < (timestamp || cron.lastDate()).getTime()) await removeFile(file);
    }
  } catch (e) {
    withScope((scope) => {
      scope.clear();
      scope.setExtra('date', timestamp || cron.lastDate());
      captureException(e);
    });
    console.error('Error cleaning download files.', e);
  }
}
