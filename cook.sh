#!/bin/sh
# Copyright (c) 2017 Yahweasel
#
# Permission to use, copy, modify, and/or distribute this software for any
# purpose with or without fee is hereby granted, provided that the above
# copyright notice and this permission notice appear in all copies.
#
# THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
# WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
# MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
# SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
# WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
# OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
# CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

timeout() {
    /usr/bin/timeout -k 5 "$@"
}

DEF_TIMEOUT=1800
ulimit -v $(( 2 * 1024 * 1024 ))
echo 10 > /proc/self/oom_adj

PATH="/opt/node/bin:$PATH"
export PATH

set -e
[ "$1" ]

FORMAT=flac
[ "$2" ] && FORMAT="$2"

CONTAINER=zip
[ "$3" ] && CONTAINER="$3"

case "$FORMAT" in
    vorbis)
        ext=ogg
        ENCODE="oggenc -q 6 -"
        ;;
    aac)
        ext=aac
        #ENCODE="faac -q 100 -o /dev/stdout -"
        ENCODE="fdkaac -f 2 -m 4 -o - -"
        ;;
    mp3)
        ext=mp3
        ENCODE="lame -V 2 - -"
        ;;
    *)
        ext=flac
        ENCODE="flac - -c"
        ;;
esac

cd `dirname "$0"`/rec

tmpdir=`mktemp -d`
[ "$tmpdir" -a -d "$tmpdir" ]

echo 'rm -rf '"$tmpdir" | at 'now + 2 hours'

mkdir "$tmpdir/in" "$tmpdir/out"

NB_STREAMS=`timeout 10 cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data |
    timeout 10 ffprobe -print_format flat -show_format - 2> /dev/null |
    grep '^format\.nb_streams' |
    sed 's/^[^=]*=//'`

# Fix timing
timeout $DEF_TIMEOUT cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data |
    timeout $DEF_TIMEOUT $NICE ../oggstender.js > "$tmpdir/in/in.ogg"

# Encode thru fifos
NICE="nice -n10 ionice -c3 chrt -i 0"
for c in `seq 1 $NB_STREAMS`
do
    mkfifo $tmpdir/out/$c.$ext
    timeout $DEF_TIMEOUT $NICE ffmpeg -codec libopus -copyts -i "$tmpdir/in/in.ogg" \
        -map 0:$((c-1)) \
        -af aresample=flags=res:min_comp=0.25:min_hard_comp=0.25:first_pts=0 \
        -f wav - |
        timeout $DEF_TIMEOUT $NICE $ENCODE > $tmpdir/$c.$ext &
done

# Put them into their container
cd $tmpdir/out
case "$CONTAINER" in
    matroska)
        INPUT=""
        MAP=""
        c=0
        for i in *.$ext
        do
            INPUT="$INPUT -i $i"
            MAP="$MAP -map $c"
            c=$((c+1))
        done
        timeout $DEF_TIMEOUT $NICE ffmpeg $INPUT $MAP -c:a copy -f $CONTAINER -
        ;;

    *)
        timeout $DEF_TIMEOUT $NICE zip -1 -FI - *.$ext
        ;;
esac | cat

# And clean up after ourselves
cd
rm -f $tmpdir/*
