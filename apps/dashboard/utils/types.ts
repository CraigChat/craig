export interface DiscordUser {
  id: string;
  username: string;
  avatar?: string;
  discriminator: string;
  public_flags: number;
  flags: number;
  locale: string;
  mfa_enabled: boolean;
  premium_type: number;
}

export interface PatreonUser {
  data: {
    id: string;
    type: 'user';
  };
}

export interface MicrosoftOAuthResponse {
  token_type: string;
  scope: string;
  expires_in: number;
  ext_expires_in: number;
  access_token: string;
  refresh_token: string;
  id_token: string;
}

export interface MicrosoftUser {
  displayName: string;
  userPrincipalName: string;
}
