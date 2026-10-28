import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  return Response.json({ ok: true });
};
