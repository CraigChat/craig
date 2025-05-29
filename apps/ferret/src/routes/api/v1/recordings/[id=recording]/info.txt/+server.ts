import { errorResponse, getInfoText, getRecordingInfo, recordingExists } from '$lib/server/util';
import { APIErrorCode } from '$lib/types';

import type { RequestHandler } from './$types';

export const GET = (async ({ url, params }) => {
  const key = url.searchParams.get('key') ?? '';
  const id = params.id;

  if (!key) return errorResponse(APIErrorCode.KEY_REQUIRED, { status: 400 });

  const recExists = await recordingExists(id);
  if (!recExists.available) return errorResponse(APIErrorCode.RECORDING_NOT_FOUND, { status: 404 });

  const recording = await getRecordingInfo(id);
  if (recording.info.key !== key) return errorResponse(APIErrorCode.INVALID_KEY, { status: 401 });
  if (recording.users.length !== 0 && !recExists.dataExists) return errorResponse(APIErrorCode.RECORDING_NO_DATA, { status: 404 });

  const info = getInfoText(id, recording.info, recording.users);

  return new Response(info, {
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'max-age=120',
      'Content-Disposition': `attachment; filename="craig-${id}-info.txt"`,
      'Content-Length': info.length.toString()
    }
  });
}) satisfies RequestHandler;
