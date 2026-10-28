import { disconnectService } from '#lib/server/data.js';
import { checkAuth } from '#lib/server/discord.js';
import { SESSION_COOKIE } from '#lib/server/jwt.js';
import { logger } from '#lib/server/logger.js';
import { googleOAuth2Client } from '#lib/server/oauth.js';
import { rateLimitRequest } from '#lib/server/redis.js';
import { errorResponse } from '#lib/server/util.js';
import { APIErrorCode } from '#lib/types.js';

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

  return Response.json({ ok: true });
};
