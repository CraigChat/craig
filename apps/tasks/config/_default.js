module.exports = {
  // Redis, leave blank to connect to localhost:6379 with "craig:" as the prefix
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
    keyPrefix: process.env.REDIS_PREFIX || 'craig:',
    password: process.env.REDIS_PASSWORD || undefined
  },
  // redis: {
  //   host: 'localhost',
  //   port: 6379,
  //   keyPrefix: 'craig:'
  // },

  // For drive upload in Google Drive
  drive: {
    clientId: '',
    clientSecret: ''
  },

  // For drive upload in Microsoft OneDrive
  microsoft: {
    clientId: '',
    clientSecret: '',
    redirect: ''
  },

  // For drive upload in Dropbox
  dropbox: {
    clientId: '',
    clientSecret: '',
    folderName: 'CraigChat'
  },

  // For S3 upload
  s3: {
    // Default bucket and region (can be overridden per user)
    defaultBucket: '',
    defaultRegion: 'us-east-1'
  },

  // Payment configuration
  payment: {
    // Payment rate: cents per minute of participation
    ratePerMinuteCents: 10, // $0.10 per minute by default
    // Minimum minutes before payment is calculated
    minimumMinutesForPayment: 1
  },

  // for refresh patrons job
  patreon: {
    campaignId: 0,
    accessToken: '',
    tiers: {},
    skipUsers: []
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
