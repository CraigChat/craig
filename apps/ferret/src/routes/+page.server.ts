import { redirect } from '@sveltejs/kit';

import { dev } from '$app/environment';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  if (dev) return;

  redirect(307, 'https://craig.chat');
};
