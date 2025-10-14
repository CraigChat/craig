import { json } from '@sveltejs/kit';

import { checkAuth } from '$lib/server/discord';

import type { RequestHandler } from './$types';
import { rateLimitRequest } from '$lib/server/redis';
import { prisma } from '@craig/db';
import { getUserData } from '$lib/server/data';
import { errorResponse } from '$lib/server/util';
import { APIErrorCode } from '$lib/types';

export const GET: RequestHandler = async ({ cookies, getClientAddress, isDataRequest }) => {
  if (!isDataRequest) {
    const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'me', limit: 30, window: 60 });
    if (rlResponse) return rlResponse;
  }

  const sessionCookie = cookies.get('session');
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return errorResponse(APIErrorCode.UNAUTHORIZED, { status: 401 });

  return json({
    user: auth.user,
    ...(await getUserData(auth.id))
  });
};
