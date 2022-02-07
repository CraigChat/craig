import { RecordingNote, recPath } from './recording';
import path from 'path';
import execa from 'execa';
import { spawn } from 'child_process';
import { clearReadyState, getReadyState, setReadyState } from '../cache';

export const cookPath = path.join(__dirname, '..', '..', '..', 'cook');
export const tmpPath = path.join(__dirname, '..', '..', 'tmp');

export interface ReadyState {
  message?: string;
  file?: string;
  time?: string;
  progress?: number;
}

export async function getReady(id: string): Promise<true | ReadyState> {
  const state: ReadyState = await getReadyState(id);
  if (state) return state;

  // Check if the data file is share locked
  const lock = await execa(`exec 9< "${path.join(recPath, `${id}.ogg.data`)}" && flock -n 9 || exit 1`, {
    shell: true,
    reject: false
  });
  if (lock.exitCode === 1) return { message: 'Locked by another process...' };

  return true;
}

export async function getDuration(id: string): Promise<number> {
  const durationPath = path.join(cookPath, 'duration.sh');
  const { stdout: duration } = await execa(durationPath, [id]);
  return parseFloat(duration);
}

export async function getNotes(id: string): Promise<RecordingNote[]> {
  const notesPath = path.join(cookPath, 'jsonnotes.sh');
  const { stdout: notesStr } = await execa(notesPath, [id]);
  return JSON.parse(notesStr);
}

export const allowedFormats = [
  'flac',
  'copy',
  'oggflac',
  'vorbis',
  'aac',
  'heaac',
  'adpcm',
  'wav8',
  'opus',
  'wavsfx',
  'wavsfxm',
  'wavsfxu',
  'powersfx',
  'powersfxm',
  'powersfxu',
  'mp3',
  'ra'
];

export const allowedContainers: { [container: string]: { mime?: string; ext?: string } } = {
  zip: {},
  aupzip: {
    ext: 'aup.zip'
  },
  ogg: {
    ext: 'ogg',
    mime: 'audio/ogg'
  },
  matroska: {
    ext: 'mkv',
    mime: 'video/x-matroska'
  },
  exe: {
    ext: 'exe',
    mime: 'application/vnd.microsoft.portable-executable'
  },
  mix: {
    mime: 'application/octet-stream'
  }
};

function stateManager(id: string): [ReadyState, (newState: ReadyState) => Promise<void>, () => Promise<void>] {
  const state: ReadyState = {};
  let stateDeleted = false;

  const deleteState = async () => {
    stateDeleted = true;
    await clearReadyState(id).catch(() => {});
  };

  const writeState = async (newState: ReadyState) => {
    if (stateDeleted) return;
    const isNew = !(
      state.file === newState.file &&
      state.progress === newState.progress &&
      state.time === newState.time
    );
    if (isNew) {
      state.file = newState.file;
      state.progress = newState.progress;
      state.time = newState.time;
      await setReadyState(id, newState).catch(() => {});
    }
  };

  return [state, writeState, deleteState];
}

function getStderrReader(state: ReadyState, writeState: (newState: ReadyState) => Promise<void>) {
  return (buf: Buffer) => {
    const log = buf.toString();

    // Watch when a new file is being put in the zip
    if (log.includes('adding:')) {
      const match = log.match(/ {2}adding: (?:[\w.-]+\/)([\w.-]+)(?: \(deflated \d+%\))?(?=$)/);
      if (match) return void writeState({ file: match[1], progress: 0, time: '00:00:00.00' });
    }

    // Watch when FFMpeg updates on progress
    if (log.includes('complete,')) {
      const match = log.match(/(\d+)% complete, ratio=[\d.]+(?=$)/);
      if (match) return void writeState({ file: state.file, progress: parseInt(match[1], 10), time: state.time });
    }

    // Watch when FFMpeg updates on total time
    if (log.includes('time=')) {
      const match = log.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
      if (match) return void writeState({ file: state.file, progress: state.progress, time: match[1] });
    }
  };
}

export async function cook(id: string, format = 'flac', container = 'zip', dynaudnorm = false) {
  const [state, writeState, deleteState] = stateManager(id);

  try {
    await writeState({});
    const cookingPath = path.join(cookPath, '..', 'cook.sh');
    const args = [id, format, container, ...(dynaudnorm ? ['dynaudnorm'] : [])];
    const child = spawn(cookingPath, args);
    child.stdout.once('end', deleteState);
    child.stdout.once('error', deleteState);

    // Prevent the stream from ending prematurely (for some reason)
    child.stderr.on('data', getStderrReader(state, writeState));

    return child.stdout;
  } catch (e) {
    deleteState();
    throw e;
  }
}

export const allowedAvatarFormats = [
  'png',
  'mkvh264',
  'webmvp8',
  'movsfx',
  'movsfxm',
  'movsfxu',
  'movpngsfx',
  'movpngsfxm',
  'movpngsfxu',
  'exe'
];

export async function cookAvatars(
  id: string,
  format = 'png',
  container = 'zip',
  transparent = false,
  bg = '000000',
  fg = '008000'
) {
  const [state, writeState, deleteState] = stateManager(id);

  try {
    await writeState({});
    const cookingPath = path.join(cookPath, 'avatars.sh');
    const args = [id, format, container, transparent ? '1' : '0', bg, fg];
    const child = spawn(cookingPath, args);
    child.stdout.once('end', deleteState);
    child.stdout.once('error', deleteState);

    // Prevent the stream from ending prematurely (for some reason)
    child.stderr.on('data', getStderrReader(state, writeState));

    return child.stdout;
  } catch (e) {
    deleteState();
    throw e;
  }
}

export function rawPartwise(id: string, track?: number) {
  const cookingPath = path.join(cookPath, 'raw-partwise.sh');
  const args = [id, ...(track ? [String(track)] : [])];
  const child = spawn(cookingPath, args);

  // Prevent the stream from ending prematurely (for some reason)
  child.stderr.on('data', () => {});

  return child.stdout;
}
