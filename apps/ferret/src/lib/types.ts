import type { Kitchen, Recording } from '@craig/types';
import type Emittery from 'emittery';

export type Unpacked<T> = T extends (infer U)[] ? U : T;

export type RecordingPageEvents = { streamJob: MinimalJobInfo; statusUpdate: Kitchen.JobStatus };
export type RecordingPageEmitter = Emittery<RecordingPageEvents>;

export enum APIErrorCode {
  UNKNOWN_ERROR = 'unknown',
  SERVER_ERROR = 'server_error',
  INVALID_BODY = 'invalid_body',

  KEY_REQUIRED = 'no_key',
  INVALID_RECORDING = 'invalid_rec',
  RECORDING_NOT_FOUND = 'no_rec',
  INVALID_KEY = 'invalid_key',
  RECORDING_NO_DATA = 'rec_no_data',

  KITCHEN_UNAVAILABLE = 'kitchen_down',
  JOB_ALREADY_EXISTS = 'job_exists',
  JOB_NOT_FOUND = 'no_job',

  INVALID_FORMAT = 'invalid_format',
  FEATURE_UNAVAILABLE = 'feature_unavailable',
  INVALID_TRACK = 'invalid_track',
  NO_TRACKS_GIVEN = 'no_tracks_given',

  INVALID_DELETE_KEY = 'invalid_delete_key'
}

export interface MinimalRecordingInfo {
  id: string;
  autorecorded: boolean;
  startTime: string;
  expiresAfter: number;
  client: {
    id?: string;
  };
  guild: {
    id: string;
    name: string;
    icon?: string;
  };
  channel: {
    name: string;
    id: string;
    type: 2 | 13;
  };
  requester: {
    username: string;
    discriminator: string;
    avatar?: string;
    id: string;
  };
  features: (keyof Recording.RecordingInfoV1['features'])[];
}

export interface MinimalJobInfo {
  id: string;
  type: Kitchen.JobType;
  options: {
    format?: Kitchen.FormatType;
    container?: Kitchen.ContainerType;
    dynaudnorm?: boolean;
    parallel?: boolean;
  };
  status: Kitchen.JobStatus;
  state: Kitchen.JobState;
  outputData: Kitchen.JobOutputData;
  continued: boolean;
  startedIn: string;
  outputFileName: string;
  outputSize?: number;
  finishedAt?: string;
}

export interface MinimalJobUpdate {
  started: number;
  now: number;
  status: Kitchen.JobStatus;
  state: Kitchen.JobState;
  outputData: Kitchen.JobOutputData;
  outputFileName: string;
  outputSize: number | null;
  finishedAt: number | null;
}

export interface RecordingResponse {
  recording: MinimalRecordingInfo;
  users: Recording.RecordingUser[];
}

export interface APIErrorResponse {
  error: string;
  code: APIErrorCode;
}
