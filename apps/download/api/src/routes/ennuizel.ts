import { captureException, withScope } from '@sentry/node';
import destr from 'destr';
import { RouteOptions } from 'fastify';

import { rawPartwise } from '../util/cook';
import { getRecording, getUsers, keyMatches } from '../util/recording';
import { timeoutWebsocket, toBuffer } from '../util/ws';

export const ennuizelWebsocketRoute: RouteOptions = {
  method: 'GET',
  url: '/api/ennuizel',
  handler: (_, reply) => reply.status(404).send(),
  wsHandler(connection) {
    timeoutWebsocket(connection.socket);
    connection.socket.once('message', async (data) => {
      const message = toBuffer(data);
      const json = message.toString('utf8', 0);
      let payload: { i: string; k: string; t: number };
      try {
        payload = destr(json, { strict: true });
      } catch (e) {
        return connection.socket.close(1001);
      }

      if (typeof payload.i !== 'string' || typeof payload.k !== 'string' || typeof payload.t !== 'number') return connection.socket.close(4001);
      if (
        payload.t < 1 ||
        payload.t > 65535 ||
        !Number.isInteger(payload.t) ||
        !payload.i ||
        !payload.k ||
        !/^[\w-]+$/.exec(payload.i) ||
        !/^[\w-]+$/.exec(payload.k)
      )
        return connection.socket.close(4001);

      const info = await getRecording(payload.i);
      if (info === false || !info || !keyMatches(info, payload.k)) return connection.socket.close(4002);

      const users = await getUsers(payload.i);
      if (!users[payload.t - 1]) return connection.socket.close(4003);

      try {
        connection.socket.send('{"ok":true}');
        const stream = rawPartwise(payload.i, payload.t);
        stream.on('data', (buf) => connection.socket.send(buf));
        stream.once('end', () => connection.socket.close(1000));
        stream.once('close', () => connection.socket.close(1000));
        stream.once('error', () => connection.socket.close(4000));
        connection.socket.once('message', () => {
          connection.socket.close(4004);
          stream.destroy();
        });
      } catch (err) {
        withScope((scope) => {
          scope.setTag('recordingID', payload.i);
          scope.setExtra('trackNum', payload.t);
          captureException(err);
        });
        return connection.socket.close(4000);
      }
    });
  }
};
