const Eris = require('eris');

const apiHomepage = process.env.API_HOMEPAGE || 'https://craig.chat/';
const apiUrl = new URL(apiHomepage);
const recordingRetentionDays = Number.parseFloat(process.env.RECORDING_RETENTION_DAYS || '3');
const recordingRetentionHours = Math.max(Number.isFinite(recordingRetentionDays) ? recordingRetentionDays : 3, 1) * 24;

module.exports = {
  // Redis, leave blank to connect to localhost:6379 with "craig:" as the prefix
  redis: {
    host: 'redis',
    port: 6379,
    keyPrefix: 'craig:'
  },

  sharding: {
    file: process.env.NODE_ENV === 'development' ? './index.ts' : './index.js',
    execArgv: process.env.NODE_ENV === 'development' ? ['--import', 'tsx'] : [],
    // The amount of shards to spawn in sharding mode
    shardCount: 2,
    // The amount of time to wait for a ready
    readyTimeout: 60000
  },

  // InfluxDB options
  influx: false,

  // Sentry options
  sentry: false,

  dexare: {
    // Bot token
    token: process.env.DISCORD_BOT_TOKEN || '',
    // Application ID
    applicationID: process.env.DISCORD_APP_ID || process.env.CLIENT_ID || '',

    /** @type {Eris.ClientOptions} */
    erisOptions: {
      autoreconnect: true,
      allowedMentions: {
        everyone: false,
        roles: false,
        users: true
      },
      defaultImageFormat: 'png',
      defaultImageSize: 256,
      messageLimit: 0,
      gateway: {
        maxShards: 1,
        intents: ['guilds', 'guildMessages', 'guildVoiceStates'],
        requestTimeout: 15000
      }
    },

    // Users who can eval
    elevated: ['158049329150427136'],

    prefix: ['craig', ':craig:', 'craig,', ':craig:,'],
    mentionPrefix: true,

    craig: {
      // The craig emoji ID
      emoji: '297187944295301122',
      // The protocol to get downloads from
      downloadProtocol: apiUrl.protocol.replace(':', ''),
      // The domain to get downloads from
      downloadDomain: apiUrl.host,
      // The homepage of the bot
      homepage: 'https://craig.chat/',
      // The dashboard URL
      dashboardURL: process.env.APP_URI || 'https://my.craig.chat',
      // Record disk size limit, in bytes
      sizeLimit: 536870912,
      // Record disk size limit for Opus web users, in bytes
      sizeLimitWebOpus: 1073741824,
      // Record disk size limit for FLAC web users, in bytes
      hardLimitWeb: 4294967296,
      // Whether to remove the nickname after finishing the recording
      removeNickname: true,
      // Whether to recognize alistair emojis instead of craig emojis
      alistair: false,
      // The folder to put recordings in
      recordingFolder: '../../rec',
      // Webapp settings
      webapp: {
        on: false,
        url: 'ws://localhost:9001/shard',
        token: '1234',
        // connectUrl: 'https://web.craig.chat?id={id}&key={key}',
        connectUrl: 'http://localhost:5000?id={id}&key={key}'
      },
      rewardTiers: {
        [-1]: {
          // Greater Weasels
          recordHours: 24,
          downloadExpiryHours: recordingRetentionHours,
          features: ['mix', 'auto', 'drive', 'glowers', 'eccontinuous', 'ecflac', 'mp3']
        },
        [0]: {
          // Default
          recordHours: 6,
          downloadExpiryHours: recordingRetentionHours,
          features: []
        },
        [10]: {
          // Supporters / I'm chipping in!
          recordHours: 6,
          downloadExpiryHours: recordingRetentionHours,
          features: ['drive', 'glowers'],
          sizeLimitMult: 2
        },
        [20]: {
          // Supporterers / More power!
          recordHours: 24,
          downloadExpiryHours: recordingRetentionHours,
          features: ['mix', 'auto', 'drive', 'glowers', 'eccontinuous'],
          sizeLimitMult: 2
        },
        [30]: {
          // Supporterests / I DEMAND FLAC
          recordHours: 24,
          downloadExpiryHours: recordingRetentionHours,
          features: ['mix', 'auto', 'drive', 'glowers', 'eccontinuous', 'ecflac'],
          sizeLimitMult: 2
        },
        [100]: {
          // MP3 God
          recordHours: 24,
          downloadExpiryHours: recordingRetentionHours,
          features: ['mix', 'auto', 'drive', 'glowers', 'eccontinuous', 'ecflac', 'mp3'],
          sizeLimitMult: 5
        }
      }
    },

    status: {
      type: 4, // [custom status]
      name: 'craig',
      state: 'Recording VCs • craig.chat'
    },

    logger: {
      level: 'debug'
    },

    slash: {
      creator: {
        allowedMentions: {
          everyone: false,
          roles: false,
          users: true
        },
        defaultImageFormat: 'png',
        defaultImageSize: 256
      }
    }
  },
  commandsPath: './textCommands'
};
