import type { Kitchen } from '@craig/types';

import { logger } from '$lib/server/logger.js';
import { REDIS_JOB_CHANNEL_PREFIX, redisSub } from '$lib/server/redis.js';
import type { AnyMessageEvent } from '$lib/sse/types';

import { getJob, minimizeJobInfo, minimizeJobUpdate } from '../util';
import { ConnectionReadyState, type SSEConnection } from './client';

const MAX_SSE_CONNECTIONS_PER_GROUP = 5;

class SSEManager {
  jobGroups = new Map<string, SSEGroup>();
  interval = setInterval(() => this.onIntervalTick(), 1000 * 5) as unknown as number;

  constructor() {
    redisSub.on('message', (channel, message) => this.onMessage(channel, message));
  }

  async onMessage(channel: string, data: string) {
    if (!channel.startsWith(REDIS_JOB_CHANNEL_PREFIX)) return;
    const jobId = channel.slice(REDIS_JOB_CHANNEL_PREFIX.length);
    if (!this.jobGroups.has(jobId)) return;
    const group = this.jobGroups.get(jobId)!;
    group.onMessage(data);

    // Close connections if the job is done
    const update: Kitchen.JobUpdate = JSON.parse(data);
    if (!['running', 'idle', 'queued'].includes(update.status)) await group.destroy();
  }

  async onIntervalTick() {
    for (const group of Array.from(this.jobGroups.values())) {
      if (group.clients.size === 0) group.destroy();
      else {
        const job = await getJob(group.id);
        if (job && ['running', 'idle', 'queued'].includes(job.status)) return;
        if (job) group.send({ event: 'update', data: { job: minimizeJobInfo(job) } });
        group.destroy();
      }
    }
  }

  async push(jobId: string, connection: SSEConnection) {
    const group = this.jobGroups.get(jobId) ?? new SSEGroup(this, jobId);
    if (group.clients.size >= MAX_SSE_CONNECTIONS_PER_GROUP) {
      connection.send({ event: 'end', data: { error: 'TOO_MANY_CONNECTIONS' } });
      connection.close();
      return;
    }
    if (!group.subscribed) await group.subscribe();
    if (!this.jobGroups.has(jobId)) this.jobGroups.set(jobId, group);
    group.add(connection);
  }

  async destroy() {
    clearInterval(this.interval);
    for (const group of Array.from(this.jobGroups.values())) await group.destroy();
  }
}

class SSEGroup {
  public clients = new Map<string, SSEConnection>();
  subscribed = false;

  constructor(
    public manager: SSEManager,
    public id: string
  ) {
    logger.debug(`Created SSE group ${id}`);
  }

  add(connection: SSEConnection) {
    if (connection.state !== ConnectionReadyState.READY) {
      logger.warn(`[SSE:${this.id}] Tried to add a closed client`);
      return;
    }

    connection.send({ event: 'init', data: { id: connection.id, streaming: true } });
    this.clients.set(connection.id, connection);
    logger.debug(`[SSE:${this.id}] Added client ${connection.id}`);

    connection.on('close', () => {
      logger.debug(`[SSE:${this.id}] Client ${connection.id} closed`);
      this.clients.delete(connection.id);
    });

    return connection.id;
  }

  close(clientId: string) {
    logger.debug(`[SSE:${this.id}] Closing client ${clientId}`);
    const connection = this.clients.get(clientId);
    if (!connection) return false;
    connection.close();
    return true;
  }

  onMessage(data: string) {
    const update: Kitchen.JobUpdate = JSON.parse(data);
    this.send({ event: 'update', data: { update: minimizeJobUpdate(update) } });
  }

  send(event: AnyMessageEvent) {
    for (const connection of this.clients.values()) connection.send(event);
  }

  async subscribe() {
    if (this.subscribed) return;
    const result = await redisSub.subscribe(`${REDIS_JOB_CHANNEL_PREFIX}${this.id}`);
    logger.debug(`Subscribed SSE group ${this.id}`, result, `${REDIS_JOB_CHANNEL_PREFIX}${this.id}`);
    this.subscribed = true;
  }

  async destroy() {
    logger.debug(`Destroying SSE group ${this.id}`);
    for (const clientId of Array.from(this.clients.keys())) this.close(clientId);
    await redisSub.unsubscribe(`${REDIS_JOB_CHANNEL_PREFIX}${this.id}`);
    this.manager.jobGroups.delete(this.id);
  }
}

export const sseManager = new SSEManager();
