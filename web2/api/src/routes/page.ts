import { RouteOptions } from 'fastify';
import path from 'path';

const pageDistPath = path.join(__dirname, '../page');

export const pageRoute: RouteOptions = {
  method: 'GET',
  url: '/rec/:id',
  handler: async (request, reply) => {
    // TODO generate embed?
    return reply.sendFile('index.html', path.join(__dirname, '../../page'));
  }
};

export const scriptRoute: RouteOptions = {
  method: 'GET',
  url: '/assets/rec.js',
  handler: async (request, reply) => {
    return reply.type('text/javascript').sendFile('rec.js', pageDistPath);
  }
};

export const sourceMapRoute: RouteOptions = {
  method: 'GET',
  url: '/assets/rec.js.map',
  handler: async (request, reply) => {
    return reply.type('application/json').sendFile('rec.js.map', pageDistPath);
  }
};

export const cssRoute: RouteOptions = {
  method: 'GET',
  url: '/assets/rec.css',
  handler: async (request, reply) => {
    return reply.type('text/css; charset=utf-8').sendFile('rec.css', pageDistPath);
  }
};

// This actually serves font files from fontsource
export const filesRoute: RouteOptions = {
  method: 'GET',
  url: '/assets/files/:file',
  handler: async (request, reply) => {
    const { file } = request.params as { file: string };
    const fontsPath = path.join(__dirname, '../../node_modules/@fontsource');
    const fonts = ['red-hat-text', 'lexend'];
    for (const font of fonts) {
      const mime = file.endsWith('woff2') ? 'font/woff2' : 'font/woff';
      if (file.startsWith(font)) return reply.type(mime).sendFile(file, path.join(fontsPath, font, 'files'));
    }
    return reply.status(404).send({ error: 'File not found' });
  }
};
