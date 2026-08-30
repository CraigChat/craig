# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential ca-certificates git python3 unzip wget \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

COPY . .

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile

ARG CRAIG_VERSION=unknown
ENV CRAIG_VERSION=$CRAIG_VERSION

RUN pnpm --filter @craig/kitchen run build-cook \
  && pnpm --filter @craig/ennuizel-streamer run build-cook \
  && pnpm turbo run build \
    --filter=@craig/bot \
    --filter=@craig/kitchen \
    --filter=@craig/ferret \
    --filter=@craig/ennuizel-streamer \
    --filter=@craig/dashboard \
    --filter=@craig/tasks

RUN pnpm deploy --filter @craig/bot --prod --legacy /opt/craig/bot \
  && pnpm deploy --filter @craig/kitchen --prod --legacy /opt/craig/kitchen \
  && pnpm deploy --filter @craig/ferret --prod --legacy /opt/craig/ferret \
  && pnpm deploy --filter @craig/ennuizel-streamer --prod --legacy /opt/craig/ennuizel-streamer \
  && pnpm deploy --filter @craig/dashboard --prod --legacy /opt/craig/dashboard \
  && pnpm deploy --filter @craig/tasks --prod --legacy /opt/craig/tasks \
  && rm -rf \
    /opt/craig/bot/dist \
    /opt/craig/kitchen/dist \
    /opt/craig/kitchen/cook \
    /opt/craig/ferret/build \
    /opt/craig/ennuizel-streamer/dist \
    /opt/craig/ennuizel-streamer/cook \
    /opt/craig/dashboard/build \
    /opt/craig/tasks/dist \
  && cp -a apps/bot/dist /opt/craig/bot/dist \
  && cp -a apps/kitchen/dist /opt/craig/kitchen/dist \
  && cp -a apps/kitchen/cook /opt/craig/kitchen/cook \
  && cp -a apps/ferret/build /opt/craig/ferret/build \
  && cp -a apps/ennuizel-streamer/dist /opt/craig/ennuizel-streamer/dist \
  && cp -a apps/ennuizel-streamer/cook /opt/craig/ennuizel-streamer/cook \
  && cp -a apps/dashboard/build /opt/craig/dashboard/build \
  && cp -a apps/tasks/dist /opt/craig/tasks/dist \
  && cp -a packages/db/prisma /opt/craig/prisma \
  && cp -a locale /opt/craig/locale

FROM node:22-bookworm-slim AS runtime

WORKDIR /opt/craig

RUN sed -i 's/Components: main/Components: main contrib non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    at \
    ca-certificates \
    fdkaac \
    ffmpeg \
    flac \
    lame \
    openssl \
    opus-tools \
    procps \
    unzip \
    util-linux \
    vorbis-tools \
    zip \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pm2@5.4.3 slash-up@1.4.2 \
  && npm cache clean --force

COPY --from=build /opt/craig /opt/craig
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/craig-entrypoint.sh
COPY --chmod=755 docker/healthcheck.sh /usr/local/bin/craig-healthcheck.sh
COPY docker/ecosystem.config.cjs /opt/craig/ecosystem.config.cjs

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  REC_DIRECTORY=/data/rec \
  DOWNLOADS_DIRECTORY=/data/downloads \
  OUTPUT_DIRECTORY=/data/output \
  TMP_DIRECTORY=/data/tmp \
  BOT_LOCALE_FOLDER=/opt/craig/locale \
  KITCHEN_URL=http://127.0.0.1:9000 \
  WEBAPP_URL=ws://127.0.0.1:9001/shard

EXPOSE 9001 9100 9200

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 CMD ["craig-healthcheck.sh"]

ENTRYPOINT ["craig-entrypoint.sh"]
