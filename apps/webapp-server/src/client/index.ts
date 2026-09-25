import { createWriteStream } from 'fs';
import { WebSocket } from 'ws';

import {
  ConnectionType,
  ConnectionTypeMask,
  DataTypeFlag,
  DataTypeMask,
  EnnuicastrId,
  EnnuicastrInfo,
  EnnuicastrParts,
  Feature,
  WebappOp,
  WebappOpCloseReason
} from '../protocol.js';
import { toBuffer } from '../util.js';
import OggEncoder, { BOS } from './ogg.js';
import {
  FLAC_HEADER_44k,
  FLAC_HEADER_44k_VAD,
  FLAC_HEADER_48k,
  FLAC_HEADER_48k_VAD,
  FLAC_TAGS,
  OPUS_HEADERS_MONO,
  OPUS_MONO_HEADER_VAD,
  write
} from './util.js';

interface ShardClientOptions {
  id: string;
  ennuiKey: string;
  clientId: string;
  clientName?: string;
  flacEnabled: boolean;
  continuousEnabled: boolean;
  serverName: string;
  serverIcon?: string;
  channelName: string;
  channelType: 2 | 13;
  url: string;
  token: string;
}

interface WebUser {
  connected: boolean;
  dataType: DataTypeFlag;
  continuous: boolean;
  clientId: string;
  webUserID: string;
  data: {
    id: string;
    name: string;
    discrim: 'web';
    dtype: DataTypeFlag;
  };
}

const startTime = process.hrtime();
const dataEncoder = new OggEncoder(createWriteStream('./rec/test2.ogg.data'));
const headerEncoder1 = new OggEncoder(createWriteStream('./rec/test2.ogg.header1'));
const headerEncoder2 = new OggEncoder(createWriteStream('./rec/test2.ogg.header2'));
const usersStream = createWriteStream('./rec/test2.ogg.users');

class ShardClient {
  ws: WebSocket;
  ready = false;
  clients = new Map<string, ConnectionType>();
  webUsers = new Map<string, WebUser>();

  trackNo = 0;
  userTrackNos: { [key: string]: number } = {};
  userPacketNos: { [key: string]: number } = {};
  speaking: { [key: number]: boolean } = {};

  constructor(opts: ShardClientOptions) {
    this.ws = new WebSocket(opts.url, { headers: { Authorization: opts.token } });
    this.ws.on('open', () => {
      console.log('opened connection');

      const payload = JSON.stringify({
        id: opts.id,
        ennuiKey: opts.ennuiKey,
        clientId: opts.clientId,
        clientName: opts.clientName,
        shardId: 0,
        flacEnabled: opts.flacEnabled,
        continuousEnabled: opts.continuousEnabled,
        serverName: opts.serverName,
        serverIcon: opts.serverIcon,
        channelName: opts.channelName,
        channelType: opts.channelType
      });
      const ret = Buffer.alloc(payload.length + 4);
      ret.writeUInt32LE(WebappOp.IDENTIFY, 0);
      Buffer.from(payload).copy(ret, 4);
      this.ws.send(ret);
    });
    this.ws.on('message', (data) => this.parseMessage(toBuffer(data)));
    this.ws.on('close', (code, reason) => {
      if (!this.ready) {
        console.log('failed to connect', WebappOpCloseReason[reason[0]]);
        return;
      }

      console.log('disconnected', WebappOpCloseReason[reason[0]]);
    });
    this.ws.on('error', (e) => console.log('ws error', e));
  }

  findWebUserFromClientId(id: string) {
    for (const [, user] of this.webUsers) {
      if (user.clientId === id) return user;
    }
    return null;
  }

  closeClient(clientId: string, reason: WebappOpCloseReason) {
    const ret = Buffer.alloc(4);
    ret.writeUInt32LE(reason, 0);
    this.ws.send(this.wrapMessage(ret, clientId, WebappOp.CLOSE));
  }

  close(reason: WebappOpCloseReason) {
    this.ws.close(reason);
    this.ready = false;
  }

