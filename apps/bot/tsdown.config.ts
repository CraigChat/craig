import * as child_process from 'node:child_process';

import { defineConfig } from 'tsdown';

function versionName() {
  if (process.env.CRAIG_VERSION) return process.env.CRAIG_VERSION;
  try {
    return child_process.execSync('git rev-parse HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  entry: ['src/index.ts', 'src/sharding/index.ts'],
  dts: false,
  sourcemap: true,
  format: 'esm',
  env: { CRAIG_VERSION: versionName() }
});
