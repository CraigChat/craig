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
  url: '/rec.js',
  handler: async (request, reply) => {
    return reply.type('text/javascript').sendFile('index.js', pageDistPath);
  }
};

export const cssRoute: RouteOptions = {
  method: 'GET',
  url: '/rec.css',
  handler: async (request, reply) => {
    return reply.type('text/css; charset=utf-8').sendFile('index.css', pageDistPath);
  }
};
