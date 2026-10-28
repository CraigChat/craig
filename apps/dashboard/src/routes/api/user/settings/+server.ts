import { db } from '@craig/db';
import { destr } from 'destr';
import { z } from 'zod';

import { DRIVE_SERVICES, type DriveService, isServiceConnected } from '#lib/server/data.js';
import { checkAuth } from '#lib/server/discord.js';
import { SESSION_COOKIE } from '#lib/server/jwt.js';
import { rateLimitRequest } from '#lib/server/redis.js';
import { errorResponse } from '#lib/server/util.js';
import { APIErrorCode } from '#lib/types.js';

import type { RequestHandler } from './$types';

const Schema = z
  .object({
    driveService: z.literal(DRIVE_SERVICES).optional(),
    driveFormat: z.literal(['flac', 'aac', 'oggflac', 'heaac', 'opus', 'vorbis', 'adpcm', 'wav8']).optional(),
    driveContainer: z.literal(['aupzip', 'sesxzip', 'zip', 'mix']).optional(),
    driveEnabled: z.boolean().optional(),
    driveOptions: z
      .object({
        excludeBots: z.boolean().optional(),
        includeTranscription: z.literal([null, 'vtt', 'srt', 'txt']).optional()
      })
      .optional(),
    webapp: z.boolean().optional()
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
  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'user-settings', limit: 20, window: 10 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get(SESSION_COOKIE);
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return errorResponse(APIErrorCode.UNAUTHORIZED, { status: 401 });

  let body: unknown;
  try {
    body = destr(await request.text(), { strict: true });
  } catch {
    return errorResponse(APIErrorCode.INVALID_BODY, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) return errorResponse(APIErrorCode.INVALID_BODY, { status: 400 });

  const parsed = Schema.safeParse(body);
  if (!parsed.success) return errorResponse(APIErrorCode.INVALID_BODY, { status: 400 }, { errors: z.treeifyError(parsed.error) });

  const user = await db.selectFrom('User').select(['rewardTier', 'driveService', 'driveOptions']).where('id', '=', auth.id).executeTakeFirst();

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

  if (parsed.data.driveOptions?.includeTranscription && !(user && (user.rewardTier >= 30 || user.rewardTier === -1)))
    return errorResponse(APIErrorCode.NEED_HIGHER_TIER, { status: 400 });

  // Only allow selecting or enabling a provider the user has actually linked
  if (parsed.data.driveService !== undefined || parsed.data.driveEnabled === true) {
    const service = parsed.data.driveService ?? (user?.driveService as DriveService | undefined) ?? 'google';
    if (!(await isServiceConnected(auth.id, service))) return errorResponse(APIErrorCode.FEATURE_UNAVAILABLE, { status: 400 });
  }

  const userDriveOptions = user?.driveOptions && typeof user.driveOptions === 'object' && !Array.isArray(user.driveOptions) ? user.driveOptions : {};
  const driveOptions = JSON.stringify({ ...userDriveOptions, ...(parsed.data.driveOptions ?? {}) });
  await db
    .insertInto('User')
    .values({ id: auth.id, ...parsed.data, driveOptions })
    .onConflict((oc) => oc.column('id').doUpdateSet({ ...parsed.data, driveOptions }))
    .execute();

  return Response.json({ ok: true });
};
