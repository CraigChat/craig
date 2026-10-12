import type Dysnomia from '@projectdysnomia/dysnomia';
import * as Sentry from '@sentry/node';
import type { CommandContext } from 'slash-create';

import { getSentryOptions } from './config.js';
import type Recording from './modules/recorder/recording.js';

const sentryOpts = getSentryOptions();

export function reportErrorFromCommand(ctx: CommandContext, error: any, commandName: string, type?: string) {
  if (!sentryOpts) return;
  Sentry.withScope((scope) => {
    scope.setTag('type', type || 'generic');
    if (commandName) scope.setTag('command', commandName);
    scope.setTag('user', ctx ? ctx.user.id : undefined);
    scope.setTag('guild', ctx ? ctx.guildID : undefined);
    scope.setTag('channel', ctx ? ctx.channelID : undefined);
    scope.setExtra('ctx', ctx);
    scope.setUser({
      id: ctx ? ctx.user.id : undefined,
      username: ctx ? ctx.user.username : undefined,
      discriminator: ctx ? ctx.user.discriminator : undefined
    });
    Sentry.captureException(error);
  });
}

export function reportRecordingError(ctx: CommandContext, error: any, recording?: Recording) {
  if (!sentryOpts) return;
  Sentry.withScope((scope) => {
    scope.setTag('type', 'command');
    scope.setTag('command', 'join');
    if (recording) scope.setTag('recording', recording.id);
    scope.setTag('user', ctx ? ctx.user.id : undefined);
    scope.setTag('guild', ctx ? ctx.guildID : undefined);
    scope.setTag('channel', ctx ? ctx.channelID : undefined);
    scope.setExtra('ctx', ctx);
    scope.setUser({
      id: ctx ? ctx.user.id : undefined,
      username: ctx ? ctx.user.username : undefined,
      discriminator: ctx ? ctx.user.discriminator : undefined
    });
    Sentry.captureException(error);
  });
}

export function reportAutorecordingError(member: Dysnomia.Member, guildId: string, channelId: string, error: any, recording?: Recording) {
  if (!sentryOpts) return;
  Sentry.withScope((scope) => {
    scope.setTag('type', 'autorecord');
    if (recording) scope.setTag('recording', recording.id);
    scope.setTag('user', member.id);
    scope.setTag('guild', guildId);
    scope.setTag('channel', channelId);
    scope.setUser({
      id: member.id,
      username: member.username,
      discriminator: member.discriminator
    });
    Sentry.captureException(error);
  });
}

export function close() {
  if (!sentryOpts) return;
  return Sentry.close();
}
