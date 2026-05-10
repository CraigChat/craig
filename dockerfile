# Use an official Ubuntu base image
FROM ubuntu:22.04

# Install all required dependencies in advance, for performance
RUN apt-get update && \
    apt-get -y upgrade && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
    make inkscape ffmpeg flac fdkaac vorbis-tools opus-tools zip unzip \
    wget lsb-release curl gpg ca-certificates redis redis-server redis-tools \
    postgresql dbus-x11 sed coreutils build-essential python-setuptools \
    sudo git locales && \
    apt-get -y autoremove

RUN locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8

# Used for Docker-specific build logic in install.sh
ENV container=docker

WORKDIR /app

ARG NODE_VERSION=22
ENV NODE_VERSION=${NODE_VERSION}

# Install Node early so it's cached
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash && \
    export NVM_DIR="/root/.nvm" && \
    . "$NVM_DIR/nvm.sh" && \
    nvm install "$NODE_VERSION" && \
    npm install -g yarn pm2

# Copy code and config
COPY . .

# Install yarn dependencies
RUN export NVM_DIR="/root/.nvm" && \
    . "$NVM_DIR/nvm.sh" && \
    nvm use "$NODE_VERSION" && \
    yarn install

# Build cook utilities
RUN mkdir -p /app/rec && \
    /bin/bash /app/scripts/buildCook.sh && \
    /bin/bash /app/scripts/downloadCookBuilds.sh

# Build all apps
RUN export NVM_DIR="/root/.nvm" && \
    . "$NVM_DIR/nvm.sh" && \
    nvm use "$NODE_VERSION" && \
    set -a && \
    . /app/install.config && \
    set +a && \
    yarn workspaces run build

# Expose app port
EXPOSE 3000
# Expose API port
EXPOSE 5029
# Start Craig
CMD ["/bin/bash", "/app/start.sh"]

