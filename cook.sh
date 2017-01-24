#!/bin/sh
set -e
[ "$1" ]

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
    mkfifo $tmpdir/$((c+1)).flac
    $NICE cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data |
        $NICE ffmpeg -codec libopus -copyts -i - \
        -map 0:$c -af aresample=async=480,asyncts=first_pts=0 \
        -f wav - |
        $NICE flac - -c > $tmpdir/$((c+1)).flac &
done

# Zip them up
cd $tmpdir
zip -1 -FI - *.flac | cat
cd

# And clean up after ourselves
rm -rf $tmpdir
