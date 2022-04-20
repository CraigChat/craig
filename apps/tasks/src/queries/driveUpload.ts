import axios from 'axios';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import config from 'config';
import { drive_v3, google } from 'googleapis';
import * as fs from 'node:fs/promises';
import path from 'node:path';

import { createLogger } from '../logger';
import { prisma } from '../prisma';
import { clearReadyState, setReadyState } from '../redis';

const driveConfig = config.get('drive') as {
  clientId: string;
  clientSecret: string;
};

const microsoftConfig = config.get('microsoft') as {
  clientId: string;
  clientSecret: string;
  redirect: string;
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

async function cook(id: string, format = 'flac', container = 'zip', dynaudnorm = false) {
  try {
    await setReadyState(id, { message: 'Uploading recording to cloud backup...' });
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

async function findCraigDirectoryInGoogleDrive(drive: drive_v3.Drive) {
  try {
    const list = await drive.files.list({
      q: "name = 'Craig' and mimeType = 'application/vnd.google-apps.folder'"
    });

    if (list.data.files && list.data.files.length > 0) return list.data.files[0].id;

    const folder = await drive.files.create({
      requestBody: {
        name: 'Craig',
        mimeType: 'application/vnd.google-apps.folder',
        folderColorRgb: '#00aaaa'
      }
    });

    return folder.data.id;
  } catch (e) {
    return null;
  }
}

async function getRefreshedMicrosoftAccessToken(accessToken: string, refreshToken: string, userId: string) {
  const me = await axios.get('https://graph.microsoft.com/v1.0/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    validateStatus: () => true
  });

  if (me.status === 200) return accessToken;

  const response = await axios.post(
    'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: microsoftConfig.clientId,
      client_secret: microsoftConfig.clientSecret,
      refresh_token: refreshToken,
      redirect_uri: microsoftConfig.redirect
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true
    }
  );

  if (response.status === 200) {
    const { access_token, refresh_token } = response.data;
    await prisma.microsoftUser.update({ where: { id: userId }, data: { token: access_token, refreshToken: refresh_token } });
    return access_token;
  }

  return null;
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

export async function driveUpload({
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

  const user = await prisma.user.findFirst({ where: { id: userId } });
  if (!user) return { error: 'user_not_found', notify: false };
  if (user.rewardTier === 0) return { error: 'user_not_allowed', notify: false };
  if (!user.driveEnabled) return { error: 'not_enabled', notify: false };

  let child: ChildProcessWithoutNullStreams | null = null;

  try {
    switch (user.driveService) {
      case 'google': {
        const oAuth2Client = new google.auth.OAuth2(driveConfig.clientId, driveConfig.clientSecret);
        const driveUser = await prisma.googleDriveUser.findFirst({ where: { id: userId } });
        if (!driveUser) return { error: 'data_not_found', notify: false };
        oAuth2Client.setCredentials({
          access_token: driveUser.token,
          refresh_token: driveUser.refreshToken
        });
        const drive = google.drive({ version: 'v3', auth: oAuth2Client });

        // Update refresh token
        oAuth2Client.on('tokens', async (tokens) => {
          if (tokens.refresh_token)
            await prisma.googleDriveUser.update({
              where: { id: userId },
              data: { refreshToken: tokens.refresh_token }
            });
        });

        const folderId = await findCraigDirectoryInGoogleDrive(drive);
        if (!folderId) return { error: 'google_drive_folder_not_found', notify: true };

        const format = user.driveFormat || 'flac';
        const container = user.driveContainer || 'zip';
        const mime = container === 'exe' ? 'application/vnd.microsoft.portable-executable' : 'application/zip';
        const ext = container === 'exe' ? 'exe' : 'zip';
        child = await cook(recordingId, format, container);

        // TODO server icon as contentHints.thumbnail ?

        const file = await drive.files.create({
          quotaUser: userId,
          requestBody: {
            name: `${fileName}.${ext}`,
            mimeType: mime,
            parents: [folderId],
            createdTime: info.startTime,
            description: getRecordingDescription(recordingId, info),
            properties: {
              'craig-recording-id': recordingId,
              'craig-requester-id': info.requesterId,
              'craig-guild-id': info.guildExtra.id,
              'craig-channel-id': info.channelExtra.id
            },
            contentHints: {
              indexableText: `${info.channel} - ${info.guild} - Craig recording ${recordingId} - https://craig.chat/`
            }
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
          id: file.data.id!,
          url: `https://drive.google.com/open?id=${file.data.id}`
        };
      }
      case 'onedrive': {
        const driveUser = await prisma.microsoftUser.findFirst({ where: { id: userId } });
        if (!driveUser) return { error: 'data_not_found', notify: false };
        const accessToken = await getRefreshedMicrosoftAccessToken(driveUser.token, driveUser.refreshToken, userId);
        if (!accessToken) {
          await prisma.microsoftUser.delete({ where: { id: userId } });
          return { error: 'microsoft_token_expired', notify: true };
        }

        const format = user.driveFormat || 'flac';
        const container = user.driveContainer || 'zip';
        const mime = container === 'exe' ? 'application/vnd.microsoft.portable-executable' : 'application/zip';
        const ext = container === 'exe' ? 'exe' : 'zip';
        child = await cook(recordingId, format, container);

        const file = await axios.put(`https://graph.microsoft.com/v1.0/drive/special/approot:/${fileName}.${ext}:/content`, child.stdout, {
          headers: { 'Content-Type': mime, Authorization: `Bearer ${accessToken}` }
        });

        await clearReadyState(recordingId);
        child.kill();

        // Set file description
        await axios.patch(
          `https://graph.microsoft.com/v1.0/drive/items/${file.data.id}/`,
          JSON.stringify({ description: getRecordingDescription(recordingId, info, ' - ') }),
          {
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }
          }
        );

        // // Set file icon
        // if (info.guildExtra.icon) {
        //   const icon = await axios.get(info.guildExtra.icon, { responseType: 'arraybuffer' });
        //   await axios.put(`https://graph.microsoft.com/v1.0/drive/items/${file.data.id}/thumbnails/0/source/content`, icon.data, {
        //     headers: { 'Content-Type': icon.headers['content-type'], Authorization: `Bearer ${accessToken}` }
        //   });
        // }

        return {
          error: null,
          notify: true,
          id: file.data.id,
          url: file.data.webUrl
        };
      }
      default:
        return { error: 'unknown_service', notify: false };
    }
  } catch (e) {
    logger.error(`Error in uploading recording ${recordingId} for user ${userId}`, e);
    await clearReadyState(recordingId);
    child?.kill();
    return { error: (e as any).toString() || 'unknown_error', notify: true };
  }
}
