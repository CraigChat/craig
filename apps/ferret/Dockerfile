# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential ca-certificates git python3 \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

COPY . .

RUN pnpm install --frozen-lockfile

RUN --mount=type=secret,id=root_env,target=/workspace/.env,required=true \
  --mount=type=secret,id=ferret_env,target=/workspace/apps/ferret/.env,required=true \
  pnpm turbo run build --filter=@craig/ferret

RUN pnpm deploy --filter @craig/ferret --prod --legacy /app \
  && rm -rf /app/build \
  && cp -a apps/ferret/build /app/build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app

CMD ["node", "build"]
