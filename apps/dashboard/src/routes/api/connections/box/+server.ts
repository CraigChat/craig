import { checkAuth } from "$lib/server/discord";
import { rateLimitRequest } from "$lib/server/redis";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { prisma } from "@craig/db";
import { errorResponse } from "$lib/server/util";
import { APIErrorCode } from "$lib/types";
import { setNextAvailableService } from "$lib/server/data";

export const DELETE: RequestHandler = async ({ cookies, getClientAddress }) => {
  const rlResponse = await rateLimitRequest(
    { cookies, getClientAddress },
    { prefix: 'disconnect-box', limit: 5, window: 60 }
  );
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get('session');
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return errorResponse(APIErrorCode.UNAUTHORIZED, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: auth.id } });
  if (user) await setNextAvailableService(user, 'box');

  await prisma.boxUser.delete({ where: { id: auth.id } }).catch(() => {});

  return json({ ok: true });
};
