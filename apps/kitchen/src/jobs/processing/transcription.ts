import fs from 'node:fs/promises';
import path from 'node:path';

import { TranscriptionFormatTypes } from '@craig/types/kitchen';
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
  output: TranscriptionResult | TranscriptionResult[];
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

type RunpodResponse = RunpodQueuedResponse | RunpodProcessingResponse | RunpodErrorResponse | RunpodCompleteResponse;

function makeTranscriptionFile(format: 'txt' | 'srt' | 'vtt', transcriptions: TranscriptionResult[], names: string[]): string {
  const allSegments: {
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
    speaker: string;
  }[] = [];

  transcriptions.forEach((track: any, i: number) => {
    const speaker = names[i] || `User ${i + 1}`;
    track.segments.forEach((seg: any) => {
      allSegments.push({
        ...seg,
        speaker
      });
    });
  });

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
      text += `<v ${seg.speaker.replace(/>/g, '_')}>${seg.words.map((w) => `<${formatTime(w.start)}><c>${w.word.trim()}</c>`).join(' ')}</v>\n\n`;
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

  const response = await fetch(`https://api.runpod.ai/v2/${RUNPOD_TRANSCRIPTION_ENDPOINT_ID}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: RUNPOD_API_KEY
    },
    body: JSON.stringify({
      input: {
        audios: writtenTracks.map(([, fileName]) => `${DOWNLOAD_URL_PREFIX}${fileName}`),
        model: 'turbo',
        transcription: 'none',
        word_timestamps: true,
        enable_vad: true
      }
    })
  });

  if (!response.ok) throw new Error(`Runpod responded with a ${response.status}`);

  let runpodResponse: RunpodResponse = await response.json();
  job.outputData.transcriptionRequestId = runpodResponse.id;
  logger.info(`Job ${job.id} started runpod request ${runpodResponse.id}`);

  while (runpodResponse.status !== 'COMPLETED' && runpodResponse.status !== 'FAILED') {
    job.setState({
      type: 'transcribing',
      runpodStatus: runpodResponse.status
    });

    await wait(3000);
    if (cancelSignal.aborted) throw new Error('Job aborted');

    const response = await fetch(`https://api.runpod.ai/v2/${RUNPOD_TRANSCRIPTION_ENDPOINT_ID}/status/${runpodResponse.id}`, {
      headers: { Authorization: RUNPOD_API_KEY }
    });
    if (!response.ok) throw new Error(`Runpod responded with a ${response.status}`);
    runpodResponse = await response.json();
  }

  if (runpodResponse.status === 'FAILED') throw new Error(`Runpod transcription failed (${runpodResponse.id}): ${runpodResponse.error}`);

  await fs.writeFile(
    job.outputFile,
    makeTranscriptionFile(
      (job.options?.format as TranscriptionFormatTypes) || 'vtt',
      Array.isArray(runpodResponse.output) ? runpodResponse.output : [runpodResponse.output],
      writtenTracks.map(([i]) => users[i].globalName || users[i].username)
    )
  );
}
