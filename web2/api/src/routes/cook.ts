import { RouteOptions } from 'fastify';
import { ErrorCode } from '../util';
import {
  allowedAvatarFormats,
  allowedContainers,
  allowedFormats,
  cook,
  cookAvatars,
  getDuration,
  getNotes,
  isReady,
  rawPartwise
} from '../util/cook';
import { getRecording, getUsers, keyMatches } from '../util/recording';

export const durationRoute: RouteOptions = {
  method: 'GET',
  url: '/api/recording/:id/duration',
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

    const duration = await getDuration(id);

    return reply.status(200).send({ ok: true, duration });
  }
};

export const notesRoute: RouteOptions = {
  method: 'GET',
  url: '/api/recording/:id/notes',
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

    const notes = await getNotes(id);

    return reply.status(200).send({ ok: true, notes });
  }
};

export const ennuizelRoute: RouteOptions = {
  method: 'GET',
  url: '/api/recording/:id/ennuizel',
  handler: async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    if (!id) return reply.status(400).send({ ok: false, error: 'Invalid ID', code: ErrorCode.INVALID_ID });
    const { key, track } = request.query as Record<string, string>;
    if (!key) return reply.status(403).send({ ok: false, error: 'Invalid key', code: ErrorCode.INVALID_KEY });
    if (!track) return reply.status(400).send({ ok: false, error: 'Invalid track', code: ErrorCode.INVALID_TRACK });

    const info = await getRecording(id);
    if (info === false)
      return reply.status(410).send({ ok: false, error: 'Recording was deleted', code: ErrorCode.RECORDING_DELETED });
    else if (!info)
      return reply.status(404).send({ ok: false, error: 'Recording not found', code: ErrorCode.RECORDING_NOT_FOUND });
    if (!keyMatches(info, key))
      return reply.status(403).send({ ok: false, error: 'Invalid key', code: ErrorCode.INVALID_KEY });

    const trackNum = parseInt(track, 10);
    if (isNaN(trackNum) || trackNum <= 0)
      return reply.status(400).send({ ok: false, error: 'Invalid track', code: ErrorCode.INVALID_TRACK });

    const users = await getUsers(id);
    if (!users[trackNum - 1])
      return reply.status(400).send({ ok: false, error: 'Invalid track', code: ErrorCode.INVALID_TRACK });

    try {
      const stream = rawPartwise(id, trackNum);
      return reply.status(200).send(stream);
    } catch (err) {
      return reply.status(500).send({ ok: false, error: err.message });
    }
  }
};

export const getRoute: RouteOptions = {
  method: 'GET',
  url: '/api/recording/:id/cook',
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

    const ready = await isReady(id);
    return reply.status(200).send({ ok: true, ready });
  }
};

export const postRoute: RouteOptions = {
  method: 'POST',
  url: '/api/recording/:id/cook',
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

    const ready = await isReady(id);
    if (!ready)
      return reply
        .status(429)
        .send({ ok: false, error: 'This recording is already being processed', code: ErrorCode.RECORDING_NOT_READY });

    const body = request.body as { format?: string; container?: string; dynaudnorm?: boolean };
    if (body.format && !allowedFormats.includes(body.format))
      return reply.status(400).send({ ok: false, error: 'Invalid format', code: ErrorCode.INVALID_FORMAT });
    if (body.format === 'mp3' && !info.features.mp3)
      return reply
        .status(403)
        .send({ ok: false, error: 'This recording is missing the MP3 feature', code: ErrorCode.MISSING_MP3 });
    const format = body.format || 'flac';

    if (body.container && !Object.keys(allowedContainers).includes(body.container))
      return reply.status(400).send({ ok: false, error: 'Invalid container', code: ErrorCode.INVALID_CONTAINER });
    if (body.container === 'mix' && !info.features.mix)
      return reply
        .status(403)
        .send({ ok: false, error: 'This recording is missing the mix feature', code: ErrorCode.MISSING_MIX });
    const container = body.container || 'zip';

    const dynaudnorm = Boolean(body.dynaudnorm);

    try {
      let ext = allowedContainers[container].ext || `${format}.zip`;
      if (container === 'mix') ext = format === 'vorbis' ? 'ogg' : format;
      const mime = allowedContainers[container].mime || 'application/zip';

      const stream = cook(id, format, container, dynaudnorm);
      return reply
        .status(200)
        .headers({
          'content-disposition': `attachment; filename=${id}.${ext}`,
          'content-type': mime
        })
        .send(stream);
    } catch (err) {
      return reply.status(500).send({ ok: false, error: err.message });
    }
  }
};

