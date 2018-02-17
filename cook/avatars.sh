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

PATH="/opt/node/bin:$PATH"
export PATH

SCRIPTBASE=`dirname "$0"`
SCRIPTBASE=`realpath "$SCRIPTBASE/.."`

[ "$1" ] || exit 1

FORMAT=png
[ "$2" ] && FORMAT="$2"

CONTAINER=zip
[ "$3" ] && CONTAINER="$3"

unset TRANSPARENT
[ "$4" = "0" ] || TRANSPARENT=1

BG=000000
[ "$5" ] && BG="$5"

FG=008000
[ "$6" ] && FG="$6"

set -e

ARESAMPLE="aresample=flags=res:min_comp=0.001:max_soft_comp=0.01:min_hard_comp=1:first_pts=0"

case "$FORMAT" in
    mkvh264)
        ext=mkv
        CODEC="-c:v libx264 -crf 16"
        ;;
    webmvp8)
        ext=webm
        CODEC="-c:v libvpx -crf 10 -auto-alt-ref 0"
        [ ! "$TRANSPARENT" ] || CODEC="$CODEC -metadata:s:v:0 alpha_mode=1"
        ;;
    *)
        ext=png
        FORMAT=png
        ;;
esac

cd "$SCRIPTBASE/rec"

tmpdir=`mktemp -d`
[ "$tmpdir" -a -d "$tmpdir" ]

echo 'rm -rf '"$tmpdir" | at 'now + 2 hours'

mkdir "$tmpdir/in" "$tmpdir/out"

# Take a lock on the data file so that we can detect active downloads
exec 9< "$1.ogg.data"
flock -s 9

NB_STREAMS=`timeout 10 cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data |
    timeout 10 ffprobe -print_format flat -show_format - 2> /dev/null |
    grep '^format\.nb_streams' |
    sed 's/^[^=]*=//'`
NICE="nice -n10 ionice -c3 chrt -i 0"

TRACKS=

# Make the png files
for c in `seq -w 1 $NB_STREAMS`
do
    O_USER="`$SCRIPTBASE/cook/userinfo.js $1 $c`"
    [ "$O_USER" ] || unset O_USER
    TRACKS="$TRACKS $c${O_USER+-}$O_USER"
    O_FN="$c${O_USER+-}$O_USER.png"
    O_FFN="$tmpdir/in/$O_FN"
    "$SCRIPTBASE/cook/userinfo.js" $1 $c avatar datauri > "$O_FFN" || convert -size 128x128 xc:black "$O_FFN"
done

FILES=
if [ "$FORMAT" = "png" ]
then
    # No actual processing
    for t in $TRACKS
    do
        FILES="$FILES $t.png"
    done
else
    # Make the output files
    for t in $TRACKS
    do
        I_FFN="$tmpdir/in/$t.png"
        O_FN="$t.$ext"
        O_FFN="$tmpdir/out/$O_FN"
        FILES="$FILES $O_FN"

        # We encode into a FIFO
        mkfifo "$O_FFN"

        FILTER=""

        # Make the background
        have_bg=no
        if [ "$TRANSPARENT" -a "$FORMAT" = "mkvh264" ]
        then
            FILTER='color=color=black:size=160x160:rate=30[bg];'
            have_bg=yes
        elif [ ! "$TRANSPARENT" ]
        then
            FILTER='color=color=0x'"$BG"':size=160x160:rate=30[bg];'
            have_bg=yes
        fi

        # Make the glow itself
        FILTER="$FILTER"'
            [2:a]'"$ARESAMPLE"',dynaudnorm,showvolume=r=30:b=0:c=0xFFFFFF:f=0.75:t=0:v=0,format=y8,scale=1:1:flags=area,scale=160:160:flags=neighbor,setsar=1,split=3[glow][glow2][glow3];
            [1:v]alphaextract,setsar=1[glowa];
            [glowa][glow]blend=darken:shortest=1[glow];'

        # If we're generating an alpha channel, don't color the glow
        if [ "$TRANSPARENT" -a "$FORMAT" = "mkvh264" ]
        then
            FILTER="$FILTER"'
                [glow2]nullsink;'
        else
            FILTER="$FILTER"'
                color=color=0x'"$FG"':size=160x160:rate=30[glowbg];
                [glowbg][glow2]overlay=160:160:shortest=1[glowbg];
                [glowbg][glow]alphamerge[glow];'
        fi

        # Sort out the avatar
        if [ "$TRANSPARENT" -a "$FORMAT" = "mkvh264" ]
        then
            # In this case, we're just putting a white (opaque) circle
            FILTER="$FILTER"'
                [0:v]null[avatar];'
        else
            # Overlay the avatar on top
            FILTER="$FILTER"'
                [0:v]alphaextract[avatara];
                [3:v]scale=128:128,pad=160:160:16:16,setsar=1[avatar];
                [avatar][avatara]alphamerge[avatar];'
        fi
        FILTER="$FILTER"'
            [avatar][glow3]overlay=160:160:shortest=1[avatar];'

        # Now, layer it all
        if [ "$have_bg" = "yes" ]
        then
            FILTER="$FILTER"'
                [bg][glow]overlay=shortest=1[vid];'
        else
            FILTER="$FILTER"'
                [glow]null[vid];'
        fi
        FILTER="$FILTER"'
            [vid][avatar]overlay=shortest=1[vid]'

        # Now perform the conversion
        timeout $DEF_TIMEOUT cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data |
            timeout $DEF_TIMEOUT "$SCRIPTBASE/oggstender" $c |
            timeout $DEF_TIMEOUT $NICE ffmpeg \
                -loop 1 -framerate 30 -i "$SCRIPTBASE/cook/glower-avatar.png" \
                -loop 1 -framerate 30 -i "$SCRIPTBASE/cook/glower-glow.png" \
                -codec libopus -copyts -i - \
                -loop 1 -framerate 30 -i "$I_FFN" \
                -filter_complex "$FILTER" \
                -map '[vid]' \
                $CODEC \
                -y "$O_FFN" &

        if [ "$TRANSPARENT" -a "$FORMAT" = "mkvh264" ]
        then
            # Need to provide a png file for the color data
            OP_FN="$t.png"
            OP_FFN="$tmpdir/out/$OP_FN"
            FILES="$FILES $OP_FN"
            timeout $DEF_TIMEOUT $NICE ffmpeg \
                -i "$SCRIPTBASE/cook/glower-avatar.png" \
                -i "$I_FFN" \
                -filter_complex '
                    color=color=0x'"$FG"':size=160x160,trim=end_frame=1[bg];
                    [0:v]alphaextract[avatara];
                    [1:v]scale=128:128,pad=160:160:16:16,setsar=1[avatar];
                    [avatar][avatara]alphamerge[avatar];
                    [bg][avatar]overlay[avatar]' \
                -map '[avatar]' \
                -y "$OP_FFN"
        fi
    done
fi

# Put them into their container
[ "$FORMAT" = "png" ] && cd "$tmpdir/in" || cd "$tmpdir/out"
case "$CONTAINER" in
    *)
        timeout $DEF_TIMEOUT $NICE zip -1 -FI - $FILES || true
        ;;
esac | (cat || cat > /dev/null)

# And clean up after ourselves
cd
rm -rf "$tmpdir/"

wait
