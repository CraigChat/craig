#!/usr/bin/env node
import { stdin } from 'node:process';

import { getConfig } from './config.js';
import { ControlClient, inspectEvalResult, type ShardSelector } from './controlClient.js';
import {
  codeBlock,
  formatAction,
  formatEndpoints,
  formatInfo,
  formatOverviewInstances,
  formatShardInfo,
  type OverviewInstanceInfo,
  redact
} from './format.js';
import { formatMaintenanceUpdate, resolveMaintenanceTargets, updateMaintenance } from './maintenance.js';
import { type ControlEndpoint, EndpointStore } from './store.js';

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

const config = getConfig();
const store = new EndpointStore(config.storePath);

main(process.argv.slice(2).filter((arg, index) => index !== 0 || arg !== '--')).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main(args: string[]) {
  const [command, ...rest] = args;
  if (!command || command === 'help' || command === '--help' || command === '-h') return printHelp();

  if (command === 'endpoint') return handleEndpoint(rest);
  if (command === 'overview') return console.log(formatOverviewInstances(await getOverviewInstances(await store.list())));

  const parsed = parseArgs(rest);
  const endpointName = parsed.positionals[0];
  if (!endpointName) throw new Error(`Usage: botctl ${command} <endpoint>`);
  if (command === 'maintenance') {
    const endpoints = await resolveMaintenanceTargets(store, endpointName);
    const message = parsed.positionals.slice(1).join(' ');
    const result = await updateMaintenance(endpoints, message || undefined);
    return console.log(formatMaintenanceUpdate(result, Boolean(message)));
  }

  const endpoint = await store.get(endpointName);
  const client = new ControlClient(endpoint);

  switch (command) {
    case 'info': {
      const info = await client.getInfo();
      await store.updateApplicationID(endpoint.name, info.applicationID);
      return console.log(formatInfo(endpoint.name, info));
    }
    case 'shards':
      return console.log(formatShardInfo(await client.getShards()));
    case 'restart':
      return console.log(formatAction(await client.restart(parseShardSelector(String(parsed.flags.shards || 'all'))), 'Restarted shards.'));
    case 'rwa':
      return console.log(
        formatAction(await client.setRWA(parseShardSelector(String(parsed.flags.shards || 'all')), parseBoolean(parsed.flags.value)), 'Updated RWA.')
      );
    case 'status':
      await client.setStatus(requireStringFlag(parsed.flags.type, 'type'), optionalStringFlag(parsed.flags.message));
      return console.log('Updated status.');
    case 'eval': {
      const target = requireStringFlag(parsed.flags.target, 'target');
      if (target !== 'manager' && target !== 'shard') throw new Error('--target must be manager or shard.');
      const shard = target === 'shard' ? parseShardID(requireStringFlag(parsed.flags.shard, 'shard')) : undefined;
      const script = parsed.positionals.slice(1).join(' ') || (await readStdin()).trim();
      if (!script) throw new Error('Eval script is required as an argument or stdin.');
      const result = await client.eval(target, script, shard);
      if (result.error) throw new Error(result.error);
      const output = redact(inspectEvalResult(result.result), [endpoint.token, config.discordToken]);
      return console.log(codeBlock(output, 'js'));
    }
    default:
      throw new Error(`Unknown command "${command}".`);
  }
}

async function handleEndpoint(args: string[]) {
  const [action, ...rest] = args;
  const parsed = parseArgs(rest);

  switch (action) {
    case 'add': {
      const [name, url] = parsed.positionals;
      if (!name || !url) throw new Error('Usage: botctl endpoint add <name> <url> --token <token>');
      const endpoint = await store.add(name, url, requireStringFlag(parsed.flags.token, 'token'));
      return console.log(`Saved endpoint "${endpoint.name}" (${endpoint.url}).`);
    }
    case 'remove': {
      const [name] = parsed.positionals;
      if (!name) throw new Error('Usage: botctl endpoint remove <name>');
      const removed = await store.remove(name);
      return console.log(removed ? `Removed endpoint "${name}".` : `No endpoint named "${name}".`);
    }
    case 'list':
      return console.log(formatEndpoints(await store.list()));
    case 'test': {
      const [name] = parsed.positionals;
      if (!name) throw new Error('Usage: botctl endpoint test <name>');
      const endpoint = await store.get(name);
      const info = await new ControlClient(endpoint).getInfo();
      await store.updateApplicationID(endpoint.name, info.applicationID);
      return console.log(`Endpoint "${name}" is reachable.`);
    }
    default:
      throw new Error(`Unknown endpoint action "${action || ''}".`);
  }
}

async function getOverviewInstances(endpoints: ControlEndpoint[]): Promise<OverviewInstanceInfo[]> {
  return Promise.all(
    endpoints.map(async (endpoint) => {
      const client = new ControlClient(endpoint);
      try {
        const [info, shards] = await Promise.all([client.getInfo(), client.getShards()]);
        await store.updateApplicationID(endpoint.name, info.applicationID);
        return {
          endpoint: {
            ...endpoint,
            applicationID: info.applicationID ?? endpoint.applicationID
          },
          info,
          shards
        };
      } catch (error) {
        return {
          endpoint,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    })
  );
}

function parseArgs(args: string[]): ParsedArgs {
  const positionals = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const [rawName, inlineValue] = arg.slice(2).split('=', 2);
    if (!rawName) throw new Error(`Invalid flag "${arg}".`);
    if (inlineValue !== undefined) {
      flags[rawName] = inlineValue;
    } else if (args[index + 1] && !args[index + 1].startsWith('--')) {
      flags[rawName] = args[++index];
    } else {
      flags[rawName] = true;
    }
  }

  return { positionals, flags };
}

function parseShardSelector(value: string): ShardSelector {
  if (value === 'all') return 'all';
  const ids = value
    .split(',')
    .flatMap((part) => part.trim().split(/\s+/))
    .filter(Boolean)
    .map(parseShardID);
  if (!ids.length) throw new Error('Shard selector must be "all" or a comma-separated list of shard IDs.');
  return [...new Set(ids)];
}

function parseShardID(value: string): number {
  const id = parseInt(value, 10);
  if (!Number.isInteger(id) || id < 0) throw new Error(`Invalid shard ID "${value}".`);
  return id;
}

function parseBoolean(value: string | boolean | undefined): boolean {
  if (value === true || value === 'true' || value === '1' || value === 'on' || value === 'yes') return true;
  if (value === false || value === 'false' || value === '0' || value === 'off' || value === 'no') return false;
  throw new Error('--value must be true or false.');
}

function requireStringFlag(value: string | boolean | undefined, name: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`--${name} is required.`);
  return value;
}

function optionalStringFlag(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

async function readStdin(): Promise<string> {
  if (stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function printHelp() {
  console.log(`botctl

Endpoint management:
  botctl endpoint add <name> <url> --token <token>
  botctl endpoint remove <name>
  botctl endpoint list
  botctl endpoint test <name>

Control:
  botctl overview
  botctl info <name>
  botctl shards <name>
  botctl eval <name> --target manager|shard [--shard <id>] [code]
  botctl rwa <name> --value true|false --shards all|0,1
  botctl maintenance <name[,name...]|all> [message]
  botctl restart <name> --shards all|0,1
  botctl status <name> --type online|idle|dnd|default|custom [--message text]`);
}
