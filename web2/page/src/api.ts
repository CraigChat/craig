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
    avatar?: string;
  };
  features: { [features: string]: boolean };
}

export interface RecordingUser {
  id: string;
  username: string;
  discrim: string;
  avatar?: string;
}

export async function getRecording(id: string, key: string | number): Promise<RecordingInfo> {
  const response = await fetch(`/api/recording/${id}?key=${key}`);
  if (response.status !== 200) throw response;
  return response.json().then(data => data.info);
}

export async function getRecordingUsers(id: string, key: string | number): Promise<RecordingUser[]> {
  const response = await fetch(`/api/recording/${id}/users?key=${key}`);
  if (response.status !== 200) throw response;
  return response.json().then(data => data.users);
}

export async function getRecordingDuration(id: string, key: string | number): Promise<number> {
  const response = await fetch(`/api/recording/${id}/duration?key=${key}`);
  if (response.status !== 200) throw response;
  const { duration } = await response.json();
  return duration;
}

export async function isReady(id: string, key: string | number): Promise<boolean> {
  const response = await fetch(`/api/recording/${id}/cook?key=${key}`);
  if (response.status !== 200) throw response;
  const { ready } = await response.json();
  return ready;
}

interface CookPayload {
  format?: string;
  container?: string;
  dynaudnorm?: boolean;
}

export async function cookRecording(id: string, key: string | number, payload: CookPayload): Promise<Response> {
  const response = await fetch(`/api/recording/${id}/cook?key=${key}`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' }
  });
  if (response.status !== 200) throw response;
  return response;
}
