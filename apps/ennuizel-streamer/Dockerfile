# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

COPY . .

RUN pnpm install --frozen-lockfile \
  && pnpm --filter @craig/ennuizel-streamer run build-cook \
  && pnpm turbo run build --filter=@craig/ennuizel-streamer \
  && pnpm deploy --filter @craig/ennuizel-streamer --prod --legacy /app \
  && rm -rf /app/dist /app/cook \
  && cp -a apps/ennuizel-streamer/dist /app/dist \
  && cp -a apps/ennuizel-streamer/cook /app/cook

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates util-linux \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app

CMD ["node", "dist/index.mjs"]
