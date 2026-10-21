import { formatWithOptions } from 'node:util';

import type Dysnomia from '@projectdysnomia/dysnomia';
import * as Sentry from '@sentry/node';
import type { CommandContext } from 'slash-create';

import { getSentryOptions } from './config.js';
import { type default as Recording, RecordingState } from './modules/recorder/recording.js';

const sentryOpts = getSentryOptions();
const BREADCRUMB_LEVELS: Record<string, Sentry.SeverityLevel> = { info: 'info', warn: 'warning', error: 'error' };
// Shard-wide events; other modules log per-user activity that only belongs on that interaction's events
const PROCESS_CATEGORIES = new Set(['bot', 'sys', 'dysnomia', 'sharding']);
const rootIsolationScope = sentryOpts ? Sentry.getIsolationScope() : null;

// The logger writes to stdout directly, so the console integration never sees it
export function addLogBreadcrumb(level: string, moduleName: string, args: any[]) {
  if (!sentryOpts || !BREADCRUMB_LEVELS[level]) return;
  // Uncaught exceptions and unhandled rejections are already captured as events
  if (moduleName === 'sys' && level === 'error') return;
  if (!PROCESS_CATEGORIES.has(moduleName) && Sentry.getIsolationScope() === rootIsolationScope) return;
  Sentry.addBreadcrumb({
    category: moduleName,
    level: BREADCRUMB_LEVELS[level],
    message: formatWithOptions(
      { depth: 1, breakLength: Infinity },
      ...args.map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : arg))
    )
  });
}

export function withInteractionScope<T>(callback: () => T): T {
  if (!sentryOpts) return callback();
  return Sentry.withIsolationScope(() => callback());
}

function summarizeRecording(recording: Recording) {
  return {
    id: recording.id,
    state: RecordingState[recording.state],
    autorecorded: recording.autorecorded,
    webapp: !!recording.options?.webapp,
    includeBots: !!recording.options?.includeBots,
    tier: recording.rewards?.tier ?? null,
    startedAt: recording.startedAt?.toISOString() ?? null,
    users: Object.keys(recording.users).length,
    bytesWritten: recording.bytesWritten,
    latency: recording.latency,
    voiceVersion: recording.voiceVersion ?? null,
    rtcWorkerVersion: recording.rtcWorkerVersion ?? null,
    encryptionRecoveryAttempts: recording.encryptionRecoveryAttempts
  };
}

function summarizeContext(ctx: CommandContext) {
  let opts = ctx.options;
  for (const sub of ctx.subcommands) opts = opts?.[sub];
  const optionNames = opts && typeof opts === 'object' ? Object.keys(opts) : [];

  return {
    subcommands: ctx.subcommands,
    optionNames,
    interactionID: ctx.interactionID,
    locale: ctx.locale
  };
}

export function reportErrorFromCommand(ctx: CommandContext, error: any, commandName: string, type?: string) {
  if (!sentryOpts) return;
  Sentry.withScope((scope) => {
    scope.setTag('type', type || 'generic');
    if (commandName) scope.setTag('command', commandName);
    scope.setTag('guild', ctx ? ctx.guildID : undefined);
    scope.setTag('channel', ctx ? ctx.channelID : undefined);
    scope.setExtra('ctx', ctx ? summarizeContext(ctx) : undefined);
    scope.setUser({
      id: ctx ? ctx.user.id : undefined,
      username: ctx ? ctx.user.username : undefined
    });
    Sentry.captureException(error);
  });
}

export function reportRecordingError(ctx: CommandContext, error: any, recording?: Recording) {
  if (!sentryOpts) return;
  Sentry.withScope((scope) => {
    scope.setTag('type', 'command');
    scope.setTag('command', 'join');
    if (recording) {
      scope.setTag('recording', recording.id);
      scope.setContext('recording', summarizeRecording(recording));
    }
    scope.setTag('guild', ctx ? ctx.guildID : undefined);
    scope.setTag('channel', ctx ? ctx.channelID : undefined);
    scope.setExtra('ctx', ctx ? summarizeContext(ctx) : undefined);
    scope.setUser({
      id: ctx ? ctx.user.id : undefined,
      username: ctx ? ctx.user.username : undefined
    });
    Sentry.captureException(error);
  });
}

export function reportAutorecordingError(member: Dysnomia.Member, guildId: string, channelId: string, error: any, recording?: Recording) {
  if (!sentryOpts) return;
  Sentry.withScope((scope) => {
    scope.setTag('type', 'autorecord');
    if (recording) {
      scope.setTag('recording', recording.id);
      scope.setContext('recording', summarizeRecording(recording));
    }
    scope.setTag('guild', guildId);
    scope.setTag('channel', channelId);
    scope.setUser({
      id: member.id,
      username: member.username
    });
    Sentry.captureException(error);
  });
}

export function close() {
  if (!sentryOpts) return;
  return Sentry.close();
}
