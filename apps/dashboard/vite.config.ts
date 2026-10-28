import * as child_process from 'node:child_process';

import adapter from '@sveltejs/adapter-node';
import { enhancedImages } from '@sveltejs/enhanced-img';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import devtoolsJson from 'vite-plugin-devtools-json';

function versionName() {
  if (process.env.CRAIG_VERSION) return process.env.CRAIG_VERSION;

  try {
    return child_process.execSync('git rev-parse HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    enhancedImages(),
    sveltekit({
      // Consult https://kit.svelte.dev/docs/integrations#preprocessors
      // for more information about preprocessors
      preprocess: [vitePreprocess({})],

      // adapter-auto only supports some environments, see https://kit.svelte.dev/docs/adapter-auto for a list.
      // If your environment is not supported or you settled on a specific environment, switch out the adapter.
      // See https://kit.svelte.dev/docs/adapters for more information about adapters.
      adapter: adapter({}),

      paths: { origin: process.env.ORIGIN || undefined },

      version: {
        pollInterval: 5000,
        name: versionName()
      }
    }),
    devtoolsJson()
  ],
  server: {
    fs: {
      allow: ['../../locale']
    },
    allowedHosts: ['.trycloudflare.com'],
    port: 57131
  },
  ssr: {
    external: ['@craig/db']
  }
});
