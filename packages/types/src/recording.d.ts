export type RecordingInfo = RecordingInfoV1;

export interface RecordingInfoV1 {
  format: 1;
  key: string;
  delete: string;
  autorecorded: boolean;
  clientId?: string;
  guild: string;
  guildExtra: {
    name: string;
    id: string;
    icon?: string;
  };
  channel: string;
  channelExtra: {
    name: string;
    id: string;
    type: 2 | 13;
  };
  requester: string;
  requesterExtra: {
    username: string;
    discriminator: string;
    avatar: string;
  };
  requesterId: string;
  startTime: string;
  expiresAfter: number;
  features: {
    mix?: true;
    auto?: true;
    drive?: true;
    glowers?: true;
    eccontinuous?: true;
    ecflac?: true;
    mp3?: true;
  };
}

export interface RecordingUser {
  id: string;
  track: number;
  username: string;
  discriminator: string;
  bot?: boolean;
  unknown: boolean;
  avatar?: string;
  avatarUrl?: string;
  dtype?: number;
}

export interface RecordingNote {
  time: string;
  note: string;
}

export type StreamType = 'opus' | 'flac';
