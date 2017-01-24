#!/bin/sh
set -e
[ "$1" ]
cd `dirname "$0"`/rec
cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data |
    nice -n10 ionice -c3 \
    ffmpeg -codec libopus -i - \
    -map 0 -af aresample=async=480 \
    -c:a wavpack -f matroska -
