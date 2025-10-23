import fs from 'node:fs/promises';
import path from 'node:path';

import { TranscriptionFormatTypes } from '@craig/types/kitchen';
import { RecordingUser } from '@craig/types/recording';
import { nanoid } from 'nanoid';

import { DOWNLOAD_URL_PREFIX, DOWNLOADS_DIRECTORY, RUNPOD_API_KEY, RUNPOD_TRANSCRIPTION_ENDPOINT_ID } from '../../util/config.js';
import { fileNameFromUser, runParallelFunction, wait } from '../../util/index.js';
import logger from '../../util/logger.js';
import { encodeTranscriptionTrack, getStreamTypes } from '../../util/process.js';
import { getRecordingUsers } from '../../util/recording.js';
import { Job } from '../job.js';

interface RunpodQueuedResponse {
  id: string;
  status: 'IN_QUEUE';
}

interface RunpodProcessingResponse {
  delayTime: number;
  id: string;
  status: 'IN_PROGRESS';
  workerId: string;
}

interface RunpodErrorResponse {
  delayTime: number;
  error: string;
  executionTime: number;
  id: string;
  status: 'FAILED';
  workerId: string;
}

interface RunpodCompleteResponse {
  delayTime: number;
  id: string;
  status: 'COMPLETED';
  workerId: string;
  output: TranscriptionCorrectorResult;
}
interface RunpodTimedOutResponse {
  id: string;
  status: 'TIMED_OUT';
}

interface TranscriptionResult {
  detected_language: string;
  device: string;
  model: string;
  segments: {
    end: number;
    id: number;
    seek: number;
    start: number;
    text: string;
    words: {
      end: number;
      start: number;
      word: string;
    }[];
  }[];
  transcription: string;
  translation: null;
}

interface CorrectedSegment {
  track: number;
  start: number;
  end: number;
  text: string;
  words: {
    track: number;
    word: string;
    start: number;
    end: number;
  }[];
}

interface TranscriptionCorrectorResult {
  corrected_segments: CorrectedSegment[];
  change_count: number;
  results: TranscriptionResult[];
}

type RunpodResponse = RunpodQueuedResponse | RunpodProcessingResponse | RunpodErrorResponse | RunpodCompleteResponse | RunpodTimedOutResponse;

function makeTranscriptionFile(format: 'txt' | 'srt' | 'vtt', segments: CorrectedSegment[], names: string[]): string {
  const allSegments = segments.map((s) => ({ ...s, speaker: names[s.track] || `User ${s.track + 1}` }));

  // Sort by start time
  allSegments.sort((a, b) => a.start - b.start);

  // Format time to VTT
  function formatTime(t: number): string {
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    const time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
    return format === 'srt' ? time.replace('.', ',') : time;
  }

  let text = format === 'vtt' ? `WEBVTT\n\nNOTE Created with craig.chat\n\n` : '';

  // Write each segment as a cue
  allSegments.forEach((seg, i) => {
    if (format === 'vtt' || format === 'srt') {
      text += `${i + 1}\n`;
      text += `${formatTime(seg.start)} --> ${formatTime(seg.end)}\n`;
    }

    if (format === 'vtt')
      text += `<v ${seg.speaker.replace(/>/g, '_')}>${seg.words.map((w) => {
        const leadingSpace = w.word[0] === ' ';
        return `${leadingSpace ? ' ' : ''}<${formatTime(w.start)}><c>${w.word.slice(leadingSpace ? 1 : 0)}</c>`;
      }).join('')}</v>\n\n`;
    else text += `${seg.speaker}: ${seg.text.trim()}\n\n`;
  });

  return text.trim();
}

export async function processTranscriptionJob(job: Job) {
  if (!RUNPOD_API_KEY || !RUNPOD_TRANSCRIPTION_ENDPOINT_ID || !DOWNLOAD_URL_PREFIX) throw new Error('Missing environment variables.');

  const { recFileBase, tmpDir } = job;
  const cancelSignal = job.abortController.signal;

  const users = await getRecordingUsers(recFileBase);
  const streamTypes = await getStreamTypes({ recFileBase, cancelSignal });
  const writtenTracks: [number, string][] = [];

  async function createTrack(i: number) {
    const user = users[i];
    const track = i + 1;
    const fileName = `${nanoid(40)}-${fileNameFromUser(track, user)}.opus`;
    if (job.options?.ignoreTracks?.includes(track)) return;

    job.setState({
      type: job.state.type,
      tracks: {
        ...(job.state.tracks || {}),
        [track]: { progress: 0, processing: true }
      }
    });
    const audioWritePath = path.join(tmpDir, fileName);
    writtenTracks.push([i, fileName]);
    const success = await encodeTranscriptionTrack({
      recFileBase,
      cancelSignal,
      track,
      job,
      codec: streamTypes[i],
      audioWritePath
    });

    job.setState({
      type: 'encoding',
      tracks: {
        ...(job.state.tracks || {}),
        [track]: { progress: 100, warn: !success }
      }
    });
  }

  await runParallelFunction({
    parallel: job.options?.parallel,
    concurrency: job.options?.concurrency,
    userCount: users.length,
    cancelSignal,
    fn: createTrack
  });

  if (cancelSignal.aborted) throw new Error('Job aborted');
  // Move files to download so runpod can get them
  await Promise.all(
    writtenTracks.map(([, fileName]) => {
      const fromPath = path.join(tmpDir, fileName);
      const toPath = path.join(DOWNLOADS_DIRECTORY, fileName);
      if (cancelSignal.aborted) throw new Error('Job aborted');
      job.extraFiles.push(toPath);
      return fs.rename(fromPath, toPath);
    })
  );

  const runpodResponse = await runRunpodRequest(
    job,
    writtenTracks.map(([, fileName]) => fileName)
  );

  await fs.writeFile(
    job.outputFile,
    makeTranscriptionFile(
      (job.options?.format as TranscriptionFormatTypes) || 'vtt',
      runpodResponse.output.corrected_segments,
      writtenTracks.map(([i]) => users[i].globalName || users[i].username)
    )
  );
}

