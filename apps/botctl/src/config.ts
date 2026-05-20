import './env.js';

import path from 'node:path';

function listFromEnv(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function pathFromEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return path.resolve(value || fallback);
}

export interface BotCTLConfig {
  discordToken: string;
  discordApplicationID: string;
  adminUsers: string[];
  storePath: string;
  loggerLevel: string;
}

export function getConfig(): BotCTLConfig {
  return {
    discordToken: process.env.BOTCTL_DISCORD_TOKEN || '',
    discordApplicationID: process.env.BOTCTL_DISCORD_APPLICATION_ID || '',
    adminUsers: listFromEnv('BOTCTL_ADMIN_USERS'),
    storePath: pathFromEnv('BOTCTL_STORE', path.resolve(process.cwd(), 'data/endpoints.json')),
    loggerLevel: process.env.BOTCTL_LOGGER_LEVEL || 'debug'
  };
}
