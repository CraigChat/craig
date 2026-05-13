#!/bin/bash
export NVM_DIR="/root/.nvm"
source "$NVM_DIR/nvm.sh"
nvm use "${NODE_VERSION:-22}"

# Load environment variables from install.config
set -a
source /app/install.config
set +a

# Run DB migrations now that Postgres is up
cd /app && yarn prisma:deploy

cd /app/apps/bot && pm2 start ecosystem.config.js
cd /app/apps/dashboard && pm2 start ecosystem.config.js
cd /app/apps/download && pm2 start ecosystem.config.js
cd /app/apps/tasks && pm2 start ecosystem.config.js

# Return to /app so pm2-runtime resolves relative paths correctly
cd /app

# Use pm2-runtime to keep PM2 in the foreground so Docker captures logs
exec pm2-runtime start /app/ecosystem.config.js
