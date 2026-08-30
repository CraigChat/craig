import { json } from '@sveltejs/kit';

import { getUserData } from '$lib/server/data';
import { checkAuth } from '$lib/server/discord';
import { rateLimitRequest } from '$lib/server/redis';
import { errorResponse } from '$lib/server/util';
import { APIErrorCode } from '$lib/types';

import type { RequestHandler } from './$types';

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
