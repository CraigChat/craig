function validateEnv<T extends string = string>(key: keyof NodeJS.ProcessEnv, defaultValue?: T): T {
  const value = process.env[key] as T | undefined;

  if (!value) {
    if (typeof defaultValue !== 'undefined') {
      return defaultValue;
    } else if (!process.browser) {
      throw new Error(`${key} is not defined in environment variables`);
    }
  }

  return value;
}

export const config = {
  cookieName: 'token',
  clientId: validateEnv('CLIENT_ID'),
  clientSecret: validateEnv('CLIENT_SECRET'),
  patreonClientId: validateEnv('PATREON_CLIENT_ID'),
  patreonClientSecret: validateEnv('PATREON_CLIENT_SECRET'),
  patreonWebhookSecret: validateEnv('PATREON_WEBHOOK_SECRET'),
  patreonTierMap: validateEnv('PATREON_TIER_MAP', '{}'),
  googleClientId: validateEnv('GOOGLE_CLIENT_ID'),
  googleClientSecret: validateEnv('GOOGLE_CLIENT_SECRET'),
  microsoftClientId: validateEnv('MICROSOFT_CLIENT_ID'),
  microsoftClientSecret: validateEnv('MICROSOFT_CLIENT_SECRET'),
  dropboxClientId: validateEnv('DROPBOX_CLIENT_ID'),
  dropboxClientSecret: validateEnv('DROPBOX_CLIENT_SECRET'),
  appUri: validateEnv('APP_URI', 'http://localhost:3000'),
  jwtSecret: validateEnv('JWT_SECRET', 'this is a development value that should be changed in production!!!!!')
} as const;