  createNewWebUser(clientId: string, username: string, dataType: DataTypeFlag, continuous: boolean) {
    let webUserID = username + '#web';
    let user = this.webUsers.get(username);
    if (user && (user.connected || user.dataType !== dataType || user.continuous !== continuous)) {
      // Try another track
      let i;
      for (i = 2; i < 16; i++) {
        webUserID = username + ' (' + i + ')#web';
        user = this.webUsers.get(webUserID);
        if (!user || (!user.connected && user.dataType === dataType && user.continuous === continuous)) break;
      }
      if (i === 16) return this.closeClient(clientId, WebappOpCloseReason.ALREADY_CONNECTED);

      username = username + ' (' + i + ')';
      webUserID = username + '#web';
    }

    console.log('connected', username, dataType, continuous, webUserID);

    let userTrackNo: number;
    if (!user) {
      /* Initialize this user's data (FIXME: partially duplicated from
       * the Discord version) */
      const userData: WebUser['data'] = { id: webUserID, name: username, discrim: 'web', dtype: dataType };
      userTrackNo = this.trackNo++;
      this.userTrackNos[webUserID] = userTrackNo;
      this.userPacketNos[webUserID] = 0;

      this.monitorSetConnected(userTrackNo, `${userData.name}#${userData.discrim}`, true, clientId);

      // Put a valid Opus header at the beginning if we're Opus
      if (dataType === DataTypeFlag.OPUS) {
        try {
          write(headerEncoder1, 0, userTrackNo, 0, continuous ? OPUS_MONO_HEADER_VAD : OPUS_HEADERS_MONO[0], BOS);
          write(headerEncoder2, 0, userTrackNo, 1, OPUS_HEADERS_MONO[1]);
        } catch (ex) {
          console.log('failed to write headers', ex);
        }
      }

      // Write their username etc to the recording data
      usersStream.write(',"' + userTrackNo + '":' + JSON.stringify(userData) + '\n');

      user = {
        connected: true,
        data: userData,
        dataType,
        continuous,
        clientId,
        webUserID
      };
      this.webUsers.set(webUserID, user);
    } else {
      userTrackNo = this.userTrackNos[webUserID];
      user.connected = true;
      user.clientId = clientId;
    }

    // Send them their own ID
    const idMessage = Buffer.alloc(EnnuicastrParts.info.length);
    idMessage.writeUInt32LE(EnnuicastrId.INFO, 0);
    idMessage.writeUInt32LE(EnnuicastrInfo.ID, EnnuicastrParts.info.key);
    idMessage.writeUInt32LE(userTrackNo, EnnuicastrParts.info.value);
    this.ws.send(this.wrapMessage(idMessage, clientId, WebappOp.DATA));

    // And send them the start time (which is always near 0)
    const stMessage = Buffer.alloc(EnnuicastrParts.info.length + 4);
    stMessage.writeUInt32LE(EnnuicastrId.INFO, 0);
    stMessage.writeUInt32LE(EnnuicastrInfo.START_TIME, EnnuicastrParts.info.key);
    stMessage.writeUInt32LE(1, EnnuicastrParts.info.value);
    this.ws.send(this.wrapMessage(stMessage, clientId, WebappOp.DATA));

    // And catch them up on connected users
    for (const [, user] of this.webUsers) {
      if (user.webUserID === webUserID || !user.connected) continue;
      const nickBuf = Buffer.from(`${user.data.name}#${user.data.discrim}`, 'utf8');
      const buf = Buffer.alloc(EnnuicastrParts.user.length + nickBuf.length);
      buf.writeUInt32LE(EnnuicastrId.USER, 0);
      buf.writeUInt32LE(this.userTrackNos[user.webUserID], EnnuicastrParts.user.index);
      buf.writeUInt32LE(1, EnnuicastrParts.user.status);
      nickBuf.copy(buf, EnnuicastrParts.user.nick);
      this.ws.send(this.wrapMessage(buf, clientId, WebappOp.DATA));
    }

    // And current speaking states
    for (const trackNo in this.speaking) {
      if (!this.speaking[trackNo]) continue;
      const buf = Buffer.alloc(EnnuicastrParts.speech.length);
      buf.writeUInt32LE(EnnuicastrId.SPEECH, 0);
      buf.writeUInt32LE(parseInt(trackNo), EnnuicastrParts.speech.index);
      buf.writeUInt32LE(this.speaking[trackNo] ? 1 : 0, EnnuicastrParts.speech.status);
      this.ws.send(this.wrapMessage(buf, clientId, WebappOp.DATA));
    }
  }

  createNewMonitor(clientId: string) {
    // Catch the monitor up on connected users
    for (const [, user] of this.webUsers) {
      if (!user.connected) continue;
      const nickBuf = Buffer.from(`${user.data.name}#${user.data.discrim}`, 'utf8');
      const buf = Buffer.alloc(EnnuicastrParts.user.length + nickBuf.length);
      buf.writeUInt32LE(EnnuicastrId.USER, 0);
      buf.writeUInt32LE(this.userTrackNos[user.webUserID], EnnuicastrParts.user.index);
      buf.writeUInt32LE(1, EnnuicastrParts.user.status);
      nickBuf.copy(buf, EnnuicastrParts.user.nick);
      this.ws.send(this.wrapMessage(buf, clientId, WebappOp.DATA));
    }

    // And current speaking states
    for (const trackNo in this.speaking) {
      if (!this.speaking[trackNo]) continue;
      const buf = Buffer.alloc(EnnuicastrParts.speech.length);
      buf.writeUInt32LE(EnnuicastrId.SPEECH, 0);
      buf.writeUInt32LE(parseInt(trackNo), EnnuicastrParts.speech.index);
      buf.writeUInt32LE(this.speaking[trackNo] ? 1 : 0, EnnuicastrParts.speech.status);
      this.ws.send(this.wrapMessage(buf, clientId, WebappOp.DATA));
    }
  }

