import { createReadStream, WriteStream } from 'node:fs';
import { readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { RecordingInfo, RecordingNote, RecordingUser, StreamType } from '@craig/types/recording';

import { Job } from '../jobs/job.js';
import logger from '../util/logger.js';
import { ROOT_DIR } from './index.js';
import { procOpts } from './processOptions.js';
import { runCommand } from './subprocess.js';

export const DEF_TIMEOUT = 14400 * 1000; // 4 hours

interface CommonProcessOptions {
  recFileBase: string;
  cancelSignal: AbortSignal;
}

export function streamRecording({ recFileBase, cancelSignal }: CommonProcessOptions) {
  return runCommand(['cat', ...['header1', 'header2', 'data'].map((ext) => `${recFileBase}.${ext}`)].join(' '), {
    cancelSignal,
    buffer: false,
    timeout: DEF_TIMEOUT
  });
}

export async function getNotes({
  recFileBase,
  cancelSignal
}: Omit<CommonProcessOptions, 'cancelSignal'> & { cancelSignal?: AbortSignal | undefined }) {
  const subprocess = runCommand(
    [['cat', ...['header1', 'header2', 'data'].map((ext) => `${recFileBase}.${ext}`)].join(' '), './cook/extnotes -f json'].join(' | '),
    { cancelSignal, shell: true, cwd: ROOT_DIR, timeout: DEF_TIMEOUT }
  );
  const { stdout } = await subprocess;
  return JSON.parse(stdout) as RecordingNote[];
}

export async function getStreamTypes({ recFileBase, cancelSignal }: CommonProcessOptions) {
  const stream = createReadStream(`${recFileBase}.header1`);
  try {
    const subprocess = runCommand('./cook/oggtracks', { cancelSignal, cwd: ROOT_DIR, timeout: 10000 });
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

export async function getDuration({ recFileBase, cancelSignal, track }: DurationOptions) {
  const stream = createReadStream(`${recFileBase}.data`);
  try {
    const subprocess = runCommand(`${procOpts()} ./cook/oggduration${track ? ` ${track}` : ''}`, {
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

  const directOutput = encodeCommand.includes('$OUTPUT');
  const childProcess = runCommand(commands.join(' | '), {
    cancelSignal,
    buffer: false,
    shell: true,
    timeout: DEF_TIMEOUT,
    cwd: ROOT_DIR,
    env: directOutput ? { OUTPUT: audioWritePath } : undefined,
    stdout: directOutput ? 'ignore' : { file: audioWritePath }
  });

  const durationNum = parseFloat(duration);

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

    const success = await childProcess
      .then(() => true)
      .catch(() => {
        if (job) logger.warn(`Job ${job.id} (${job.recordingId}) failed to encode track ${track}`);
        return false;
      });
    return success;
  } finally {
    // Clean up event listeners and streams
    childProcess.stderr.removeAllListeners('data');
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

  const childProcess = runCommand(commands.join(' | '), { cancelSignal, buffer: false, shell: true, timeout: DEF_TIMEOUT, cwd: ROOT_DIR });

  childProcess.stdout!.resume();

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

    const success = await childProcess
      .then(() => true)
      .catch(() => {
        if (job) logger.warn(`Job ${job.id} (${job.recordingId}) failed to create avatar video track ${track}`);
        return false;
      });
    return success;
  } finally {
    // Clean up event listeners and streams
    childProcess.stderr.removeAllListeners('data');
  }
}

interface ReEncodeTrackOptions {
  cancelSignal?: AbortSignal;
  audioWritePath: string;
}

export async function reEncodeTrack({ cancelSignal, audioWritePath }: ReEncodeTrackOptions) {
  const tempPath = path.join(path.dirname(audioWritePath), 'TMP-' + path.basename(audioWritePath));
  await rename(audioWritePath, tempPath);
  const success = await runCommand(`${procOpts()} ffmpeg -i "${tempPath}" -c:v copy -c:a flac "${audioWritePath}"`, {
    cancelSignal,
    shell: true,
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
  const subprocess = await runCommand(`ffprobe -i "${file}" -show_entries format=duration -v quiet -of csv="p=0"`, {
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
  const childProcess = runCommand(commands.join(' | '), { cancelSignal, buffer: false, shell: true, timeout: DEF_TIMEOUT, cwd: ROOT_DIR });

  childProcess.stdout!.resume();
  childProcess.stderr!.resume();

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

  const directOutput = encodeCommand.includes('$OUTPUT');
  const childProcess = runCommand(commands.join(' | '), {
    cancelSignal,
    buffer: false,
    shell: true,
    timeout: DEF_TIMEOUT,
    cwd: ROOT_DIR,
    env: directOutput ? { OUTPUT: audioWritePath } : undefined,
    stdout: directOutput ? 'ignore' : { file: audioWritePath }
  });

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

    await childProcess.catch(() => {});
  } finally {
    childProcess.stderr.removeAllListeners('data');
  }
}

interface RecordingWriteOptions extends CommonProcessOptions {
  writeStream: WriteStream;
  id: string;
  info: RecordingInfo;
  users: RecordingUser[];
}

export async function recordingWrite({ recFileBase, cancelSignal, writeStream, id, info, users }: RecordingWriteOptions) {
  // Transform the recording info to append before anything
  const writtenInfo = {
    format: info.format,
    id,
    clientId: info.clientId,
    guild: info.guild,
    guildExtra: info.guildExtra,
    channel: info.channel,
    channelExtra: info.channelExtra,
    requester: info.requester,
    requesterExtra: info.requesterExtra,
    requesterId: info.requesterId,
    startTime: info.startTime,
    expiresAfter: info.expiresAfter,
    autorecorded: info.autorecorded,
    tracks: users.reduce(
      (p, u) => ({
        ...p,
        [u.track]: { id: u.id, username: u.username, discriminator: u.discriminator, globalName: u.globalName, bot: u.bot, unknown: u.unknown }
      }),
      {} as Record<string, any>
    )
  };
  writeStream.write(`${JSON.stringify(writtenInfo)}\n`);

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

  const childProcess = runCommand(commands.join(' | '), { cancelSignal, buffer: false, shell: true, timeout: DEF_TIMEOUT, cwd: ROOT_DIR });

  const durationNum = parseFloat(duration);

  childProcess.stdout!.resume();

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

    const success = await childProcess
      .then(() => true)
      .catch(() => {
        if (job) logger.warn(`Job ${job.id} (${job.recordingId}) failed to encode track ${track}`);
        return false;
      });
    return success;
  } finally {
    // Clean up event listeners and streams
    childProcess.stderr.removeAllListeners('data');
  }
}
