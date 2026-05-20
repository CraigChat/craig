import { stripIndents } from 'common-tags';

import type { ActionResult, BotInfo, ShardInfo } from './controlClient.js';
import type { ControlEndpoint } from './store.js';

export function formatInfo(name: string, info: BotInfo): string {
  return stripIndents`
    ${name}
    Shards: ${info.shardCount}/${info.configuredShards}
    Guilds: ${info.guilds.toLocaleString()}
    Recordings: ${info.recordings.toLocaleString()}
  `;
}

export function formatEndpoints(endpoints: ControlEndpoint[]): string {
  if (!endpoints.length) return 'No endpoints configured.';
  const nameWidth = Math.max(4, ...endpoints.map((endpoint) => endpoint.name.length));
  return ['Name'.padEnd(nameWidth) + '  URL', ...endpoints.map((endpoint) => `${endpoint.name.padEnd(nameWidth)}  ${endpoint.url}`)].join('\n');
}

export function formatAction(result: ActionResult, success: string): string {
  if (!result.results) return result.ok ? success : 'Action failed.';
  const failed = result.results.filter((item) => !item.ok);
  const succeeded = result.results.filter((item) => item.ok).map((item) => item.id);
  if (!failed.length) return `${success}${succeeded.length ? ` (${succeeded.join(', ')})` : ''}`;
  return stripIndents`
    ${succeeded.length ? `${success} (${succeeded.join(', ')})` : 'No shards updated.'}

    Failed:
    ${failed.map((item) => `- Shard ${item.id}: ${item.error || 'Unknown error'}`).join('\n')}
  `;
}

export function formatShardInfo(info: ShardInfo): string {
  const rows = [...info.shards].sort((a, b) => a.id - b.id);
  const totalGuilds = rows.reduce((acc, shard) => acc + (shard.guilds ?? 0), 0);
  const totalRecordings = rows.reduce((acc, shard) => acc + (shard.recordings ?? 0), 0);
  const avgLatency = rows.length ? Math.round(rows.reduce((acc, shard) => acc + (shard.latency ?? 0), 0) / rows.length) : 0;

  return [
    `Spawned ${info.spawned}/${info.total} | Guilds ${totalGuilds.toLocaleString()} | Recordings ${totalRecordings.toLocaleString()} | Latency ${avgLatency}ms avg`,
    '',
    ' ID | Status       | Guilds   | Latency | Uptime   | Recs     | RWA',
    ...rows.map((shard) =>
      [
        shard.id.toString().padStart(3, ' '),
        (shard.status ?? shard.managerStatus ?? (shard.error ? 'error' : 'unknown')).padEnd(12, ' '),
        (shard.guilds ?? '-').toString().padEnd(8, ' '),
        (typeof shard.latency === 'number' ? `${Math.round(shard.latency)}ms` : '-').padEnd(7, ' '),
        formatDuration(shard.uptime).padEnd(8, ' '),
        (shard.recordings ?? '-').toString().padEnd(8, ' '),
        shard.respawnWhenAvailable ? 'yes' : 'no'
      ].join(' | ')
    )
  ].join('\n');
}

export function formatDuration(seconds?: number) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '-';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return [hours, minutes, remainingSeconds].map((part) => part.toString().padStart(2, '0')).join(':');
}

export function redact(text: string, secrets: string[]) {
  return secrets.filter(Boolean).reduce((acc, secret) => acc.split(secret).join('--snip--'), text);
}

export function truncateForDiscord(text: string, limit = 1900) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 20)}\n... truncated ...`;
}

export function codeBlock(text: string, language = '') {
  const sanitized = text.split('```').join('`\\`\\`');
  return `\`\`\`${language}\n${sanitized}\n\`\`\``;
}
