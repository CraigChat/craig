import { WebSocket } from 'ws';

import type { CraigBot, CraigBotConfig } from '../../bot';
import type { ParsedRewards } from '../../util';
import {
  ConnectionType,
  ConnectionTypeMask,
  DataTypeFlag,
  DataTypeMask,
  EnnuicastrId,
  EnnuicastrInfo,
  EnnuicastrParts,
  Feature,
  UserExtraType,
  WebappOp,
  WebappOpCloseReason
} from './protocol';
import Recording from './recording';
import { toBuffer } from './util';

export interface WebUser {
  connected: boolean;
  dataType: DataTypeFlag;
  continuous: boolean;
  clientId: string;
  webUserID: string;
  data: {
    id: string;
    username: string;
    discriminator: 'web';
    dtype: DataTypeFlag;
  };
}

export class WebappClient {
  ws: WebSocket;
  recording: Recording;
  ready = false;
  disconnecting = false;
  clients = new Map<string, ConnectionType>();
  webUsers = new Map<string, WebUser>();
  config: CraigBotConfig;

  userTrackNos: { [key: string]: number } = {};
  userPacketNos: { [key: string]: number } = {};
  userTimeouts: { [key: string]: any } = {};
  speaking: { [key: number]: boolean } = {};

  constructor(recording: Recording, parsedRewards: ParsedRewards) {
    this.recording = recording;
    this.config = recording.recorder.client.config;
    this.ws = new WebSocket(this.config.craig.webapp.url, {
      headers: { Authorization: this.config.craig.webapp.token }
    });
    this.ws.on('open', () => {
      recording.recorder.logger.log(`Opened webapp connection for recording ${recording.id}`);

      const payload = JSON.stringify({
        id: recording.id,
        ennuiKey: recording.ennuiKey,
        clientId: recording.recorder.client.bot.user.id,
        clientName: recording.recorder.client.bot.user.username,
        shardId: (this.recording.recorder.client as unknown as CraigBot).shard!.id ?? -1,
        flacEnabled: parsedRewards.rewards.features.includes('ecflac'),
        continuousEnabled: parsedRewards.rewards.features.includes('eccontinuous'),
        serverName: recording.channel.guild.name,
        serverIcon: recording.channel.guild.icon ? recording.channel.guild.dynamicIconURL('png', 256) : null,
        channelName: recording.channel.name,
        channelType: recording.channel.type
      });
      const ret = Buffer.alloc(Buffer.from(payload).length + 4);
      ret.writeUInt32LE(WebappOp.IDENTIFY, 0);
      Buffer.from(payload).copy(ret, 4);
      this.ws.send(ret);
    });
    this.ws.on('message', (data) => this.parseMessage(toBuffer(data)));
    this.ws.on('close', (code, reason) => {
      if (!this.ready && !this.disconnecting) {
        recording.recorder.logger.log(`Failed to connect to the webapp for recording ${recording.id}: ${WebappOpCloseReason[reason[0]]}`, 'webapp');
        recording.pushToActivity(`Failed to connect to the webapp! (${WebappOpCloseReason[reason[0]]})`);
        return;
      }

      recording.recorder.logger.log(`Disconnected from webapp for recording ${recording.id}: ${WebappOpCloseReason[reason[0]]}`, 'webapp');
    });
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
    this.disconnecting = true;
    this.ws.close(1000, Buffer.from([reason]));
    this.ready = false;
  }

