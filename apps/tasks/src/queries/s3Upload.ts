import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import config from 'config';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AxiosError } from 'axios';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createLogger } from '../logger';
import { prisma } from '../prisma';
import { clearReadyState, setReadyState } from '../redis';

const logger = createLogger('s3');

const recPath = config.has('recording.path')
  ? path.join(__dirname, '..', '..', config.get<string>('recording.path'))
  : path.join(__dirname, '..', '..', '..', '..', 'rec');
const cookPath = config.has('cookPath')
  ? path.join(__dirname, '..', '..', config.get<string>('cookPath'))
  : path.join(__dirname, '..', '..', '..', '..', 'cook');

const s3Config = config.get<{
  defaultBucket: string;
  defaultRegion: string;
}>('s3');

async function fileExists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch (err) {
    return false;
  }
}

function killProcessTree(p: ChildProcessWithoutNullStreams) {
  if (p.killed || !p.pid) return true;
  try {
    const result = process.kill(p.pid);
    return result;
  } catch (e) {
    if ((e as Error).message.startsWith('kill ESRCH')) return true;
    return false;
  }
}

async function cook(id: string, format = 'flac', container = 'zip', dynaudnorm = false) {
  if (!/^[a-zA-Z0-9]+$/.test(id) || !/^[a-z38]+$/.test(format) || !/^[a-z]+$/.test(container))
    throw new Error('An invalid argument was passed.');

  try {
    await setReadyState(id, { message: 'Uploading recording to S3...' });
    const cookingPath = path.join(cookPath, '..', 'cook.sh');
    const args = [id, format, container, ...(dynaudnorm ? ['dynaudnorm'] : [])];
    const child = spawn(cookingPath, args, { detached: true });
    logger.log(`Cooking ${id} (${format}.${container}${dynaudnorm ? ' dynaudnorm' : ''}) with process ${child.pid}`);

    // Prevent the stream from ending prematurely (for some reason)
    child.stderr.on('data', () => {});

    return child;
  } catch (e) {
    await clearReadyState(id);
    throw e;
  }
}

function getRecordingDescription(recordingId: string, info: any, joiner = '\n') {
  return [
    `Craig recording ${recordingId} via https://craig.chat/`,
    '',
    `${info.autorecorded ? 'Auto-recorded in behalf of' : 'Started by'}: ${info.requester} (${info.requesterId})`,
    `Server: ${info.guild} (${info.guildExtra.id})`,
    `Channel: ${info.channel} (${info.channelExtra.id})`
  ].join(joiner);
}

const FormatToMime: Record<string, string> = {
  flac: 'audio/flac',
  vorbis: 'audio/ogg',
  aac: 'audio/aac'
};

const FormatToExt: Record<string, string> = {
  flac: 'flac',
  vorbis: 'ogg',
  aac: 'aac'
};

export async function s3Upload({
  recordingId,
  userId
}: {
  recordingId: string;
  userId: string;
}): Promise<{ error: null | string; notify: boolean; id?: string; url?: string }> {
  const infoExists = await fileExists(path.join(recPath, `${recordingId}.ogg.info`));
  if (!infoExists) return { error: 'info_deleted', notify: false };
  const dataExists = await fileExists(path.join(recPath, `${recordingId}.ogg.data`));
  if (!dataExists) return { error: 'data_deleted', notify: false };
  const info = JSON.parse(await fs.readFile(path.join(recPath, `${recordingId}.ogg.info`), 'utf8'));
  const startDate = new Date(info.startTime);
  const fileName = `craig_${recordingId}_${startDate.getFullYear()}-${
    startDate.getMonth() + 1
  }-${startDate.getDate()}_${startDate.getHours()}-${startDate.getMinutes()}-${startDate.getSeconds()}`;

  // Upload is unconditional (global S3). Use user overrides when available, else defaults
  const user = await prisma.user.findFirst({ where: { id: userId } });
  const bucket = (user?.s3Bucket) || s3Config.defaultBucket;
  const region = (user?.s3Region) || process.env.AWS_REGION || s3Config.defaultRegion;
  const format = (user?.s3Format) || 'flac';
  const container = (user?.s3Container) || 'zip';

  if (!bucket) return { error: 'bucket_not_configured', notify: false };

  // Credentials: use per-user S3User if present; otherwise fall back to env AWS creds
  const s3User = await prisma.s3User.findFirst({ where: { id: userId } });

  logger.info(`Uploading ${recordingId} to S3 for ${userId} (bucket: ${bucket}, region: ${region}, ${format}.${container})`);
  const start = Date.now();

  let child: ChildProcessWithoutNullStreams | null = null;
  let tempFile: string | null = null;

  const mime =
    container === 'mix'
      ? FormatToMime[format] || 'audio/flac'
      : container === 'exe'
      ? 'application/vnd.microsoft.portable-executable'
      : 'application/zip';
  const ext = container === 'mix' ? FormatToExt[format] || 'flac' : container === 'exe' ? 'exe' : 'zip';

  try {
    // Create S3 client
    const s3Client = new S3Client({
      region,
      credentials: s3User
        ? { accessKeyId: s3User.accessKeyId, secretAccessKey: s3User.secretAccessKey }
        : (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
            ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
            : undefined)
    });

    child = await cook(recordingId, format, container);

    tempFile = path.join(tmpdir(), `${fileName}-${(Math.random() * 1000000).toString(36)}-upload.tmp`);
    
    // Write cooked recording to temp file
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    await new Promise<void>((resolve, reject) => {
      child!.stdout.on('end', async () => {
        try {
          await fs.writeFile(tempFile!, Buffer.concat(chunks));
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      child!.stdout.on('error', reject);
      child!.on('error', reject);
    });

    await clearReadyState(recordingId);
    killProcessTree(child);
    logger.info(`Finished cooking for ${recordingId}, took ${(Date.now() - start) / 1000}s`);

    // Upload to S3
    const fileSize = (await fs.stat(tempFile!)).size;
    const fileStream = createReadStream(tempFile!);

    const key = `recordings/${userId}/${fileName}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileStream,
      ContentType: mime,
      Metadata: {
        'craig-recording-id': recordingId,
        'craig-requester-id': info.requesterId,
        'craig-guild-id': info.guildExtra.id,
        'craig-channel-id': info.channelExtra.id,
        description: getRecordingDescription(recordingId, info, ' - ')
      }
    });

    await s3Client.send(command);

    await fs.unlink(tempFile!).catch(() => {});
    logger.info(`Uploaded ${recordingId} to S3`);

    // Generate a presigned URL for access (valid for 7 days)
    const getCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });
    const url = await getSignedUrl(s3Client, getCommand, { expiresIn: 604800 }); // 7 days

    // Update recording with S3 info
    await prisma.recording.update({
      where: { id: recordingId },
      data: {
        s3Uploaded: true,
        s3Url: url
      }
    });

    return {
      error: null,
      notify: true,
      id: key,
      url
    };
  } catch (e) {
    logger.error(`Error in uploading recording ${recordingId} for user ${userId}`);
    await clearReadyState(recordingId);
    if (child) killProcessTree(child);
    if (tempFile) await fs.unlink(tempFile).catch(() => {});
    
    let errorString = (e as any).toString().slice(0, 100) || 'unknown_error';
    if (errorString.startsWith('Error: <!DOCTYPE')) errorString = 'upload_timeout';
    return { error: errorString, notify: true };
  }
}

