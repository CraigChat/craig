import { TranscriptStatus } from '@prisma/client';
import { RouteOptions } from 'fastify';

import { prisma } from '../prisma';
import { ErrorCode } from '../util';
import { getRecording, keyMatches } from '../util/recording';

export const statusRoute: RouteOptions = {
  method: 'GET',
  url: '/api/recording/:id/transcript',
  handler: async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    if (!id) return reply.status(400).send({ ok: false, error: 'Invalid ID', code: ErrorCode.INVALID_ID });
    const { key } = request.query as Record<string, string>;
    if (!key) return reply.status(403).send({ ok: false, error: 'Invalid key', code: ErrorCode.INVALID_KEY });

    const info = await getRecording(id);
    if (info === false) return reply.status(410).send({ ok: false, error: 'Recording was deleted', code: ErrorCode.RECORDING_DELETED });
    if (!info) return reply.status(404).send({ ok: false, error: 'Recording not found', code: ErrorCode.RECORDING_NOT_FOUND });
    if (!keyMatches(info, key)) return reply.status(403).send({ ok: false, error: 'Invalid key', code: ErrorCode.INVALID_KEY });
    if (process.env.TRANSCRIPT_ENABLED === 'false')
      return reply.status(200).send({
        ok: true,
        transcript: { status: TranscriptStatus.SKIPPED, errorCode: 'TRANSCRIPT_DISABLED', errorMessage: 'Transcript generation is disabled.' }
      });

    const transcript = await prisma.recordingTranscript.findUnique({ where: { recordingId: id } });
    if (!transcript) return reply.status(200).send({ ok: true, transcript: { status: TranscriptStatus.PENDING } });

    return reply.status(200).send({
      ok: true,
      transcript: {
        status: transcript.status,
        preview: transcript.preview,
        errorCode: transcript.errorCode,
        errorMessage: transcript.errorMessage,
        startedAt: transcript.startedAt,
        completedAt: transcript.completedAt
      }
    });
  }
};

export const textRoute: RouteOptions = {
  method: 'GET',
  url: '/api/recording/:id/transcript.txt',
  handler: async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    if (!id) return reply.status(400).send({ ok: false, error: 'Invalid ID', code: ErrorCode.INVALID_ID });
    const { key } = request.query as Record<string, string>;
    if (!key) return reply.status(403).send({ ok: false, error: 'Invalid key', code: ErrorCode.INVALID_KEY });

    const info = await getRecording(id);
    if (info === false) return reply.status(410).send({ ok: false, error: 'Recording was deleted', code: ErrorCode.RECORDING_DELETED });
    if (!info) return reply.status(404).send({ ok: false, error: 'Recording not found', code: ErrorCode.RECORDING_NOT_FOUND });
    if (!keyMatches(info, key)) return reply.status(403).send({ ok: false, error: 'Invalid key', code: ErrorCode.INVALID_KEY });

    const transcript = await prisma.recordingTranscript.findUnique({ where: { recordingId: id } });
    if (!transcript) return reply.status(404).send({ ok: false, error: 'Transcript not found', code: ErrorCode.TRANSCRIPT_NOT_FOUND });
    if (transcript.status !== TranscriptStatus.COMPLETE || !transcript.text)
      return reply.status(409).send({ ok: false, error: 'Transcript is not ready', code: ErrorCode.TRANSCRIPT_NOT_READY });

    return reply
      .status(200)
      .headers({
        'content-disposition': `attachment; filename=${id}-transcript.txt`,
        'content-type': 'text/plain; charset=utf-8'
      })
      .send(transcript.text);
  }
};
