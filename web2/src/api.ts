import fastify, { FastifyInstance } from 'fastify';
import helmet from 'fastify-helmet';
import * as recordingRoute from './routes/recording';
import * as cookRoute from './routes/cook';

export let server: FastifyInstance;

// TODO fastify rate limit
export async function start(): Promise<void> {
  server = fastify({
    logger: process.env.NODE_ENV !== 'production',
    ignoreTrailingSlash: true,
    bodyLimit: 500
  });

  await server.register(helmet);

  server.get('/', async (request, reply) => {
    const { id, key, delete: deleteKey } = request.query as Record<string, string>;
    if (id) return reply.redirect(`/rec/${id}?${new URLSearchParams({ key, delete: deleteKey }).toString()}`);
    return reply.redirect(process.env.API_HOMEPAGE || '/chat/');
  });

  server.get('/health', async (request, reply) => {
    return reply.status(200).send({ ok: true });
  });

  server.get('/rec/:id', async (request, reply) => {
    // TODO recording page
    return reply.status(200).send({ ok: true });
  });

  server.route(recordingRoute.headRoute);
  server.route(recordingRoute.getRoute);
  server.route(recordingRoute.deleteRoute);
  server.route(cookRoute.durationRoute);

  server.addHook('onRequest', async (req, reply) => {
    reply.headers({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
      Connection: 'close'
    });
    return;
  });

  const port = parseInt(process.env.API_PORT, 10) || 3000;
  await server.listen({ port });
  console.info(`Running webhook on port ${port}, env: ${process.env.NODE_ENV || 'development'}`);

  // PM2 graceful start/shutdown
  if (process.send) process.send('ready');

  process.on('SIGINT', stop);
  process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection', err);
  });
}

export async function stop(): Promise<void> {
  console.info('Shutting down...');
  await server.close();
  console.info('All things disconnected.');
  process.exit(0);
}
