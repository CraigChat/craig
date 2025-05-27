import { stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { error } from '@sveltejs/kit';
import { createReadStream } from 'fs';

import { DOWNLOADS_DIRECTORY } from '$lib/server/config';

import type { RequestHandler } from './$types';

const ExtToMime: Record<string, string> = {
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
  wav: 'audio/wav',
  zip: 'application/zip',
  exe: 'application/exe',
  mp3: 'audio/mpeg'
};

async function getStat(path: string) {
  try {
    return await stat(path);
  } catch (e) {
    return null;
  }
}

export const GET: RequestHandler = async ({ params }) => {
  const file = params.file;
  if (!/^(?:[\w-]+)(?:\.[a-z0-9]+)+$/.test(file)) error(404, 'Not Found');

  const filePath = join(DOWNLOADS_DIRECTORY, file);
  const stat = await getStat(filePath);

  if (!stat) error(404, 'Not Found');

  let streamEnded = false;
  const readStream = createReadStream(filePath);
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      readStream.on('data', (data) => controller.enqueue(data as Buffer));
      readStream.once('error', (err) => {
        streamEnded = true;
        controller.error(err);
        readStream.destroy();
      });
      readStream.once('end', () => {
        streamEnded = true;
        controller.close();
      });
      readStream.once('close', () => {
        if (!streamEnded) {
          streamEnded = true;
          controller.close();
        }
      });
    },
    cancel: () => {
      streamEnded = true;
      readStream.destroy();
    }
  });
  return new Response(stream, {
    headers: {
      'Content-Type': ExtToMime[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'max-age=604800',
      'Content-Disposition': 'attachment',
      'Content-Length': String(stat!.size)
    }
  });
};
