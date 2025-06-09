ARG BUILD_PROFILE=local

FROM debian:bullseye-slim AS base

# Variables set locally. BUILD_PROFILE should be set to "local" (it's the default value)
FROM base AS local_build

# Variables set on CI. BUILD_PROFILE should be set to "ci"
FROM base AS ci_build
ARG POSTGRESQL_HOST
ARG POSTGRESQL_START_TIMEOUT_S
ARG DATABASE_NAME
ARG POSTGRESQL_USER
ARG REDIS_HOST
ARG REDIS_START_TIMEOUT_S
ARG DISCORD_BOT_TOKEN
ARG DISCORD_APP_ID
ARG CLIENT_ID
ARG CLIENT_SECRET

ENV POSTGRESQL_HOST=${POSTGRESQL_HOST}
ENV POSTGRESQL_START_TIMEOUT_S=${POSTGRESQL_START_TIMEOUT_S}
ENV DATABASE_NAME=${DATABASE_NAME}
ENV POSTGRESQL_USER=${POSTGRESQL_USER}
ENV REDIS_HOST=${REDIS_HOST}
ENV REDIS_START_TIMEOUT_S=${REDIS_START_TIMEOUT_S}
ENV DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN}
ENV DISCORD_APP_ID=${DISCORD_APP_ID}
ENV CLIENT_ID=${CLIENT_ID}
ENV CLIENT_SECRET=${CLIENT_SECRET}

FROM ${BUILD_PROFILE}_build
ENV NODE_VERSION=18.18.2

RUN echo "deb http://deb.debian.org/debian bullseye main" > /etc/apt/sources.list.d/debian.list

RUN apt-get update && \
  apt-get install --no-install-recommends -y \
  gcc-10 \
  g++-10 \
  python3-setuptools \
  sudo \
  flac \
  curl \
  git \
  build-essential \
  autoconf \
  automake \
  libtool \
  pkg-config \
  gawk \
  wget \
  ca-certificates \
  # Installing FDK AAC codec library \
  && git clone https://github.com/mstorsjo/fdk-aac.git ./fdk-aac \
  && cd ./fdk-aac && autoreconf -fiv && ./configure && make && make install \
  # Installing FDK AAC encoder CLI \
  && git clone https://github.com/nu774/fdkaac.git ./fdkaac \
  && cd ./fdkaac && autoreconf -i && ./configure && make && make install \
  # Installing node.js
  && curl -fsSL https://deb.nodesource.com/setup_16.x | bash -

RUN apt-get install -y nodejs --no-install-recommends\
  && rm -rf /var/lib/apt/lists/* ./fdk-aac ./fdkaac

WORKDIR /app

# Add a large swap file (adjust the size as needed, for example, 8GB swap)
# RUN dd if=/dev/zero of=/swapfile bs=1M count=8192 && \
#     chmod 600 /swapfile && \
#     mkswap /swapfile && \
#     swapon /swapfile

# Set environment variables
ENV CC=gcc-10
ENV CXX=g++-10
ENV NODE_OPTIONS="--max-old-space-size=4096"

COPY . .

RUN chmod +x run.sh && chmod +x install.sh && ./install.sh \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

EXPOSE 3000

CMD ["./run.sh"]
