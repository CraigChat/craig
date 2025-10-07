import { json } from '@sveltejs/kit';
import { destr } from 'destr';
import { z } from 'zod';

import { checkAuth } from '$lib/server/discord';

import type { RequestHandler } from './$types';
import { rateLimitRequest } from '$lib/server/redis';
import { errorResponse } from '$lib/server/util';
import { APIErrorCode } from '$lib/types';
import { prisma } from '@craig/db';

const Schema = z
  .object({
    driveService: z.literal(['google', 'onedrive', 'dropbox']).optional(),
    driveFormat: z.literal(['flac', 'aac', 'oggflac', 'heaac', 'opus', 'vorbis', 'adpcm', 'wav8']).optional(),
    driveContainer: z.literal(['aupzip', 'sesxzip', 'zip', 'mix']).optional(),
    driveEnabled: z.boolean().optional(),
    driveOptions: z
      .object({
        excludeBots: z.boolean().optional()
      })
      .optional(),
    webapp: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.driveFormat !== undefined && data.driveContainer === undefined)
      ctx.addIssue({
        code: 'custom',
        message: 'driveContainer is required when driveFormat is provided',
        path: ['driveContainer']
      });
    if (data.driveContainer !== undefined && data.driveFormat === undefined)
      ctx.addIssue({
        code: 'custom',
        message: 'driveFormat is required when driveContainer is provided',
        path: ['driveFormat']
      });
  });

export const POST: RequestHandler = async ({ cookies, getClientAddress, request }) => {
  const rlResponse = await rateLimitRequest(
    { cookies, getClientAddress },
    { prefix: 'user-settings', limit: 20, window: 10 }
  );
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get('session');
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return errorResponse(APIErrorCode.UNAUTHORIZED, { status: 401 });

  const body = destr(await request.text());
  if (typeof body !== 'object') return errorResponse(APIErrorCode.INVALID_BODY, { status: 400 });

  const parsed = Schema.safeParse(body);
  if (!parsed.success) return errorResponse(APIErrorCode.INVALID_BODY, { status: 400 }, { errors: z.treeifyError(parsed.error) });

  const user = await prisma.user.findUnique({ where: { id: auth.id } });

  if (
    (parsed.data.driveService ||
      parsed.data.driveContainer ||
      parsed.data.driveFormat ||
      typeof parsed.data.driveEnabled === 'boolean' ||
      parsed.data.driveOptions !== undefined) &&
    !user?.rewardTier
  )
    return errorResponse(APIErrorCode.NOT_SUPPORTER, { status: 400 });

  const { driveContainer: container, driveFormat: format } = parsed.data;
  if (container && format) {
    if (format !== 'flac' && (container === 'aupzip' || container === 'sesxzip')) return errorResponse(APIErrorCode.INVALID_FORMAT, { status: 400 });
    if (container === 'mix' && !['flac', 'vorbis', 'aac'].includes(format)) return errorResponse(APIErrorCode.INVALID_FORMAT, { status: 400 });
    if (container === 'mix' && !(user && (user.rewardTier >= 20 || user.rewardTier === -1)))
      return errorResponse(APIErrorCode.NEED_HIGHER_TIER, { status: 400 });
  }

  await prisma.user.upsert({
    where: { id: auth.id },
    create: { id: auth.id, ...parsed.data },
    update: { ...parsed.data }
  });

  return json({ ok: true });
};
