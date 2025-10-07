import * as child_process from 'node:child_process';

import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://kit.svelte.dev/docs/integrations#preprocessors
  // for more information about preprocessors
  preprocess: [vitePreprocess({})],

  kit: {
    // adapter-auto only supports some environments, see https://kit.svelte.dev/docs/adapter-auto for a list.
    // If your environment is not supported or you settled on a specific environment, switch out the adapter.
    // See https://kit.svelte.dev/docs/adapters for more information about adapters.
    adapter: adapter({}),

    alias: {
      $components: 'src/components',
      $locale: '../../locale',
      $assets: 'src/assets'
    },

    version: {
      pollInterval: 5000,
      name: child_process.execSync('git rev-parse HEAD').toString().trim()
    }
  }
};

export default config;
