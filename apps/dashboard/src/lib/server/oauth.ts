import { DropboxAuth } from 'dropbox';
import { google } from 'googleapis';

import { DROPBOX_CLIENT_SECRET, GOOGLE_CLIENT_SECRET } from '$app/env/private';
import { PUBLIC_BASE_URL, PUBLIC_DROPBOX_CLIENT_ID, PUBLIC_GOOGLE_CLIENT_ID } from '$app/env/public';

export const toRedirectUri = (service: string) => `${PUBLIC_BASE_URL || ''}/api/connections/${service}/callback`;
export const dropboxScopes = ['account_info.read', 'files.content.write'];
export const dbxAuth = new DropboxAuth({
  clientId: PUBLIC_DROPBOX_CLIENT_ID,
  clientSecret: DROPBOX_CLIENT_SECRET
});

export const googleOAuth2Client = new google.auth.OAuth2(PUBLIC_GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, toRedirectUri('google'));
