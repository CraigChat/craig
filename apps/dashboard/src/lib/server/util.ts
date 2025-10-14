import { json } from '@sveltejs/kit';

import { APIErrorCode } from '../types';

export function errorResponse(code?: APIErrorCode, init?: ResponseInit, extra?: any) {
  function result(msg: string) {
    return json({ error: msg, code: code ?? APIErrorCode.UNKNOWN_ERROR, ...extra }, init);
  }

  switch (code) {
    case APIErrorCode.SERVER_ERROR:
      return result('Server error');
    case APIErrorCode.INVALID_BODY:
      return result('Invalid body');
    case APIErrorCode.LOGIN:
      return result('Login required');
    case APIErrorCode.UNAUTHORIZED:
      return result('Unauthorized');
    case APIErrorCode.INVALID_FORMAT:
      return result('Invalid format');
    case APIErrorCode.FEATURE_UNAVAILABLE:
      return result('This feature is unavailable to this user');
    case APIErrorCode.NOT_SUPPORTER:
      return result('This requires a supporter tier');
    case APIErrorCode.NEED_HIGHER_TIER:
      return result('This requires a higher supporter tier');
  }

  return result('Unknown Error');
}

export function convertToTimeMark(seconds: number, includeHours?: boolean): string {
  if (isNaN(seconds) || seconds < 0) return '00:00:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  const formattedHours = hours < 10 ? `0${hours}` : `${hours}`;
  const formattedMinutes = minutes < 10 ? `0${minutes}` : `${minutes}`;
  const formattedSeconds = remainingSeconds < 10 ? `0${remainingSeconds.toFixed(2)}` : `${remainingSeconds.toFixed(2)}`;

  return `${hours === 0 && !includeHours ? '' : `${formattedHours}:`}${formattedMinutes}:${formattedSeconds}`;
}
