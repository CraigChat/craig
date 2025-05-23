# Use an official Ubuntu base image
FROM ubuntu:22.04

# Install all required dependencies in advance, for performance
RUN apt-get update && \
    apt-get -y upgrade && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
    # cook
    make inkscape ffmpeg flac fdkaac vorbis-tools opus-tools zip unzip \
    wget \
    # redis
    lsb-release curl gpg \
    ca-certificates redis redis-server redis-tools \
    # web
    postgresql \
    # install
    dbus-x11 sed coreutils build-essential python-setuptools \
    # Other dependencies
    sudo git locales && \
    # Cleanup
    apt-get -y autoremove
RUN locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8

WORKDIR /app

# Copy all changes, particularly environment variables with discord API keys
COPY . .
# Run first-time setup for faster restarts
RUN ./install.sh

# Expose app port
EXPOSE 3000
# Expose API port
EXPOSE 5029
# Start Craig
CMD ["sh", "-c", "/app/start.sh"]


# Usage:

# Build:
# docker build -t craig .

# Run:
# docker run -i -p 3000:3000 -p 5029:5029 craig
