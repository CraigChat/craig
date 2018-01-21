#!/bin/sh
# Copyright (c) 2017, 2018 Yahweasel
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

# Don't get HUP'd
trap "" HUP

PATH="/opt/node/bin:$PATH"
export PATH

SCRIPTBASE=`dirname "$0"`
SCRIPTBASE=`realpath "$SCRIPTBASE"`

set -e
[ "$1" ]

FORMAT=flac
[ "$2" ] && FORMAT="$2"

CONTAINER=zip
[ "$3" ] && CONTAINER="$3"

case "$FORMAT" in
    copy)
        ext=ogg
        ;;
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
    ra)
        ext=ra
        ENCODE="ffmpeg -f wav -i - -f rm -"
        ;;
    *)
        ext=flac
        ENCODE="flac - -c"
        ;;
esac

cd "$SCRIPTBASE/rec"

tmpdir=`mktemp -d`
[ "$tmpdir" -a -d "$tmpdir" ]

echo 'rm -rf '"$tmpdir" | at 'now + 2 hours'

mkdir "$tmpdir/in" "$tmpdir/out"

NB_STREAMS=`timeout 10 cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data |
    timeout 10 ffprobe -print_format flat -show_format - 2> /dev/null |
    grep '^format\.nb_streams' |
    sed 's/^[^=]*=//'`
NICE="nice -n10 ionice -c3 chrt -i 0"

# Encode thru fifos
for c in `seq 1 $NB_STREAMS`
do
    mkfifo $tmpdir/out/$c.$ext
    if [ "$FORMAT" = "copy" ]
    then
        timeout $DEF_TIMEOUT cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data |
            timeout $DEF_TIMEOUT ../oggstender $c > $tmpdir/out/$c.$ext &

    else
        true
        timeout $DEF_TIMEOUT cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data |
            timeout $DEF_TIMEOUT ../oggstender $c |
            timeout $DEF_TIMEOUT $NICE ffmpeg -codec libopus -copyts -i - \
            -af aresample=flags=res:min_comp=0.001:max_soft_comp=0.01:min_hard_comp=1:first_pts=0 \
            -f wav - |
            timeout $DEF_TIMEOUT $NICE $ENCODE > $tmpdir/out/$c.$ext &

    fi
done
if [ "$CONTAINER" = "zip" ]
then
    mkfifo $tmpdir/out/raw.dat
    timeout $DEF_TIMEOUT cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data > $tmpdir/out/raw.dat &
fi

# Put them into their container
cd $tmpdir/out
case "$CONTAINER" in
    ogg|matroska)
        if [ "$FORMAT" = "copy" -a "$CONTAINER" = "ogg" ]
        then
            "$SCRIPTBASE/oggmultiplexer" *.ogg || true
        else
            INPUT=""
            MAP=""
            c=0
            for i in *.$ext
            do
                [ "$FORMAT" != "copy" ] || INPUT="$INPUT -copyts"
                INPUT="$INPUT -i $i"
                MAP="$MAP -map $c"
                c=$((c+1))
            done
            timeout $DEF_TIMEOUT $NICE ffmpeg $INPUT $MAP -c:a copy -f $CONTAINER - < /dev/null || true
        fi
        ;;

    *)
        timeout $DEF_TIMEOUT $NICE zip -1 -FI - *.$ext raw.dat || true
        ;;
esac | (cat || cat > /dev/null)

# And clean up after ourselves
cd
rm -rf "$tmpdir/"

wait
