export const EnnuicastrParts = {
  /**
   * id   ackd
   * XXXX XXXX
   */
  ack: {
    length: 8,
    ackd: 4
  },

  /**
   * id   ackd code msg
   * XXXX XXXX XXXX ->
   */
  nack: {
    length: 12,
    ackd: 4,
    code: 8,
    msg: 12
  },

  /**
   * id   token    flags nick
   * XXXX XXXXXXXX XXXX  ->
   */
  login: {
    length: 16,
    token: 4,
    flags: 12,
    nick: 16
  },

  /**
   * id   key  value
   * XXXX XXXX XXXX
   */
  info: {
    /* Note: Longer for some info */
    length: 12,
    key: 4,
    value: 8
  },

  /**
   * id   clientTime
   * XXXX XXXXXXXX
   */
  ping: {
    length: 12,
    clientTime: 4
  },

  /**
   * id   clientTime serverTime
   * XXXX XXXXXXXX   XXXXXXXX
   */
  pong: {
    length: 20,
    clientTime: 4,
    serverTime: 12
  },

  /**
   * id   granulePos packet
   * XXXX XXXXXXXX   ->
   */
  data: {
    length: 12,
    granulePos: 4,
    packet: 12
  },

  /**
   * id   index status nick
   * XXXX XXXX  XXXX   ->
   */
  user: {
    length: 12,
    index: 4,
    status: 8,
    nick: 12
  },

  /**
   * id   index type data
   * XXXX XXXX  XXXX ->
   */
  userExtra: {
    length: 12,
    index: 4,
    type: 8,
    data: 12
  },

  /**
   * id   index status
   * XXXX XXXX  XXXX
   */
  speech: {
    length: 12,
    index: 4,
    status: 8
  },

  /**
   * id   indexStatus
   * XXXX XXXX
   */
  mode: {
    length: 8,
    mode: 4
  }
};

export const ConnectionTypeMask = 0xf;

export enum ConnectionType {
  PING = 0x0,
  DATA = 0x1,
  // MASTER = 0x2,
  MONITOR = 0x3
}

export const DataTypeMask = 0xf0;

export enum DataTypeFlag {
  OPUS = 0x00,
  FLAC = 0x10
}

export const FeaturesMask = 0xff00;

export enum Feature {
  CONTINUOUS = 0x100
  // RTC = 0x200
}

export enum UserExtraType {
  AVATAR = 0x0
}

export enum EnnuicastrId {
  // Good and evil
  ACK = 0x00,
  NACK = 0x01,

  // Basic
  LOGIN = 0x10,
  INFO = 0x11,
  ERROR = 0x12,

  // Ping socket
  PING = 0x20,
  PONG = 0x21,

  // Main data message
  DATA = 0x30,

  // Monitoring
  USER = 0x40,
  SPEECH = 0x41,
  USER_EXTRA = 0x42,

  // WebRTC signaling info and inter-client RTC messages
  RTC = 0x50,
  VIDEO_REC = 0x51,
  CTCP = 0x52,

  // Master
  MODE = 0x60,
  ADMIN = 0x61
}

export enum EnnuicastrInfo {
  // C->S, uint32: For FLAC, inform of the sample rate
  SAMPLE_RATE = 0,
  // S->C, uint32: Give the client its ID number
  ID = 0x10,
  /* S->C, uint32 + double + double: Inform the user of the current
   * mode, the server time when that mode was set, and the recording
   * time when that mode was set */
  MODE = 0x14,
  /* S->C, double: Inform the user of the timestamp at which
   * recording formally began */
  START_TIME = 0x15,
  /* S->C, string: Inform the client of the name of this recording */
  REC_NAME = 0x16
}

export enum WebappOp {
  IDENTIFY = 0x00,
  READY = 0x01,
  NEW = 0x02,
  DATA = 0x03,
  CLOSE = 0x04,
  EXIT = 0x05,
  PING = 0x06,
  PONG = 0x07
}

export enum WebappOpCloseReason {
  CLOSED = 0x00,
  SHARD_CLOSED = 0x01,
  RECORDING_ENDED = 0x02,
  INVALID = 0x03,
  INVALID_MESSAGE = 0x05,
  INVALID_ID = 0x06,
  INVALID_FLAGS = 0x07,
  INVALID_TOKEN = 0x08,
  INVALID_USERNAME = 0x09,
  INVALID_CONNECTION_TYPE = 0x10,
  NOT_FOUND = 0x11,
  ALREADY_CONNECTED = 0x12
}
