# Update VSCode's Database Client
VSC_REDIS_CLIENT=data/User/globalStorage/cweijan.vscode-redis-client
[ -d /home/node/.vscode-server ] && \
  mkdir -p /home/node/.vscode-server/${VSC_REDIS_CLIENT} && \
  cp -f .devcontainer/database-client-config.json /home/node/.vscode-server/${VSC_REDIS_CLIENT}/config.json
[ -d /home/node/.vscode-remote ] && \
  mkdir -p /home/node/.vscode-remote/${VSC_REDIS_CLIENT} && \
  cp -f .devcontainer/database-client-config.json /home/node/.vscode-remote/${VSC_REDIS_CLIENT}/config.json

# Update pnpm
npm i -g pnpm@9.1.1

# Install global modules
sudo npm i -g turbo slash-up prisma tsx

# Create folders
[ -d rec ] || mkdir rec
[ -d downloads ] || mkdir downloads
[ -d output ] || mkdir output

# .env setup
if [ ! -f ./.env ]; then
  touch .env
  echo 'DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres?schema=public"' >> .env
fi

# prisma migration
pnpm db:deploy
