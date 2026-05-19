import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/runTask.ts'],
  dts: false,
  format: 'esm'
});
