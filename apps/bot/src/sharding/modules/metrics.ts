import http from 'node:http';
import { Counter, Gauge, register } from 'prom-client';

import * as logger from '../logger';
import type ShardManager from '../manager';
import ShardManagerModule from '../module';
import Shard from '../shard';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setPropPerShard(script: string, gauge: Gauge, manager: ShardManager) {
  return timeout(
    Promise.all(
      Array.from(manager.shards.values()).map(async (shard) => {
        if (shard.status === 'ready' || shard.status === 'resuming') {
          const result: number = await shard.eval(script);
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
  gatewayCloseCounter?: Counter;

  constructor(manager: ShardManager) {
    super(manager, {
      name: 'metrics',
      description: 'Metrics server'
    });

    this.onShardDisconnect = this.onShardDisconnect.bind(this);

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
    const manager = this.manager;

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
      name: 'craig_bot_gateway_events_received_total',
      help: 'Counter for total gateway events received per shard',
      labelNames: ['shard'],
      async collect() {
        try {
          await collectFromShards('gatewayEventsReceived', this, manager);
        } catch {}
      }
    });

    const cmdUsage = new Counter({
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

    for (const command of ['autorecord', 'bless', 'features', 'info', 'join', 'note', 'recordings', 'server-settings', 'stop', 'unbless', 'webapp'])
      cmdUsage.inc({ command }, 0);

    new Counter({
      name: 'craig_bot_voice_regions_connected_total',
      help: 'Counter for total voice server regions connected',
      labelNames: ['region'],
      async collect() {
        try {
          await timeout(
            Promise.all(
              Array.from(manager.shards.values()).map(async (shard) => {
                if (shard.status === 'ready' || shard.status === 'resuming') {
                  const result: Record<string, number> = await shard.eval('this.modules.get("metrics").collect("voiceServersConnected")');
                  for (const region in result) this.inc({ region }, result[region]);
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
      name: 'craig_bot_shard_process_memory_bytes',
      help: 'Memory usage of the shard process in bytes',
      labelNames: ['shard'],
      async collect() {
        try {
          await setPropPerShard('process.memoryUsage().heapUsed', this, manager);
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

    this.gatewayCloseCounter = new Counter({
      name: 'craig_bot_gateway_closes',
      help: 'Counter for total gateway close events',
      labelNames: ['code']
    });

    // Initialize the counter with some known codes
    this.gatewayCloseCounter.inc({ code: '1000' }, 0);
    this.gatewayCloseCounter.inc({ code: '1001' }, 0);
    this.gatewayCloseCounter.inc({ code: '1006' }, 0);
    this.gatewayCloseCounter.inc({ code: '1014' }, 0);
    this.gatewayCloseCounter.inc({ code: '4000' }, 0);
    this.gatewayCloseCounter.inc({ code: '4008' }, 0);
    this.gatewayCloseCounter.inc({ code: '4009' }, 0);

    this.manager.on('disconnect', this.onShardDisconnect);
    this.server.listen(this.manager.options.metricsPort, () => logger?.info(`Metrics server started on port ${this.manager.options.metricsPort}`));
  }

  onShardDisconnect(shard: Shard, err: Error & { code: number }) {
    try {
      if (err && 'code' in err && typeof err.code === 'number') this.gatewayCloseCounter?.inc({ code: err.code.toString() });
    } catch {}
  }

  unload() {
    this.manager.removeListener('disconnect', this.onShardDisconnect);
    this.gatewayCloseCounter = undefined;
    register.clear();
    this.server.close();
    this.unregisterAllCommands();
  }
}
