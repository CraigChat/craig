import { RouteOptions } from 'fastify';
import { allowedContainers, allowedFormats, cook, getDuration, isReady } from '../util/cook';
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

export const getRoute: RouteOptions = {
  method: 'GET',
  url: '/api/recording/:id/cook',
  handler: async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    if (!id) return reply.status(400).send({ ok: false, error: 'Invalid ID' });
    const { key } = request.query as Record<string, string>;
    if (!key) return reply.status(403).send({ ok: false, error: 'Invalid key' });

    const info = await getRecording(id);
    if (info === false) return reply.status(410).send({ ok: false, error: 'Recording was deleted' });
    else if (!info) return reply.status(404).send({ ok: false, error: 'Recording not found' });
    if (!keyMatches(info, key)) return reply.status(403).send({ ok: false, error: 'Invalid key' });

    const ready = await isReady(id);
    return reply.status(200).send({ ok: true, ready });
  }
};

export const postRoute: RouteOptions = {
  method: 'POST',
  url: '/api/recording/:id/cook',
  handler: async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    if (!id) return reply.status(400).send({ ok: false, error: 'Invalid ID' });
    const { key } = request.query as Record<string, string>;
    if (!key) return reply.status(403).send({ ok: false, error: 'Invalid key' });

    const info = await getRecording(id);
    if (info === false) return reply.status(410).send({ ok: false, error: 'Recording was deleted' });
    else if (!info) return reply.status(404).send({ ok: false, error: 'Recording not found' });
    if (!keyMatches(info, key)) return reply.status(403).send({ ok: false, error: 'Invalid key' });

    const ready = await isReady(id);
    if (!ready) return reply.status(429).send({ ok: false, error: 'This recording is already being processed' });

    const body = request.body as { format?: string; container?: string; dynaudnorm?: boolean };
    if (body.format && !allowedFormats.includes(body.format))
      return reply.status(400).send({ ok: false, error: 'Invalid format' });
    if (body.format === 'mp3' && !info.features.mp3)
      return reply.status(403).send({ ok: false, error: 'This recording is missing the MP3 feature' });
    const format = body.format || 'flac';

    if (body.container && !Object.keys(allowedContainers).includes(body.container))
      return reply.status(400).send({ ok: false, error: 'Invalid container' });
    if (body.container === 'mix' && !info.features.mix)
      return reply.status(403).send({ ok: false, error: 'This recording is missing the mix feature' });
    const container = body.container || 'zip';

    const dynaudnorm = Boolean(body.dynaudnorm);

    try {
      let ext = allowedContainers[container].ext || `${format}.zip`;
      if (container === 'mix') ext = format === 'vorbis' ? 'ogg' : format;
      const mime = allowedContainers[container].mime || 'application/zip';

      const buffer = await cook(id, format, container, dynaudnorm);
      return reply
        .status(200)
        .headers({
          'content-disposition': `attachment; filename=${id}.${ext}`,
          'content-type': mime
        })
        .send(buffer);
    } catch (err) {
      return reply.status(500).send({ ok: false, error: err.message });
    }
  }
};

// TODO add glowers support
