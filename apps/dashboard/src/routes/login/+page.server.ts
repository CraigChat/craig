import { redirect } from '@sveltejs/kit';

import { checkAuth } from '#lib/server/discord.js';
import { SESSION_COOKIE } from '#lib/server/jwt.js';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
  const sessionCookie = cookies.get(SESSION_COOKIE);
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (auth) return redirect(307, '/');
};
