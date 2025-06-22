import * as fs from 'node:fs/promises';
import { join } from 'node:path';

import type { Kitchen, Recording } from '@craig/types';
import type { RecordingInfo, RecordingNote, RecordingUser } from '@craig/types/recording';
import { json } from '@sveltejs/kit';
import clone from 'just-clone';

import { APIErrorCode, type MinimalJobInfo, type MinimalJobUpdate, type MinimalRecordingInfo } from '$lib/types';

import { debug, KITCHEN_URL, REC_DIRECTORY } from './config';
import { logger } from './logger';

export function kitchenUrl(p: string) {
  return new URL(p, KITCHEN_URL);
}

type RequestInitExtra = RequestInit & { query?: Record<string, string> };

export async function kitchenFetch(path: string, initOpts?: RequestInitExtra) {
  const url = kitchenUrl(path);
  const init = initOpts ? clone(initOpts) : undefined;
  if (init?.query) {
    const query = init.query;
    delete init.query;
    for (const key in query) url.searchParams.append(key, query[key]);
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {})
    },
    ...(init ?? {})
  });

  if (debug) logger.debug(`requested kitchen ${url.toString()} - recieved ${response.status}`);

  return response;
}

export async function pathExists(path: string) {
  try {
    await fs.access(path);
    return true;
  } catch (e) {
    return false;
  }
}

export async function getStatIfExists(path: string) {
  try {
    const stat = await fs.stat(path);
    return stat.isFile() ? stat : null;
  } catch (e) {
    return null;
  }
}

export async function recordingExists(recordingId: string) {
  const recFileBase = join(REC_DIRECTORY, `${recordingId}.ogg`);
  const [infoExists, usersExists, dataStats] = await Promise.all([
    pathExists(`${recFileBase}.info`),
    pathExists(`${recFileBase}.users`),
    getStatIfExists(`${recFileBase}.data`)
  ]);

  return { available: infoExists && usersExists, dataExists: !!dataStats, dataStats };
}

export async function getRecordingInfo(recordingId: string) {
  const recFileBase = join(REC_DIRECTORY, `${recordingId}.ogg`);
  const [info, users] = await Promise.all([
    (async () => {
      const data = await fs.readFile(`${recFileBase}.info`, { encoding: 'utf8' });
      return JSON.parse(data) as Recording.RecordingInfo;
    })(),
    (async () => {
      const data = await fs.readFile(`${recFileBase}.users`, { encoding: 'utf8' });
      const userRecord = JSON.parse(`{${data}}`) as Record<number, Recording.RecordingUser>;
      return Object.entries(userRecord)
        .map(([i, user]) => ({ ...user, track: parseInt(i) }))
        .filter((u) => u.track !== 0);
    })()
  ]);

  const cleanInfo: MinimalRecordingInfo = {
    id: recordingId,
    autorecorded: info.autorecorded,
    startTime: info.startTime,
    expiresAfter: info.expiresAfter,
    guild: info.guildExtra,
    channel: info.channelExtra,
    client: {
      id: info.clientId
    },
    requester: {
      id: info.requesterId,
      ...info.requesterExtra
    },
    features: (Object.keys(info.features) as (keyof Recording.RecordingInfoV1['features'])[]).filter((f) => info.features[f])
  };

  return { info, users, cleanInfo };
}

export async function validateKey(recordingId: string, key: string) {
  const recFileBase = join(REC_DIRECTORY, `${recordingId}.ogg`);

  const data = await fs.readFile(`${recFileBase}.info`, { encoding: 'utf8' });
  const info = JSON.parse(data) as Recording.RecordingInfo;

  return info.key === key;
}

export async function deleteRecording(recordingId: string) {
  logger.info(`Manually deleting recording ${recordingId}`);
  const recFileBase = join(REC_DIRECTORY, `${recordingId}.ogg`);
  await Promise.all(['data', 'header1', 'header2'].map((ext) => fs.unlink(`${recFileBase}.${ext}`)));
}

export function errorResponse(code?: APIErrorCode, init?: ResponseInit, extra?: object) {
  function result(msg: string) {
    return json({ error: msg, code: code ?? APIErrorCode.UNKNOWN_ERROR, ...extra }, init);
  }

  switch (code) {
    case APIErrorCode.SERVER_ERROR:
      return result('Server error');
    case APIErrorCode.INVALID_BODY:
      return result('Invalid body');
    case APIErrorCode.KEY_REQUIRED:
      return result('Key required');
    case APIErrorCode.INVALID_RECORDING:
      return result('Invalid recording ID');
    case APIErrorCode.RECORDING_NOT_FOUND:
      return result('Recording not found');
    case APIErrorCode.INVALID_KEY:
      return result('Invalid key');
    case APIErrorCode.RECORDING_NO_DATA:
      return result('Recording has no data');
    case APIErrorCode.KITCHEN_UNAVAILABLE:
      return result('Kitchen server unavailable');
    case APIErrorCode.JOB_ALREADY_EXISTS:
      return result('A job already exists for this recording');
    case APIErrorCode.JOB_NOT_FOUND:
      return result('A job does not exist for this recording');
    case APIErrorCode.INVALID_FORMAT:
      return result('Invalid format');
    case APIErrorCode.FEATURE_UNAVAILABLE:
      return result('This feature is unavailable to this recording');
    case APIErrorCode.INVALID_DELETE_KEY:
      return result('Invalid delete key');
  }

  return result('Unknown Error');
}

