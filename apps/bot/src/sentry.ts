import { RewriteFrames } from '@sentry/integrations';
import * as Sentry from '@sentry/node';
import { Integrations } from '@sentry/tracing';
import config from 'config';
import Eris from 'eris';
import { CommandContext } from 'slash-create';

import Recording from './modules/recorder/recording';
import { prisma } from './prisma';

const sentryOpts: any = config.get('sentry');
Sentry.init({
  dsn: sentryOpts.dsn,
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new RewriteFrames({
      root: __dirname
    }),
    new Integrations.Prisma({ client: prisma })
  ],

  environment: sentryOpts.env || process.env.NODE_ENV || 'development',
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  release: `craig-bot@${require('../package.json').version}`,
  tracesSampleRate: sentryOpts.sampleRate ? parseFloat(sentryOpts.sampleRate) : 1.0
});

export function reportErrorFromCommand(ctx: CommandContext, error: any, commandName: string, type?: string) {
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

export function reportAutorecordingError(member: Eris.Member, guildId: string, channelId: string, error: any, recording?: Recording) {
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
  return Sentry.close();
}
