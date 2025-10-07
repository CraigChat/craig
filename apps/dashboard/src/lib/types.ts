import type { getUserData } from "./server/data";

export enum APIErrorCode {
  UNKNOWN_ERROR = 'unknown',
  SERVER_ERROR = 'server_error',
  INVALID_BODY = 'invalid_body',

  LOGIN = 'login',
  UNAUTHORIZED = 'unauthorized',

  INVALID_FORMAT = 'invalid_format',
  FEATURE_UNAVAILABLE = 'feature_unavailable',
  NOT_SUPPORTER = 'not_supporter',
  NEED_HIGHER_TIER = 'need_higher_tier'
}

export interface APIErrorResponse {
  error: string;
  code: APIErrorCode;
}

export type ConnectionsData = Awaited<ReturnType<typeof getUserData>>['connections']