async function runRunpodRequest(job: Job, fileNames: string[]) {
  let lastError;
  for (let i = 0; i < 5; i++) {
    try {
      const response = await _runRunpodRequest(job, fileNames);
      return response;
    } catch (e) {
      if ((e as Error).message.includes('CUDA failed with error CUDA-capable device(s) is/are busy or unavailable')) {
        logger.warn(`CUDA failed to start for job ${job.id} (${job.recordingId}), retrying [${i + 1}]...`);
        lastError = e;
      } else throw e;
    }
  }
  throw lastError;
}

async function _runRunpodRequest(job: Job, fileNames: string[]) {
  const response = await fetch(`https://api.runpod.ai/v2/${RUNPOD_TRANSCRIPTION_ENDPOINT_ID}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: RUNPOD_API_KEY!
    },
    body: JSON.stringify({
      input: {
        audios: fileNames.map((fileName) => `${DOWNLOAD_URL_PREFIX}${fileName}`),
        model: 'turbo',
        transcription: 'none',
        word_timestamps: true,
        enable_vad: true,
        transcription_corrector: true
      }
    })
  });

  if (!response.ok) throw new Error(`Runpod responded with a ${response.status}`);

  let runpodResponse: RunpodResponse = await response.json();
  job.outputData.transcriptionRequestId = runpodResponse.id;
  logger.info(`Job ${job.id} started runpod request ${runpodResponse.id}`);

  while (runpodResponse.status !== 'COMPLETED' && runpodResponse.status !== 'FAILED' && runpodResponse.status !== 'TIMED_OUT') {
    job.setState({
      type: 'transcribing',
      runpodStatus: runpodResponse.status
    });

    await wait(3000);
    if (job.abortController.signal.aborted) throw new Error('Job aborted');

    const response = await fetch(`https://api.runpod.ai/v2/${RUNPOD_TRANSCRIPTION_ENDPOINT_ID}/status/${runpodResponse.id}`, {
      headers: { Authorization: RUNPOD_API_KEY! }
    });
    if (!response.ok) throw new Error(`Runpod responded with a ${response.status}`);
    runpodResponse = await response.json();
  }

  if (runpodResponse.status === 'FAILED') throw new Error(`Runpod transcription failed (${runpodResponse.id}): ${runpodResponse.error}`);
  if (runpodResponse.status === 'TIMED_OUT') throw new Error(`Runpod transcription timed out (${runpodResponse.id})`);

  return runpodResponse;
}

export async function backgroundTranscription(job: Job, writtenTracks: [number, string][], users: RecordingUser[]) {
  if (!RUNPOD_API_KEY || !RUNPOD_TRANSCRIPTION_ENDPOINT_ID || !DOWNLOAD_URL_PREFIX) throw new Error('Missing environment variables.');

  const cancelSignal = job.abortController.signal;
  const outputFileNames: [number, string][] = [];

  // Copy files to download so runpod can get them
  await Promise.all(
    writtenTracks.map(([track, filePath]) => {
      const fileName = path.basename(filePath);
      const toPath = path.join(DOWNLOADS_DIRECTORY, `${nanoid(40)}-${fileName}`);
      if (cancelSignal.aborted) throw new Error('Job aborted');
      job.extraFiles.push(toPath);
      outputFileNames.push([track, path.basename(toPath)]);
      return fs.copyFile(filePath, toPath);
    })
  );

  const runpodResponse = await runRunpodRequest(
    job,
    outputFileNames.map(([, fileName]) => fileName)
  );

  return makeTranscriptionFile(
    job.options?.includeTranscription || 'vtt',
    runpodResponse.output.corrected_segments,
    writtenTracks.map(([i]) => users[i - 1].globalName || users[i - 1].username)
  );
}
