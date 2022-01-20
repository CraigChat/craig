import { RouteOptions } from 'fastify';
import { ErrorCode } from '../util';
import { getRecording, deleteRecording, keyMatches, getUsers, getRawRecordingStream } from '../util/recording';

export const headRoute: RouteOptions = {
  method: 'HEAD',
  url: '/api/recording/:id',
  handler: async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    if (!id) return reply.status(400).send({ ok: false, error: 'Invalid ID', code: ErrorCode.INVALID_ID });
    const { key } = request.query as Record<string, string>;
    if (!key) return reply.status(403).send({ ok: false, error: 'Invalid key', code: ErrorCode.INVALID_KEY });
    return reply.status(200).send('OK');
  }
};

export const getRoute: RouteOptions = {
  method: 'GET',
  url: '/api/recording/:id',
  handler: async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    if (!id) return reply.status(400).send({ ok: false, error: 'Invalid ID', code: ErrorCode.INVALID_ID });
    const { key } = request.query as Record<string, string>;
    if (!key) return reply.status(403).send({ ok: false, error: 'Invalid key', code: ErrorCode.INVALID_KEY });

    const info = await getRecording(id);
    if (info === false)
      return reply.status(410).send({ ok: false, error: 'Recording was deleted', code: ErrorCode.RECORDING_DELETED });
    else if (!info)
      return reply.status(404).send({ ok: false, error: 'Recording not found', code: ErrorCode.RECORDING_NOT_FOUND });
    if (!keyMatches(info, key))
      return reply.status(403).send({ ok: false, error: 'Invalid key', code: ErrorCode.INVALID_KEY });

    delete info.delete;

    return reply.status(200).send({ ok: true, info });
  }
};

export const usersRoute: RouteOptions = {
  method: 'GET',
  url: '/api/recording/:id/users',
  handler: async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    if (!id) return reply.status(400).send({ ok: false, error: 'Invalid ID', code: ErrorCode.INVALID_ID });
    const { key } = request.query as Record<string, string>;
    if (!key) return reply.status(403).send({ ok: false, error: 'Invalid key', code: ErrorCode.INVALID_KEY });

    const info = await getRecording(id);
    if (info === false)
      return reply.status(410).send({ ok: false, error: 'Recording was deleted', code: ErrorCode.RECORDING_DELETED });
    else if (!info)
      return reply.status(404).send({ ok: false, error: 'Recording not found', code: ErrorCode.RECORDING_NOT_FOUND });
    if (!keyMatches(info, key))
      return reply.status(403).send({ ok: false, error: 'Invalid key', code: ErrorCode.INVALID_KEY });

    const users = await getUsers(id);
    return reply.status(200).send({ ok: true, users });
  }
};

export const rawRoute: RouteOptions = {
  method: 'GET',
  url: '/api/recording/:id/raw',
  handler: async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    if (!id) return reply.status(400).send({ ok: false, error: 'Invalid ID', code: ErrorCode.INVALID_ID });
    const { key } = request.query as Record<string, string>;
    if (!key) return reply.status(403).send({ ok: false, error: 'Invalid key', code: ErrorCode.INVALID_KEY });

    const info = await getRecording(id);
    if (info === false)
      return reply.status(410).send({ ok: false, error: 'Recording was deleted', code: ErrorCode.RECORDING_DELETED });
    else if (!info)
      return reply.status(404).send({ ok: false, error: 'Recording not found', code: ErrorCode.RECORDING_NOT_FOUND });
    if (!keyMatches(info, key))
      return reply.status(403).send({ ok: false, error: 'Invalid key', code: ErrorCode.INVALID_KEY });

    return reply
      .status(200)
      .headers({
        'content-disposition': `attachment; filename=${id}.ogg`,
        'content-type': 'audio/ogg'
      })
      .send(getRawRecordingStream(id));
  }
};

export const deleteRoute: RouteOptions = {
  method: 'DELETE',
  url: '/api/recording/:id',
  handler: async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    if (!id) return reply.status(400).send({ ok: false, error: 'Invalid ID', code: ErrorCode.INVALID_ID });
    const { key, delete: deleteKey } = request.query as Record<string, string>;
    if (!key) return reply.status(403).send({ ok: false, error: 'Invalid key', code: ErrorCode.INVALID_KEY });
    if (!deleteKey)
      return reply.status(403).send({ ok: false, error: 'Invalid delete key', code: ErrorCode.INVALID_DELETE_KEY });

    const info = await getRecording(id);
    if (info === false)
      return reply.status(410).send({ ok: false, error: 'Recording was deleted', code: ErrorCode.RECORDING_DELETED });
    else if (!info)
      return reply.status(404).send({ ok: false, error: 'Recording not found', code: ErrorCode.RECORDING_NOT_FOUND });
    if (!keyMatches(info, key))
      return reply.status(403).send({ ok: false, error: 'Invalid key', code: ErrorCode.INVALID_KEY });
    if (String(info.delete) !== deleteKey)
      return reply.status(403).send({ ok: false, error: 'Invalid delete key', code: ErrorCode.INVALID_DELETE_KEY });

    await deleteRecording(id);

    return reply.status(204).send();
  }
};
