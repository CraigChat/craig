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
