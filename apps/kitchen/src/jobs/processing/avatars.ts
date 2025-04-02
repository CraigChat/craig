import fs from 'node:fs/promises';
import * as path from 'node:path';

import { RecordingUser } from '@craig/types/recording';
import { execaCommand } from 'execa';

import { AVATAR_CDN } from '../../util/config.js';
import { fileNameFromUser, ROOT_DIR, runParallelFunction } from '../../util/index.js';
import { createAvatarVideo, DEF_TIMEOUT, getDuration, getStreamTypes } from '../../util/process.js';
import { procOpts } from '../../util/processOptions.js';
import { getRecordingUsers } from '../../util/recording.js';
import { Job } from '../job.js';

const ARESAMPLE = 'aresample=flags=res:min_comp=0.001:max_soft_comp=1000000:min_hard_comp=16:first_pts=0';

// TODO mov support? (probably not, mkv is better)

async function writeAvatar(user: RecordingUser, file: string) {
  if (user.avatar?.startsWith('data:')) return await fs.writeFile(file, Buffer.from(user.avatar.split(',')[1], 'base64'));

  if (!user.id.includes('#') && AVATAR_CDN) {
    const response = await fetch(`${AVATAR_CDN}/discord-avatars/${user.id}.png`);
    if (response.status === 200) return await fs.writeFile(file, Buffer.from(await response.arrayBuffer()));
  }

  if (user.avatarUrl?.startsWith('https://cdn.discordapp.com/avatars/')) {
    const response = await fetch(user.avatarUrl);
    if (response.status === 200) return await fs.writeFile(file, Buffer.from(await response.arrayBuffer()));
  }

  await fs.copyFile('./assets/default_avatar.png', file);
}

export async function processAvatarsJob(job: Job) {
  const { recFileBase, tmpDir } = job;
  const cancelSignal = job.abortController.signal;

  const users = await getRecordingUsers(recFileBase);
  const streamTypes = await getStreamTypes({ recFileBase, cancelSignal });
  const duration = await getDuration({ recFileBase, cancelSignal });
  const trackFiles: string[] = [];
  const pOpts = procOpts();

  const filters: string[] = [];
  const bg = !job.options?.bg || !/^[0-9a-f]{6}$/.test(job.options?.bg) ? '000000' : job.options?.bg;
  const fg = !job.options?.fg || !/^[0-9a-f]{6}$/.test(job.options?.fg) ? '008000' : job.options?.fg;
  const transparent = !!job.options?.transparent;
  const splitChannels = transparent && job.options?.format === 'mkvh264';

  // Background
  if (splitChannels) filters.push('color=color=black:size=160x160:rate=30:duration=1[bg]');
  else if (!transparent) filters.push(`color=color=0x${bg}:size=160x160:rate=30:duration=1[bg]`);

  // Avatar glow
  filters.push(
    `[2:a]${ARESAMPLE},apad,dynaudnorm,volume=2,showvolume=r=30:b=0:c=0xFFFFFF:f=0.75:t=0:v=0,format=y8,scale=1:1:flags=area,scale=160:160:flags=neighbor,setsar=1[glow]`,
    `[1:v]alphaextract,setsar=1[glowa]`,
    `[glowa][glow]blend=darken[glow]`
  );

  // Color the glow if we arent using transparency
  if (!splitChannels) filters.push(`color=color=0x${fg}:size=160x160:rate=30[glowbg]`, '[glowbg][glow]alphamerge[glow]');

  // Avatar
  if (splitChannels) filters.push('[0:v]null[avatar]');
  else filters.push('[0:v]alphaextract[avatara]', '[3:v]scale=128:128,pad=160:160:16:16,setsar=1[avatar]', '[avatar][avatara]alphamerge[avatar]');

  // Layering
  const hasBg = filters[0]?.includes('[bg]');
  if (hasBg) filters.push('[bg][glow]overlay[vid]');
  else filters.push('[glow]null[vid]');
  filters.push('[vid][avatar]overlay[vid]');

  // Processing
  const filter = filters.join(';');
  async function createTrack(i: number) {
    const user = users[i];
    const track = i + 1;
    const fileName = fileNameFromUser(track, user);

    job.setState({
      type: job.state.type,
      tracks: {
        ...(job.state.tracks || {}),
        [track]: { progress: 0, processing: true }
      }
    });

    const avatarPath = path.join(tmpDir, `${fileName}.tmp.png`);
    await writeAvatar(user, avatarPath);

    const writePath = path.join(tmpDir, `${fileName}.${job.options?.format === 'mkvh264' ? 'mkv' : 'webm'}`);
    trackFiles.push(writePath);

    const success = await createAvatarVideo({
      recFileBase,
      cancelSignal,
      track,
      job,
      codec: streamTypes[i],
      extraArgs:
        job.options?.format === 'mkvh264'
          ? '-c:v libx264 -crf 16'
          : `-c:v libvpx -crf 10 -auto-alt-ref 0${job.options?.transparent ? ' -metadata:s:v:0 alpha_mode=1' : ''}`,
      writePath,
      avatarPath,
      duration: parseFloat(duration),
      filter
    });

    if (splitChannels)
      await execaCommand(
        [
          `${pOpts} ffmpeg -nostdin`,
          '-i "./assets/glower-avatar.png"',
          `-i "${avatarPath}"`,
          `-filter_complex '${[
            `color=color=0x${fg}:size=160x160,trim=end_frame=1[bg]`,
            '[0:v]alphaextract[avatara]',
            '[1:v]scale=128:128,pad=160:160:16:16,setsar=1[avatar]',
            '[avatar][avatara]alphamerge[avatar]',
            '[bg][avatar]overlay[avatar]'
          ].join(';')}'`,
          "-map '[avatar]'",
          `-y "${path.join(tmpDir, `${fileName}.png`)}"`
        ].join(' '),
        { cancelSignal, timeout: DEF_TIMEOUT, shell: true, cwd: ROOT_DIR }
      );

    job.setState({
      type: 'encoding',
      tracks: {
        ...(job.state.tracks || {}),
        [track]: { progress: 100, warn: !success }
      }
    });

    await fs.rm(avatarPath);

    if (!success) job.outputData.usersWarned = [...(job.outputData.usersWarned || []), track];
  }

  job.setState(job.options?.container === 'mix' ? { type: 'processing' } : { type: 'encoding', tracks: {} });

  await runParallelFunction({
    parallel: job.options?.parallel,
    batchBy: job.options?.batchBy,
    userCount: users.length,
    cancelSignal,
    fn: createTrack
  });

  // Zip up stuff
  job.setState({ type: 'finalizing' });
  await execaCommand(`${pOpts} zip -r1FI ${job.outputFile} .`, { cancelSignal, timeout: DEF_TIMEOUT, cwd: tmpDir });
}
