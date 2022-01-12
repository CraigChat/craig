import * as fs from 'fs/promises';
import { constants as FS } from 'fs';
import { recPath } from './recording';
import path from 'path';
import execa from 'execa';
import { spawn } from 'child_process';

const cooking = new Map<string, string>();
export const cookPath = path.join(__dirname, '..', '..', '..', 'cook');
export const tmpPath = path.join(__dirname, '..', '..', 'tmp');

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
  'flac',
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
  'mp3',
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

export function cook(id: string, format = 'flac', container = 'zip', dynaudnorm = false) {
  const cookId = Date.now().toString(36);
  const deleteState = () => {
    if (cooking.get(id) === cookId) cooking.delete(id);
  };
  try {
    cooking.set(id, cookId);
    const cookingPath = path.join(cookPath, '..', 'cook.sh');
    const args = [id, format, container, ...(dynaudnorm ? ['dynaudnorm'] : [])];
    const child = spawn(cookingPath, args);
    child.stdout.once('end', deleteState);
    child.stdout.once('error', deleteState);
    return child.stdout;
  } catch (e) {
    deleteState();
    throw e;
  }
}

export const allowedAvatarFormats = [
  'png',
  'mkvh264',
  'webmvp8',
  'movsfx',
  'movsfxm',
  'movsfxu',
  'movpngsfx',
  'movpngsfxm',
  'movpngsfxu',
  'exe'
];

export function cookAvatars(
  id: string,
  format = 'png',
  container = 'zip',
  transparent = false,
  bg = '000000',
  fg = '008000'
) {
  const cookId = Date.now().toString(36);
  const deleteState = () => {
    if (cooking.get(id) === cookId) cooking.delete(id);
  };
  try {
    cooking.set(id, cookId);
    const cookingPath = path.join(cookPath, 'avatars.sh');
    const args = [id, format, container, transparent ? '1' : '0', bg, fg];
    const child = spawn(cookingPath, args);
    child.stdout.once('end', deleteState);
    child.stdout.once('error', deleteState);
    return child.stdout;
  } catch (e) {
    deleteState();
    throw e;
  }
}
