import { checkAuth } from '$lib/server/discord';
import { error, redirect } from '@sveltejs/kit';

import type { LayoutServerLoad } from './$types';
import { getUserData } from '$lib/server/data';

export const load: LayoutServerLoad = async ({ cookies, url }) => {
  const sessionCookie = cookies.get('session');
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;

  if (!auth) {
    if (url.pathname === '/') return redirect(307, '/login');
    return error(401, { code: 'NO_AUTH', message: 'You need to login to do this' });
  }

  return {
    user: auth.user,
    ...(await getUserData(auth.id))
  };
};
