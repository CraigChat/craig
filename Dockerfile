FROM ubuntu:18.04
# Set timezone
ENV TZ=US/Eastern
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone
# Install pre-requisites
RUN apt-get update \
    && apt-get install --no-install-recommends --no-install-suggests -y \
        software-properties-common \
    && add-apt-repository ppa:ondrej/php \
    && apt-get update \
    && apt-get install --no-install-recommends --no-install-suggests -y \
        ffmpeg \
        flac \
        fdkaac \
        zip \
        unzip \
        vorbis-tools \
        opus-tools \
        node-gyp \
        make \
        inkscape \
        apache2 \
        php7.3 \
        php7.3-cli \
        php7.3-mysql \
        php7.3-gd \
        php7.3-imagick \
        php7.3-recode \
        php7.3-tidy \
        php7.3-xmlrpc \
        php7.3-common \
        php7.3-curl \
        php7.3-mbstring \
        php7.3-xml \
        php7.3-bcmath \
        php7.3-bz2 \
        php7.3-intl \
        php7.3-json \
        php7.3-readline \
        php7.3-zip \
        libapache2-mod-php7.3 \
        curl \
        git \
        g++ \
        gnupg
# Clone the craig bot repo
RUN git clone https://github.com/ericrigsb/bitl_craig.git
WORKDIR /bitl_craig/
# Build up node
RUN curl -sL https://deb.nodesource.com/setup_10.x | bash - \
    && apt-get update \
    && apt-get install --no-install-recommends --no-install-suggests -y nodejs \
# Install some dependencies
    && rm -rf node_modules \
    && npm install \
    && npm install @discordjs/uws@^10.149.0
# Let's cook
WORKDIR /bitl_craig/cook/
RUN for i in *.c; do gcc -O3 -o ${i%.c} $i; done \
    && for i in *.svg; do inkscape -e ${i%.svg}.png $i; done
WORKDIR /bitl_craig/
# Create recording directory
RUN mkdir rec/
# Apache Config
COPY apacheconf/apache2.conf /etc/apache2/apache2.conf
COPY apacheconf/000-default.conf /etc/apache2/sites-enabled/000-default.conf