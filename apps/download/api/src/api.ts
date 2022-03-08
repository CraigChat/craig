import fastify, { FastifyInstance } from 'fastify';
import helmet from 'fastify-helmet';
import staticPlugin from 'fastify-static';
import rateLimit from 'fastify-rate-limit';
import path from 'path';
import * as recordingRoute from './routes/recording';
import * as cookRoute from './routes/cook';
import * as pageRoute from './routes/page';
import { ErrorCode } from './util';
import { client as redisClient } from './cache';
import { cron as influxCron } from './influx';
import { close as closeSentry } from './sentry';
import { cron as downloadCron, downloadPath } from './util/download';
import { access, mkdir } from 'fs/promises';

export let server: FastifyInstance;

export async function start(): Promise<void> {
  try {
    await access(downloadPath);
  } catch (e) {
    await mkdir(downloadPath);
  }

  await redisClient.connect();
  influxCron.start();
  downloadCron.start();

  server = fastify({
    logger: process.env.NODE_ENV !== 'production',
    ignoreTrailingSlash: true,
    bodyLimit: 1024
  });

  await server.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        'default-src': ["'self'"],
        'img-src': ["'self'", 'data:', 'https://cdn.discordapp.com', 'https://media.discordapp.net'],
        'style-src': ["'self'", 'https:', "'unsafe-inline'"],
        'connect-src': ["'self'", process.env.SENTRY_HOST]
      }
    }
  });

  await server.register(staticPlugin, {
    root: path.join(__dirname, '..', 'page', 'public'),
    prefix: '/'
  });

  await server.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator(req) {
      return (req.headers['cf-connecting-ip'] as string) || req.ip;
    },
    errorResponseBuilder() {
      return {
        ok: false,
        code: ErrorCode.RATELIMITED,
        error: 'Too many requests'
      };
    }
  });

  server.get('/', async (request, reply) => {
    const { id, key, delete: deleteKey } = request.query as Record<string, string>;
    if (id)
      return reply.redirect(
        `/rec/${id}?${new URLSearchParams({
          ...(key ? { key } : {}),
          ...(deleteKey ? { delete: deleteKey } : {})
        }).toString()}`
      );
    return reply.redirect(process.env.API_HOMEPAGE || '/chat/');
  });

  server.get('/health', async (request, reply) => {
    return reply.status(200).send({ ok: true });
  });

  server.get('/dl/:file', async (request, reply) => {
    const { file } = request.params as Record<string, string>;
    return reply.header('content-disposition', `attachment; filename=${file}`).sendFile(file, downloadPath);
  });

  server.route(recordingRoute.headRoute);
  server.route(recordingRoute.getRoute);
  server.route(recordingRoute.deleteRoute);
  server.route(recordingRoute.textRoute);
  server.route(recordingRoute.usersRoute);
  server.route(recordingRoute.rawRoute);
  server.route(cookRoute.durationRoute);
  server.route(cookRoute.notesRoute);
  server.route(cookRoute.getRoute);
  server.route(cookRoute.postRoute);
  server.route(cookRoute.ennuizelRoute);
  server.route(cookRoute.avatarRoute);
  server.route(pageRoute.pageRoute);
  server.route(pageRoute.scriptRoute);
  server.route(pageRoute.sourceMapRoute);
  server.route(pageRoute.cssRoute);
  server.route(pageRoute.filesRoute);

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
  redisClient.disconnect();
  influxCron.stop();
  closeSentry();
  console.info('All things disconnected.');
  process.exit(0);
}
