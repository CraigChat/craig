import { setMaxListeners } from 'node:events';
import { access } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FormatType } from '@craig/types/kitchen';
import { RecordingUser } from '@craig/types/recording';
import { Error as DropboxError } from 'dropbox';
import range from 'just-range';
import split from 'just-split';

export const ROOT_DIR = fileURLToPath(new URL('../..', import.meta.url));

export const FormatToExt: { [format: string]: string } = {
  flac: 'flac',
  oggflac: 'oga',
  aac: 'aac',
  heaac: 'aac',
  opus: 'opus',
  vorbis: 'ogg',
  wav: 'wav',
  adpcm: 'wav',
  wav8: 'wav',
  mp3: 'mp3',
  ra: 'wav'
};

export const FormatToMime: { [format: string]: string } = {
  flac: 'audio/flac',
  oggflac: 'audio/ogg',
  aac: 'audio/aac',
  heaac: 'audio/aac',
  opus: 'audio/opus',
  vorbis: 'audio/ogg',
  wav: 'audio/wav',
  adpcm: 'audio/wav',
  wav8: 'audio/wav',
  mp3: 'audio/mpeg',
  ra: 'audio/wav'
};

export const FormatToCommand: { [format: string]: string } = {
  flac: 'flac - -c',
  oggflac: 'flac --ogg --serial-number=1 - -',
  aac: 'fdkaac -f 2 -m 4 -o - -',
  heaac: 'fdkaac -p 29 -f 2 -m 4 -o - -',
  opus: 'opusenc --bitrate 96 - -',
  vorbis: 'oggenc -q 6 -',
  wav: 'ffmpeg -f wav -i - -c:a adpcm_ms -f wav -',
  adpcm: 'ffmpeg -f wav -i - -c:a adpcm_ms -f wav -',
  wav8: 'ffmpeg -f wav -i - -c:a pcm_u8 -f wav -',
  mp3: 'lame -b 128 - -',
  ra: 'ffmpeg -f wav -i - -f rm -'
};

export function getEncodeOptions(tmpDir: string, fileName: string, format?: FormatType) {
  const audioWritePath = path.join(tmpDir, fileName);
  let ext = 'flac';
  let command = 'flac - -c';

  switch (format) {
    case 'oggflac': {
      ext = 'oga';
      command = 'flac --ogg --serial-number=1 - -c';
      break;
    }
    case 'aac': {
      ext = 'aac';
      command = 'fdkaac -f 2 -m 4 -o - -';
      break;
    }
    case 'heaac': {
      ext = 'aac';
      command = 'fdkaac -p 29 -f 2 -m 4 -o - -';
      break;
    }
    case 'opus': {
      ext = 'opus';
      command = 'opusenc --bitrate 96 - -';
      break;
    }
    case 'vorbis': {
      ext = 'ogg';
      command = 'oggenc -q 6 -';
      break;
    }
    case 'wav':
    case 'adpcm': {
      ext = 'wav';
      command = 'ffmpeg -f wav -i - -c:a adpcm_ms -f wav -';
      break;
    }
    case 'wav8': {
      ext = 'wav';
      command = 'ffmpeg -f wav -i - -c:a pcm_u8 -f wav -';
      break;
    }
    case 'mp3': {
      ext = 'mp3';
      command = 'lame -b 128 - -';
      break;
    }
    case 'ra': {
      ext = 'wav';
      command = 'ffmpeg -f wav -i - -f rm -';
      break;
    }
  }

  return [`${audioWritePath}.${ext}`, command];
}

export async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch (e) {
    return false;
  }
}

export function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function fileNameFromUser(track: number, user: RecordingUser) {
  return `${track}-${(user.discriminator === '0' ? user.username : `${user.username}#${user.discriminator}`).replace(/[^a-zA-Z0-9]/g, '_')}`;
}

export function getRecordingDescription(recordingId: string, info: any, joiner = '\n') {
  return [
    `Craig recording ${recordingId} via https://craig.chat/`,
    '',
    `${info.autorecorded ? 'Auto-recorded in behalf of' : 'Started by'}: ${info.requester} (${info.requesterId})`,
    `Server: ${info.guild} (${info.guildExtra.id})`,
    `Channel: ${info.channel} (${info.channelExtra.id})`
  ].join(joiner);
}

export class UploadError extends Error {}

export function formatError(e: Error) {
  if ((e as Error).name === 'DropboxResponseError') {
    const err: DropboxError<{ error_summary: string }> = e as any;
    return `DropboxError [${err.error.error_summary}]`;
  }

  return String(e);
}

export interface RunParallelFunctionOptions {
  parallel?: boolean;
  batchBy?: number;
  userCount: number;
  cancelSignal: AbortSignal;
  fn: (index: number) => Promise<void>;
}

export async function runParallelFunction({ parallel, userCount, batchBy, cancelSignal, fn }: RunParallelFunctionOptions) {
  function fnWrapped(i: number) {
    if (cancelSignal.aborted) throw new Error('Function was aborted');
    return fn(i);
  }

  if (parallel) {
    setMaxListeners(userCount * 2, cancelSignal);
    if (batchBy) {
      const batches = split(range(userCount), batchBy);
      for (const batch of batches) await Promise.all(batch.map(fnWrapped));
    } else await Promise.all(range(userCount).map(fnWrapped));
  } else {
    for (let i = 0; i < userCount; i++) await fnWrapped(i);
  }
}

export function convertToTimeMark(seconds: number, includeHours?: boolean): string {
  if (isNaN(seconds) || seconds < 0) return '00:00:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  const formattedHours = hours < 10 ? `0${hours}` : `${hours}`;
  const formattedMinutes = minutes < 10 ? `0${minutes}` : `${minutes}`;
  const formattedSeconds = remainingSeconds < 10 ? `0${remainingSeconds.toFixed(2)}` : `${remainingSeconds.toFixed(2)}`;

  return `${hours === 0 && !includeHours ? '' : `${formattedHours}:`}${formattedMinutes}:${formattedSeconds}`;
}
