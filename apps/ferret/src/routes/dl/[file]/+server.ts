import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';

import { error } from '@sveltejs/kit';

import { DOWNLOADS_DIRECTORY } from '$lib/server/config';

import type { RequestHandler } from './$types';

const ExtToMime: Record<string, string> = {
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
  wav: 'audio/wav',
  zip: 'application/zip',
  exe: 'application/exe',
  mp3: 'audio/mpeg',
  oga: 'audio/ogg',
  opus: 'audio/ogg'
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

  const readStream = createReadStream(filePath);
  const stream = Readable.toWeb(readStream) as ReadableStream<Uint8Array>;
  const extension = extname(file).slice(1).toLowerCase();

  return new Response(stream, {
    headers: {
      'Content-Type': ExtToMime[extension] || 'application/octet-stream',
      'Cache-Control': 'max-age=604800',
      'Content-Disposition': 'attachment',
      'Content-Length': String(stat!.size)
    }
  });
};
