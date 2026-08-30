import { timingSafeEqual } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import { join } from 'node:path';
import { writeHeapSnapshot } from 'node:v8';

import { startMetricsServer } from '@craig/metrics';
import destr from 'destr';
import uWS from 'uWebSockets.js';

import { HOST, PORT, PROXY_HEADER, REC_DIRECTORY } from './util/config.js';
import { timeoutWebsocket, WebsocketData } from './util/index.js';
import logger from './util/logger.js';
import { openStreams, requestHistogram, streamsTotal } from './util/metrics.js';
import { getNotes, SEND_SIZE, streamController } from './util/process.js';
import { testProcessOptions } from './util/processOptions.js';
import { getInfoText, getRecordingInfo, recordingExists, safeKeyCompare } from './util/recording.js';

interface SendOptions {
  status: number;
  data: any | string;
  timer?: ReturnType<typeof requestHistogram.startTimer>;
  headers?: Record<string, string>;
}

function send(res: uWS.HttpResponse, { status, data, timer, headers }: SendOptions) {
  if (!res.aborted)
    res.cork(() => {
      res.writeStatus(`${status} ${STATUS_CODES[status]}`);

      if (headers)
        for (const header in headers) {
          res.writeHeader(header, headers[header]);
        }

      if (!headers?.['content-type']) res.writeHeader('Content-Type', typeof data === 'string' ? 'text/plain' : 'application/json');
      if (!headers?.['access-control-allow-origin']) res.writeHeader('Access-Control-Allow-Origin', '*');

      res.end(typeof data === 'string' ? data : JSON.stringify(data));
    });
  timer?.({ status });
}

const ID_REGEX = /^[\w-]+$/;
let openStreamCount = 0;

