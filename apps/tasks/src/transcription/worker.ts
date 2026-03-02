import { TranscriptStatus } from '@prisma/client';
import config from 'config';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { createLogger } from '../logger';
import { prisma } from '../prisma';
import { client as redisClient } from '../redis';
import { OpenAIWhisperProvider } from './openaiWhisperProvider';
import { TranscriptionProvider } from './provider';

interface TranscriptConfig {
  enabled: boolean;
  queueKey: string;
  lockTtlS: number;
  popTimeoutS: number;
  model: string;
  maxDurationSec: number;
  maxFileMb: number;
  previewChars: number;
  workerConcurrency: number;
}

const defaultConfig: TranscriptConfig = {
  enabled: true,
  queueKey: 'transcript:queue',
  lockTtlS: 14400,
  popTimeoutS: 5,
  model: 'whisper-1',
  maxDurationSec: 7200,
  maxFileMb: 24,
  previewChars: 1200,
  workerConcurrency: 1
};

const transcriptConfig = {
  ...defaultConfig,
  ...(config.has('transcript') ? (config.get('transcript') as Partial<TranscriptConfig>) : {})
};

if (process.env.OPENAI_TRANSCRIPTION_MODEL) transcriptConfig.model = process.env.OPENAI_TRANSCRIPTION_MODEL;
if (process.env.TRANSCRIPT_ENABLED) transcriptConfig.enabled = process.env.TRANSCRIPT_ENABLED === 'true';
if (process.env.TRANSCRIPT_MAX_DURATION_SEC) transcriptConfig.maxDurationSec = Number(process.env.TRANSCRIPT_MAX_DURATION_SEC);
if (process.env.TRANSCRIPT_MAX_FILE_MB) transcriptConfig.maxFileMb = Number(process.env.TRANSCRIPT_MAX_FILE_MB);
if (process.env.TRANSCRIPT_PREVIEW_CHARS) transcriptConfig.previewChars = Number(process.env.TRANSCRIPT_PREVIEW_CHARS);
if (process.env.TRANSCRIPT_WORKER_CONCURRENCY) transcriptConfig.workerConcurrency = Number(process.env.TRANSCRIPT_WORKER_CONCURRENCY);
if (!Number.isFinite(transcriptConfig.maxDurationSec) || transcriptConfig.maxDurationSec <= 0) transcriptConfig.maxDurationSec = defaultConfig.maxDurationSec;
if (!Number.isFinite(transcriptConfig.maxFileMb) || transcriptConfig.maxFileMb <= 0) transcriptConfig.maxFileMb = defaultConfig.maxFileMb;
if (!Number.isFinite(transcriptConfig.previewChars) || transcriptConfig.previewChars <= 0) transcriptConfig.previewChars = defaultConfig.previewChars;
if (!Number.isFinite(transcriptConfig.workerConcurrency) || transcriptConfig.workerConcurrency <= 0)
  transcriptConfig.workerConcurrency = defaultConfig.workerConcurrency;

const logger = createLogger('transcript');
const recPath = config.has('recording.path')
  ? path.join(__dirname, '..', '..', config.get<string>('recording.path'))
  : path.join(__dirname, '..', '..', '..', '..', 'rec');
const cookPath = config.has('cookPath')
  ? path.join(__dirname, '..', '..', config.get<string>('cookPath'))
  : path.join(__dirname, '..', '..', '..', '..', 'cook');

const lockPrefix = 'transcript:lock:';

let workerStarted = false;

export function startTranscriptWorker() {
  if (workerStarted) return;
  workerStarted = true;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!transcriptConfig.enabled) {
    logger.info('Transcript worker disabled.');
    return;
  }
  if (!apiKey) {
    logger.warn('Transcript worker disabled: OPENAI_API_KEY not set.');
    return;
  }

  const provider = new OpenAIWhisperProvider(apiKey);
  logger.info(
    'Transcript worker started. queue=%s model=%s maxDuration=%ds maxFile=%dMB concurrency=%d',
    transcriptConfig.queueKey,
    transcriptConfig.model,
    transcriptConfig.maxDurationSec,
    transcriptConfig.maxFileMb,
    transcriptConfig.workerConcurrency
  );
  const concurrency = Math.max(1, transcriptConfig.workerConcurrency);
  for (let i = 0; i < concurrency; i++) {
    void runWorkerLoop(provider);
  }
}

async function runWorkerLoop(provider: TranscriptionProvider) {
  for (;;) {
    try {
      const queueItem = await redisClient.blpop(transcriptConfig.queueKey, transcriptConfig.popTimeoutS);
      if (!queueItem) continue;
      const recordingId = queueItem[1];
      await processQueuedRecording(recordingId, provider);
    } catch (err) {
      logger.error('Transcript worker loop error', err);
    }
  }
}

