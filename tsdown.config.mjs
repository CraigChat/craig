import { defineConfig } from 'tsdown';

export default defineConfig({
  deps: {
    neverBundle: true
  },
  dts: true,
  format: {
    esm: {
      target: ['esnext']
    }
  }
});
