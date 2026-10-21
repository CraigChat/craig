import './env.js';

import * as Sentry from '@sentry/node';

import packageJson from '../package.json';
import { getSentryOptions } from './config.js';

const MAX_BREADCRUMB_LENGTH = 500;
const FILTERED = '[Filtered]';

const SENSITIVE_KEYS = new Set(['token', 'interactiontoken', 'accesskey', 'deletekey', 'ennuikey', 'authorization', 'password', 'secret']);
const SENSITIVE_PATTERNS: [RegExp, string][] = [
  // Interaction tokens in REST paths (/webhooks/:appID/:token, /interactions/:id/:token/callback)
  [/(\/(?:webhooks|interactions)\/\d+\/)[\w.-]+/g, `$1${FILTERED}`],
  // Recording keys in download/webapp links
  [/([?&](?:key|delete|token)=)[^&\s"'`]+/gi, `$1${FILTERED}`],
  // Recording keys in logged objects
  [/((?:access|delete|ennui)Key["']?\s*[:=]\s*)(["'`]?)[\w-]+\2/g, `$1"${FILTERED}"`],
  // Row values in Postgres error details (unique/foreign key and constraint violations)
  [/(Key \(.*?\)=\().*?(\) (?:already exists|is not present|is still referenced|conflicts with))/g, `$1${FILTERED}$2`],
  [/(Failing row contains \().*(\))/g, `$1${FILTERED}$2`],
  // Discord bot tokens
  [/[\w-]{24,}\.[\w-]{6}\.[\w-]{27,}/g, FILTERED],
  // ANSI colors from the logger
  // eslint-disable-next-line no-control-regex
  [/\x1b\[[\d;]*m/g, '']
];

const IGNORED_DISCORD_CODES = new Set([
  10003, // Unknown channel
  10004, // Unknown guild
  10008, // Unknown message
  10015, // Unknown webhook
  10062, // Unknown interaction
  20009, // Explicit content cannot be sent to the desired recipient(s)
  40004, // Send messages has been temporarily disabled
  40060, // Interaction has already been acknowledged
  50001, // Missing access
  50007, // Cannot send messages to this user
  50013, // Missing permissions
  50027 // Invalid webhook token
]);

function getDiscordCode(error: unknown): number | undefined {
  if (!(error instanceof Error) || !error.name.startsWith('DiscordRESTError')) return;
  const code = (error as any).response?.code;
  return typeof code === 'number' ? code : undefined;
}

function scrubString(value: string) {
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) value = value.replace(pattern, replacement);
  return value;
}

function scrub<T>(value: T, depth = 0): T {
  if (typeof value === 'string') return scrubString(value) as T;
  if (!value || typeof value !== 'object' || depth > 10) return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1)) as T;
  const out: Record<string, any> = {};
  for (const [key, v] of Object.entries(value)) out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? FILTERED : scrub(v, depth + 1);
  return out as T;
}

const sentryOpts = getSentryOptions();
if (sentryOpts) {
  const tracesSampleRate = sentryOpts.sampleRate ? parseFloat(sentryOpts.sampleRate) : 0;
  const tracing = tracesSampleRate > 0;

  Sentry.init({
    dsn: sentryOpts.dsn,
    defaultIntegrations: false,
    integrations: [
      Sentry.eventFiltersIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
      Sentry.systemErrorIntegration(),
      Sentry.consoleIntegration(),
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration({ mode: 'none' }),
      Sentry.nodeContextIntegration({ cloudResource: false, culture: false }),
      Sentry.rewriteFramesIntegration({ root: process.cwd() }),
      ...(tracing ? [Sentry.httpIntegration(), Sentry.nativeNodeFetchIntegration(), Sentry.postgresIntegration({ ignoreConnectSpans: true })] : [])
    ],
    maxBreadcrumbs: 30,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { deny: ['authorization', 'proxy-authorization', 'cookie', 'set-cookie'] },
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
      frameContextLines: 0
    },
    environment: sentryOpts.env || process.env.NODE_ENV || 'development',
    release: `craig-bot@${packageJson.version}`,
    initialScope: process.env.SHARD_ID
      ? {
          tags: { shard: process.env.SHARD_ID },
          contexts: { shard: { id: Number(process.env.SHARD_ID) } }
        }
      : undefined,
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === 'console' && breadcrumb.data) delete breadcrumb.data.arguments;
      if (breadcrumb.message) {
        const message = scrubString(breadcrumb.message);
        breadcrumb.message = message.length > MAX_BREADCRUMB_LENGTH ? `${message.slice(0, MAX_BREADCRUMB_LENGTH)}…` : message;
      }
      if (breadcrumb.data) breadcrumb.data = scrub(breadcrumb.data);
      return breadcrumb;
    },
    beforeSend(event, hint) {
      // Enrich Discord errors a bit (slash-create didnt format it properly)
      const discordCode = getDiscordCode(hint.originalException);
      if (discordCode !== undefined) {
        if (IGNORED_DISCORD_CODES.has(discordCode)) return null;
        const name = (hint.originalException as Error).name;
        for (const exception of event.exception?.values ?? []) if (exception.type === name) exception.type = `DiscordRESTError [${discordCode}]`;
      }

      // Scrubbing
      if (event.message) event.message = scrubString(event.message);
      if (event.logentry?.message) event.logentry.message = scrubString(event.logentry.message);
      for (const exception of event.exception?.values ?? []) if (exception.value) exception.value = scrubString(exception.value);
      if (event.extra) event.extra = scrub(event.extra);
      if (event.contexts) event.contexts = scrub(event.contexts);

      return event;
    },
    beforeSendSpan(span) {
      span.name = scrubString(span.name);
      span.attributes = scrub(span.attributes);
      return span;
    },
    tracesSampleRate: tracing ? tracesSampleRate : undefined
  });
}
