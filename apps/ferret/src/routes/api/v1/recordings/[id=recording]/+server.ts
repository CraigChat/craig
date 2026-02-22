import { json } from '@sveltejs/kit';

import { getCachedRecordingDuration } from '$lib/server/data';
import {
  deleteRecording,
  errorResponse,
  getRecordingDeletedAt,
  getRecordingInfo,
  isRecordingLive,
  markRecordingDeleted,
  recordingExists,
  safeKeyCompare
} from '$lib/server/util';
import { APIErrorCode } from '$lib/types';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, params }) => {
  const key = url.searchParams.get('key') ?? '';
  const withAvatars = url.searchParams.get('with_avatars') === 'true';
  const id = params.id;

  if (!key) return errorResponse(APIErrorCode.KEY_REQUIRED, { status: 400 });

  const recExists = await recordingExists(id);
  if (!recExists.available) {
    const deletedAt = await getRecordingDeletedAt(id);
    if (deletedAt) return errorResponse(APIErrorCode.RECORDING_DELETED, { status: 404 }, { deletedAt });
    return errorResponse(APIErrorCode.RECORDING_NOT_FOUND, { status: 404 });
  }

  const recording = await getRecordingInfo(id);
  if (!safeKeyCompare(recording.info.key, key)) return errorResponse(APIErrorCode.INVALID_KEY, { status: 401 });
  if (recording.users.length !== 0 && !recExists.dataExists) return errorResponse(APIErrorCode.RECORDING_NO_DATA, { status: 404 });
  const [duration, live] = await Promise.all([getCachedRecordingDuration(id, recExists.dataStats?.size), isRecordingLive(id)]);

  return json({
    recording: recording.cleanInfo,
    users: withAvatars ? recording.users : recording.users.map(({ avatar: _, ...user }) => user),
    ...(duration !== null ? { duration } : {}),
    live
  });
};

export const DELETE: RequestHandler = async ({ url, params }) => {
  const key = url.searchParams.get('key') ?? '';
  const deleteKey = url.searchParams.get('delete') ?? '';
  const id = params.id;

  if (!key) return errorResponse(APIErrorCode.KEY_REQUIRED, { status: 400 });

  const recExists = await recordingExists(id);
  if (!recExists.available) return errorResponse(APIErrorCode.RECORDING_NOT_FOUND, { status: 404 });

  const recording = await getRecordingInfo(id);
  if (!safeKeyCompare(recording.info.key, key)) return errorResponse(APIErrorCode.INVALID_KEY, { status: 401 });
  if (!recExists.dataExists) return errorResponse(APIErrorCode.RECORDING_NO_DATA, { status: 404 });

  if (recording.info.delete !== deleteKey) return errorResponse(APIErrorCode.INVALID_DELETE_KEY, { status: 401 });

  await deleteRecording(id);
  await markRecordingDeleted(id, recording.info);

  return json({ ok: true });
};
