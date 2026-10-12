import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/sharding/index.ts'],
  dts: false,
  sourcemap: true,
  format: 'esm'
});
