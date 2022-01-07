import { RouteOptions } from 'fastify';
import { getRecording, deleteRecording, keyMatches, getUsers } from '../util/recording';

export const headRoute: RouteOptions = {
  method: 'HEAD',
  url: '/api/recording/:id',
  handler: async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    if (!id) return reply.status(400).send({ ok: false, error: 'Invalid ID' });
    const { key } = request.query as Record<string, string>;
    if (!key) return reply.status(400).send({ ok: false, error: 'Invalid key' });
    return reply.status(200).send('OK');
  }
};

export const getRoute: RouteOptions = {
  method: 'GET',
  url: '/api/recording/:id',
  handler: async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    if (!id) return reply.status(400).send({ ok: false, error: 'Invalid ID' });
    const { key } = request.query as Record<string, string>;
    if (!key) return reply.status(403).send({ ok: false, error: 'Invalid key' });

    const info = await getRecording(id);
    if (info === false) return reply.status(410).send({ ok: false, error: 'Recording was deleted' });
    else if (!info) return reply.status(404).send({ ok: false, error: 'Recording not found' });
    if (!keyMatches(info, key)) return reply.status(403).send({ ok: false, error: 'Invalid key' });

    delete info.delete;

    return reply.status(200).send({ ok: true, info });
  }
};

export const usersRoute: RouteOptions = {
  method: 'GET',
  url: '/api/recording/:id/users',
  handler: async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    if (!id) return reply.status(400).send({ ok: false, error: 'Invalid ID' });
    const { key } = request.query as Record<string, string>;
    if (!key) return reply.status(403).send({ ok: false, error: 'Invalid key' });

    const info = await getRecording(id);
    if (info === false) return reply.status(410).send({ ok: false, error: 'Recording was deleted' });
    else if (!info) return reply.status(404).send({ ok: false, error: 'Recording not found' });
    if (!keyMatches(info, key)) return reply.status(403).send({ ok: false, error: 'Invalid key' });

    const users = await getUsers(id);
    return reply.status(200).send({ ok: true, users });
  }
};

export const deleteRoute: RouteOptions = {
  method: 'DELETE',
  url: '/api/recording/:id',
  handler: async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    if (!id) return reply.status(400).send({ ok: false, error: 'Invalid ID' });
    const { key, delete: deleteKey } = request.query as Record<string, string>;
    if (!key) return reply.status(403).send({ ok: false, error: 'Invalid key' });
    if (!deleteKey) return reply.status(403).send({ ok: false, error: 'Invalid delete key' });

    const info = await getRecording(id);
    if (info === false) return reply.status(410).send({ ok: false, error: 'Recording was deleted' });
    else if (!info) return reply.status(404).send({ ok: false, error: 'Recording not found' });
    if (!keyMatches(info, key)) return reply.status(403).send({ ok: false, error: 'Invalid key' });
    if (String(info.delete) !== deleteKey) return reply.status(403).send({ ok: false, error: 'Invalid delete key' });

    await deleteRecording(id);

    return reply.status(200).send({ ok: true });
  }
};
