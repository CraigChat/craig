# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential ca-certificates unzip wget \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

COPY . .

RUN pnpm install --frozen-lockfile \
  && pnpm --filter @craig/kitchen run build-cook \
  && pnpm turbo run build --filter=@craig/kitchen \
  && pnpm deploy --filter @craig/kitchen --prod --legacy /app \
  && rm -rf /app/dist /app/cook \
  && cp -a apps/kitchen/dist /app/dist \
  && cp -a apps/kitchen/cook /app/cook

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

RUN sed -i 's/Components: main/Components: main contrib non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg fdkaac flac lame openssl opus-tools procps util-linux vorbis-tools zip \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app

CMD ["node", "dist/index.js"]
