import { createReadStream, WriteStream } from 'node:fs';
import { readFile, rename, rm, stat } from 'node:fs/promises';
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
}

export async function getDuration({ recFileBase, cancelSignal }: DurationOptions) {
  const { stdout } = await runCommand(`${procOpts()} ./cook/tailduration ${recFileBase}.data`, {
    cancelSignal,
    cwd: ROOT_DIR,
    timeout: 10 * 1000
  });
  return stdout;
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

function getTimemark(chunk: string): [string, number] | null {
  const lines = chunk.split(/[\r\n]+/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const timemark = getLineTimemark(lines[i]);
    if (timemark) return timemark;
  }
  return null;
}

function getLineTimemark(line: string): [string, number] | null {
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

interface SplitTracksOptions extends CommonProcessOptions {
  outPrefix: string;
  tracks: number[];
  job?: Job;
}

export interface SplitTrack {
  file: string;
  duration: string;
  size: number;
}

export async function splitTracks({ recFileBase, cancelSignal, outPrefix, tracks, job }: SplitTracksOptions) {
  const result = new Map<number, SplitTrack>();
  if (!tracks.length) return result;
  const { stdout, stderr } = await runCommand(`${procOpts()} ./cook/oggsplit ${recFileBase} ${outPrefix} ${tracks.join(' ')}`, {
    cancelSignal,
    cwd: ROOT_DIR,
    timeout: DEF_TIMEOUT
  });
  if (stderr && job) logger.warn(`Job ${job.id} (${job.recordingId}): ${stderr}`);
  for (const line of stdout.split('\n')) {
    const [track, duration] = line.split(' ');
    if (track && duration) result.set(parseInt(track, 10), { file: `${outPrefix}${track}.ogg`, duration, size: 0 });
  }
  const missing = tracks.filter((track) => !result.has(track));
  if (missing.length) throw new Error(`oggsplit did not write tracks ${missing.join(', ')}`);

  // Get sizes after split
  await Promise.all([...result.values()].map(async (split) => (split.size = (await stat(split.file)).size)));

  return result;
}

interface EncodeTrackOptions extends SplitTrack {
  cancelSignal: AbortSignal;
  track: number;
  audioWritePath: string;
  codec: StreamType;
  encodeCommand: string;
  dynaudnorm?: boolean;
  job?: Job;
}

export async function encodeTrack({
  file,
  duration,
  codec,
  track,
  cancelSignal,
  encodeCommand,
  audioWritePath,
  job,
  dynaudnorm
}: EncodeTrackOptions) {
  const pOpts = procOpts();
  const encodeOptions = { cancelSignal, track, encodeCommand, audioWritePath, job, duration };

  if (codec === 'opus') {
    const decodeCommands = dynaudnorm
      ? [
          `${pOpts} ./cook/oggdec ${file}`,
          `${pOpts} ffmpeg -f wav -i - -af anull,dynaudnorm -flags bitexact -f wav -`,
          `${pOpts} ./cook/wavduration ${duration}`
        ]
      : [`${pOpts} ./cook/oggdec -d ${duration} ${file}`];
    const result = await runTrackEncode({
      ...encodeOptions,
      commands: [...decodeCommands, `${pOpts} ${encodeCommand}`],
      checkCommand: 0
    });
    if (result === 'ok') return true;
    // Only a failed decode is worth retrying with ffmpeg; a failing encoder would fail the same way there
    if (result !== 'checkFailed' || cancelSignal.aborted) {
      if (job && !cancelSignal.aborted) logger.warn(`Job ${job.id} (${job.recordingId}) failed to encode track ${track}`);
      return false;
    }
    if (job) logger.warn(`Job ${job.id} (${job.recordingId}) failed to decode track ${track} with oggdec, retrying with ffmpeg`);
  }

  const ffmpegFilters = ['anull', ...(dynaudnorm ? ['dynaudnorm'] : [])].join(',');
  const result = await runTrackEncode({
    ...encodeOptions,
    commands: [
      `cat ${file}`,
      `${pOpts} ffmpeg -codec ${codec === 'opus' ? 'libopus' : codec} -copyts -i - -af ${ffmpegFilters} -flags bitexact -f wav -`,
      `${pOpts} ./cook/wavduration ${duration}`,
      `${pOpts} ${encodeCommand}`
    ]
  });
  if (result !== 'ok' && job) logger.warn(`Job ${job.id} (${job.recordingId}) failed to encode track ${track}`);
  return result === 'ok';
}

/** Exit status the pipeline uses when its checked command failed (see `checkCommand`) */
const CHECK_FAILED_EXIT = 222;

interface RunTrackEncodeOptions extends Omit<EncodeTrackOptions, 'file' | 'size' | 'codec' | 'dynaudnorm'> {
  commands: string[];
  /**
   * Index of a pipeline command whose exit status must also be 0. If it is not, the result is 'checkFailed' even when
   * the last command failed too, so the caller can tell a failed decode from a failed encode.
   */
  checkCommand?: number;
}

async function runTrackEncode({ cancelSignal, track, encodeCommand, audioWritePath, job, duration, commands, checkCommand }: RunTrackEncodeOptions) {
  const directOutput = encodeCommand.includes('$OUTPUT');
  const pipeline = commands.join(' | ');
  const childProcess = runCommand(
    checkCommand === undefined
      ? pipeline
      : `${pipeline}; s=("\${PIPESTATUS[@]}"); [ "\${s[${checkCommand}]}" = 0 ] || exit ${CHECK_FAILED_EXIT}; exit "\${s[-1]}"`,
    {
      cancelSignal,
      buffer: false,
      shell: checkCommand === undefined ? true : '/bin/bash',
      timeout: DEF_TIMEOUT,
      cwd: ROOT_DIR,
      env: directOutput ? { OUTPUT: audioWritePath } : undefined,
      stdout: directOutput ? 'ignore' : { file: audioWritePath }
    }
  );

  const durationNum = parseFloat(duration);
  const warnings: string[] = [];

  try {
    childProcess
      .stderr!.on('data', (b) => {
        const text = b.toString();
        if (text.includes('oggdec: warning')) warnings.push(...text.split('\n').filter((l: string) => l.startsWith('oggdec: warning')));
        const timemark = getTimemark(text);
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

    const result = await childProcess.then(
      () => 'ok' as const,
      (e) => (checkCommand !== undefined && e?.exitCode === CHECK_FAILED_EXIT ? ('checkFailed' as const) : ('failed' as const))
    );
    if (job) for (const warning of warnings) logger.warn(`Job ${job.id} (${job.recordingId}) track ${track}: ${warning}`);
    return result;
  } finally {
    // Clean up event listeners and streams
    childProcess.stderr.removeAllListeners('data');
  }
}

interface CreateAvatarVideoOptions {
  cancelSignal: AbortSignal;
  /** Corrected track file from `splitTracks` */
  file: string;
  codec: StreamType;
  extraArgs?: string;
  filter: string;
  duration: number;
  avatarPath: string;
  track: number;
  writePath: string;
  job?: Job;
}

export async function createAvatarVideo({
  file,
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

  const command = [
    `${procOpts()} ffmpeg -nostdin`,
    '-framerate 30 -i "./assets/glower-avatar.png"',
    '-framerate 30 -i "./assets/glower-glow.png"',
    `-codec ${ffmpegCodec} -copyts -i "${file}"`,
    `-framerate 30 -i "${avatarPath}"`,
    `-filter_complex "${filter}"`,
    "-map '[vid]'",
    '-filter_complex_threads 1',
    extraArgs || '',
    `-t "${duration}"`,
    `-y "${writePath}"`
  ].join(' ');

  const childProcess = runCommand(command, { cancelSignal, buffer: false, shell: true, timeout: DEF_TIMEOUT, cwd: ROOT_DIR });

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

interface EncodeTranscriptionTrackOptions extends Pick<SplitTrack, 'file' | 'duration'> {
  cancelSignal: AbortSignal;
  track: number;
  audioWritePath: string;
  codec: StreamType;
  job?: Job;
}

export async function encodeTranscriptionTrack({ file, duration, codec, track, cancelSignal, audioWritePath, job }: EncodeTranscriptionTrackOptions) {
  const pOpts = procOpts();
  const encodeArgs = '-f ogg -c:a libopus -ac 1 -ar 16000 -b:a 32k -application lowdelay';

  const commands =
    codec === 'opus'
      ? [`${pOpts} ./cook/oggdec ${file}`, `${pOpts} ffmpeg -nostdin -f wav -i - ${encodeArgs} -y "${audioWritePath}"`]
      : [`${pOpts} ffmpeg -nostdin -c:a ${codec} -i "${file}" ${encodeArgs} -y "${audioWritePath}"`];

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
