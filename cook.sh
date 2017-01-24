#!/bin/sh
set -e
[ "$1" ]
cd `dirname "$0"`/rec
tmpdir=`mktemp -d`
echo 'rm -rf '"$tmpdir" | at 'now + 2 hours'
NB_STREAMS=`cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data | ffprobe -print_format flat -show_format - 2> /dev/null |
    grep '^format\.nb_streams' |
    sed 's/^[^=]*=//'`

for c in `seq 0 $((NB_STREAMS-1))`
do
    cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data |
        nice -n10 ionice -c3 \
        ffmpeg -codec libopus -copyts -i - \
        -map 0:$c -af aresample=async=480,asyncts=first_pts=0 \
        -f wav - |
        nice -n10 ionice -c3 \
        flac - -o $tmpdir/$((c+1)).flac
done

cd $tmpdir
zip -0 - *.flac
cd
rm -rf $tmpdir
