export interface RecordingInfo {
  format: 1;
  key: number | string;
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
  expiresAfter?: number;
  user?: string;
  userId?: string;
  userExtra?: {
    username: string;
    discriminator: string;
    avatar?: string;
  };
  features: { [features: string]: boolean };
}

export interface RecordingUser {
  id: string;
  name: string;
  discrim: string;
  avatar?: string;
}

export interface CookPayload {
  format?: string;
  container?: string;
  dynaudnorm?: boolean;
}

export interface CookAvatarsPayload {
  format?: string;
  container?: string;
  transparent?: boolean;
  bg?: string;
  fg?: string;
}

export interface ReadyState {
  ready: boolean;
  message?: string;
  file?: string;
  time?: string;
  progress?: number;
  download?: DownloadState;
}

export interface DownloadState {
  file: string;
  format: string;
  container: string;
  dynaudnorm: boolean;
  type?: string;
}

export async function getRecording(id: string, key: string | number): Promise<RecordingInfo> {
  const response = await fetch(`/api/recording/${id}?key=${key}`);
  if (response.status !== 200) throw response;
  return response.json().then((data) => data.info);
}

export async function getRecordingUsers(id: string, key: string | number): Promise<RecordingUser[]> {
  const response = await fetch(`/api/recording/${id}/users?key=${key}`);
  if (response.status !== 200) throw response;
  return response.json().then((data) => data.users);
}

export async function getRecordingDuration(id: string, key: string | number): Promise<number> {
  const response = await fetch(`/api/recording/${id}/duration?key=${key}`);
  if (response.status !== 200) throw response;
  const { duration } = await response.json();
  return duration;
}

export async function deleteRecording(id: string, key: string | number, deleteKey: string | number): Promise<void> {
  const response = await fetch(`/api/recording/${id}?key=${key}&delete=${deleteKey}`, { method: 'DELETE' });
  if (response.status !== 200 && response.status !== 204) throw response;
  return;
}

export async function isReady(id: string, key: string | number): Promise<ReadyState> {
  const response = await fetch(`/api/recording/${id}/cook?key=${key}`);
  if (response.status !== 200) throw response;
  const readyState = await response.json();
  return readyState;
}

export async function getRawRecording(id: string, key: string | number): Promise<Response> {
  const response = await fetch(`/api/recording/${id}/raw?key=${key}`);
  if (response.status !== 200) throw response;
  return response;
}

export async function cookDownload(id: string, key: string | number, payload: any, type?: string): Promise<void> {
  const response = await fetch(`/api/recording/${id}/cook${type ? `/${type}` : ''}?key=${key}`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' }
  });
  if (response.status !== 200 && response.status !== 204) throw response;
  return;
}
