import { disconnectService } from '#lib/server/data.js';
import { checkAuth } from '#lib/server/discord.js';
import { SESSION_COOKIE } from '#lib/server/jwt.js';
import { rateLimitRequest } from '#lib/server/redis.js';
import { errorResponse } from '#lib/server/util.js';
import { APIErrorCode } from '#lib/types.js';

import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ cookies, getClientAddress }) => {
  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'disconnect-box', limit: 5, window: 60 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get(SESSION_COOKIE);
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return errorResponse(APIErrorCode.UNAUTHORIZED, { status: 401 });

  await disconnectService(auth.id, 'box', (tx) => tx.deleteFrom('BoxUser').where('id', '=', auth.id).execute());

  return Response.json({ ok: true });
};
