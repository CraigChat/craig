import { DropboxAuth } from 'dropbox';
import { google } from 'googleapis';
import { env } from '$env/dynamic/private';
import { env as envPub } from '$env/dynamic/public';
import { PUBLIC_BASE_URL } from '$env/static/public';

export const toRedirectUri = (service: string) => `${PUBLIC_BASE_URL}/api/connections/${service}/callback`;
export const dropboxScopes = ['account_info.read', 'files.content.write'];
export const dbxAuth = new DropboxAuth({
  clientId: envPub.PUBLIC_DROPBOX_CLIENT_ID,
  clientSecret: env.DROPBOX_CLIENT_SECRET
});

export const googleOAuth2Client = new google.auth.OAuth2(envPub.PUBLIC_GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, toRedirectUri('google'));
