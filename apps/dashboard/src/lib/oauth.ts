import { PUBLIC_BASE_URL, PUBLIC_MICROSOFT_CLIENT_ID, PUBLIC_PATREON_CLIENT_ID, PUBLIC_GOOGLE_CLIENT_ID } from "$env/static/public";

export const toRedirectUri = (service: string) => `${PUBLIC_BASE_URL}/api/connections/${service}/callback`;

export const PATREON_REDIRECT_URI = `${PUBLIC_BASE_URL}/api/connections/patreon/callback`;
export const PATREON_OAUTH_URL = `https://www.patreon.com/oauth2/authorize?${new URLSearchParams({
  client_id: PUBLIC_PATREON_CLIENT_ID,
  redirect_uri: toRedirectUri('patreon'),
  response_type: 'code'
}).toString()}`;

export const microsoftScopes = ['Files.ReadWrite.AppFolder', 'offline_access', 'openid', 'profile', 'User.Read'];
export const MICROSOFT_OAUTH_URL = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${new URLSearchParams({
  client_id: PUBLIC_MICROSOFT_CLIENT_ID,
  scope: microsoftScopes.join(' '),
  redirect_uri: toRedirectUri('microsoft'),
  response_type: 'code'
})}`;

export const googleScopes = ['https://www.googleapis.com/auth/drive.file'];
export const GOOGLE_OAUTH_URL = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  access_type: 'offline',
  scope: googleScopes.join(' '),
  response_type: 'code',
  client_id: PUBLIC_GOOGLE_CLIENT_ID,
  redirect_uri: toRedirectUri('google')
})}`;
