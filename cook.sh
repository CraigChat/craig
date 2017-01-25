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

set -e
[ "$1" ]

if [ "$2" ]
then
    FORMAT="$2"
else
    FORMAT="flac"
fi

case "$FORMAT" in
    vorbis)
        ext=ogg
        ENCODE="oggenc -q 6 -"
        ;;
    aac)
        ext=aac
        ENCODE="faac -q 100 -o /dev/stdout -"
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

NB_STREAMS=`cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data | ffprobe -print_format flat -show_format - 2> /dev/null |
    grep '^format\.nb_streams' |
    sed 's/^[^=]*=//'`

# Make all the fifos
NICE="nice -n10 ionice -c3"
for c in `seq 0 $((NB_STREAMS-1))`
do
    mkfifo $tmpdir/$((c+1)).$ext
    $NICE cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data |
        $NICE ffmpeg -codec libopus -copyts -i - \
        -map 0:$c -af aresample=async=480,asyncts=first_pts=0 \
        -f wav - |
        $NICE $ENCODE > $tmpdir/$((c+1)).$ext &
done

# Zip them up
cd $tmpdir
zip -1 -FI - *.$ext | cat
cd

# And clean up after ourselves
rm -rf $tmpdir
