import * as fs from 'fs/promises';
import { constants as FS } from 'fs';
import { recPath } from './recording';
import path from 'path';
import execa from 'execa';

const cooking = new Map<string, boolean>();
export const cookPath = path.join(__dirname, '..', '..', '..', 'cook');

export async function isReady(id: string): Promise<boolean> {
  // check to see if a file is share locked
  const locked = await fs.access(path.join(recPath, `${id}.ogg.data`), FS.W_OK | FS.R_OK).then(
    () => true,
    () => false
  );
  if (locked) return false;
  return cooking.has(id);
}

export async function getDuration(id: string): Promise<number> {
  const durationPath = path.join(cookPath, 'duration.sh');
  const { stdout: duration } = await execa(durationPath, [id]);
  return parseInt(duration);
}
