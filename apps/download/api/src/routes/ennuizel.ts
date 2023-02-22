import { captureException, withScope } from '@sentry/node';
import destr from 'destr';
import { RouteOptions } from 'fastify';
import internal from 'node:stream';

import { rawPartwise } from '../util/cook';
import { getRecording, getUsers, keyMatches } from '../util/recording';
import { timeoutWebsocket, toBuffer } from '../util/ws';

const sendSize = 65536;

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

      let stream: internal.Readable,
        paused = false,
        ackd = -1,
        sending = 0,
        buf = Buffer.alloc(4);
      buf.writeUInt32LE(sending, 0);

      function readable() {
        if (paused) return;
        let chunk;
        while ((chunk = stream.read(sendSize))) {
          setData(chunk);
          if (paused) break;
        }
      }

      function setData(chunk) {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= sendSize) sendBuffer();
      }

      function sendBuffer() {
        // Get the sendable part
        let toSend;
        if (buf.length > sendSize) {
          toSend = buf.subarray(0, sendSize);
          buf = buf.subarray(sendSize);
        } else {
          toSend = buf;
          buf = null;
        }

        try {
          connection.socket.send(toSend);
        } catch (ex) {}

        const hdr = Buffer.alloc(4);
        sending++;
        hdr.writeUInt32LE(sending, 0);
        if (buf) buf = Buffer.concat([hdr, buf]);
        else buf = hdr;

        if (sending > ackd + 128) {
          // Stop accepting data
          paused = true;
        }
      }

      connection.socket.on('message', (message) => {
        const msg = toBuffer(message);
        const cmd = msg.readUInt32LE(0);
        const p = msg.readUInt32LE(4);
        if (cmd !== 0) return connection.socket.close();
        if (p > ackd) {
          ackd = p;
          if (sending <= ackd + 128) {
            // Accept data
            paused = false;
            readable();
          }
        }
      });

      try {
        connection.socket.send('{"ok":true}');
        stream = rawPartwise(payload.i, payload.t);
        stream.on('readable', readable);
        stream.once('end', () => {
          while (buf.length > 4) sendBuffer();
          sendBuffer();
          connection.socket.close();
        });
        stream.once('close', () => {
          connection.socket.close(1000);
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
