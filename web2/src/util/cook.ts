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
    () => false,
    () => true
  );
  if (locked) return false;
  return !cooking.has(id);
}

export async function getDuration(id: string): Promise<number> {
  const durationPath = path.join(cookPath, 'duration.sh');
  const { stdout: duration } = await execa(durationPath, [id]);
  return parseFloat(duration);
}

export const allowedFormats = [
  'copy',
  'oggflac',
  'vorbis',
  'aac',
  'heaac',
  'adpcm',
  'wav8',
  'opus',
  'wavsfx',
  'wavsfxm',
  'wavsfxu',
  'powersfx',
  'powersfxm',
  'powersfxu',
  'ra'
];

export const allowedContainers: { [container: string]: { mime?: string; ext?: string } } = {
  zip: {},
  aupzip: {
    ext: 'aup.zip'
  },
  ogg: {
    ext: 'ogg',
    mime: 'audio/ogg'
  },
  matroska: {
    ext: 'mkv',
    mime: 'video/x-matroska'
  },
  exe: {
    ext: 'exe',
    mime: 'application/vnd.microsoft.portable-executable'
  },
  mix: {
    mime: 'application/octet-stream'
  }
};

export async function cook(id: string, format = 'flac', container = 'zip', dynaudnorm = false): Promise<Buffer> {
  try {
    cooking.set(id, true);
    const cookingPath = path.join(cookPath, '..', 'cook.sh');
    const args = [id, format, container, ...(dynaudnorm ? ['dynaudnorm'] : [])];
    const { stdout: cooked } = await execa(cookingPath, args);
    cooking.delete(id);
    return Buffer.from(cooked);
  } catch (e) {
    cooking.delete(id);
    throw e;
  }
}
