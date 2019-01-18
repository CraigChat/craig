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

DEF_TIMEOUT=43200
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

ARESAMPLE="aresample=flags=res:min_comp=0.001:max_soft_comp=1000000:min_hard_comp=16:first_pts=0"

case "$FORMAT" in
    mkvh264|movsfx|movsfxm|movsfxu)
        ext=mkv
        FORMAT_GEN=qtrle
        FORMAT_FFMPEG=movqtrle
        CODEC="-c:v libx264 -crf 16"
        ;;
    movpngsfx|movpngsfxm|movpngsfxu)
        ext=mkv
        FORMAT=mov${FORMAT#movpng}
        FORMAT_GEN=png
        FORMAT_FFMPEG=movpng
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

NICE="nice -n10 ionice -c3 chrt -i 0"
CODECS=`timeout 10 "$SCRIPTBASE/cook/oggtracks" < $1.ogg.header1`
NB_STREAMS=`echo "$CODECS" | wc -l`
DURATION=`timeout $DEF_TIMEOUT $NICE "$SCRIPTBASE/cook/oggduration" < $1.ogg.data`

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

# Prepare the self-extractor
if [ "$FORMAT" = "movsfx" ]
then
    sed 's/^/@REM   / ; s/$/\r/g' "$SCRIPTBASE/cook/ffmpeg-lgpl21.txt" > "$tmpdir/out/RunMe.bat"
    mkfifo "$tmpdir/out/ffmpeg.exe"
    timeout $DEF_TIMEOUT cat "$SCRIPTBASE/cook/ffmpeg-$FORMAT_FFMPEG.exe" > "$tmpdir/out/ffmpeg.exe" &
    FILES="$FILES RunMe.bat ffmpeg.exe"

elif [ "$FORMAT" = "movsfxm" -o "$FORMAT" = "movsfxu" ]
then
    RUNMESUFFIX=sh
    if [ "$FORMAT" = "movsfxm" ]
    then
        cp "$SCRIPTBASE/cook/ffmpeg-$FORMAT_FFMPEG.macosx" "$tmpdir/out/ffmpeg"
        chmod a+x "$tmpdir/out/ffmpeg"
        FILES="$FILES ffmpeg"
        RUNMESUFFIX=command
    fi
    (
        printf '#!/bin/sh\n'
        sed 's/^/#   /' "$SCRIPTBASE/cook/ffmpeg-lgpl21.txt"
        printf 'set -e\ncd "$(dirname "$0")"\n\n'
    ) > "$tmpdir/out/RunMe.$RUNMESUFFIX"
    chmod a+x "$tmpdir/out/RunMe.$RUNMESUFFIX"
    FILES="$FILES RunMe.$RUNMESUFFIX"

fi

if [ "$FORMAT" = "png" ]
then
    # No actual processing
    for t in $TRACKS
    do
        FILES="$FILES $t.png"
    done
else
    # Make the output files
    c=1
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
            FILTER='color=color=black:size=160x160:rate=30:duration=1[bg];'
            have_bg=yes
        elif [ ! "$TRANSPARENT" ]
        then
            FILTER='color=color=0x'"$BG"':size=160x160:rate=30:duration=1[bg];'
            have_bg=yes
        fi

        # Make the glow itself
        FILTER="$FILTER"'
            [2:a]'"$ARESAMPLE"',apad,dynaudnorm,volume=2,showvolume=r=30:b=0:c=0xFFFFFF:f=0.75:t=0:v=0,format=y8,scale=1:1:flags=area,scale=160:160:flags=neighbor,setsar=1[glow];
            [1:v]alphaextract,setsar=1[glowa];
            [glowa][glow]blend=darken[glow];'

        # If we're generating an alpha channel, don't color the glow
        if [ "$TRANSPARENT" -a "$FORMAT" = "mkvh264" ]
        then
            true
        else
            FILTER="$FILTER"'
                color=color=0x'"$FG"':size=160x160:rate=30[glowbg];
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

        # Now, layer it all
        if [ "$have_bg" = "yes" ]
        then
            FILTER="$FILTER"'
                [bg][glow]overlay[vid];'
        else
            FILTER="$FILTER"'
                [glow]null[vid];'
        fi
        FILTER="$FILTER"'
            [vid][avatar]overlay[vid]'

        # If we're making a self-extractor, split the color and alpha
        if [ "$FORMAT" = "movsfx" -o "$FORMAT" = "movsfxm" -o "$FORMAT" = "movsfxu" ]
        then
            FILTER="$FILTER"';
                [vid]split[vid][alpha];
                [alpha]alphaextract[alpha];
                [vid][alpha]hstack[vid]'
        fi

        # Now perform the conversion
        timeout $DEF_TIMEOUT cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data |
            timeout $DEF_TIMEOUT "$SCRIPTBASE/cook/oggstender" $c |
            timeout $DEF_TIMEOUT $NICE ffmpeg \
                -framerate 30 -i "$SCRIPTBASE/cook/glower-avatar.png" \
                -framerate 30 -i "$SCRIPTBASE/cook/glower-glow.png" \
                -codec libopus -copyts -i - \
                -framerate 30 -i "$I_FFN" \
                -filter_complex "$FILTER" \
                -map '[vid]' \
                $CODEC \
                -t "$DURATION" \
                -y "$O_FFN" &

        # Support special stuff for special formats
        if [ "$TRANSPARENT" -a "$FORMAT" = "mkvh264" ]
        then
            # Need to provide a png file for the color data
            OP_FN="$t.png"
            OP_FFN="$tmpdir/out/$OP_FN"
            FILES="$FILES $OP_FN"
            timeout $DEF_TIMEOUT $NICE ffmpeg -nostdin \
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

        elif [ "$FORMAT" = "movsfx" ]
        then
            printf 'ffmpeg -i %s -filter_complex "[0:v]split[vid][alpha];[vid]crop=160:160:0:0[vid];[alpha]crop=160:160:160:0[alpha];[vid][alpha]alphamerge[vid]" -map [vid] -c:v %s %s\r\ndel %s\r\n\r\n' \
                "$O_FN" "$FORMAT_GEN" "${O_FN%.mkv}.mov" "$O_FN" \
                >> "$tmpdir/out/RunMe.bat"

        elif [ "$FORMAT" = "movsfxm" -o "$FORMAT" = "movsfxu" ]
        then
            (
                [ "$FORMAT" != "movsfxm" ] || printf './'
                printf 'ffmpeg -i %s -filter_complex '\''[0:v]split[vid][alpha];[vid]crop=160:160:0:0[vid];[alpha]crop=160:160:160:0[alpha];[vid][alpha]alphamerge[vid]'\'' -map '\''[vid]'\'' -c:v %s %s\nrm %s\n\n' \
                    "$O_FN" "$FORMAT_GEN" "${O_FN%.mkv}.mov" "$O_FN"
            ) >> "$tmpdir/out/RunMe.$RUNMESUFFIX"

        fi

        c=$((c+1))
    done
fi
if [ "$FORMAT" = "movsfxm" -o "$FORMAT" = "movsfxu" ]
then
    printf "printf '\\\\n\\\\n===\\\\nProcessing complete.\\\\n===\\\\n\\\\n'\\n" >> "$tmpdir/out/RunMe.$RUNMESUFFIX"
fi

# Put them into their container
[ "$FORMAT" = "png" ] && cd "$tmpdir/in" || cd "$tmpdir/out"
case "$CONTAINER" in
    exe)
        ( timeout $DEF_TIMEOUT $NICE zip -1 -FI - $FILES || true ) |
        cat "$SCRIPTBASE/cook/sfx.exe" -
        ;;
    *)
        timeout $DEF_TIMEOUT $NICE zip -1 -FI - $FILES || true
        ;;
esac | (cat || cat > /dev/null)

# And clean up after ourselves
cd
rm -rf "$tmpdir/"

wait
