#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';

const [, , command, instanceName, ...extraArgs] = process.argv;
if (!['start', 'reload', 'sync'].includes(command) || !instanceName) {
  console.error('Usage: pnpm -F bot run instance <start|reload|sync> <instance> [-- <extra args>]');
  process.exit(1);
}

const rootDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(rootDir, '../..');
const instanceDir = path.join(rootDir, 'config', 'instances');
const instancePath = path.join(instanceDir, `${instanceName}.env`);

if (!fs.existsSync(instancePath)) {
  console.error(`Could not find instance env file: ${instancePath}`);
  process.exit(1);
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return dotenv.parse(fs.readFileSync(filePath));
}

const mergedEnv = {
  ...process.env,
  ...parseEnvFile(path.join(repoRoot, '.env')),
  ...parseEnvFile(path.join(rootDir, '.env')),
  ...parseEnvFile(instancePath)
};

const pm2ProcessName = mergedEnv.PM2_PROCESS_NAME || mergedEnv.PM2_NAME || instanceName;
mergedEnv.PM2_PROCESS_NAME = pm2ProcessName;

let bin;
let args;
if (command === 'sync') {
  bin = 'slash-up';
  args = ['sync', '--env', instancePath, ...extraArgs];
} else {
  bin = 'pm2';
  args = [command, 'ecosystem.config.cjs', '--update-env', ...extraArgs];
}

const result = spawnSync(bin, args, {
  cwd: rootDir,
  env: mergedEnv,
  stdio: 'inherit'
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);
