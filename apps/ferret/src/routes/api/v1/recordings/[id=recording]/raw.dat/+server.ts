import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { join } from 'path';

import { REC_DIRECTORY } from '$lib/server/config';
import { errorResponse, getRecordingInfo, recordingExists } from '$lib/server/util';
import { APIErrorCode } from '$lib/types';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, params, request }) => {
  const key = url.searchParams.get('key') ?? '';
  const id = params.id;

  if (!key) return errorResponse(APIErrorCode.KEY_REQUIRED, { status: 400 });

  const recExists = await recordingExists(id);
  if (!recExists.available) return errorResponse(APIErrorCode.RECORDING_NOT_FOUND, { status: 404 });

  const recording = await getRecordingInfo(id);
  if (recording.info.key !== key) return errorResponse(APIErrorCode.INVALID_KEY, { status: 401 });
  if (recording.users.length !== 0 && !recExists.dataExists) return errorResponse(APIErrorCode.RECORDING_NO_DATA, { status: 404 });

  const recFileBase = join(REC_DIRECTORY, `${id}.ogg`);
  const files = [`${recFileBase}.header1`, `${recFileBase}.header2`, `${recFileBase}.data`];

  const sizes = await Promise.all(files.map((file) => stat(file)));
  const totalSize = sizes.reduce((total, stats) => total + stats.size, 0);

  const abortController = new AbortController();
  const readableStream = new ReadableStream({
    async start(controller) {
      const openStreams = [];
      try {
        for (const file of files) {
          if (request.signal.aborted || abortController.signal.aborted) break;
          const stream = createReadStream(file);
          openStreams.push(stream);

          for await (const chunk of stream) {
            if (request.signal.aborted || abortController.signal.aborted) {
              for (const s of openStreams) {
                try {
                  s.destroy();
                } catch {}
              }
              controller.close();
              return;
            }
            controller.enqueue(new Uint8Array(chunk));
          }
          stream.close();

          openStreams.pop();
        }

        controller.close();
      } catch (err) {
        for (const s of openStreams)
          try {
            s.destroy();
          } catch {}
        controller.error(err instanceof Error ? err : new Error(String(err)));
      }
    },
    cancel() {
      abortController.abort();
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

  return response;
};
