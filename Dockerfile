# Use an official Node.js image as the base image
# FROM node:20-buster
FROM debian:bullseye-slim

RUN echo "deb http://deb.debian.org/debian bullseye main" > /etc/apt/sources.list.d/debian.list

# Install necessary packages
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
  ca-certificates \
  # Installing FDK AAC codec library \
  && git clone https://github.com/mstorsjo/fdk-aac.git ./fdk-aac \
  && cd ./fdk-aac && autoreconf -fiv && ./configure && make && sudo make install \
  # Installing FDK AAC encoder CLI \
  && git clone https://github.com/nu774/fdkaac.git ./fdkaac \
  && cd ./fdkaac && autoreconf -i && ./configure && make && make install \
  # Installing node.js
  && curl -fsSL https://deb.nodesource.com/setup_16.x | bash - \
  && apt-get install -y nodejs \
  && rm -rf /var/lib/apt/lists/* ./fdk-aac ./fdkaac

# && git clone https://github.com/nu774/fdkaac.git /fdkaac \
# && cd /fdkaac && \
# make && \
# make install \


# Create and set the working directory
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

# Clone the repository
COPY . .

# RUN yarn install && \
#   yarn cache clean && \
#   yarn workspace run build

# TODO: replace `sudo` with `gosu`. ()
# RUN sudo ./install.sh

# Expose ports (adjust based on the application)
EXPOSE 3000

# CMD ["tail", "-f", "/dev/null"]
CMD ["sleep", "infinity"]
