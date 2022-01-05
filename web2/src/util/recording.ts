import fs from 'fs/promises';
import path from 'path';

export const recPath = path.join(__dirname, '..', '..', '..', 'rec');
export const configPath = path.join(__dirname, '..', '..', '..', 'config.json');
let config: Record<string, any> | null = null;

export interface RecordingInfo {
  format: 1;
  key: number | string;
  delete: number | string;
  guild: string;
  guildExtra: {
    name: string;
    id: string;
    icon: string | null;
  };
  channel: string;
  channelExtra: {
    name: string;
    id: string;
    type: number;
  };
  requester: string;
  requesterExtra: {
    username: string;
    discriminator: string;
    avatar: string | null;
  };
  requesterId: string;
  startTime: string;
  user?: string;
  userExtra?: {
    username: string;
    discriminator: string;
    avatar: string | null;
  };
  features: { [features: string]: boolean };
}

export async function loadConfig(): Promise<void> {
  const configText = await fs.readFile(configPath, 'utf8');
  if (!configText) throw new Error('Config file not found');
  config = JSON.parse(configText);
}

export async function fileExists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch (err) {
    return false;
  }
}

export async function getRecording(id: string): Promise<RecordingInfo | false> {
  if (!config) await loadConfig();

  const dataExists = !(
    await Promise.all(['data', 'header1', 'header2'].map((ext) => fileExists(path.join(recPath, `${id}.ogg.${ext}`))))
  ).some((exists) => exists === false);
  const infoExists = await fileExists(path.join(recPath, `${id}.ogg.info`));
  if (!dataExists && infoExists) return false;
  if (!dataExists || !infoExists) return null;

  const info: Partial<RecordingInfo> = JSON.parse(await fs.readFile(path.join(recPath, `${id}.ogg.info`), 'utf8'));

  // check for a key file
  if (!info.key) {
    const keyExists = await fileExists(path.join(recPath, `${id}.ogg.key`));
    if (keyExists) info.key = await fs.readFile(path.join(recPath, `${id}.ogg.key`), 'utf8');
  }

  // fill in features
  if (!info.features) {
    const featsExists = await fileExists(path.join(recPath, `${id}.ogg.features`));
    if (featsExists) info.features = JSON.parse(await fs.readFile(path.join(recPath, `${id}.ogg.features`), 'utf8'));
    else {
      const defaultFeatures = Object.assign({}, config.defaultFeatures);
      delete defaultFeatures.limits;
      info.features = defaultFeatures;
    }
  }

  return info as RecordingInfo;
}

export async function deleteRecording(id: string): Promise<void> {
  const keyExists = await fileExists(path.join(recPath, `${id}.ogg.key`));
  const featsExists = await fileExists(path.join(recPath, `${id}.ogg.features`));
  await Promise.all(
    ['data', 'header1', 'header2', ...(keyExists ? ['key'] : []), ...(featsExists ? ['features'] : [])].map((ext) =>
      fs.unlink(path.join(recPath, `${id}.ogg.${ext}`))
    )
  );
}

export function keyMatches(rec: RecordingInfo, key: string) {
  return key === String(rec.key);
}
