# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential ca-certificates python3 \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

COPY . .

RUN pnpm install --frozen-lockfile \
  && pnpm turbo run build --filter=@craig/bot \
  && pnpm deploy --filter @craig/bot --prod --legacy /app \
  && rm -rf /app/dist \
  && cp -a apps/bot/dist /app/dist

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app
COPY --from=build /workspace/packages/db/prisma /app/prisma
COPY --from=build /workspace/locale /app/locale
COPY --from=build --chmod=755 /workspace/apps/bot/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
