import { defineEnvVars } from '@sveltejs/kit/env';

import { building } from '$app/env';

const optional = (input: string | undefined) => input;
const required = (input: string | undefined) => {
  if (!input && !building) throw new Error('This environment variable is required.');
  return input as string;
};

export const variables = defineEnvVars({
  JWT_SECRET: { schema: required },
  PUBLIC_PLAUSIBLE_HOSTNAME: { public: true, schema: optional },
  PUBLIC_HOSTNAME: { public: true, schema: optional },
  PATREON_WEBHOOK_SECRET: { schema: optional },
  DISCORD_CLIENT_SECRET: { schema: required },
  DISCORD_REDIRECT_URI: { schema: required },
  PUBLIC_DISCORD_CLIENT_ID: { public: true, schema: required },
  PUBLIC_PATREON_CLIENT_ID: { public: true, schema: optional },
  PATREON_CLIENT_SECRET: { schema: optional },
  MICROSOFT_CLIENT_SECRET: { schema: optional },
  PUBLIC_MICROSOFT_CLIENT_ID: { public: true, schema: optional },
  GOOGLE_CLIENT_SECRET: { schema: optional },
  PUBLIC_GOOGLE_CLIENT_ID: { public: true, schema: optional },
  DROPBOX_CLIENT_SECRET: { schema: optional },
  PUBLIC_DROPBOX_CLIENT_ID: { public: true, schema: optional },
  BOX_CLIENT_SECRET: { schema: optional },
  PUBLIC_BOX_CLIENT_ID: { public: true, schema: optional },
  PUBLIC_PATREON_URL: { public: true, schema: optional },
  PUBLIC_BASE_URL: { public: true, schema: optional },
  REDIS_HOST: { schema: optional },
  REDIS_PORT: { schema: optional },
  REDIS_DATABASE: { schema: optional },
  REDIS_PREFIX: { schema: optional },
  PATREON_TIER_MAP: { schema: optional },
  PUBLIC_CRAIG_ENV: { public: true, schema: optional }
});
