import { nanoid } from 'nanoid';
import { WebSocket } from 'ws';

import { WebappOp, WebappOpCloseReason } from './protocol.js';
import { debug, logger, prettyLog, toBuffer } from './util.js';

export const shardsConnected = new Map<string, Shard>();

export interface ShardIdentifyPayload {
  id: string;
  ennuiKey: string;
  shardId: number;
  clientId: string;
  clientName?: string;
  flacEnabled: boolean;
  continuousEnabled: boolean;
  serverName: string;
  serverIcon?: string;
  channelName: string;
  channelType: 2 | 13;
}

export class Shard {
  ws: WebSocket;
  id: string;
  connectionToken = nanoid(8);
  payload: ShardIdentifyPayload;
  clients = new Map<string, WebSocket>();

  constructor(ws: WebSocket, payload: ShardIdentifyPayload) {
    this.ws = ws;
    this.id = payload.id;
    this.payload = payload;
    shardsConnected.set(payload.id, this);
    ws.on('message', (data) => this.parseMessage(toBuffer(data)));
    ws.on('close', (code, reason) => {
      prettyLog('-', `Recording ${this.id} closed (code ${code}): ${reason}`);
      this.close(reason.length > 0 ? reason[0] : undefined);
    });
  }

  newConnection(ws: WebSocket, message: Buffer, username: string) {
    const clientId = nanoid(8);
    this.clients.set(clientId, ws);
    prettyLog('>', `User "${username}" (${clientId}) joined recording ${this.id}`);
    ws.on('close', (code, reason) => {
      prettyLog('<', `User "${username}" (${clientId}) left recording ${this.id} (code ${code}): ${reason}`);
      this.clients.delete(clientId);
      this.ws.send(this.wrapMessage(reason.slice(0, 10), clientId, WebappOp.CLOSE));
    });
    ws.on('message', (data) => {
      const message = toBuffer(data);
      this.ws.send(this.wrapMessage(message, clientId));
    });
    this.ws.send(this.wrapMessage(message, clientId, WebappOp.NEW));
  }

  close(reason?: WebappOpCloseReason) {
    this.ws.close();
    for (const clientId of this.clients.keys()) this.closeClient(clientId, reason || WebappOpCloseReason.SHARD_CLOSED);
    shardsConnected.delete(this.id);
  }

  closeClient(clientId: string, reason?: WebappOpCloseReason) {
    if (debug) logger.debug('closing client', clientId, 'from shard', this.id, reason);
    const ws = this.clients.get(clientId);
    if (!ws) return;
    ws.close(1000, Buffer.from([reason ?? WebappOpCloseReason.CLOSED]));
  }

  private parseMessage(message: Buffer) {
    const op: WebappOp = message.readUInt32LE(0);

    switch (op) {
      case WebappOp.DATA: {
        const clientId = message.toString('utf8', 4, 12);
        const client = this.clients.get(clientId);
        if (!client) return;
        client.send(message.slice(12));
        break;
      }
      case WebappOp.CLOSE: {
        const clientId = message.toString('utf8', 4, 12);
        const client = this.clients.get(clientId);
        if (!client) return;
        const reason = message.length > 12 ? message.readUInt32LE(12) : WebappOpCloseReason.CLOSED;
        this.closeClient(clientId, reason);
        break;
      }
      case WebappOp.EXIT: {
        const reason: WebappOpCloseReason = message.length > 4 ? message.readUInt32LE(4) : WebappOpCloseReason.SHARD_CLOSED;
        this.close(reason);
        break;
      }
      case WebappOp.PING: {
        const ret = Buffer.alloc(4);
        ret.writeUInt32LE(WebappOp.PONG, 0);
        this.ws.send(ret);
        break;
      }
      default: {
        prettyLog('i', `Unknown op from recording ${this.id}: ${op}`);
        break;
      }
    }
  }

  private wrapMessage(message: Buffer, clientId: string, type = WebappOp.DATA) {
    const ret = Buffer.alloc(message.length + 12);
    ret.writeUInt32LE(type, 0);
    new Uint8Array(ret.buffer).set(new TextEncoder().encode(clientId), 4);
    message.copy(ret, 12);
    return ret;
  }
}

export function getShardFromConnectionToken(token: string) {
  for (const shard of shardsConnected.values()) {
    if (shard.connectionToken === token) return shard;
  }
  return null;
}