export async function getJob(jobId: string) {
  try {
    const response = await kitchenFetch(`/jobs/${jobId}`);
    if (response.status === 404) return null;
    else if (response.status !== 200) return false;

    const job: Kitchen.JobJSON = await response.json();
    return job;
  } catch (e) {
    logger.error(`Could not contact kitchen for fetching job ${jobId}`, e);
    return false;
  }
}

export async function getLatestJob(recordingId: string) {
  try {
    const response = await kitchenFetch(`/recordings/${recordingId}`);
    if (response.status !== 200) return false;

    const { jobs }: Kitchen.KitchenJobsResponse = await response.json();

    const job = jobs.find((j) => j.from === 'download-page');
    return job ?? null;
  } catch (e) {
    logger.error(`Could not contact kitchen for fetching job recording ${recordingId}`, e);
    return false;
  }
}

export async function getRecordingDuration(recordingId: string) {
  try {
    const response = await kitchenFetch(`/recordings/${recordingId}/duration`);
    if (response.status !== 200) return false;

    const { duration }: { duration: number } = await response.json();
    return duration;
  } catch (e) {
    logger.error(`Could not contact kitchen for fetching recording duration ${recordingId}`, e);
    return false;
  }
}

export async function getRecordingNotes(recordingId: string) {
  try {
    const response = await kitchenFetch(`/recordings/${recordingId}/notes`);
    if (response.status !== 200) return false;

    const { notes }: { notes: RecordingNote[] } = await response.json();
    return notes;
  } catch (e) {
    logger.error(`Could not contact kitchen for fetching recording notes ${recordingId}`, e);
    return false;
  }
}

export async function cancelJob(jobId: string) {
  try {
    const response = await kitchenFetch(`/jobs/${jobId}`, { method: 'DELETE' });
    if (response.status !== 200) return false;

    const job: Kitchen.JobJSON = await response.json();
    return job;
  } catch (e) {
    logger.error(`Could not contact kitchen for cancelling job ${jobId}`, e);
    return false;
  }
}

export async function createJob(jobOptions: Kitchen.CreateJobOptions) {
  try {
    const options = { from: 'download-page', ...jobOptions };
    const response = await kitchenFetch('/jobs', {
      method: 'POST',
      body: JSON.stringify(options),
      headers: { 'Content-Type': 'application/json' }
    });
    if (response.status !== 200) return false;

    const job: Kitchen.JobJSON = await response.json();
    return job;
  } catch (e) {
    logger.error(`Could not contact kitchen for creating job recording ${jobOptions.id}`, e);
    return false;
  }
}

export function minimizeJobInfo(job: Kitchen.JobJSON): MinimalJobInfo {
  return {
    id: job.id,
    type: job.type,
    options: {
      format: job.options?.format,
      container: job.options?.container,
      dynaudnorm: job.options?.dynaudnorm,
      parallel: job.options?.parallel,
      ignoredTracks: job.options?.ignoreTracks
    },
    status: job.status,
    state: job.state,
    continued: job.continued,
    startedIn: job.createdAt,
    outputData: job.outputData,
    outputFileName: job.outputFileName,
    outputSize: job.outputSize,
    finishedAt: job.finishedAt
  };
}

export function minimizeJobUpdate(update: Kitchen.JobUpdate): MinimalJobUpdate {
  return {
    started: update.started,
    now: update.now,
    status: update.status,
    state: update.state,
    outputData: update.outputData,
    outputFileName: update.outputFileName,
    outputSize: update.outputSize,
    finishedAt: update.finishedAt
  };
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

export function getInfoText(id: string, info: RecordingInfo, users: RecordingUser[], notes?: RecordingNote[]) {
  let txt =
    'Recording ' +
    id +
    '\r\n' +
    '\r\n' +
    'Guild:\t\t' +
    (info.guildExtra ? `${info.guildExtra.name} (${info.guildExtra.id})` : info.guild) +
    '\r\n' +
    'Channel:\t' +
    (info.channelExtra ? `${info.channelExtra.name} (${info.channelExtra.id})` : info.channel) +
    '\r\n' +
    'Requester:\t' +
    (info.requesterExtra ? `${info.requesterExtra.username}#${info.requesterExtra.discriminator} (${info.requesterId})` : info.requester) +
    '\r\n' +
    'Start time:\t' +
    info.startTime +
    '\r\n' +
    '\r\n' +
    'Tracks:\r\n';

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    txt += `\t${user.username}#${user.discriminator} (${user.id})\r\n`;
  }

  if (notes && notes.length) {
    txt += '\r\nNotes:\r\n';
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      txt += `\t${convertToTimeMark(parseFloat(note.time), true)}: ${note.note}\r\n`;
    }
  }

  return txt;
}