  createNewWebUser(clientId: string, username: string, dataType: DataTypeFlag, continuous: boolean) {
    let webUserID = username + '#web';
    let user = this.webUsers.get(webUserID);
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

    let userTrackNo: number;
    if (!user) {
      /* Initialize this user's data (FIXME: partially duplicated from
       * the Discord version) */
      const userData: WebUser['data'] = { id: webUserID, username, discriminator: 'web', dtype: dataType };
      userTrackNo = this.recording.trackNo++;
      this.userTrackNos[webUserID] = userTrackNo;
      this.userPacketNos[webUserID] = 0;

      // Announce them
      this.recording.pushToActivity(`${username} has connected to the webapp!`);
      this.monitorSetConnected(userTrackNo, `${userData.username}#${userData.discriminator}`, true, clientId);

      // Put a valid Opus header at the beginning if we're Opus
      if (dataType === DataTypeFlag.OPUS) this.recording.writer?.q.push({ type: 'writeWebappOpusHeader', trackNo: userTrackNo, continuous });

      // Write their username etc to the recording data
      this.recording.writer?.q.push({ type: 'writeWebappUser', trackNo: userTrackNo, data: userData });

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
    this.recording.writeToLog(
      `New user from webapp. trackNo=${userTrackNo}, clientId=${clientId}, id=${webUserID}, dataType=${DataTypeFlag[dataType]}, continuous=${continuous}`,
      'webapp'
    );

    // We switch to a web size limit, depending on which features are enabled
    if (dataType !== DataTypeFlag.OPUS || continuous) this.recording.sizeLimit = Math.max(this.recording.sizeLimit, this.config.craig.sizeLimitWeb);
    else this.recording.sizeLimit = Math.max(this.recording.sizeLimit, this.config.craig.sizeLimitWebOpus);

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

    // Treat new data as a monitor aswell
    this.createNewMonitor(clientId);
  }

  createNewMonitor(clientId: string) {
    // Catch the monitor up on connected users
    for (const userID in this.recording.users) {
      const user = this.recording.users[userID];
      const nickBuf = Buffer.from(`${user.username}#${user.discriminator}`, 'utf8');
      const buf = Buffer.alloc(EnnuicastrParts.user.length + nickBuf.length);
      buf.writeUInt32LE(EnnuicastrId.USER, 0);
      buf.writeUInt32LE(user.track, EnnuicastrParts.user.index);
      buf.writeUInt32LE(1, EnnuicastrParts.user.status);
      nickBuf.copy(buf, EnnuicastrParts.user.nick);
      this.ws.send(this.wrapMessage(buf, clientId, WebappOp.DATA));

      if (user.avatarUrl) {
        const avyBuf = Buffer.from(user.avatarUrl, 'utf8');
        const buf = Buffer.alloc(EnnuicastrParts.userExtra.length + avyBuf.length);
        buf.writeUInt32LE(EnnuicastrId.USER_EXTRA, 0);
        buf.writeUInt32LE(user.track, EnnuicastrParts.user.index);
        buf.writeUInt32LE(UserExtraType.AVATAR, EnnuicastrParts.user.status);
        avyBuf.copy(buf, EnnuicastrParts.user.nick);
        this.ws.send(this.wrapMessage(buf, clientId, WebappOp.DATA));
      }
    }

    // Catch the monitor up on connected web users
    for (const [, user] of this.webUsers) {
      if (!user.connected) continue;
      const nickBuf = Buffer.from(`${user.data.username}#${user.data.discriminator}`, 'utf8');
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
    if (!this.ready) return;
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

  monitorSetUserExtra(trackNo: number, type: UserExtraType, data: string) {
    const dataBuf = Buffer.from(data, 'utf8');
    const buf = Buffer.alloc(EnnuicastrParts.user.length + dataBuf.length);
    buf.writeUInt32LE(EnnuicastrId.USER_EXTRA, 0);
    buf.writeUInt32LE(trackNo, EnnuicastrParts.user.index);
    buf.writeUInt32LE(type, EnnuicastrParts.user.status);
    dataBuf.copy(buf, EnnuicastrParts.user.nick);

    // Send to all clients
    for (const [clientId, type] of this.clients) {
      if (type !== ConnectionType.PING) this.ws.send(this.wrapMessage(buf, clientId, WebappOp.DATA));
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

  userSpeaking(trackNo: number) {
    if (this.userTimeouts[trackNo]) clearTimeout(this.userTimeouts[trackNo]);
    else this.monitorSetSpeaking(trackNo, true);
    this.userTimeouts[trackNo] = setTimeout(() => {
      this.monitorSetSpeaking(trackNo, false);
      delete this.userTimeouts[trackNo];
    }, 2000);
  }

  onData(data: Buffer, clientId: string) {
    const user = this.findWebUserFromClientId(clientId);
    if (!user) return;
    const webUserID = user.data.id;
    const userTrackNo = this.userTrackNos[webUserID];

    const message = toBuffer(data);
    if (message.length < 4) this.closeClient(clientId, WebappOpCloseReason.INVALID_MESSAGE);

    const cmd = message.readUInt32LE(0);

    if (this.disconnecting || this.recording.closing) return;

    switch (cmd) {
      case EnnuicastrId.INFO: {
        if (message.length != EnnuicastrParts.info.length) return this.closeClient(clientId, WebappOpCloseReason.INVALID_MESSAGE);

        const key = message.readUInt32LE(EnnuicastrParts.info.key);
        const value = message.readUInt32LE(EnnuicastrParts.info.value);
        // Now we can write our header
        if (key === EnnuicastrInfo.SAMPLE_RATE)
          this.recording.writer?.q.push({ type: 'writeWebappFlacHeader', sampleRate: value, user, trackNo: userTrackNo });
        break;
      }
      case EnnuicastrId.DATA: {
        if (message.length < EnnuicastrParts.data.length) return this.closeClient(clientId, WebappOpCloseReason.INVALID_MESSAGE);

        let granulePos = message.readUIntLE(EnnuicastrParts.data.granulePos, 6);

        // Calculate our "correct" time to make sure it's not unacceptably far off
        const arrivalHrTime = process.hrtime(this.recording.startTime);
        const arrivalTime = arrivalHrTime[0] * 48000 + ~~(arrivalHrTime[1] / 20833.333);

        if (granulePos < arrivalTime - 30 * 48000 || granulePos > arrivalTime + 30 * 48000) granulePos = arrivalTime;

        // Accept the data
        const data = message.slice(EnnuicastrParts.data.length);
        this.recording.write(this.recording.writer!.dataEncoder, granulePos, userTrackNo, this.userPacketNos[webUserID]++, data);

        // And inform the monitor
        const user = this.findWebUserFromClientId(clientId);
        if (!user) return;
        // Determine silence
        let silence = false;
        if (user.continuous && data.length) {
          silence = !data.readUInt8(0);
        } else if (user.dataType === DataTypeFlag.FLAC) {
          silence = data.length < 16;
        } else {
          silence = data.length < 8;
        }
        this.monitorSetSpeaking(userTrackNo, !silence);
        break;
      }
      case EnnuicastrId.ERROR:
        // A client error occurred. Log it.
        try {
          this.recording.writeToLog('Ennuicastr error: ' + message.toString('utf8', 4), 'webapp');
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
        this.recording.writeToLog(`Connected to webapp @ ${this.config.craig.webapp.url}`, 'webapp');
        break;
      }
      case WebappOp.NEW: {
        const nick = data.toString('utf8', EnnuicastrParts.login.nick).substring(0, 32);
        const flags = data.readUInt32LE(EnnuicastrParts.login.flags);
        const connectionType: ConnectionType = flags & ConnectionTypeMask;
        const dataType: DataTypeFlag = flags & DataTypeMask;
        const continuous = !!(flags & Feature.CONTINUOUS);

        this.recording.writeToLog(
          `Webapp client connected. type=${ConnectionType[connectionType]}, clientId=${clientId}, nick=${nick}, dataType=${DataTypeFlag[dataType]}, continuous=${continuous}`,
          'webapp'
        );
        this.clients.set(clientId, connectionType);
        switch (connectionType) {
          case ConnectionType.PING:
            break;
          case ConnectionType.DATA:
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
                const tm = process.hrtime(this.recording.startTime);
                ret.writeDoubleLE(tm[0] * 1000 + tm[1] / 1000000, EnnuicastrParts.pong.serverTime);
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
        this.recording.writeToLog(`Webapp client disconnected. clientId=${clientId}`, 'webapp');
        const client = this.clients.get(clientId);
        if (!client) return;
        this.clients.delete(clientId);

        const user = this.findWebUserFromClientId(clientId);
        if (!user) return;
        this.recording.writeToLog(
          `Webapp user disconnected. clientId=${clientId}, name=${user.data.username}, trackNo=${this.userTrackNos[user.webUserID]}`,
          'webapp'
        );
        user.connected = false;
        this.monitorSetConnected(this.userTrackNos[user.webUserID], `${user.data.username}#${user.data.discriminator}`, false);
        break;
      }
      case WebappOp.PONG: {
        break;
      }
      default: {
        this.recording.writeToLog(`Unknown op from server: ${op}`, 'webapp');
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
