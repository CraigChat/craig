import path from 'node:path';
import * as fs from 'node:fs/promises';
import { drive_v3, google } from 'googleapis';
import config from 'config';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { prisma } from '../prisma';
import { createLogger } from '../logger';
import { clearReadyState, setReadyState } from '../redis';

const driveConfig = config.get('drive') as {
  clientId: string;
  clientSecret: string;
};

const logger = createLogger('drive');

const recPath = path.join(__dirname, '..', '..', '..', '..', 'rec');
const cookPath = path.join(__dirname, '..', '..', '..', '..', 'cook');

async function fileExists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch (err) {
    return false;
  }
}

async function findCraigDirectory(drive: drive_v3.Drive) {
  const list = await drive.files.list({
    q: "name = 'Craig' and mimeType = 'application/vnd.google-apps.folder'"
  });

  if (list.data.files && list.data.files.length > 0) return list.data.files[0].id;

  const folder = await drive.files.create({
    requestBody: {
      name: 'Craig',
      mimeType: 'application/vnd.google-apps.folder'
    }
  });

  return folder.data.id;
}

async function cook(id: string, format = 'flac', container = 'zip', dynaudnorm = false) {
  try {
    await setReadyState(id, { message: 'Uploading recording to Google Drive...' });
    const cookingPath = path.join(cookPath, '..', 'cook.sh');
    const args = [id, format, container, ...(dynaudnorm ? ['dynaudnorm'] : [])];
    const child = spawn(cookingPath, args);
    logger.log(`Cooking ${id} (${format}.${container}${dynaudnorm ? ' dynaudnorm' : ''}) with process ${child.pid}`);

    // Prevent the stream from ending prematurely (for some reason)
    child.stderr.on('data', () => {});

    return child;
  } catch (e) {
    await clearReadyState(id);
    throw e;
  }
}

export async function driveUpload({
  recordingId,
  userId
}: {
  recordingId: string;
  userId: string;
}): Promise<{ error: null | string; notify: boolean; id?: string }> {
  const infoExists = await fileExists(path.join(recPath, `${recordingId}.ogg.info`));
  if (!infoExists) return { error: 'info_deleted', notify: false };
  const dataExists = await fileExists(path.join(recPath, `${recordingId}.ogg.data`));
  if (!dataExists) return { error: 'data_deleted', notify: false };
  const info = JSON.parse(await fs.readFile(path.join(recPath, `${recordingId}.ogg.info`), 'utf8'));

  const oAuth2Client = new google.auth.OAuth2(driveConfig.clientId, driveConfig.clientSecret);

  const user = await prisma.user.findFirst({ where: { id: userId } });
  if (!user) return { error: 'user_not_found', notify: false };
  if (user.rewardTier === 0) return { error: 'user_not_allowed', notify: false };

  const driveUser = await prisma.googleDriveUser.findFirst({ where: { id: userId } });
  if (!driveUser) return { error: 'drive_not_found', notify: false };
  if (!driveUser.enabled) return { error: 'not_enabled', notify: false };

  oAuth2Client.setCredentials({
    access_token: driveUser.token,
    refresh_token: driveUser.refreshToken
  });

  const drive = google.drive({ version: 'v3', auth: oAuth2Client });
  let child: ChildProcessWithoutNullStreams | null = null;

  try {
    const folderId = await findCraigDirectory(drive);
    if (!folderId) return { error: 'folder_not_found', notify: false };

    const format = driveUser.format || 'flac';
    const container = driveUser.container || 'zip';
    const mime = container === 'exe' ? 'application/vnd.microsoft.portable-executable' : 'application/zip';
    const ext = container === 'exe' ? 'exe' : 'zip';
    child = await cook(recordingId, format, container);

    const file = await drive.files.create({
      requestBody: {
        name: `craig-${recordingId}-${info.startTime}.${ext}`,
        mimeType: mime,
        parents: [folderId]
      },
      media: {
        mimeType: mime,
        body: child.stdout
      }
    });

    await clearReadyState(recordingId);
    child.kill();
    return {
      error: null,
      notify: true,
      id: file.data.id!
      // https://drive.google.com/open?id=${file.data.id}
    };
  } catch (e) {
    logger.error(`Error in uploading recording ${recordingId} for user ${userId}`, e);
    await clearReadyState(recordingId);
    child?.kill();
    return { error: (e as any).toString() || 'unknown_error', notify: true };
  }
}
