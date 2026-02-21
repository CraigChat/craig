import { json } from '@sveltejs/kit';
import { destr } from 'destr';

import { dev } from '$app/environment';
import { type PostJobBody, validateOptions } from '$lib/server/job';
import { isStreamOpen } from '$lib/server/redis';
import { cancelJob, createJob, errorResponse, getLatestJob, getRecordingInfo, minimizeJobInfo, recordingExists, safeKeyCompare, validateKey } from '$lib/server/util';
import { APIErrorCode } from '$lib/types';

import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ url, params }) => {
  const key = url.searchParams.get('key') ?? '';
  const id = params.id;

  if (!key) return errorResponse(APIErrorCode.KEY_REQUIRED, { status: 400 });

  const recExists = await recordingExists(id);
  if (!recExists.available) return errorResponse(APIErrorCode.RECORDING_NOT_FOUND, { status: 404 });
  if (!(await validateKey(id, key))) return errorResponse(APIErrorCode.INVALID_KEY, { status: 401 });

  const job = await getLatestJob(id);
  if (job === false) return errorResponse(APIErrorCode.KITCHEN_UNAVAILABLE, { status: 503 });
  else if (!job) return errorResponse(APIErrorCode.JOB_NOT_FOUND, { status: 400 });

  await cancelJob(job.id);
  return json({ ok: true });
};

export const GET: RequestHandler = async ({ url, params }) => {
  const key = url.searchParams.get('key') ?? '';
  const id = params.id;

  if (!key) return errorResponse(APIErrorCode.KEY_REQUIRED, { status: 400 });

  const recExists = await recordingExists(id);
  if (!recExists.available) return errorResponse(APIErrorCode.RECORDING_NOT_FOUND, { status: 404 });
  if (!(await validateKey(id, key))) return errorResponse(APIErrorCode.INVALID_KEY, { status: 401 });

  const job = await getLatestJob(id);
  if (job === false) return errorResponse(APIErrorCode.KITCHEN_UNAVAILABLE, { status: 503 });

  const streamOpen = job ? await isStreamOpen(job.id) : false;
  return json({ job: job ? minimizeJobInfo(job) : null, streamOpen });
};

export const POST: RequestHandler = async ({ url, params, request }) => {
  const key = url.searchParams.get('key') ?? '';
  const id = params.id;

  if (!key) return errorResponse(APIErrorCode.KEY_REQUIRED, { status: 400 });

  const recExists = await recordingExists(id);
  if (!recExists.available) return errorResponse(APIErrorCode.RECORDING_NOT_FOUND, { status: 404 });

  const recording = await getRecordingInfo(id);
  if (!safeKeyCompare(recording.info.key, key)) return errorResponse(APIErrorCode.INVALID_KEY, { status: 401 });
  if (!recExists.dataExists) return errorResponse(APIErrorCode.RECORDING_NO_DATA, { status: 404 });

  const job = await getLatestJob(id);
  if (job === false) return errorResponse(APIErrorCode.KITCHEN_UNAVAILABLE, { status: 503 });
  else if (job) {
    if (job.status !== 'running' && job.status !== 'queued') await cancelJob(job.id);
    else return errorResponse(APIErrorCode.JOB_ALREADY_EXISTS, { status: 400 });
  }

  const body = destr<PostJobBody>(await request.text());
  if (typeof body !== 'object') return errorResponse(APIErrorCode.INVALID_BODY, { status: 400 });
  const parsedOptions = validateOptions(recording.info, recording.users, body);
  if (!parsedOptions.valid) return errorResponse(parsedOptions.code, { status: 400 }, { error: parsedOptions.error });

  const newJob = await createJob({
    id,
    jobType: body.type,
    postTask: 'download',
    options: dev
      ? {
          ...parsedOptions.options,
          parallel: true,
          concurrency: 3
        }
      : parsedOptions.options
  });
  if (newJob === false) return errorResponse(APIErrorCode.KITCHEN_UNAVAILABLE, { status: 503 });

  return json({ job: minimizeJobInfo(newJob) });
};
