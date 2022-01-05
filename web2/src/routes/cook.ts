import { RouteOptions } from 'fastify';
import { getDuration } from '../util/cook';
import { getRecording, keyMatches } from '../util/recording';

export const durationRoute: RouteOptions = {
  method: 'GET',
  url: '/api/recording/:id/duration',
  handler: async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    if (!id) return reply.status(400).send({ ok: false, error: 'Invalid ID' });
    const { key } = request.query as Record<string, string>;
    if (!key) return reply.status(403).send({ ok: false, error: 'Invalid key' });

    const info = await getRecording(id);
    if (info === false) return reply.status(410).send({ ok: false, error: 'Recording was deleted' });
    else if (!info) return reply.status(404).send({ ok: false, error: 'Recording not found' });
    if (!keyMatches(info, key)) return reply.status(403).send({ ok: false, error: 'Invalid key' });

    const duration = await getDuration(id);

    return reply.status(200).send({ ok: true, duration });
  }
};
