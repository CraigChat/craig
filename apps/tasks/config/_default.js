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
    // Default bucket and region (used globally if per-user not provided)
    defaultBucket: process.env.S3_DEFAULT_BUCKET || '',
    defaultRegion: process.env.AWS_REGION || 'us-east-1'
  },

  // Payment configuration
  payment: {
    // Payment rate: cents per minute of participation
    ratePerMinuteCents: 10, // $0.10 per minute by default
    // Minimum minutes before payment is calculated
    minimumMinutesForPayment: 1
  },

  // Stripe configuration for payouts
  stripe: {
    // Stripe secret key (get from https://dashboard.stripe.com/apikeys)
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    // Stripe publishable key (for frontend if needed)
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    // Minimum payout amount in cents (e.g., 1000 = $10.00)
    minimumPayoutCents: process.env.STRIPE_MINIMUM_PAYOUT_CENTS ? parseInt(process.env.STRIPE_MINIMUM_PAYOUT_CENTS, 10) : 1000,
    // Webhook secret for verifying webhook signatures
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || ''
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
