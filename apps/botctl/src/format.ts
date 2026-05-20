import { stripIndents } from 'common-tags';

import type { ActionResult, BotInfo, ShardInfo } from './controlClient.js';
import type { ControlEndpoint } from './store.js';

export interface OverviewInstanceInfo {
  endpoint: ControlEndpoint;
  info?: BotInfo;
  shards?: ShardInfo;
  error?: string;
}

export function formatInfo(name: string, info: BotInfo): string {
  return stripIndents`
    ${name}
    Application ID: ${info.applicationID ?? '<unknown>'}
    Shards: ${info.shardCount}/${info.configuredShards}
    Guilds: ${info.guilds.toLocaleString()}
    Recordings: ${info.recordings.toLocaleString()}
  `;
}

export function formatEndpoints(endpoints: ControlEndpoint[]): string {
  if (!endpoints.length) return 'No endpoints configured.';
  const nameWidth = Math.max(4, ...endpoints.map((endpoint) => endpoint.name.length));
  return [
    'Name'.padEnd(nameWidth) + '  Application ID       URL',
    ...endpoints.map((endpoint) => `${endpoint.name.padEnd(nameWidth)}  ${(endpoint.applicationID ?? '-').padEnd(20)} ${endpoint.url}`)
  ].join('\n');
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
  const averageLatency = rows.length ? Math.round(rows.reduce((acc, shard) => acc + (shard.latency ?? 0), 0) / rows.length) : 0;
  const averageUptime = rows.length ? rows.reduce((acc, shard) => acc + (shard.uptime ?? 0), 0) / rows.length : 0;
  const rwaShards = rows.filter((shard) => shard.respawnWhenAvailable).length;
  const currentShardID = parseCurrentShardID(process.env.SHARD_ID);
  const summaryGuilds = totalGuilds.toLocaleString().padEnd(10, ' ');
  const summaryLatency = `${averageLatency}ms avg`.padEnd(11, ' ');
  const summaryUptime = `${formatDuration(averageUptime)} avg`.padEnd(14, ' ');
  const summaryRecordings = totalRecordings.toLocaleString().padEnd(12, ' ');

  return [
    `Shards Spawned: ${info.spawned}/${info.total}${info.spawned !== info.total ? ' (!)' : ''}`,
    '',
    `      --- SUMMARY --- | ${summaryGuilds} | ${summaryLatency} | ${summaryUptime} | ${summaryRecordings} | ${rwaShards.toLocaleString()} shards`,
    `       |       Status |   Guilds   |   Latency   |     Uptime     |  Recordings  | RWA`,
    ...rows.map((shard) => formatShardRow(shard, currentShardID))
  ].join('\n');
}

export function formatOverviewInstances(instances: OverviewInstanceInfo[]): string {
  if (!instances.length) return 'No endpoints configured.';

  return instances
    .map((instance) => {
      const label = formatEndpointMention(instance.endpoint, instance.info);
      if (instance.error || !instance.info || !instance.shards) return `${label} - offline (${instance.error || 'unavailable'})`;

      const rwa = instance.shards.shards.filter((shard) => shard.respawnWhenAvailable).length;
      const ready = instance.shards.shards.filter((shard) => isShardReady(shard)).length;
      const notReady = Math.max(instance.shards.total - ready, 0);

      return `${label} - ${instance.info.guilds.toLocaleString()} guilds | ${instance.info.recordings.toLocaleString()} rec | ${
        instance.shards.spawned
      }/${instance.shards.total} shards | ${rwa} RWA | ${notReady} not ready`;
    })
    .join('\n');
}

function formatEndpointMention(endpoint: ControlEndpoint, info?: BotInfo): string {
  const applicationID = info?.applicationID ?? endpoint.applicationID;
  return applicationID ? `<@${applicationID}> (${endpoint.name})` : endpoint.name;
}

function isShardReady(shard: ShardInfo['shards'][number]) {
  if (shard.ready === false) return false;
  const status = shard.status ?? shard.managerStatus;
  return status === 'ready' || shard.ready === true;
}

export function formatDuration(seconds?: number) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '-';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return [hours, minutes, remainingSeconds].map((part) => part.toString().padStart(2, '0')).join(':');
}

function formatLatency(latency?: number) {
  return typeof latency === 'number' ? `${Math.round(latency)}ms` : '-';
}

function formatShardRow(shard: ShardInfo['shards'][number], currentShardID?: number) {
  const marker = shard.id === currentShardID ? '>' : ' ';
  const id = shard.id.toString().padStart(3, ' ');
  const status = (shard.status ?? shard.managerStatus ?? (shard.error ? 'error' : 'unknown')).padStart(12, ' ');
  const latency = formatLatency(shard.latency).padEnd(11, ' ');
  const uptime = formatDuration(shard.uptime).padEnd(14, ' ');

  return `${marker} [${id}]: ${status} | ${padNumericValue(shard.guilds, 10)} | ${latency} | ${uptime} | ${padNumericValue(shard.recordings, 12)} | ${
    shard.respawnWhenAvailable ?? '-'
  }`;
}

function padNumericValue(value: number | undefined, maxLength: number) {
  return (typeof value === 'number' ? value.toLocaleString() : '-').padEnd(maxLength, ' ');
}

function parseCurrentShardID(value?: string) {
  if (!value) return undefined;
  const id = parseInt(value, 10);
  return Number.isInteger(id) ? id : undefined;
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