export const runRoute: RouteOptions = {
  method: 'GET',
  url: '/api/recording/:id/cook/run',
  handler: async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    if (!id) return reply.status(400).send({ ok: false, error: 'Invalid ID', code: ErrorCode.INVALID_ID });
    const query = request.query as Record<string, string>;
    if (!query.key) return reply.status(403).send({ ok: false, error: 'Invalid key', code: ErrorCode.INVALID_KEY });

    const info = await getRecording(id);
    if (info === false)
      return reply.status(410).send({ ok: false, error: 'Recording was deleted', code: ErrorCode.RECORDING_DELETED });
    else if (!info)
      return reply.status(404).send({ ok: false, error: 'Recording not found', code: ErrorCode.RECORDING_NOT_FOUND });
    if (!keyMatches(info, query.key))
      return reply.status(403).send({ ok: false, error: 'Invalid key', code: ErrorCode.INVALID_KEY });

    const ready = await isReady(id);
    if (!ready)
      return reply
        .status(429)
        .send({ ok: false, error: 'This recording is already being processed', code: ErrorCode.RECORDING_NOT_READY });

    if (query.format && !allowedFormats.includes(query.format))
      return reply.status(400).send({ ok: false, error: 'Invalid format', code: ErrorCode.INVALID_FORMAT });
    if (query.format === 'mp3' && !info.features.mp3)
      return reply
        .status(403)
        .send({ ok: false, error: 'This recording is missing the MP3 feature', code: ErrorCode.MISSING_MP3 });
    const format = query.format || 'flac';

    if (query.container && !Object.keys(allowedContainers).includes(query.container))
      return reply.status(400).send({ ok: false, error: 'Invalid container', code: ErrorCode.INVALID_CONTAINER });
    if (query.container === 'mix' && !info.features.mix)
      return reply
        .status(403)
        .send({ ok: false, error: 'This recording is missing the mix feature', code: ErrorCode.MISSING_MIX });
    const container = query.container || 'zip';

    const dynaudnorm = Boolean(query.dynaudnorm);

    try {
      let ext = allowedContainers[container].ext || `${format}.zip`;
      if (container === 'mix') ext = format === 'vorbis' ? 'ogg' : format;
      const mime = allowedContainers[container].mime || 'application/zip';

      const stream = cook(id, format, container, dynaudnorm);
      return reply
        .status(200)
        .headers({
          'content-disposition': `attachment; filename=${id}.${ext}`,
          'content-type': mime
        })
        .send(stream);
    } catch (err) {
      return reply.status(500).send({ ok: false, error: err.message });
    }
  }
};

export const avatarRoute: RouteOptions = {
  method: 'POST',
  url: '/api/recording/:id/cook/avatars',
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

    const ready = await isReady(id);
    if (!ready)
      return reply
        .status(429)
        .send({ ok: false, error: 'This recording is already being processed', code: ErrorCode.RECORDING_NOT_READY });

    const body = request.body as {
      format?: string;
      container?: string;
      transparent?: boolean;
      bg?: string;
      fg?: string;
    };

    if (((body.format && body.format !== 'png') || body.container === 'exe') && !info.features.glowers)
      return reply
        .status(403)
        .send({ ok: false, error: 'This recording is missing the glowers feature', code: ErrorCode.MISSING_GLOWERS });
    if (body.format && !allowedAvatarFormats.includes(body.format))
      return reply.status(400).send({ ok: false, error: 'Invalid format', code: ErrorCode.INVALID_FORMAT });
    const format = body.format || 'png';

    if (body.container && body.container !== 'exe' && body.container !== 'zip')
      return reply.status(400).send({ ok: false, error: 'Invalid container', code: ErrorCode.INVALID_CONTAINER });
    if (body.container === 'exe' && !['movsfx', 'movpngsfx'].includes(format))
      return reply.status(400).send({ ok: false, error: 'Invalid container', code: ErrorCode.INVALID_CONTAINER });
    const container = body.container || (format === 'movsfx' || format === 'movpngsfx' ? 'exe' : 'zip');

    const transparent = Boolean(body.transparent);

    if (body.bg && !/^[a-f0-9]{6}$/.exec(body.bg))
      return reply.status(400).send({ ok: false, error: 'Invalid background color', code: ErrorCode.INVALID_BG });
    const bg = body.bg || '000000';

    if (body.fg && !/^[a-f0-9]{6}$/.exec(body.fg))
      return reply.status(400).send({ ok: false, error: 'Invalid foreground color', code: ErrorCode.INVALID_FG });
    const fg = body.fg || '008000';

    // sanity checks
    if (format === 'png' && container !== 'zip')
      return reply.status(400).send({
        ok: false,
        error: 'PNG format cannot use containers other than ZIP',
        code: ErrorCode.PNG_FORMAT_MISMATCH
      });

    try {
      const ext = container === 'exe' ? (format === 'movpngsfx' ? 'movpng.exe' : 'mov.exe') : `${format}.zip`;
      const mime = container === 'exe' ? 'application/vnd.microsoft.portable-executable' : 'application/zip';

      const stream = cookAvatars(id, format, container, transparent, bg, fg);
      return reply
        .status(200)
        .headers({
          'content-disposition': `attachment; filename=${id}.${ext}`,
          'content-type': mime
        })
        .send(stream);
    } catch (err) {
      return reply.status(500).send({ ok: false, error: err.message });
    }
  }
};
