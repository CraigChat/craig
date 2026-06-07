# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /workspace

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile \
  && pnpm turbo run build --filter=@craig/tasks \
  && pnpm deploy --filter @craig/tasks --prod --legacy /app \
  && rm -rf /app/dist \
  && cp -a apps/tasks/dist /app/dist

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app

CMD ["node", "dist/index.mjs"]
