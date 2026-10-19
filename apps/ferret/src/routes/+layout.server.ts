import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, request }) => ({
  lang: locals.lang,
  userAgent: request.headers.get('user-agent') ?? ''
});
