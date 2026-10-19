import { open } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';

import { error } from '@sveltejs/kit';

import { DOWNLOADS_ACCEL_PATH, DOWNLOADS_DIRECTORY } from '$lib/server/config';

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

const CACHE_CONTROL = 'private, max-age=604800';

async function openFile(path: string) {
  const handle = await open(path, 'r').catch(() => null);
  if (!handle) return null;
  const stat = await handle.stat().catch(() => null);
  if (!stat?.isFile()) {
    await handle.close().catch(() => {});
    return null;
  }
  return { handle, stat };
}

function parseRange(header: string, size: number): { start: number; end: number } | 'invalid' | null {
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return null;

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = parseInt(match[2], 10);
    if (suffix === 0) return 'invalid';
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = parseInt(match[1], 10);
    end = match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1;
  }

  if (start >= size || end < start) return 'invalid';
  return { start, end };
}

export const GET: RequestHandler = async ({ params, request }) => {
  const file = params.file;
  if (!/^(?:[\w-]+)(?:\.[a-z0-9]+)+$/.test(file)) error(404, 'Not Found');

  const extension = extname(file).slice(1).toLowerCase();
  const baseHeaders: Record<string, string> = {
    'Content-Type': ExtToMime[extension] || 'application/octet-stream',
    'Cache-Control': CACHE_CONTROL,
    'Content-Disposition': 'attachment',
    'X-Content-Type-Options': 'nosniff'
  };

  const opened = await openFile(join(DOWNLOADS_DIRECTORY, file));
  if (!opened) error(404, 'Not Found');
  const { handle, stat } = opened;

  // Let nginx serve the file itself (sendfile, Range and conditional requests)
  if (DOWNLOADS_ACCEL_PATH) {
    await handle.close().catch(() => {});
    return new Response(null, {
      headers: { ...baseHeaders, 'X-Accel-Redirect': DOWNLOADS_ACCEL_PATH + file }
    });
  }

  const size = stat.size;
  const lastModified = stat.mtime.toUTCString();
  const etag = `W/"${size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers: Record<string, string> = {
    ...baseHeaders,
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Last-Modified': lastModified
  };

  const ifNoneMatch = request.headers.get('If-None-Match');
  const ifModifiedSince = request.headers.get('If-Modified-Since');
  const notModified = ifNoneMatch
    ? ifNoneMatch.split(',').some((tag) => tag.trim() === etag || tag.trim() === '*')
    : !!ifModifiedSince && Math.floor(stat.mtimeMs / 1000) <= Math.floor(Date.parse(ifModifiedSince) / 1000);
  if (notModified) {
    await handle.close().catch(() => {});
    return new Response(null, { status: 304, headers });
  }

  const rangeHeader = request.headers.get('Range');
  const ifRange = request.headers.get('If-Range');
  const range = rangeHeader && (!ifRange || ifRange === etag || ifRange === lastModified) ? parseRange(rangeHeader, size) : null;

  if (range === 'invalid') {
    await handle.close().catch(() => {});
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  headers['Content-Length'] = String(size === 0 ? 0 : end - start + 1);
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  const status = range ? 206 : 200;

  if (request.method === 'HEAD' || size === 0) {
    await handle.close().catch(() => {});
    return new Response(null, { status, headers });
  }

  const readStream = handle.createReadStream({ start, end });
  request.signal.addEventListener('abort', () => readStream.destroy());
  const stream = Readable.toWeb(readStream) as ReadableStream<Uint8Array>;

  return new Response(stream, { status, headers });
};
