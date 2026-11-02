#!/bin/sh
set -eu

# Usage: craig-entrypoint.sh <service>, where <service> is `migrate` or an app in services.cjs
if [ "$#" -ne 1 ]; then
  echo "Usage: craig-entrypoint.sh <service>" >&2
  exit 1
fi
SERVICE="$1"

# Only services that mount /data read-write create its folders
if [ -w /data ]; then
  mkdir -p "${REC_DIRECTORY:-/data/rec}" "${DOWNLOADS_DIRECTORY:-/data/downloads}" "${OUTPUT_DIRECTORY:-/data/output}"
fi

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

# Build DATABASE_URL from the POSTGRES_* values in docker.env unless one was given explicitly
if [ -z "${DATABASE_URL:-}" ]; then
  if [ -z "${POSTGRES_PASSWORD:-}" ]; then
    echo "Set POSTGRES_PASSWORD (or DATABASE_URL) in docker.env." >&2
    exit 1
  fi
  DATABASE_URL="$(node -e '
// Same defaults as the postgres image: user "postgres", database named after the user
const { POSTGRES_USER = "postgres", POSTGRES_PASSWORD, POSTGRES_HOST = "db", POSTGRES_PORT = "5432" } = process.env;
const POSTGRES_DB = process.env.POSTGRES_DB || POSTGRES_USER;
const e = encodeURIComponent;
console.log(`postgresql://${e(POSTGRES_USER)}:${e(POSTGRES_PASSWORD)}@${POSTGRES_HOST}:${POSTGRES_PORT}/${e(POSTGRES_DB)}`);
')"
  export DATABASE_URL
fi

database_host_port() {
  node - <<'NODE'
const url = process.env.DATABASE_URL;
if (!url) process.exit(1);
const parsed = new URL(url);
console.log(`${parsed.hostname} ${parsed.port || 5432}`);
NODE
}

# Wait for DB
if DB_TARGET="$(database_host_port)"; then
  set -- $DB_TARGET
  wait_for_tcp postgres "$1" "$2" "${CRAIG_STARTUP_TIMEOUT:-90}"
fi

if [ "$SERVICE" = migrate ]; then
  exec /opt/craig/migrate/node_modules/.bin/prisma migrate deploy --config /opt/craig/migrate/prisma.config.ts
fi

wait_for_tcp redis "${REDIS_HOST:-redis}" "${REDIS_PORT:-6379}" "${CRAIG_STARTUP_TIMEOUT:-90}"

exec node /opt/craig/docker/launch.cjs "$SERVICE"
