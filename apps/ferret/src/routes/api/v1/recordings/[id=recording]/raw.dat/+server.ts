import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { PassThrough } from 'stream';
import { pipeline } from 'stream/promises';

import { errorResponse, getRecordingInfo, recordingExists } from '$lib/server/util';
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

  const basePath = `/workspaces/craig/rec/${id}.ogg`;
  const files = [`${basePath}.header1`, `${basePath}.header2`, `${basePath}.data`];

  const sizes = await Promise.all(files.map((file) => stat(file)));
  const totalSize = sizes.reduce((total, stats) => total + stats.size, 0);

  const outputStream = new PassThrough();

  // Create a ReadableStream from the PassThrough
  const readableStream = new ReadableStream({
    start(controller) {
      outputStream.on('data', (chunk: Uint8Array) => {
        controller.enqueue(chunk);
      });
      outputStream.on('end', () => {
        controller.close();
      });
      outputStream.on('error', (err: Error) => {
        controller.error(err);
      });
    }
  });

  const response = new Response(readableStream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'max-age=120',
      'Content-Disposition': `attachment; filename="craig-${id}-raw.dat"`,
      'Content-Length': totalSize.toString()
    }
  });

  (async () => {
    try {
      for (const file of files) {
        const readStream = createReadStream(file);
        await pipeline(readStream, outputStream, { end: false });
      }
      outputStream.end();
    } catch (err) {
      outputStream.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return response;
}) satisfies RequestHandler;
