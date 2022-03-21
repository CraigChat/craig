import { DiscordUser } from './types';
import { parse } from 'cookie';
import { verify } from 'jsonwebtoken';
import { config } from './config';
import { IncomingMessage } from 'node:http';

export function parseUser(req: IncomingMessage): DiscordUser | null {
  if (!req.headers.cookie) return null;
  const token = parse(req.headers.cookie)[config.cookieName];
  if (!token) return null;

  try {
    const { iat, exp, ...user } = verify(token, config.jwtSecret) as DiscordUser & { iat: number; exp: number };
    return user;
  } catch (e) {
    return null;
  }
}

export function getAvatarUrl(user: DiscordUser): string {
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
  return `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator) % 5}.png`;
}
