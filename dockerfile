# Use an official Ubuntu base image
FROM ubuntu:22.04

# Remove interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install all required dependencies in advance
RUN apt-get update && \
    apt-get -y upgrade && \
    apt-get install -y \
    # cook
    make inkscape ffmpeg flac fdkaac vorbis-tools opus-tools zip unzip \
    wget \
    # redis
    lsb-release curl gpg \
    ca-certificates redis redis-server redis-tools \
    # web
    postgresql \
    # install
    sed coreutils build-essential \
    # Other dependencies
    sudo git && \
    # Cleanup
    apt-get -y autoremove

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
