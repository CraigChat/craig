import http from 'node:http';
import { Counter, Gauge, register } from 'prom-client';

import * as logger from '../logger';
import type ShardManager from '../manager';
import ShardManagerModule from '../module';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setPropPerShard(prop: string, gauge: Gauge, manager: ShardManager) {
  return timeout(
    Promise.all(
      Array.from(manager.shards.values()).map(async (shard) => {
        if (shard.status === 'ready' || shard.status === 'resuming') {
          const result: number = await shard.eval(prop);
          gauge.set({ shard: shard.id.toString() }, result);
        }
      })
    )
  );
}

function collectFromShards(stat: string, counter: Counter, manager: ShardManager) {
  return timeout(
    Promise.all(
      Array.from(manager.shards.values()).map(async (shard) => {
        if (shard.status === 'ready' || shard.status === 'resuming') {
          const result: number = await shard.eval(`this.modules.get("metrics").collect("${stat}")`);
          counter.inc({ shard: shard.id.toString() }, result);
        }
      })
    )
  );
}

function timeout(p: Promise<any>, ms = 500) {
  return Promise.race([p, wait(ms)]);
}

export default class MetricsModule extends ShardManagerModule {
  server: http.Server;

  constructor(manager: ShardManager) {
    super(manager, {
      name: 'metrics',
      description: 'Metrics server'
    });

    new Gauge({
      name: 'craig_bot_shard_count',
      help: 'Gauge for current shard count',
      collect() {
        this.set(manager.shards.size);
      }
    });

    new Gauge({
      name: 'craig_bot_shards_configured',
      help: 'Gauge for configured shard count',
      collect() {
        this.set(manager.options.shardCount);
      }
    });

    new Gauge({
      name: 'craig_bot_guilds',
      help: 'Gauge for guild count',
      labelNames: ['shard'],
      async collect() {
        try {
          await setPropPerShard('this.bot.guilds.size', this, manager);
        } catch {}
      }
    });

    new Gauge({
      name: 'craig_bot_guilds_unavailable',
      help: 'Gauge for total unavailable guild count',
      labelNames: ['shard'],
      async collect() {
        try {
          await setPropPerShard('this.bot.unavailableGuilds.size', this, manager);
        } catch {}
      }
    });

    new Gauge({
      name: 'craig_bot_recordings_active',
      help: 'Gauge for active recording count',
      labelNames: ['shard'],
      async collect() {
        try {
          await setPropPerShard('this.modules.get("recorder").recordings.size', this, manager);
        } catch {}
      }
    });

    new Counter({
      name: 'craig_bot_recordings_total',
      help: 'Counter for total recording starts',
      labelNames: ['shard'],
      async collect() {
        try {
          await collectFromShards('recordingsStarted', this, manager);
        } catch {}
      }
    });

    new Counter({
      name: 'craig_bot_recordings_auto_total',
      help: 'Counter for total autorecording starts',
      labelNames: ['shard'],
      async collect() {
        try {
          await collectFromShards('autorecordingsStarted', this, manager);
        } catch {}
      }
    });

    new Counter({
      name: 'craig_bot_commands_ran_total',
      help: 'Counter for total commands ran per shard',
      labelNames: ['shard'],
      async collect() {
        try {
          await collectFromShards('commandsRan', this, manager);
        } catch {}
      }
    });

    new Counter({
      name: 'craig_bot_command_usage_total',
      help: 'Counter for command usage per command',
      labelNames: ['command'],
      async collect() {
        try {
          await timeout(
            Promise.all(
              Array.from(manager.shards.values()).map(async (shard) => {
                if (shard.status === 'ready' || shard.status === 'resuming') {
                  const result: Record<string, number> = await shard.eval('this.modules.get("metrics").collect("commands")');
                  for (const command in result) this.inc({ command }, result[command]);
                }
              })
            )
          );
        } catch {}
      }
    });

    new Gauge({
      name: 'craig_bot_shard_latency_milliseconds',
      help: 'Gauge for millisecond latency per shard',
      labelNames: ['shard'],
      async collect() {
        try {
          await setPropPerShard('Number.isFinite(this.shard.latency) ? this.shard.latency : -1', this, manager);
        } catch {}
      }
    });

    new Gauge({
      name: 'craig_bot_shard_uptime_seconds',
      help: 'Gauge for uptime per shard',
      labelNames: ['shard'],
      async collect() {
        try {
          await setPropPerShard('process.uptime()', this, manager);
        } catch {}
      }
    });

    new Gauge({
      name: 'craig_bot_shard_responsive',
      help: 'Whether the shard is responsive',
      labelNames: ['shard'],
      async collect() {
        try {
          await timeout(
            Promise.all(
              Array.from(manager.shards.values()).map(async (shard) => {
                if (!shard.process) return void this.set({ shard: shard.id.toString() }, 0);
                const result: boolean =
                  (await timeout(
                    shard.eval('true').catch(() => false),
                    100
                  )) ?? false;
                this.set({ shard: shard.id.toString() }, result ? 1 : 0);
              })
            )
          );
        } catch {}
      }
    });

    new Gauge({
      name: 'craig_bot_shard_rwa',
      help: 'Shard respawn-when-available',
      labelNames: ['shard'],
      async collect() {
        for (const shard of manager.shards.values()) {
          this.set({ shard: shard.id.toString() }, shard.respawnWhenAvailable ? 1 : 0);
        }
      }
    });

    new Gauge({
      name: 'craig_bot_shard_last_activity_milliseconds',
      help: 'Last activity communication to shard manager in milliseconds',
      labelNames: ['shard'],
      async collect() {
        const now = Date.now();
        for (const shard of manager.shards.values()) {
          this.set({ shard: shard.id.toString() }, shard.lastActivity === 0 ? -1 : now - shard.lastActivity);
        }
      }
    });

    new Gauge({
      name: 'craig_bot_shard_info',
      help: 'Shard info',
      labelNames: ['shard', 'status'],
      async collect() {
        this.reset();
        for (const shard of manager.shards.values()) {
          this.set({ shard: shard.id.toString(), status: shard.status }, 1);
        }
      }
    });

    this.server = http.createServer(async (req, res) => {
      if (req.url === '/metrics') {
        res.writeHead(200, { 'Content-Type': register.contentType });
        res.write(await register.metrics());
      }
      res.end();
    });
    this.server.on('error', (e) => logger.error('Metrics server error:', e));
    this.filePath = __filename;
  }

  load() {
    if (!this.manager.options.metricsPort) return void logger.info('No metrics port defined, skipping...');
    this.server.listen(this.manager.options.metricsPort, () => logger?.info(`Metrics server started on port ${this.manager.options.metricsPort}`));
  }

  unload() {
    this.server.close();
    this.unregisterAllCommands();
  }
}