async function processQueuedRecording(recordingId: string, provider: TranscriptionProvider) {
  const lockKey = `${lockPrefix}${recordingId}`;
  const lockToken = randomUUID();
  const hasLock = await redisClient.set(lockKey, lockToken, 'EX', transcriptConfig.lockTtlS, 'NX');
  if (!hasLock) return;

  let tempAudioPath: string | null = null;
  const start = Date.now();
  try {
    await ensureTranscriptRow(recordingId);
    const transcript = await prisma.recordingTranscript.findUnique({ where: { recordingId } });
    if (!transcript) return;
    if (transcript.status === TranscriptStatus.COMPLETE || transcript.status === TranscriptStatus.SKIPPED) return;

    const sourceExists = await hasSourceRecording(recordingId);
    if (!sourceExists) {
      await markSkipped(recordingId, 'SOURCE_MISSING', 'Recording source files are unavailable.');
      return;
    }

    const durationSec = await getDurationSec(recordingId);
    if (durationSec > transcriptConfig.maxDurationSec) {
      await markSkipped(
        recordingId,
        'DURATION_LIMIT',
        `Recording duration (${durationSec}s) exceeds limit (${transcriptConfig.maxDurationSec}s).`,
        durationSec
      );
      return;
    }

    await prisma.recordingTranscript.update({
      where: { recordingId },
      data: {
        status: TranscriptStatus.PROCESSING,
        attempts: { increment: 1 },
        provider: 'openai',
        model: transcriptConfig.model,
        startedAt: new Date(),
        completedAt: null,
        errorCode: null,
        errorMessage: null
      }
    });

    tempAudioPath = path.join(tmpdir(), `craig-transcript-${recordingId}-${Date.now()}.flac`);
    await buildMixedAudioFile(recordingId, tempAudioPath);
    const stats = await fsp.stat(tempAudioPath);
    const maxBytes = transcriptConfig.maxFileMb * 1024 * 1024;
    if (stats.size > maxBytes) {
      await markSkipped(
        recordingId,
        'FILE_LIMIT',
        `Mixed audio size (${stats.size} bytes) exceeds limit (${maxBytes} bytes).`,
        durationSec,
        stats.size
      );
      return;
    }

    const text = await provider.transcribe(tempAudioPath, transcriptConfig.model);
    await prisma.recordingTranscript.update({
      where: { recordingId },
      data: {
        status: TranscriptStatus.COMPLETE,
        text,
        preview: text.slice(0, Math.max(1, transcriptConfig.previewChars)),
        durationSec,
        audioBytes: stats.size,
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null
      }
    });
    logger.info('Transcript complete for %s in %dms', recordingId, Date.now() - start);
  } catch (err) {
    const { code, message } = sanitizeError(err);
    await prisma.recordingTranscript
      .update({
        where: { recordingId },
        data: {
          status: TranscriptStatus.ERROR,
          errorCode: code,
          errorMessage: message,
          completedAt: new Date()
        }
      })
      .catch(() => {});
    logger.error(`Transcript failed for ${recordingId} (${code})`, err);
  } finally {
    if (tempAudioPath) await fsp.unlink(tempAudioPath).catch(() => {});
    const token = await redisClient.get(lockKey);
    if (token === lockToken) await redisClient.del(lockKey);
  }
}

async function ensureTranscriptRow(recordingId: string) {
  await prisma.recordingTranscript.upsert({
    where: { recordingId },
    update: {},
    create: {
      recordingId
    }
  });
}

async function hasSourceRecording(recordingId: string) {
  const dataFile = path.join(recPath, `${recordingId}.ogg.data`);
  const infoFile = path.join(recPath, `${recordingId}.ogg.info`);
  return (await fileExists(dataFile)) && (await fileExists(infoFile));
}

async function fileExists(filePath: string) {
  try {
    await fsp.access(filePath);
    return true;
  } catch (err) {
    return false;
  }
}

async function getDurationSec(recordingId: string) {
  const durationPath = path.join(cookPath, 'duration.sh');
  const result = await spawnWithOutput(durationPath, [recordingId]);
  if (result.code !== 0) throw new Error(`duration_failed:${result.stderr.slice(0, 200)}`);
  const parsed = Math.ceil(Number.parseFloat(result.stdout.trim()));
  if (!Number.isFinite(parsed)) throw new Error(`duration_invalid:${result.stdout.trim().slice(0, 120)}`);
  return parsed;
}

async function buildMixedAudioFile(recordingId: string, outputPath: string) {
  const cookingPath = path.join(cookPath, '..', 'cook.sh');
  const child = spawn(cookingPath, [recordingId, 'flac', 'mix'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const writer = fs.createWriteStream(outputPath, { flags: 'w' });
  let stderr = '';

  child.stderr.on('data', (buf: Buffer) => {
    stderr += buf.toString();
  });

  await pipeline(child.stdout, writer);
  const code = await new Promise<number>((resolve) => child.once('close', (exitCode) => resolve(exitCode ?? 0)));
  if (code !== 0) throw new Error(`cook_failed:${stderr.slice(0, 300)}`);
}

async function markSkipped(recordingId: string, errorCode: string, errorMessage: string, durationSec?: number, audioBytes?: number) {
  await prisma.recordingTranscript.update({
    where: { recordingId },
    data: {
      status: TranscriptStatus.SKIPPED,
      errorCode,
      errorMessage: errorMessage.slice(0, 500),
      durationSec,
      audioBytes,
      completedAt: new Date()
    }
  });
  logger.warn('Transcript skipped for %s (%s)', recordingId, errorCode);
}

function sanitizeError(err: unknown) {
  const fallback = { code: 'TRANSCRIPT_ERROR', message: 'Transcript generation failed.' };
  if (err instanceof Error) {
    const raw = err.message || fallback.message;
    const [codePart, messagePart] = raw.split(':', 2);
    const code = codePart ? codePart.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 64) : fallback.code;
    const message = (messagePart || raw).slice(0, 500);
    return { code: code || fallback.code, message: message || fallback.message };
  }
  return fallback;
}

async function spawnWithOutput(cmd: string, args: string[]) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (buf: Buffer) => {
    stdout += buf.toString();
  });
  child.stderr.on('data', (buf: Buffer) => {
    stderr += buf.toString();
  });

  const code = await new Promise<number>((resolve) => child.once('close', (exitCode) => resolve(exitCode ?? 0)));
  return { code, stdout, stderr };
}
