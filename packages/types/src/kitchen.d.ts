export type RecordingFormatType =
  | 'flac'
  | 'copy'
  | 'oggflac'
  | 'vorbis'
  | 'aac'
  | 'heaac'
  | 'opus'
  | 'wav'
  | 'adpcm'
  | 'wav8'
  | 'mp3'
  | 'ra'
  | `${'power' | 'wav'}sfx${'' | 'm' | 'u'}`;
export type AvatarFormatTypes = 'mkvh264' | 'webmvp8';
export type FormatType = RecordingFormatType | AvatarFormatTypes;
export type ContainerType = 'ogg' | 'matroska' | 'mix' | 'zip' | 'aupzip' | 'sesxzip' | 'exe';

export type JobType = 'recording' | 'avatars';
export type JobStatus = 'idle' | 'running' | 'complete' | 'error' | 'cancelled' | 'queued';
export type PostTask = 'download' | 'upload';

export interface CreateJobOptions {
  id: string;
  continueJobId?: string;
  jobType: JobType;
  postTask?: PostTask;
  postTaskOptions?: {
    userId?: string;
    googleFolderId?: string;
  };
  from?: string;
  tags?: JobTags;
  options?: {
    parallel?: boolean;
    batchBy?: number;

    format?: FormatType;
    container?: ContainerType;
    dynaudnorm?: boolean;

    fg?: string;
    bg?: string;
    transparent?: boolean;
  };
}

export interface JobState {
  position?: number;
  type?: 'starting' | 'processing' | 'encoding' | 'writing' | 'uploading' | 'finalizing';
  file?: string;
  track?: number;
  progress?: number;
  time?: string;
  tracks?: {
    [track: number]: JobStateTrack;
  };
}

export type JobTags = { queueBypass: boolean } & Record<string, any>;

export interface JobStateTrack {
  progress: number;
  processing?: boolean;
  warn?: boolean;
  time?: string;
}

export interface JobOutputData {
  usersWarned?: number[];
  uploadError?: boolean;
  uploadFileId?: string;
  uploadFileURL?: string;
}

export interface JobJSON {
  id: string;
  from?: string;
  tags?: JobTags;
  recordingId: string;
  continued: boolean;
  createdAt: string;
  outputFile: string;
  outputFileName: string;
  type: JobType;
  postTask?: PostTask;
  postTaskOptions?: CreateJobOptions['postTaskOptions'];
  options?: CreateJobOptions['options'];
  status: JobStatus;
  state: JobState;
  outputData: JobOutputData;
  failReason?: string;
  outputSize?: number;
  startedAt?: string;
  finishedAt?: string;
}

export interface SavedJobsJSON {
  jobs: JobJSON[];
  resumeIds: string[];
  savedIds: string[];
  timestamp: string;
}

export interface JobUpdate {
  started: number;
  now: number;
  status: JobStatus;
  failReason: string | null;
  state: JobState;
  outputData: JobOutputData;
  outputFileName: string;
  outputSize: number | null;
  finishedAt: number | null;
}

export interface KitchenHealthResponse {
  responseTime: number;
}

export interface KitchenStatsResponse {
  allowNewJobs: boolean;
  jobCount: {
    finishedJobs: number;
    runningJobs: number;
    total: number;
  };
}

export interface KitchenJobsResponse {
  jobs: JobJSON[];
}
