module.exports = {
  // Redis, leave blank to connect to localhost:6379 with "craig:" as the prefix
  redis: {},
  // redis: {
  //   host: 'localhost',
  //   port: 6379,
  //   keyPrefix: 'craig:'
  // },

  // For the drive upload query
  drive: {
    clientId: '',
    clientSecret: ''
  },

  // for refresh patrons job
  patreon: {
    campaignId: 0,
    accessToken: '',
    tiers: {},
    skipUsers: []
  },

  microsoft: {
    clientId: '',
    clientSecret: '', 
    redirect: ''
  },

  downloads: {
    expiration: 24 * 60 * 60 * 1000,
    path: '../download/downloads'
  },

  recording: {
    fallbackExpiration: 24 * 60 * 60 * 1000,
    path: '../../rec',
    skipIds: []
  },

  timezone: 'America/New_York',
  loggerLevel: 'debug',
  tasks: {
    ignore: []
  }
};
