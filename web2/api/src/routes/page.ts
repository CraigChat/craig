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
    return reply.type('text/javascript').sendFile('rec.js', pageDistPath);
  }
};

export const sourceMapRoute: RouteOptions = {
  method: 'GET',
  url: '/rec.js',
  handler: async (request, reply) => {
    return reply.type('text/javascript').sendFile('rec.js.map', pageDistPath);
  }
};

export const cssRoute: RouteOptions = {
  method: 'GET',
  url: '/rec.css',
  handler: async (request, reply) => {
    return reply.type('text/css; charset=utf-8').sendFile('rec.css', pageDistPath);
  }
};
