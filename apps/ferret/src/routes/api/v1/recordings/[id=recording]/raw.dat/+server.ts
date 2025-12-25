import { open, stat } from 'fs/promises';
import { join } from 'path';
import { Readable } from 'stream';

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

  // Check all files exist and get sizes
  const sizes = await Promise.all(files.map((file) => stat(file).catch(() => null)));
  if (sizes.some((s) => s === null)) return errorResponse(APIErrorCode.RECORDING_NO_DATA, { status: 404 });
  const fileSizes = sizes.map((s) => s!.size);
  const totalSize = fileSizes.reduce((total, size) => total + size, 0);

  // Parse Range header for resume support
  const rangeHeader = request.headers.get('Range');
  let rangeStart = 0;
  let rangeEnd = totalSize - 1;
  let isPartial = false;

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      rangeStart = parseInt(match[1], 10);
      if (match[2]) rangeEnd = parseInt(match[2], 10);
      if (rangeStart >= 0 && rangeStart < totalSize) {
        isPartial = true;
        rangeEnd = Math.min(rangeEnd, totalSize - 1);
      } else
        return errorResponse(APIErrorCode.INVALID_RANGE, {
          status: 416,
          headers: { 'Content-Range': `bytes */${totalSize}` }
        });
    }
  }

  const contentLength = rangeEnd - rangeStart + 1;

  // Create a combined Node.js readable stream from all files with range support
  async function* generateChunks(): AsyncGenerator<Buffer> {
    let globalOffset = 0;
    let bytesToSkip = rangeStart;
    let bytesRemaining = contentLength;

    for (let i = 0; i < files.length && bytesRemaining > 0; i++) {
      const file = files[i];
      const fileSize = fileSizes[i];

      // Skip entire file if range starts after it
      if (bytesToSkip >= fileSize) {
        bytesToSkip -= fileSize;
        globalOffset += fileSize;
        continue;
      }

      if (request.signal.aborted) return;

      const handle = await open(file, 'r');
      try {
        const startInFile = bytesToSkip;
        bytesToSkip = 0;

        const stream = handle.createReadStream({
          start: startInFile,
          highWaterMark: 256 * 1024
        });

        for await (const chunk of stream) {
          if (request.signal.aborted) {
            stream.destroy();
            return;
          }

          let data: Buffer = chunk;
          if (data.length > bytesRemaining) data = data.subarray(0, bytesRemaining);

          bytesRemaining -= data.length;
          yield data;

          if (bytesRemaining <= 0) {
            stream.destroy();
            break;
          }
        }
      } finally {
        await handle.close().catch(() => {});
      }

      globalOffset += fileSize;
    }
  }

  const nodeStream = Readable.from(generateChunks(), { highWaterMark: 256 * 1024 });
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

  request.signal.addEventListener('abort', () => {
    nodeStream.destroy();
  });

  const headers: HeadersInit = {
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Content-Disposition': `attachment; filename="craig-${id}-raw.dat"`,
    'Content-Length': contentLength.toString(),
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
    'X-Accel-Buffering': 'no'
  };

  if (isPartial) {
    headers['Content-Range'] = `bytes ${rangeStart}-${rangeEnd}/${totalSize}`;
    return new Response(webStream, { status: 206, headers });
  }

  return new Response(webStream, { headers });
};
