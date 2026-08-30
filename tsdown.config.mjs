import { defineConfig } from 'tsdown';

export default defineConfig({
  skipNodeModulesBundle: true,
  dts: true,
  format: {
    esm: {
      target: ['esnext']
    }
  }
});
