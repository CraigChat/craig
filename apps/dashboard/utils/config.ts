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
  appUri: validateEnv('APP_URI', 'http://localhost:3000'),
  jwtSecret: validateEnv('JWT_SECRET', 'this is a development value that should be changed in production!!!!!')
} as const;
