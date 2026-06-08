#!/bin/sh
set -eu

mkdir -p "${REC_DIRECTORY:-/data/rec}" "${DOWNLOADS_DIRECTORY:-/data/downloads}" "${OUTPUT_DIRECTORY:-/data/output}" "${TMP_DIRECTORY:-/data/tmp}"

wait_for_tcp() {
  name="$1"
  host="$2"
  port="$3"
  timeout="${4:-60}"

  echo "Waiting for $name at $host:$port..."
  node - "$host" "$port" "$timeout" <<'NODE'
const net = require('node:net');

const [, , host, portRaw, timeoutRaw] = process.argv;
const port = Number(portRaw);
const deadline = Date.now() + Number(timeoutRaw) * 1000;

function tryConnect() {
  const socket = net.connect({ host, port });
  socket.setTimeout(1000);
  socket.once('connect', () => {
    socket.destroy();
    process.exit(0);
  });
  socket.once('timeout', () => socket.destroy());
  socket.once('error', () => {});
  socket.once('close', () => {
    if (Date.now() >= deadline) process.exit(1);
    setTimeout(tryConnect, 1000);
  });
}

tryConnect();
NODE
}

database_host_port() {
  node - <<'NODE'
const url = process.env.DATABASE_URL;
if (!url) process.exit(1);
const parsed = new URL(url);
console.log(`${parsed.hostname} ${parsed.port || 5432}`);
NODE
}

if DB_TARGET="$(database_host_port)"; then
  set -- $DB_TARGET
  wait_for_tcp postgres "$1" "$2" "${CRAIG_STARTUP_TIMEOUT:-90}"
fi

wait_for_tcp redis "${REDIS_HOST:-redis}" "${REDIS_PORT:-6379}" "${CRAIG_STARTUP_TIMEOUT:-90}"

PRISMA_CLI="${PRISMA_CLI:-/opt/craig/bot/node_modules/.pnpm/node_modules/.bin/prisma}"
if [ ! -x "$PRISMA_CLI" ] && [ -x /opt/craig/bot/node_modules/.bin/prisma ]; then
  PRISMA_CLI=/opt/craig/bot/node_modules/.bin/prisma
fi

if [ "${CRAIG_SKIP_MIGRATIONS:-false}" != "true" ]; then
  if [ ! -x "$PRISMA_CLI" ]; then
    echo "Prisma CLI is missing from the Craig runtime image." >&2
    exit 1
  fi
  "$PRISMA_CLI" migrate deploy --schema /opt/craig/prisma/schema.prisma
fi

exec pm2-runtime /opt/craig/ecosystem.config.cjs
