import { inspect } from 'node:util';

import type { ControlEndpoint } from './store.js';

export interface BotInfo {
  applicationID?: string;
  shardCount: number;
  configuredShards: number;
  guilds: number;
  recordings: number;
}

export interface ShardInfo {
  spawned: number;
  total: number;
  shards: {
    id: number;
    process: number | null;
    managerStatus?: string;
    status?: string;
    ready?: boolean;
    guilds?: number;
    latency?: number;
    uptime?: number;
    recordings?: number;
    respawnWhenAvailable?: boolean;
    lastActivity?: number;
    error?: string;
  }[];
}

export type ShardSelector = 'all' | number[];

export interface ActionResult {
  ok: boolean;
  enabled?: boolean;
  results?: { id: number; ok: boolean; error?: string }[];
}

export class ControlClient {
  constructor(readonly endpoint: ControlEndpoint) {}

  getInfo(): Promise<BotInfo> {
    return this.request<BotInfo>('GET', '/info');
  }

  getShards(): Promise<ShardInfo> {
    return this.request<ShardInfo>('GET', '/shards');
  }

  restart(ids: ShardSelector): Promise<ActionResult> {
    return this.request<ActionResult>('POST', '/shards/restart', ids === 'all' ? { ids: 'all' } : { ids });
  }

  setRWA(ids: ShardSelector, value: boolean): Promise<ActionResult> {
    return this.request<ActionResult>('POST', '/shards/rwa', { ids, value });
  }

  setMaintenance(message?: string): Promise<ActionResult> {
    return this.request<ActionResult>('POST', '/maintenance', { message: message || null });
  }

  setStatus(status: string, message?: string): Promise<ActionResult> {
    return this.request<ActionResult>('POST', '/status', { status, message });
  }

  eval(target: 'manager' | 'shard', script: string, shardId?: number): Promise<{ result: unknown; error?: string }> {
    return this.request('POST', '/eval', { target, script, shardId });
  }

  private async request<T>(method: string, route: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.endpoint.url}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.endpoint.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const message = typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`;
      throw new Error(message);
    }
    return data as T;
  }
}

export function inspectEvalResult(value: unknown): string {
  return inspect(value, { depth: 1, maxArrayLength: 50, breakLength: 120 });
}
