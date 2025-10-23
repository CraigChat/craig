import devtoolsJson from 'vite-plugin-devtools-json';
import { enhancedImages } from '@sveltejs/enhanced-img';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    enhancedImages(),
    sveltekit(),
    devtoolsJson()
  ],
  server: {
    fs: { allow: ['../../locale'] },
    allowedHosts: ['.trycloudflare.com']
  }
});
