import { defineConfig } from 'tsdown';
import defaultConfig from '../../tsdown.config.mjs';

export default defineConfig({
  ...defaultConfig,
  dts: false
});
