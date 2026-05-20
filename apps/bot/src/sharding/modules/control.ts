import fastify, { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';

import { getRedisOptions } from '../../config.js';
import * as logger from '../logger.js';
import type ShardManager from '../manager.js';
import ShardManagerModule from '../module.js';

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

type ShardSelector = 'all' | number[];

function parseShardID(id: string) {
  const shardID = parseInt(id, 10);
  return Number.isInteger(shardID) && shardID >= 0 ? shardID : null;
}

export default class ControlModule extends ShardManagerModule {
  app?: FastifyInstance;
  redis = new Redis(getRedisOptions());

  constructor(manager: ShardManager) {
    super(manager, {
      name: 'control',
      description: 'HTTP control API'
    });
  }

  async load() {
    const config = this.manager.options.control;
    if (!config?.port) return void logger.info('No control port defined, skipping...');

    this.app = fastify({ logger: false });
    this.app.addHook('preHandler', async (req, reply) => {
      if (!config.token) return;
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${config.token}`) return reply.status(401).send({ error: 'Unauthorized' });
    });

    this.app.get('/health', async () => ({ ok: true }));
    this.app.get('/info', async () => this.getInfo());
    this.app.get('/shards', async () => this.getShardInfo());

    this.app.post<{ Params: { id: string } }>('/shards/:id/restart', async (req, reply) => {
      const shardID = parseShardID(req.params.id);
      if (shardID === null) return reply.status(400).send({ error: 'Invalid shard ID' });
      const shard = this.manager.shards.get(shardID);
      if (!shard) return reply.status(404).send({ error: 'Shard not found' });
      await shard.respawnWithRetry();
      return { ok: true };
    });

    this.app.post<{ Params: { id: string }; Body: { value?: boolean } }>('/shards/:id/rwa', async (req, reply) => {
      const shardID = parseShardID(req.params.id);
      if (shardID === null) return reply.status(400).send({ error: 'Invalid shard ID' });
      const shard = this.manager.shards.get(shardID);
      if (!shard) return reply.status(404).send({ error: 'Shard not found' });
      if (typeof req.body?.value !== 'boolean') return reply.status(400).send({ error: 'value must be boolean' });
      shard.respawnWhenAvailable = req.body.value;
      return { ok: true };
    });

    this.app.post<{ Body?: { ids?: ShardSelector } }>('/shards/restart', async (req, reply) => {
      const ids = req.body?.ids ?? 'all';
      if (ids === 'all') {
        await this.manager.respawnAll();
        return { ok: true };
      }
      if (!Array.isArray(ids)) return reply.status(400).send({ error: 'ids must be "all" or an array of shard IDs' });

      const results = [];
      for (const shardID of [...new Set(ids)]) {
        if (!Number.isInteger(shardID) || shardID < 0) {
          results.push({ id: shardID, ok: false, error: 'Invalid shard ID' });
          continue;
        }

        const shard = this.manager.shards.get(shardID);
        if (!shard) {
          results.push({ id: shardID, ok: false, error: 'Shard not found' });
          continue;
        }

        await shard
          .respawnWithRetry()
          .then(() => results.push({ id: shardID, ok: true }))
          .catch((error) => results.push({ id: shardID, ok: false, error: formatError(error) }));
      }
      return { ok: results.every((result) => result.ok), results };
    });

    this.app.post<{ Body: { value?: boolean; ids?: ShardSelector } }>('/shards/rwa', async (req, reply) => {
      if (typeof req.body?.value !== 'boolean') return reply.status(400).send({ error: 'value must be boolean' });

      const ids = req.body.ids ?? 'all';
      const shardIDs = ids === 'all' ? Array.from(this.manager.shards.keys()) : Array.isArray(ids) ? [...new Set(ids)] : null;
      if (!shardIDs) return reply.status(400).send({ error: 'ids must be "all" or an array of shard IDs' });

      const results = [];
      for (const shardID of shardIDs) {
        if (!Number.isInteger(shardID) || shardID < 0) {
          results.push({ id: shardID, ok: false, error: 'Invalid shard ID' });
          continue;
        }

        const shard = this.manager.shards.get(shardID);
        if (!shard) {
          results.push({ id: shardID, ok: false, error: 'Shard not found' });
          continue;
        }

        shard.respawnWhenAvailable = req.body.value;
        results.push({ id: shardID, ok: true });
      }
      return { ok: results.every((result) => result.ok), results };
    });

    this.app.post<{ Body: { target?: 'manager' | 'shard'; script?: string; shardId?: number } }>('/eval', async (req, reply) => {
      if (!config.allowEval) return reply.status(403).send({ error: 'Eval is disabled for this control API' });
      const { target, script, shardId } = req.body ?? {};
      if (target !== 'manager' && target !== 'shard') return reply.status(400).send({ error: 'target must be "manager" or "shard"' });
      if (!script || typeof script !== 'string') return reply.status(400).send({ error: 'script must be a non-empty string' });

      if (target === 'manager') {
        try {
          const result = Function('script', 'return eval(script)').call(this.manager, script);
          return { result };
        } catch (error) {
          return reply.status(500).send({ result: null, error: formatError(error) });
        }
      }

      if (shardId === undefined || !Number.isInteger(shardId) || shardId < 0)
        return reply.status(400).send({ error: 'shardId must be a non-negative integer' });
      const shard = this.manager.shards.get(shardId);
      if (!shard) return reply.status(404).send({ error: 'Shard not found' });
      try {
        const result = await shard.eval(script);
        return { result };
      } catch (error) {
        return reply.status(500).send({ result: null, error: formatError(error) });
      }
    });

    this.app.post<{ Body: { message?: string | null } }>('/maintenance', async (req) => {
      const message = req.body?.message?.trim();
      const key = `maintenance:${this.manager.options.applicationID}`;
      if (message) await this.redis.set(key, JSON.stringify({ message }));
      else await this.redis.del(key);
      await this.manager.broadcastEval('this.recorder.checkForMaintenance()').catch((e) => logger.warn('Maintenance check failed', e));
      return { ok: true, enabled: Boolean(message) };
    });

    this.app.post<{ Body: { status: string; message?: string } }>('/status', async (req, reply) => {
      const body = req.body ?? {};
      if (!['online', 'idle', 'dnd', 'default', 'custom'].includes(body.status)) return reply.status(400).send({ error: 'Invalid status' });
      await this.manager.broadcast({ t: 'setStatus', d: body });
      return { ok: true };
    });

    await this.redis.connect();
    await this.app.listen({ host: config.host, port: config.port });
    logger.info(`Control API started on ${config.host}:${config.port}`);
  }

  async getInfo() {
    const [guilds, recordings] = await Promise.all([this.sumClientValue('bot.guilds.size'), this.sumClientValue('recorder.recordings.size')]);
    return {
      applicationID: this.manager.options.applicationID,
      shardCount: this.manager.shards.size,
      configuredShards: this.manager.options.shardCount,
      guilds,
      recordings
    };
  }

  async getShardInfo() {
    const shards = await Promise.all(
      Array.from(this.manager.shards.values()).map(async (shard) => {
        const details = (await shard
          .eval(
            `
              ({
                id: this.shard ? this.shard.id : parseInt(process.env.SHARD_ID),
                status: this.shard.status,
                guilds: this.bot.guilds.size,
                latency: Number.isFinite(this.shard.latency) ? this.shard.latency : -1,
                uptime: process.uptime(),
                recordings: this.recorder.recordings.size
              })
            `
          )
          .catch((error) => ({ error: formatError(error) }))) as Record<string, unknown>;
        return {
          id: shard.id,
          process: shard.process?.pid ?? null,
          managerStatus: shard.status,
          ready: shard.ready,
          respawnWhenAvailable: shard.respawnWhenAvailable,
          lastActivity: shard.lastActivity,
          ...details
        };
      })
    );

    return {
      spawned: this.manager.shards.size,
      total: this.manager.options.shardCount,
      shards: shards.sort((a, b) => a.id - b.id)
    };
  }

  async sumClientValue(prop: string) {
    const values = await this.manager.fetchClientValues(prop, true).catch(() => []);
    return values.reduce<number>((acc, value) => acc + (typeof value === 'number' ? value : 0), 0);
  }

  async unload() {
    await this.app?.close();
    this.redis.disconnect();
    this.unregisterAllCommands();
  }
}
