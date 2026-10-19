import { prisma } from '@craig/db';
import { json } from '@sveltejs/kit';

import { setNextAvailableService } from '$lib/server/data';
import { checkAuth } from '$lib/server/discord';
import { SESSION_COOKIE } from '$lib/server/jwt';
import { logger } from '$lib/server/logger';
import { googleOAuth2Client } from '$lib/server/oauth';
import { rateLimitRequest } from '$lib/server/redis';
import { errorResponse } from '$lib/server/util';
import { APIErrorCode } from '$lib/types';

import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ cookies, getClientAddress }) => {
  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'disconnect-google', limit: 5, window: 60 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get(SESSION_COOKIE);
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return errorResponse(APIErrorCode.UNAUTHORIZED, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: auth.id } });
  if (user) await setNextAvailableService(user, 'google');

  const googleUser = await prisma.googleDriveUser.findUnique({ where: { id: auth.id } });
  await prisma.googleDriveUser.delete({ where: { id: auth.id } }).catch(() => {});

  const revokable = googleUser?.refreshToken ?? googleUser?.token;
  if (revokable) await googleOAuth2Client.revokeToken(revokable).catch((e) => logger.warn(`Failed to revoke Google token (user=${auth.id})`, e));

  return json({ ok: true });
};
