# =============================================================
# Stage 1: builder
# Full toolchain — compiles native addons, builds TS, generates
# a separate /prod tree with production-only node_modules.
# =============================================================
FROM ubuntu:22.04 AS builder

RUN apt-get update && \
    apt-get -y upgrade && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
      build-essential python3 make \
      inkscape dbus-x11 \
      wget curl ca-certificates git locales unzip && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

RUN locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8

ARG NODE_VERSION=22
RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash - && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs && \
    npm install -g yarn && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# ---- Full install + compile ----
WORKDIR /build
COPY . .

RUN yarn install --frozen-lockfile
RUN npx prisma generate --schema=/build/prisma/schema.prisma
RUN mkdir -p /build/rec && \
    /bin/bash /build/scripts/buildCook.sh && \
    /bin/bash /build/scripts/downloadCookBuilds.sh
RUN yarn workspaces run build
RUN npm rebuild @discordjs/opus

# =============================================================
# Stage 2: prod-modules
# Production-only node_modules tree (no devDeps, native addon
# pre-compiled, Prisma client injected).
# =============================================================
FROM builder AS prod-modules

WORKDIR /prod
COPY package.json yarn.lock ./
COPY apps/bot/package.json      apps/bot/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/download/package.json  apps/download/
COPY apps/tasks/package.json     apps/tasks/

RUN yarn install --frozen-lockfile --production

# Rebuild native addon in the production tree while build tools are still available
RUN npm rebuild @discordjs/opus

# Pull the generated Prisma client into the production tree
RUN cp -r /build/node_modules/.prisma /prod/node_modules/.prisma

# =============================================================
# Stage 3: runtime-base
# Minimal image — no compilers, no dev packages, no secrets.
# All config is injected at runtime via env / mounted files.
# =============================================================
FROM ubuntu:22.04 AS runtime-base

RUN apt-get update && \
    apt-get -y upgrade && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
      inkscape dbus-x11 \
      ffmpeg flac fdkaac vorbis-tools opus-tools \
      zip unzip wget curl ca-certificates \
      redis-tools locales && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

RUN locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8
ENV NODE_ENV=production

RUN groupadd --system appgroup && \
    useradd --system --gid appgroup --home /app --no-create-home appuser

ARG NODE_VERSION=22
RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash - && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# =============================================================
# Stage 4: bot
# =============================================================
FROM runtime-base AS bot

WORKDIR /app

# Production node_modules (hoisted at /app/node_modules)
COPY --from=prod-modules /prod/node_modules        node_modules
COPY --from=prod-modules /prod/package.json        package.json
COPY --from=prod-modules /prod/apps/bot/package.json      apps/bot/package.json
COPY --from=prod-modules /prod/apps/dashboard/package.json apps/dashboard/package.json
COPY --from=prod-modules /prod/apps/download/package.json  apps/download/package.json
COPY --from=prod-modules /prod/apps/tasks/package.json     apps/tasks/package.json

# Compiled bot
COPY --from=builder /build/apps/bot/dist      apps/bot/dist
# Emojis (loaded at runtime from __dirname-relative path)
COPY --from=builder /build/apps/bot/emojis    apps/bot/emojis
# Bot config defaults (config npm package reads cwd/config/)
COPY --from=builder /build/apps/bot/config    apps/bot/config
# Locale/translation files
COPY --from=builder /build/locale             locale
# Prisma schema — needed by `prisma migrate deploy` in the migrate service
COPY --from=builder /build/prisma             prisma

RUN mkdir -p rec && chown appuser:appgroup rec

WORKDIR /app/apps/bot
USER appuser
EXPOSE 3001
CMD ["node", "/app/apps/bot/dist/sharding/index.js"]

# =============================================================
# Stage 5: dashboard
# =============================================================
FROM runtime-base AS dashboard

WORKDIR /app

COPY --from=prod-modules /prod/node_modules        node_modules
COPY --from=prod-modules /prod/package.json        package.json
COPY --from=prod-modules /prod/apps/bot/package.json      apps/bot/package.json
COPY --from=prod-modules /prod/apps/dashboard/package.json apps/dashboard/package.json
COPY --from=prod-modules /prod/apps/download/package.json  apps/download/package.json
COPY --from=prod-modules /prod/apps/tasks/package.json     apps/tasks/package.json

COPY --from=builder /build/apps/dashboard/.next         apps/dashboard/.next
COPY --from=builder /build/apps/dashboard/next.config.js apps/dashboard/next.config.js
COPY --from=builder /build/apps/dashboard/public        apps/dashboard/public

WORKDIR /app/apps/dashboard
USER appuser
EXPOSE 3000
CMD ["node", "/app/node_modules/.bin/next", "start", "-p", "3000"]

# =============================================================
# Stage 6: download
# =============================================================
FROM runtime-base AS download

WORKDIR /app

COPY --from=prod-modules /prod/node_modules        node_modules
COPY --from=prod-modules /prod/package.json        package.json
COPY --from=prod-modules /prod/apps/bot/package.json      apps/bot/package.json
COPY --from=prod-modules /prod/apps/dashboard/package.json apps/dashboard/package.json
COPY --from=prod-modules /prod/apps/download/package.json  apps/download/package.json
COPY --from=prod-modules /prod/apps/tasks/package.json     apps/tasks/package.json

COPY --from=builder /build/apps/download/dist      apps/download/dist
COPY --from=builder /build/apps/download/page/public apps/download/page/public
COPY --from=builder /build/cook                cook

RUN mkdir -p rec && chown appuser:appgroup rec

USER appuser
EXPOSE 5029
CMD ["node", "/app/apps/download/dist/index.js"]

# =============================================================
# Stage 7: tasks
# =============================================================
FROM runtime-base AS tasks

WORKDIR /app

COPY --from=prod-modules /prod/node_modules        node_modules
COPY --from=prod-modules /prod/package.json        package.json
COPY --from=prod-modules /prod/apps/bot/package.json      apps/bot/package.json
COPY --from=prod-modules /prod/apps/dashboard/package.json apps/dashboard/package.json
COPY --from=prod-modules /prod/apps/download/package.json  apps/download/package.json
COPY --from=prod-modules /prod/apps/tasks/package.json     apps/tasks/package.json

COPY --from=builder /build/apps/tasks/dist  apps/tasks/dist
COPY --from=builder /build/apps/tasks/config apps/tasks/config
COPY --from=builder /build/cook             cook

RUN mkdir -p rec && chown appuser:appgroup rec

WORKDIR /app/apps/tasks
USER appuser
EXPOSE 2022
CMD ["node", "/app/apps/tasks/dist/index.js"]
