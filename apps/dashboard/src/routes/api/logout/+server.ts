import { redirect } from '@sveltejs/kit';

import { SESSION_COOKIE } from '#lib/server/jwt.js';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
  cookies.delete(SESSION_COOKIE, { path: '/' });

  throw redirect(302, '/');
};
