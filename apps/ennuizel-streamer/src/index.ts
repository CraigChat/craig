import { STATUS_CODES } from 'node:http';
import { join } from 'node:path';

import { startMetricsServer } from '@craig/metrics';
import destr from 'destr';
import uWS from 'uWebSockets.js';

import { HOST, PORT, PROXY_HEADER, REC_DIRECTORY } from './util/config.js';
import { timeoutWebsocket, WebsocketData } from './util/index.js';
import logger from './util/logger.js';
import { openStreams, requestHistogram } from './util/metrics.js';
import { getNotes, streamController } from './util/process.js';
import { testProcessOptions } from './util/processOptions.js';
import { getInfoText, getRecordingInfo, recordingExists } from './util/recording.js';

function send(
  res: uWS.HttpResponse,
  { status, data, timer }: { status: number; data: any | string; timer?: ReturnType<typeof requestHistogram.startTimer> }
) {
  if (!res.aborted)
    res.cork(() =>
      res
        .writeStatus(`${status} ${STATUS_CODES[status]}`)
        .writeHeader('Content-Type', typeof data === 'string' ? 'text/plain' : 'application/json')
        .writeHeader('Access-Control-Allow-Origin', '*')
        .end(typeof data === 'string' ? data : JSON.stringify(data))
    );
  timer?.({ status });
}

const ID_REGEX = /^[\w-]+$/;

uWS
  .App()
  .get('/health', (res) => {
    const timer = requestHistogram.startTimer({ route: '/health' });
    send(res, { timer, status: 200, data: { ok: true } });
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
    if (info.key !== key) return send(res, { timer, status: 403, data: { ok: false, error: 'Invalid key' } });

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
    if (info.key !== key) return send(res, { timer, status: 403, data: { ok: false, error: 'Invalid key' } });

    try {
      const recFileBase = join(REC_DIRECTORY, `${id}.ogg`);
      const notes = await getNotes({ recFileBase, cancelSignal: abortController.signal });
      const txt = await getInfoText(id, info, users, notes);
      send(res, { timer, status: 200, data: txt });
    } catch (e) {
      send(res, { timer, status: 500, data: { ok: false } });
    }
  })
  .ws<WebsocketData>('/api/ennuizel', {
    /* Options */
    compression: 0,
    maxPayloadLength: 16 * 1024 * 1024,
    idleTimeout: 10,

    /* Handlers */
    upgrade: (res, req, context) => {
      const timer = requestHistogram.startTimer({ route: '/ennuizel' });
      const ip = PROXY_HEADER ? req.getHeader(PROXY_HEADER) : Buffer.from(res.getRemoteAddressAsText()).toString();
      logger.info(`New websocket connection request from ${ip}`);

      /* This immediately calls open handler, you must not use res after this call */
      res.upgrade(
        {
          ready: false
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
      openStreams.inc();
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
        if (typeof payload.i !== 'string' || typeof payload.k !== 'string' || typeof payload.t !== 'number') return ws.end(4001);
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
        if (info.key !== payload.k) return ws.end(4002);
        if (!users[payload.t - 1]) return ws.end(4003);

        ws.send('{"ok":true}');
        data.ready = true;
        data.cancelTimeout();
        data.controller = streamController(ws, payload.i, payload.t);
      } else {
        if (isBinary) data.controller?.onMessage(message);
      }
    },
    close: (ws) => {
      const data = ws.getUserData();
      if (!data.ready) data.cancelTimeout();
      data.controller?.onEnd();
      openStreams.dec();
    }
  })
  .listen(HOST, PORT, async (token) => {
    if (token) {
      logger.info(`Listening on ${HOST}:${PORT}`);
      await testProcessOptions();
      startMetricsServer(logger);
      // PM2 signalling
      if (process.send && process.env.pm_id !== undefined) process.send('ready');
    } else {
      logger.error(`Failed to listen to port ${PORT}`);
    }
  });
