import { writeHeapSnapshot } from 'node:v8';

import { json } from '@sveltejs/kit';

import { env } from '$env/dynamic/private';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  if (request.headers.has('x-real-ip') || request.headers.has('cf-connecting-ip')) return json({ ok: false }, { status: 401 });
  if (!env.SNAPSHOT_KEY || request.headers.get('authorization') !== env.SNAPSHOT_KEY) return json({ ok: false }, { status: 401 });
  const filename = writeHeapSnapshot();
  return json({ filename });
};
