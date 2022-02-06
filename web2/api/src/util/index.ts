export enum ErrorCode {
  INVALID_ID = 1001,
  INVALID_KEY = 1002,
  RECORDING_NOT_FOUND = 1003,
  RECORDING_DELETED = 1004,
  INVALID_DELETE_KEY = 1005,
  RECORDING_NOT_READY = 1006,
  MISSING_MP3 = 1007,
  MISSING_GLOWERS = 1008,
  MISSING_MIX = 1009,
  PNG_FORMAT_MISMATCH = 1010,
  INVALID_TRACK = 1011,

  INVALID_FORMAT = 1101,
  INVALID_CONTAINER = 1102,
  INVALID_BG = 1103,
  INVALID_FG = 1104,

  RATELIMITED = 2001
}

export function formatTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const pad = (num: number) => (num < 10 ? '0' : '') + num;
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}
