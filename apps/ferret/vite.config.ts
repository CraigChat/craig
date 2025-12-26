import { createReadStream } from 'node:fs';
import { access, cp, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enhancedImages } from '@sveltejs/enhanced-img';
import { sveltekit } from '@sveltejs/kit/vite';
import mime from 'mime';
import { defineConfig, type PluginOption } from 'vite';
import devtoolsJson from 'vite-plugin-devtools-json';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const exposeLibAV: PluginOption = (() => {
  const MODULE_DIR = join(__dirname, 'node_modules/@libav.js/variant-webcodecs/dist');
  return {
    name: 'vite-libav.js',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/_libav/')) return next();

        const filename = basename(req.url).split('?')[0];
        if (!filename) return next();

        const fileExists = await pathExists(join(MODULE_DIR, filename));
        if (!fileExists) return next();

        const fileType = mime.getType(filename);
        if (!fileType) return next();

        res.setHeader('Content-Type', fileType);
        return createReadStream(join(MODULE_DIR, filename)).pipe(res);
      });
    },
    generateBundle: async (options) => {
      if (!options.dir) return;

      const assets = join(options.dir, '_libav');
      await mkdir(assets, { recursive: true });
      await cp(MODULE_DIR, assets, { recursive: true });
    }
  };
})();

export default defineConfig({
  plugins: [enhancedImages(), sveltekit(), devtoolsJson(), exposeLibAV],
  server: {
    fs: { allow: ['../../locale'] },
    allowedHosts: ['.trycloudflare.com'],
    hmr: { timeout: 60000 }
  },
  ssr: {
    external: ['@craig/db']
  }
});
