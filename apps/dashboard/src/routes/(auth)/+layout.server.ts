import { error, redirect } from '@sveltejs/kit';

import { getUserData } from '#lib/server/data.js';
import { checkAuth } from '#lib/server/discord.js';
import { SESSION_COOKIE } from '#lib/server/jwt.js';

import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ cookies, url }) => {
  const sessionCookie = cookies.get(SESSION_COOKIE);
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;

  if (!auth) {
    if (url.pathname === '/') return redirect(307, '/login');
    return error(401, 'You need to login to do this', { code: 'NO_AUTH' });
  }

  return {
    user: auth.user,
    ...(await getUserData(auth.id))
  };
};
