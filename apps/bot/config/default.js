const Eris = require('eris');
env = require('dotenv').config();

module.exports = {
  // Redis, leave blank to connect to localhost:6379 with "craig:" as the prefix
  redis: {},
  // redis: {
  //   host: 'localhost',
  //   port: 6379,
  //   keyPrefix: 'craig:'
  // },

  sharding: {
    file: './index.js',
    // The amount of shards to spawn in sharding mode
    shardCount: 2,
    // The amount of time to wait for a ready
    readyTimeout: 60000
  },

  // InfluxDB options
  influx: false,
  // influx: {
  //   url: 'https://influx.example.com',
  //   token: '',
  //   org: 'discord',
  //   bucket: 'craig',
  //   server: 'dev',
  //   bot: 'craig'
  // },

  // Sentry options
  sentry: false,
  // sentry: {
  //   dsn: 'https://xxxxxxxxxxxxxx@sentry.io/1',
  //   env: 'development',
  //   sampleRate: 1.0
  // },

  dexare: {
    // Bot token
    token: process.env.DISCORD_TOKEN,
    // Application ID
    applicationID: process.env.DISCORD_APP_ID,

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
      // The domain to get downloads from, will be given in https
      downloadDomain: 'localhost:5029',
      // The homepage of the bot
      homepage: 'https://craig.chat/',
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
        on: true,
        url: 'ws://localhost:9001/shard',
        token: '1234',
        // connectUrl: 'https://web.craig.chat?id={id}&key={key}',
        connectUrl: 'http://localhost:5000?id={id}&key={key}'
      },
      rewardTiers: {
        [-1]: {
          // Greater Weasels
          recordHours: 24,
          downloadExpiryHours: 720,
          features: ['mix', 'auto', 'drive', 'glowers', 'eccontinuous', 'ecflac', 'mp3']
        },
        [0]: {
          // Default
          recordHours: 6,
          downloadExpiryHours: 168,
          features: []
        },
        [10]: {
          // Supporters / I'm chipping in!
          recordHours: 6,
          downloadExpiryHours: 336,
          features: ['drive', 'glowers'],
          sizeLimitMult: 2
        },
        [20]: {
          // Supporterers / More power!
          recordHours: 24,
          downloadExpiryHours: 720,
          features: ['mix', 'auto', 'drive', 'glowers', 'eccontinuous'],
          sizeLimitMult: 2
        },
        [30]: {
          // Supporterests / I DEMAND FLAC
          recordHours: 24,
          downloadExpiryHours: 720,
          features: ['mix', 'auto', 'drive', 'glowers', 'eccontinuous', 'ecflac'],
          sizeLimitMult: 2
        },
        [100]: {
          // MP3 God
          recordHours: 24,
          downloadExpiryHours: 720,
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
