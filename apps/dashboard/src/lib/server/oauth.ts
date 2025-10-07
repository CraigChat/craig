import { DropboxAuth } from 'dropbox';
import { google } from 'googleapis';
import { PUBLIC_DROPBOX_CLIENT_ID, PUBLIC_GOOGLE_CLIENT_ID } from '$env/static/public';
import { DROPBOX_CLIENT_SECRET, GOOGLE_CLIENT_SECRET } from '$env/static/private';
import { PUBLIC_BASE_URL } from '$env/static/public';

export const toRedirectUri = (service: string) => `${PUBLIC_BASE_URL}/api/connections/${service}/callback`;
export const dropboxScopes = ['account_info.read', 'files.content.write'];
export const dbxAuth = new DropboxAuth({
  clientId: PUBLIC_DROPBOX_CLIENT_ID,
  clientSecret: DROPBOX_CLIENT_SECRET
});

export const googleOAuth2Client = new google.auth.OAuth2(PUBLIC_GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, toRedirectUri('google'));
