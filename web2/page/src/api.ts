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

export async function getRecording(id: string, key: string): Promise<RecordingInfo> {
  const response = await fetch(`/api/recording/${id}?key=${key}`);
  return response.json();
}

export async function getRecordingUsers(id: string, key: string): Promise<RecordingUser[]> {
  const response = await fetch(`/api/recording/${id}/users?key=${key}`);
  return response.json();
}

export async function getRecordingDuration(id: string, key: string): Promise<number> {
  const response = await fetch(`/api/recording/${id}/duration?key=${key}`);
  const { duration } = await response.json();
  return duration;
}
