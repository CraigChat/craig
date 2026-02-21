import { isStreamOpen } from '$lib/server/redis';
import { SSEConnection, SSEResponse } from '$lib/server/sse/client';
import { sseManager } from '$lib/server/sse/manager';
import { getLatestJob, minimizeJobInfo, recordingExists, validateKey } from '$lib/server/util';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, params }) => {
  const key = url.searchParams.get('key') ?? '';
  const id = params.id;

  if (!key)
    return new SSEResponse([
      {
        event: 'end',
        data: { error: 'INVALID_RECORDING' }
      }
    ]);

  const recExists = await recordingExists(id);
  if (!recExists.available)
    return new SSEResponse([
      {
        event: 'end',
        data: { error: 'RECORDING_NOT_FOUND' }
      }
    ]);

  const validKey = await validateKey(id, key);
  if (!validKey)
    return new SSEResponse([
      {
        event: 'end',
        data: { error: 'INVALID_KEY' }
      }
    ]);

  const job = await getLatestJob(id);
  if (job === false)
    return new SSEResponse([
      {
        event: 'end',
        data: { error: 'KITCHEN_UNAVAILABLE' }
      }
    ]);
  else if (!job)
    return new SSEResponse([
      {
        event: 'end',
        data: { error: 'JOB_NOT_FOUND' }
      }
    ]);

  const streamOpen = await isStreamOpen(job.id);
  if (!streamOpen) return new SSEResponse([{ event: 'init', data: { streaming: false, job: minimizeJobInfo(job) } }, { event: 'end' }]);

  const connection = new SSEConnection();
  sseManager.push(job.id, connection);

  return new Response(connection.stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    }
  });
};
