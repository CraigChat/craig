#!/bin/sh
set -eu

PRISMA_CLI=/app/node_modules/.pnpm/node_modules/.bin/prisma

rm -f /tmp/craig-migrations-complete

if [ ! -x "$PRISMA_CLI" ]; then
  echo "Prisma CLI is missing from the bot runtime image." >&2
  exit 1
fi

"$PRISMA_CLI" migrate deploy --schema /app/prisma/schema.prisma
touch /tmp/craig-migrations-complete

exec node dist/sharding/index.mjs