const app = uWS
  .App()
  .get('/health', (res) => {
    const timer = requestHistogram.startTimer({ route: '/health' });
    send(res, { timer, status: 200, data: { ok: true } });
  })
  .post('/_writeHeapSnapshot', async (res, req) => {
    if (req.getHeader('x-real-ip') || req.getHeader('cf-connecting-ip')) return send(res, { status: 401, data: { ok: false } });
    if (!process.env.SNAPSHOT_KEY || !timingSafeEqual(Buffer.from(req.getHeader('authorization')), Buffer.from(process.env.SNAPSHOT_KEY)))
      return send(res, { status: 401, data: { ok: false } });
    const filename = writeHeapSnapshot();
    send(res, { status: 200, data: { filename } });
  })
  .get('/api/recording/:id/users', async (res, req) => {
    const timer = requestHistogram.startTimer({ route: '/recording/:id/users' });
    res.onAborted(() => (res.aborted = true));
    const id = req.getParameter('id');
    if (!id || !ID_REGEX.exec(id)) return send(res, { timer, status: 400, data: { ok: false, error: 'Invalid ID' } });
    const key = req.getQuery('key');
    if (!key || !ID_REGEX.exec(key)) return send(res, { timer, status: 400, data: { ok: false, error: 'Invalid key' } });

    const recExists = await recordingExists(id);
    if (!recExists.available || !recExists.dataExists) return send(res, { timer, status: 404, data: { ok: false, error: 'Recording not found' } });
    const { info, users } = await getRecordingInfo(id);
    if (!safeKeyCompare(info.key, key)) return send(res, { timer, status: 403, data: { ok: false, error: 'Invalid key' } });

    send(res, {
      timer,
      status: 200,
      data: {
        ok: true,
        users: users.map((u) => {
          const { avatar: _, ...user } = u;
          return user;
        })
      }
    });
  })
  .get('/api/recording/:id/.txt', async (res, req) => {
    const timer = requestHistogram.startTimer({ route: '/recording/:id/.txt' });
    const abortController = new AbortController();
    res.onAborted(() => {
      res.aborted = true;
      abortController.abort();
    });
    const id = req.getParameter('id');
    if (!id || !ID_REGEX.exec(id)) return send(res, { timer, status: 400, data: { ok: false, error: 'Invalid ID' } });
    const key = req.getQuery('key');
    if (!key || !ID_REGEX.exec(key)) return send(res, { timer, status: 400, data: { ok: false, error: 'Invalid key' } });

    const recExists = await recordingExists(id);
    if (!recExists.available || !recExists.dataExists) return send(res, { timer, status: 404, data: { ok: false, error: 'Recording not found' } });
    const { info, users } = await getRecordingInfo(id);
    if (!safeKeyCompare(info.key, key)) return send(res, { timer, status: 403, data: { ok: false, error: 'Invalid key' } });

    try {
      const recFileBase = join(REC_DIRECTORY, `${id}.ogg`);
      const notes = await getNotes({ recFileBase, cancelSignal: abortController.signal });
      const txt = await getInfoText(id, info, users, notes);
      send(res, {
        timer,
        status: 200,
        data: txt,
        headers: {
          'cache-control': 'max-age=120',
          'content-disposition': `attachment; filename="craig-${id}-info.txt"`,
          'content-length': Buffer.byteLength(txt).toString()
        }
      });
    } catch (e) {
      send(res, { timer, status: 500, data: { ok: false } });
    }
  })
  .ws<WebsocketData>('/api/ennuizel', {
    /* Options */
    compression: 0,
    maxPayloadLength: 16 * 1024 * 1024,
    maxBackpressure: SEND_SIZE * 5,
    idleTimeout: 10,

    /* Handlers */
    upgrade: (res, req, context) => {
      const timer = requestHistogram.startTimer({ route: '/ennuizel' });
      const ip = PROXY_HEADER ? req.getHeader(PROXY_HEADER.toLowerCase()) : Buffer.from(res.getRemoteAddressAsText()).toString();
      logger.info(`New websocket connection request from ${ip}`);

      /* This immediately calls open handler, you must not use res after this call */
      res.upgrade(
        {
          ready: false,
          left: false
        },
        req.getHeader('sec-websocket-key'),
        req.getHeader('sec-websocket-protocol'),
        req.getHeader('sec-websocket-extensions'),
        context
      );
      timer({ status: 101 });
    },
    open: (ws) => {
      const data = ws.getUserData();
      data.cancelTimeout = timeoutWebsocket(ws);
      streamsTotal.inc();
      openStreams.inc();
      openStreamCount++;
      logger.info(`WS open (${openStreamCount})`);
    },
    message: async (ws, message, isBinary) => {
      const data = ws.getUserData();

      if (!data.ready) {
        // Parse payload
        const json = Buffer.from(message).toString('utf-8', 0);
        let payload: { i: string; k: string; t: number };
        try {
          payload = destr(json, { strict: true });
        } catch (e) {
          return ws.end(1001);
        }

        // Validate payload
        if (
          !payload ||
          typeof payload !== 'object' ||
          typeof payload.i !== 'string' ||
          typeof payload.k !== 'string' ||
          typeof payload.t !== 'number'
        )
          return ws.end(4001);
        if (
          payload.t < 1 ||
          payload.t > 65535 ||
          !Number.isInteger(payload.t) ||
          !payload.i ||
          !payload.k ||
          !ID_REGEX.exec(payload.i) ||
          !ID_REGEX.exec(payload.k)
        )
          return ws.end(4001);

        // Validate recording
        const recExists = await recordingExists(payload.i);
        if (!recExists.available || !recExists.dataExists) return ws.end(4002);
        const { info, users } = await getRecordingInfo(payload.i);
        if (!safeKeyCompare(info.key, payload.k)) return ws.end(4002);
        if (!users[payload.t - 1]) return ws.end(4003);

        // Websocket left before we started
        if (data.left) return;

        try {
          ws.send('{"ok":true}');
        } catch {}
        data.ready = true;
        data.cancelTimeout();
        data.controller = streamController(ws, payload.i, payload.t);
      } else {
        if (isBinary) data.controller?.onMessage(message);
      }
    },
    drain(ws) {
      ws.getUserData().controller?.onDrain();
    },
    close: (ws, code, message) => {
      const data = ws.getUserData();
      if (!data.ready) data.cancelTimeout();
      data.left = true;
      data.controller?.onEnd();
      openStreams.dec();
      openStreamCount--;
      const reason = message ? Buffer.from(message).toString() : '';
      logger.info(`WS close (${openStreamCount}) code=${code} reason=${reason} buffered=${ws.getBufferedAmount()}`);
    }
  })
  .listen(HOST, PORT, async (token) => {
    if (token) {
      logger.info(`Listening on ${HOST}:${PORT}`);
      logger.info(`Rec Directory: ${REC_DIRECTORY}`);
      await testProcessOptions();
      startMetricsServer(logger);
      // PM2 signalling
      if (process.send && process.env.pm_id !== undefined) process.send('ready');
    } else {
      logger.error(`Failed to listen to port ${PORT}`);
    }
  });

process.once('SIGTERM', () => {
  logger.info('Recieved SIGTERM');
  app.close();
  process.exit();
});

process.once('SIGINT', () => {
  logger.info('Recieved SIGINT');
  app.close();
  process.exit();
});
