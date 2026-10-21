import { json } from '@sveltejs/kit';

import { disconnectService } from '$lib/server/data';
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

  const googleUser = await disconnectService(auth.id, 'google', async (tx) => {
    return tx.deleteFrom('GoogleDriveUser').where('id', '=', auth.id).returning(['token', 'refreshToken']).executeTakeFirst();
  });

  const revokable = googleUser?.refreshToken ?? googleUser?.token;
  if (revokable) await googleOAuth2Client.revokeToken(revokable).catch((e) => logger.warn(`Failed to revoke Google token (user=${auth.id})`, e));

  return json({ ok: true });
};
