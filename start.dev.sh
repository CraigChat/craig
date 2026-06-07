#!/bin/bash

# Load environment variables from install.config
set -a
source /app/install.config
set +a

# Run DB migrations now that Postgres is up
cd /app && yarn prisma:deploy

# Use pm2-runtime to keep PM2 in the foreground with the dev ecosystem config
exec pm2-runtime start /app/ecosystem.dev.config.js
