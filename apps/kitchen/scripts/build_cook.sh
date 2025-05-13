#!/bin/bash

KEEPSTUFF=0
BUILDINSTEAD=0
FFMPEG_VER=4.0.2

for i in "$@"
do
case $i in
    -V=*|--ffmpeg-version=*)
      FFMPEG_VER="${i#*=}"
    ;;
    -b|--build)
      BUILDINSTEAD=1
    ;;
    -k|--keep-files)
      KEEPSTUFF=1
    ;;
esac
done

# set CWD
SCRIPTBASE=`dirname "$0"`
SCRIPTBASE=`realpath "$SCRIPTBASE"`
cd $SCRIPTBASE
cd ../cook

# Generic build stuff
for i in *.c; do gcc -O3 -o ${i%.c} $i; done
# TODO we don't need inkscape
# for i in *.svg; do inkscape -e ${i%.svg}.png $i; done

if [ $BUILDINSTEAD -eq 0 ]; then
  printf "Downloading binaries from Snazzah..."
  wget https://snazzah.link/craig/cook-bins -O cook-bins.zip
  unzip -o cook-bins.zip
  rm cook-bins.zip
else
  # Build Windows FFmpeg binaries
  printf "Building for Windows..."
  cd windows
  make
  cd ..

  # TODO get osxcross in devcontainer to build this
  # https://github.com/tpoechtrager/osxcross/issues/157 (x86_64-apple-darwin15-gcc)

  # Build Mac FFmpeg binaries (WIP)
  # printf "Building for Mac OS..."
  # cd macosx
  # make
  # cd ..
fi


if [ $KEEPSTUFF -eq 0 ]; then
  [ -f ffmpeg-${FFMPEG_VER}.tar.xz ] && rm ffmpeg-${FFMPEG_VER}.tar.xz
  [ -d ffmpeg-${FFMPEG_VER} ] && rm -r ffmpeg-${FFMPEG_VER}
  [ -f windows/unzip/unzipsfx.a ] && rm windows/unzip/unzipsfx.a
  printf "Cleaned files."
fi
