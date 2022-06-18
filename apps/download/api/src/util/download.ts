import fs from 'fs';
import { nanoid } from 'nanoid';
import path from 'path';
import { Readable } from 'stream';

import { clearDownload, setDownload } from '../cache';

export interface DownloadState {
  file: string;
  format: string;
  container: string;
  dynaudnorm: boolean;
  type: string;
}

export const downloadPath = path.join(__dirname, '..', '..', 'downloads');

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
