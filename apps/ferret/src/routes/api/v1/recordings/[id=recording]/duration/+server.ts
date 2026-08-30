import { json } from '@sveltejs/kit';

import { getRecordingDurationWithCache } from '$lib/server/data';
import { errorResponse, recordingExists, validateKey } from '$lib/server/util';
import { APIErrorCode } from '$lib/types';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, params }) => {
  const key = url.searchParams.get('key') ?? '';
  const id = params.id;

  if (!key) return errorResponse(APIErrorCode.KEY_REQUIRED, { status: 400 });

  const recExists = await recordingExists(id);
  if (!recExists.available) return errorResponse(APIErrorCode.RECORDING_NOT_FOUND, { status: 404 });
  if (!recExists.dataExists) return errorResponse(APIErrorCode.RECORDING_NO_DATA, { status: 404 });
  if (!(await validateKey(id, key))) return errorResponse(APIErrorCode.INVALID_KEY, { status: 401 });

  const duration = await getRecordingDurationWithCache(id, recExists.dataStats?.size);
  if (duration === false) return errorResponse(APIErrorCode.KITCHEN_UNAVAILABLE, { status: 503 });

  return json(
    { duration },
    {
      headers: {
        'Cache-Control': 'max-age=120'
      }
    }
  );
};