  monitorSetConnected(trackNo: number, nick: string, connected: boolean, excludeClientId?: string) {
    const nickBuf = Buffer.from(nick, 'utf8');
    const buf = Buffer.alloc(EnnuicastrParts.user.length + nickBuf.length);
    buf.writeUInt32LE(EnnuicastrId.USER, 0);
    buf.writeUInt32LE(trackNo, EnnuicastrParts.user.index);
    buf.writeUInt32LE(connected ? 1 : 0, EnnuicastrParts.user.status);
    nickBuf.copy(buf, EnnuicastrParts.user.nick);

    // Remove speaking status if they disconnected
    if (!connected) this.speaking[trackNo] = false;

    // Send to all clients
    for (const [clientId, type] of this.clients) {
      if (clientId !== excludeClientId && type !== ConnectionType.PING) this.ws.send(this.wrapMessage(buf, clientId, WebappOp.DATA));
    }
  }

  monitorSetSpeaking(trackNo: number, speaking: boolean) {
    if (this.speaking[trackNo] === speaking) return;
    this.speaking[trackNo] = speaking;
    const buf = Buffer.alloc(EnnuicastrParts.speech.length);
    buf.writeUInt32LE(EnnuicastrId.SPEECH, 0);
    buf.writeUInt32LE(trackNo, EnnuicastrParts.speech.index);
    buf.writeUInt32LE(speaking ? 1 : 0, EnnuicastrParts.speech.status);

    // Send to all clients
    for (const [clientId, type] of this.clients) {
      if (type !== ConnectionType.PING) this.ws.send(this.wrapMessage(buf, clientId, WebappOp.DATA));
    }
  }

  onData(data: Buffer, clientId: string) {
    const user = this.findWebUserFromClientId(clientId);
    if (!user) return;
    const webUserID = user.data.id;
    const userTrackNo = this.userTrackNos[webUserID];

    const message = toBuffer(data);
    if (message.length < 4) this.closeClient(clientId, WebappOpCloseReason.INVALID_MESSAGE);

    const cmd = message.readUInt32LE(0);

    switch (cmd) {
      case EnnuicastrId.INFO: {
        // FIXME: We're counting on the fact that only FLAC sends info right now
        if (message.length != EnnuicastrParts.info.length) return this.closeClient(clientId, WebappOpCloseReason.INVALID_MESSAGE);

        const key = message.readUInt32LE(EnnuicastrParts.info.key);
        const value = message.readUInt32LE(EnnuicastrParts.info.value);
        if (key === EnnuicastrInfo.SAMPLE_RATE) {
          // Now we can write our header
          write(
            headerEncoder1,
            0,
            userTrackNo,
            0,
            value === 44100 ? (user.continuous ? FLAC_HEADER_44k_VAD : FLAC_HEADER_44k) : user.continuous ? FLAC_HEADER_48k_VAD : FLAC_HEADER_48k,
            BOS
          );
          write(headerEncoder2, 0, userTrackNo, 1, FLAC_TAGS);
        }
        break;
      }
      case EnnuicastrId.DATA: {
        if (message.length < EnnuicastrParts.data.length) return this.closeClient(clientId, WebappOpCloseReason.INVALID_MESSAGE);

        let granulePos = message.readUIntLE(EnnuicastrParts.data.granulePos, 6);

        // Calculate our "correct" time to make sure it's not unacceptably far off
        const arrivalHrTime = process.hrtime(startTime);
        const arrivalTime = arrivalHrTime[0] * 48000 + ~~(arrivalHrTime[1] / 20833.333);

        if (granulePos < arrivalTime - 30 * 48000 || granulePos > arrivalTime + 30 * 48000) granulePos = arrivalTime;

        // Accept the data
        const data = message.slice(EnnuicastrParts.data.length);
        write(dataEncoder, granulePos, userTrackNo, this.userPacketNos[webUserID]++, data);

        // And inform the monitor
        const user = this.findWebUserFromClientId(clientId);
        if (!user) return;
        // Determine silence
        const silence = user.continuous && data.length ? !data.readUInt8(0) : data.length < (user.dataType === DataTypeFlag.FLAC ? 16 : 8);
        this.monitorSetSpeaking(userTrackNo, !silence);
        break;
      }
      case EnnuicastrId.ERROR:
        // A client error occurred. Log it.
        try {
          console.log('ennuicastr error', message.toString('utf8', 4));
        } catch (ex) {}
        break;

      default:
        // No other commands are accepted
        return this.closeClient(clientId, WebappOpCloseReason.INVALID_ID);
    }
  }

