import { enhancedImages } from '@sveltejs/enhanced-img';
import { sveltekit } from '@sveltejs/kit/vite';
import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), enhancedImages(), sveltekit(), devtoolsJson()],
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
