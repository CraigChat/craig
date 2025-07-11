import { createReadStream, createWriteStream, WriteStream } from 'node:fs';
import { readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { RecordingNote, StreamType } from '@craig/types/recording';
import { execaCommand } from 'execa';

import { Job } from '../jobs/job.js';
import logger from '../util/logger.js';
import { ROOT_DIR } from './index.js';
import { procOpts } from './processOptions.js';

export const DEF_TIMEOUT = 14400 * 1000; // 4 hours

interface CommonProcessOptions {
  recFileBase: string;
  cancelSignal: AbortSignal;
}

export function streamRecording({ recFileBase, cancelSignal }: CommonProcessOptions) {
  return execaCommand(['cat', ...['header1', 'header2', 'data'].map((ext) => `${recFileBase}.${ext}`)].join(' '), { cancelSignal, buffer: false });
}

export async function getNotes({
  recFileBase,
  cancelSignal
}: Omit<CommonProcessOptions, 'cancelSignal'> & { cancelSignal?: AbortSignal | undefined }) {
  const subprocess = execaCommand(
    [['cat', ...['header1', 'header2', 'data'].map((ext) => `${recFileBase}.${ext}`)].join(' '), './cook/extnotes -f json'].join(' | '),
    { cancelSignal, shell: true, cwd: ROOT_DIR }
  );
  const { stdout } = await subprocess;
  return JSON.parse(stdout) as RecordingNote[];
}

export async function getStreamTypes({ recFileBase, cancelSignal }: CommonProcessOptions) {
  const stream = createReadStream(`${recFileBase}.header1`);
  try {
    const subprocess = execaCommand('./cook/oggtracks', { cancelSignal, cwd: ROOT_DIR, timeout: 10000 });
    stream.pipe(subprocess.stdin!);
    const { stdout } = await subprocess;
    return stdout.split('\n') as StreamType[];
  } finally {
    stream.close();
  }
}

interface DurationOptions extends Omit<CommonProcessOptions, 'cancelSignal'> {
  cancelSignal?: AbortSignal;
  track?: number;
}

export async function getChildPids(pid: number, cancelSignal: AbortSignal) {
  try {
    if (!pid) return [];
    return (await execaCommand(`ps --ppid ${pid} --no-headers -o pid`, { cancelSignal, timeout: 5000 })).stdout
      .split('\n')
      .map((l) => parseInt(l.trim(), 10));
  } catch (e) {
    return [];
  }
}

function killPids(pids: number[], recFileBase: string, logId: string) {
  const recId = recFileBase.split('/').reverse()[0].split('.')[0];
  if (pids.length) {
    logger.log(`Killing process for ${recId} [${logId}]: ${pids}`);
    for (const pid of [...pids].reverse()) {
      try {
        process.kill(pid, 9);
      } catch (e) {
        logger.log(` - Failed to kill ${pid} for ${recId} [${logId}]: ${(e as any).code}`);
      }
    }
  }
}

export async function getDuration({ recFileBase, cancelSignal, track }: DurationOptions) {
  const stream = createReadStream(`${recFileBase}.data`);
  try {
    const subprocess = execaCommand(`${procOpts()} ./cook/oggduration${track ? ` ${track}` : ''}`, {
      cancelSignal,
      cwd: ROOT_DIR,
      timeout: 5 * 60 * 1000
    });
    stream.pipe(subprocess.stdin!);
    const { stdout } = await subprocess;
    return stdout;
  } finally {
    stream.close();
  }
}

export function timemarkToSeconds(timemark: string) {
  if (typeof timemark === 'number') {
    return timemark;
  }

  if (timemark.indexOf(':') === -1 && timemark.indexOf('.') >= 0) {
    return Number(timemark);
  }

  const parts = timemark.split(':');

  // add seconds
  let secs = Number(parts.pop());

  if (parts.length) {
    // add minutes
    secs += Number(parts.pop()) * 60;
  }

  if (parts.length) {
    // add hours
    secs += Number(parts.pop()) * 3600;
  }

  return secs;
}

function getTimemark(line: string): [string, number] | null {
  // Remove all spaces after = and trim
  line = line.replace(/=\s+/g, '=').trim();
  const progressParts = line.split(' ');

  // Split every progress part by "=" to get key and value
  for (let i = 0; i < progressParts.length; i++) {
    const [key, value] = progressParts[i].split('=', 2);

    if (key === 'time') return [value, timemarkToSeconds(value)];

    // This is not a progress line
    if (typeof value === 'undefined') return null;
  }

  return null;
}

interface EncodeMixOptions extends CommonProcessOptions {
  audioWritePath: string;
  tracks: [string, StreamType][];
  encodeCommand: string;
  job?: Job;
}

interface EncodeMixTrackOptions extends CommonProcessOptions {
  track: number;
  audioWritePath: string;
}

interface EncodeTrackOptions extends EncodeMixTrackOptions {
  codec: StreamType;
  encodeCommand: string;
  dynaudnorm?: boolean;
  job?: Job;
}

export async function encodeTrack({ recFileBase, codec, track, cancelSignal, encodeCommand, audioWritePath, job, dynaudnorm }: EncodeTrackOptions) {
  const duration = await getDuration({ recFileBase, cancelSignal, track });

  const ffmpegFilters = ['anull', ...(dynaudnorm ? ['dynaudnorm'] : [])].join(',');
  const pOpts = procOpts();

  const commands = [
    ['cat', ...['header1', 'header2', 'data', 'header1', 'header2', 'data'].map((ext) => `${recFileBase}.${ext}`)].join(' '),
    `${pOpts} ./cook/oggcorrect ${track}`,
    `${pOpts} ffmpeg -codec ${codec === 'opus' ? 'libopus' : codec} -copyts -i - -af ${ffmpegFilters} -flags bitexact -f wav -`,
    `${pOpts} ./cook/wavduration ${duration}`,
    `${pOpts} ${encodeCommand}`
  ];

  const childProcess = execaCommand(commands.join(' | '), { cancelSignal, buffer: false, shell: true, timeout: DEF_TIMEOUT, cwd: ROOT_DIR });
  const childPids = await getChildPids(childProcess.pid!, cancelSignal);

  const durationNum = parseFloat(duration);
  const outputStream = createWriteStream(audioWritePath);
  let abortListener: ((event: Event) => void) | undefined;

  try {
    childProcess
      .stderr!.on('data', (b) => {
        const timemark = getTimemark(b.toString());
        if (timemark) {
          job?.setState({
            type: 'encoding',
            tracks: {
              ...(job.state.tracks || {}),
              [track]: { progress: (timemark[1] / durationNum) * 100, time: timemark[0] }
            }
          });
        }
      })
      .once('error', () => {});

    // Add abort handler that we can clean up later
    abortListener = () => {
      childProcess.stderr!.removeAllListeners('data');
      killPids(childPids, recFileBase, `encodeTrack/${track}`);
    };
    cancelSignal.addEventListener('abort', abortListener);

    childProcess.stdout!.pipe(outputStream);

    const success = await childProcess
      .then(() => true)
      .catch(() => {
        if (job) logger.warn(`Job ${job.id} (${job.recordingId}) failed to encode track ${track}`);
        return false;
      });
    return success;
  } finally {
    // Clean up event listeners and streams
    if (abortListener) cancelSignal.removeEventListener('abort', abortListener);
    childProcess.stderr.removeAllListeners();
    outputStream.end();
  }
}

interface CreateAvatarVideoOptions extends CommonProcessOptions {
  codec: 'opus' | 'flac';
  extraArgs?: string;
  filter: string;
  duration: number;
  avatarPath: string;
  track: number;
  writePath: string;
  job?: Job;
}

export async function createAvatarVideo({
  recFileBase,
  codec,
  track,
  cancelSignal,
  duration,
  extraArgs,
  avatarPath,
  filter,
  writePath,
  job
}: CreateAvatarVideoOptions) {
  const ffmpegCodec = codec === 'opus' ? 'libopus' : codec;
  const pOpts = procOpts();

  const commands = [
    ['cat', ...['header1', 'header2', 'data', 'header1', 'header2', 'data'].map((ext) => `${recFileBase}.${ext}`)].join(' '),
    `${pOpts} ./cook/oggcorrect ${track}`,
    [
      `${pOpts} ffmpeg`,
      '-framerate 30 -i "./assets/glower-avatar.png"',
      '-framerate 30 -i "./assets/glower-glow.png"',
      `-codec ${ffmpegCodec} -copyts -i -`,
      `-framerate 30 -i "${avatarPath}"`,
      `-filter_complex "${filter}"`,
      "-map '[vid]'",
      extraArgs || '',
      `-t "${duration}"`,
      `-y "${writePath}"`
    ].join(' ')
  ];

  const childProcess = execaCommand(commands.join(' | '), { cancelSignal, buffer: false, shell: true, timeout: DEF_TIMEOUT, cwd: ROOT_DIR });
  const childPids = await getChildPids(childProcess.pid!, cancelSignal);
  let abortListener: ((event: Event) => void) | undefined;

  try {
    childProcess
      .stderr!.on('data', (b) => {
        const timemark = getTimemark(b.toString());
        if (timemark) {
          job?.setState({
            type: 'encoding',
            tracks: {
              ...(job.state.tracks || {}),
              [track]: {
                progress: (timemark[1] / duration) * 100,
                time: timemark[0]
              }
            }
          });
        }
      })
      .once('error', () => {});

    // Add abort handler that we can clean up later
    abortListener = () => {
      childProcess.stderr!.removeAllListeners('data');
      killPids(childPids, recFileBase, `createAvatarVideo/${track}`);
    };
    cancelSignal.addEventListener('abort', abortListener);

    const success = await childProcess
      .then(() => true)
      .catch(() => {
        if (job) logger.warn(`Job ${job.id} (${job.recordingId}) failed to create avatar video track ${track}`);
        return false;
      });
    return success;
  } finally {
    // Clean up event listeners and streams
    if (abortListener) cancelSignal.removeEventListener('abort', abortListener);
    childProcess.stderr.removeAllListeners();
  }
}

interface ReEncodeTrackOptions {
  cancelSignal?: AbortSignal;
  audioWritePath: string;
}

export async function reEncodeTrack({ cancelSignal, audioWritePath }: ReEncodeTrackOptions) {
  const tempPath = path.join(path.dirname(audioWritePath), 'TMP-' + path.basename(audioWritePath));
  await rename(audioWritePath, tempPath);
  const success = await execaCommand(`${procOpts()} ffmpeg -i "${tempPath}" -c:v copy -c:a flac "${audioWritePath}"`, {
    cancelSignal,
    shell: true,
    buffer: false,
    timeout: DEF_TIMEOUT
  })
    .then(() => true)
    .catch(() => false);

  if (success) await rm(tempPath);
  else await rename(tempPath, audioWritePath);
}

interface FileDurationOptions {
  cancelSignal?: AbortSignal;
  file: string;
}

export async function getFileDuration({ cancelSignal, file }: FileDurationOptions) {
  const subprocess = await execaCommand(`ffprobe -i "${file}" -show_entries format=duration -v quiet -of csv="p=0"`, {
    cancelSignal,
    shell: true,
    timeout: 5 * 60 * 1000
  });
  return subprocess.stdout;
}

export async function encodeMixTrack({ recFileBase, track, cancelSignal, audioWritePath }: EncodeMixTrackOptions) {
  const commands = [
    ['cat', ...['header1', 'header2', 'data', 'header1', 'header2', 'data'].map((ext) => `${recFileBase}.${ext}`)].join(' '),
    `${procOpts()} ./cook/oggcorrect ${track} > ${audioWritePath}`
  ];
  const childProcess = execaCommand(commands.join(' | '), { cancelSignal, buffer: false, shell: true, timeout: DEF_TIMEOUT, cwd: ROOT_DIR });
  const childPids = await getChildPids(childProcess.pid!, cancelSignal);

  // Prevent further data from stderr from spilling out
  cancelSignal.addEventListener('abort', () => {
    if (childProcess.killed) {
      childProcess.stderr!.removeAllListeners('data');
      killPids(childPids, recFileBase, `encodeMixTrack/${track}`);
    }
  });

  // FIXME this doesnt work for some reason
  // childProcess.stdout!.pipe(createWriteStream(audioWritePath));

  await childProcess.catch(() => {});
}

export async function encodeMix({ recFileBase, tracks, cancelSignal, encodeCommand, audioWritePath, job }: EncodeMixOptions) {
  const duration = await getDuration({ recFileBase, cancelSignal });
  const pOpts = procOpts();

  let input = '';
  let filter = '';
  let mixFilter = '';
  let co = 0;

  for (let i = 0; i < tracks.length; i++) {
    const [filename, codec] = tracks[i];
    input += ` -codec ${codec === 'opus' ? 'libopus' : codec} -copyts -i ${filename}`;
    filter += `[${i}:a]dynaudnorm[aud${co}];`;
    mixFilter += `[aud${co}]`;
    co++;

    // amix can only mix 32 at a time
    if (co >= 32) {
      filter += `${mixFilter} amix=${co},dynaudnorm[aud${co}];`;
      mixFilter = `[aud${co}]`;
      co = 1;
    }
  }

  filter += `${mixFilter} amix=${co},dynaudnorm[aud]`;

  const commands = [
    `${pOpts} ffmpeg ${input} -filter_complex "${filter}" -map [aud] -flags bitexact -f wav -`,
    `${pOpts} ./cook/wavduration ${duration}`,
    `${pOpts} ${encodeCommand}`
  ];

  const childProcess = execaCommand(commands.join(' | '), { cancelSignal, buffer: false, shell: true, timeout: DEF_TIMEOUT, cwd: ROOT_DIR });
  const childPids = await getChildPids(childProcess.pid!, cancelSignal);
  const outputStream = createWriteStream(audioWritePath);
  let abortListener: ((event: Event) => void) | undefined;

  try {
    const durationNum = parseFloat(duration);
    childProcess
      .stderr!.on('data', (b) => {
        const timemark = getTimemark(b.toString());
        if (timemark)
          job?.setState({
            type: 'encoding',
            progress: (timemark[1] / durationNum) * 100,
            time: timemark[0]
          });
      })
      .once('error', () => {});

    abortListener = () => {
      childProcess.stderr!.removeAllListeners('data');
      killPids(childPids, recFileBase, 'encodeMix');
    };
    cancelSignal.addEventListener('abort', abortListener);

    childProcess.stdout!.pipe(outputStream);

    await childProcess.catch(() => {});
  } finally {
    // Clean up event listeners and streams
    if (abortListener) cancelSignal.removeEventListener('abort', abortListener);
    outputStream.end();
  }
}

interface RecordingWriteOptions extends CommonProcessOptions {
  writeStream: WriteStream;
}

export async function recordingWrite({ recFileBase, cancelSignal, writeStream }: RecordingWriteOptions) {
  const recProcess = streamRecording({ recFileBase, cancelSignal });
  recProcess.stdout!.pipe(writeStream);
  await recProcess;
}

export async function copyFFmpegLicense(writeStream: WriteStream, replaceValue = '$1') {
  const license = await readFile('./cook/ffmpeg-lgpl21.txt', { encoding: 'utf8' });
  writeStream.write(license.replace(/^(.*)$/gm, replaceValue));
}

interface EncodeTranscriptionTrackOptions extends EncodeMixTrackOptions {
  codec: StreamType;
  job?: Job;
}

export async function encodeTranscriptionTrack({ recFileBase, codec, track, cancelSignal, audioWritePath, job }: EncodeTranscriptionTrackOptions) {
  const duration = await getDuration({ recFileBase, cancelSignal });
  const pOpts = procOpts();

  const commands = [
    ['cat', ...['header1', 'header2', 'data', 'header1', 'header2', 'data'].map((ext) => `${recFileBase}.${ext}`)].join(' '),
    `${pOpts} ./cook/oggcorrect ${track}`,
    `${pOpts} ffmpeg -c:a ${codec === 'opus' ? 'libopus' : codec} -i - -f ogg -c:a libopus -ac 1 -ar 16000 -b:a 32k -application lowdelay -y "${audioWritePath}"`
  ];

  const childProcess = execaCommand(commands.join(' | '), { cancelSignal, buffer: false, shell: true, timeout: DEF_TIMEOUT, cwd: ROOT_DIR });
  const childPids = await getChildPids(childProcess.pid!, cancelSignal);

  const durationNum = parseFloat(duration);
  let abortListener: ((event: Event) => void) | undefined;

  try {
    childProcess
      .stderr!.on('data', (b) => {
        const timemark = getTimemark(b.toString());
        if (timemark) {
          job?.setState({
            type: 'encoding',
            tracks: {
              ...(job.state.tracks || {}),
              [track]: { progress: (timemark[1] / durationNum) * 100, time: timemark[0] }
            }
          });
        }
      })
      .once('error', () => {});

    // Add abort handler that we can clean up later
    abortListener = () => {
      childProcess.stderr!.removeAllListeners('data');
      killPids(childPids, recFileBase, `encodeTranscriptionTrack/${track}`);
    };
    cancelSignal.addEventListener('abort', abortListener);

    const success = await childProcess
      .then(() => true)
      .catch(() => {
        if (job) logger.warn(`Job ${job.id} (${job.recordingId}) failed to encode track ${track}`);
        return false;
      });
    return success;
  } finally {
    // Clean up event listeners and streams
    if (abortListener) cancelSignal.removeEventListener('abort', abortListener);
    childProcess.stderr.removeAllListeners();
  }
}