  private parseMessage(message: Buffer) {
    const { op, clientId, message: data } = this.unwrapMessage(message);

    switch (op) {
      case WebappOp.READY: {
        this.ready = true;
        console.log('ready');
        break;
      }
      case WebappOp.NEW: {
        const nick = data.toString('utf8', EnnuicastrParts.login.nick).substring(0, 32);
        const flags = data.readUInt32LE(EnnuicastrParts.login.flags);
        const connectionType: ConnectionType = flags & ConnectionTypeMask;
        const dataType: DataTypeFlag = flags & DataTypeMask;
        const continuous = !!(flags & Feature.CONTINUOUS);

        console.log(`connected:`, { connectionType, clientId });
        this.clients.set(clientId, connectionType);
        switch (connectionType) {
          case ConnectionType.PING:
            console.log(`pinger connected: ${nick}`);
            break;
          case ConnectionType.DATA:
            console.log(`data connected:`, { clientId, nick, dataType, continuous });
            this.createNewWebUser(clientId, nick, dataType, continuous);
            break;
          case ConnectionType.MONITOR:
            this.createNewMonitor(clientId);
            break;
        }
        break;
      }
      case WebappOp.DATA: {
        const connectionType = this.clients.get(clientId);
        if (connectionType === undefined) return;
        switch (connectionType) {
          case ConnectionType.PING: {
            if (data.length < 4) return this.closeClient(clientId, WebappOpCloseReason.INVALID_MESSAGE);
            const cmd: EnnuicastrId = data.readUInt32LE(0);
            switch (cmd) {
              case EnnuicastrId.PING: {
                if (data.length !== EnnuicastrParts.ping.length) return this.closeClient(clientId, WebappOpCloseReason.INVALID_MESSAGE);

                // Pong with our current time
                const ret = Buffer.alloc(EnnuicastrParts.pong.length);
                ret.writeUInt32LE(EnnuicastrId.PONG, 0);
                data.copy(ret, EnnuicastrParts.pong.clientTime, EnnuicastrParts.ping.clientTime);
                const tm = process.hrtime(startTime);
                ret.writeDoubleLE(tm[0] * 1000 + tm[1] / 1000000, EnnuicastrParts.pong.serverTime);
                console.log('ping from', clientId);
                this.ws.send(this.wrapMessage(ret, clientId));
                break;
              }
              default:
                // No other commands accepted
                return this.closeClient(clientId, WebappOpCloseReason.INVALID_ID);
            }
            break;
          }
          case ConnectionType.DATA:
            this.onData(data, clientId);
            break;
          case ConnectionType.MONITOR:
            // Monitors don't send data
            return this.closeClient(clientId, WebappOpCloseReason.INVALID_ID);
        }
        break;
      }
      case WebappOp.CLOSE: {
        console.log('close', clientId);
        const client = this.clients.get(clientId);
        if (!client) return;
        this.clients.delete(clientId);

        const user = this.findWebUserFromClientId(clientId);
        if (!user) return;
        console.log('disconnected:', user.data.name);
        user.connected = false;
        this.monitorSetConnected(this.userTrackNos[user.webUserID], `${user.data.name}#${user.data.discrim}`, false);
        break;
      }
      case WebappOp.PONG: {
        console.log('pong');
        break;
      }
      default: {
        console.log(`Unknown op from server: ${op}`);
        break;
      }
    }
  }

  private unwrapMessage(message: Buffer) {
    const op: WebappOp = message.readUInt32LE(0);
    const clientId = message.toString('utf8', 4, 12);
    return { op, clientId, message: message.slice(12) };
  }

  private wrapMessage(message: Buffer, clientId: string, type = WebappOp.DATA) {
    const ret = Buffer.alloc(message.length + 12);
    ret.writeUInt32LE(type, 0);
    new Uint8Array(ret.buffer).set(new TextEncoder().encode(clientId), 4);
    message.copy(ret, 12);
    return ret;
  }
}

new ShardClient({
  url: 'ws://localhost:9002/shard',
  token: process.env.SHARD_AUTH as string,
  id: 'test',
  ennuiKey: 'test',
  clientId: '0000000000',
  clientName: 'test-client',
  flacEnabled: true,
  continuousEnabled: true,
  serverName: 'fake server',
  serverIcon: 'https://craig.horse/craig.png',
  channelName: 'fake-channel',
  channelType: 2
});
