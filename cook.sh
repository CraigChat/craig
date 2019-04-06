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

trap '' HUP
trap '' INT

timeout() {
    /usr/bin/timeout -k 5 "$@"
}

DEF_TIMEOUT=7200
ulimit -v $(( 8 * 1024 * 1024 ))
echo 10 > /proc/self/oom_adj

PATH="/opt/node/bin:$PATH"
export PATH

SCRIPTBASE=`dirname "$0"`
SCRIPTBASE=`realpath "$SCRIPTBASE"`

# Use cook.sh <ID> <format> <container> [dynaudnorm]

[ "$1" ]
ID="$1"
shift

FORMAT=flac
[ "$1" ] && FORMAT="$1"
shift

CONTAINER=zip
[ "$1" ] && CONTAINER="$1"
shift

# NOTE: The max_soft_comp hand min_hard_comp here are just arbitrarily high, as
# the timestamps are already being smoothed by oggstender such that (a) we'll
# always do stretching/squeezing and (b) the rate of stretching/squeezing is
# limited by the drop rate of packets
ARESAMPLE="aresample=flags=res:min_comp=0.001:max_soft_comp=1000000:min_hard_comp=16:first_pts=0"
FILTER="$ARESAMPLE"

for arg in "$@"
do
    case "$arg" in
        dynaudnorm)
            FILTER="$FILTER,dynaudnorm"
            ;;

        *)
            printf 'Unrecognized argument "%s"\n' "$arg" >&2
            exit 1
            ;;
    esac
done

ZIPFLAGS=-1
EXTRAFILES=

case "$FORMAT" in
    copy)
        ext=ogg
        ;;
    oggflac)
        ext=oga
        ENCODE="flac --ogg --serial-number=1 - -c"
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
    heaac)
        ext=aac
        ENCODE="fdkaac -p 29 -f 2 -m 4 -o - -"
        ;;
    opus)
        ext=opus
        ENCODE="opusenc --bitrate 96 - -"
        ;;
    wav|adpcm)
        ext=wav
        ENCODE="ffmpeg -f wav -i - -c:a adpcm_ms -f wav -"
        CONTAINER=zip
        ZIPFLAGS=-9
        ;;
    wav8)
        ext=wav
        ENCODE="ffmpeg -f wav -i - -c:a pcm_u8 -f wav -"
        CONTAINER=zip
        ZIPFLAGS=-9
        ;;
    wavsfx)
        ext=flac
        ENCODE="flac - -c"
        EXTRAFILES="RunMe.bat ffmpeg.exe"
        ;;
    powersfx)
        ext=flac
        ENCODE="flac - -c"
        EXTRAFILES="ffmpeg.exe"
        ;;
    wavsfxm|powersfxm)
        ext=flac
        ENCODE="flac - -c"
        EXTRAFILES="RunMe.command ffmpeg"
        ;;
    wavsfxu|powersfxu)
        ext=flac
        ENCODE="flac - -c"
        EXTRAFILES="RunMe.sh"
        ;;
    mp3)
        ext=mp3
        ENCODE="lame -b 128 - -"
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
if [ "$CONTAINER" = "mix" -o "$CONTAINER" = "aupzip" ]
then
    # mix: Smart auto-mixing, so ext is temporary
    # aupzip: Even though we use FLAC, Audacity throws a fit if they're not called .ogg
    ext=ogg
fi

cd "$SCRIPTBASE/rec"

tmpdir=`mktemp -d`
[ "$tmpdir" -a -d "$tmpdir" ]

echo 'rm -rf '"$tmpdir" | at 'now + 2 hours'

OUTDIR="$tmpdir/out"
mkdir "$OUTDIR" || exit 1
if [ "$CONTAINER" = "aupzip" ]
then
    # Put actual audio in the _data dir
    OUTDIR="$OUTDIR/${ID}_data"
    mkdir "$OUTDIR" || exit 1
fi

# Take a lock on the data file so that we can detect active downloads
exec 9< "$ID.ogg.data"
flock -n 9 || exit 1

NICE="nice -n10 taskset 3 ionice -c3 chrt -i 0"
CODECS=`timeout 10 "$SCRIPTBASE/cook/oggtracks" < $ID.ogg.header1`
STREAM_NOS=`timeout 10 "$SCRIPTBASE/cook/oggtracks" -n < $ID.ogg.header1`
NB_STREAMS=`echo "$CODECS" | wc -l`

# Prepare the self-extractor or project file
if [ "$FORMAT" = "wavsfx" ]
then
    sed 's/^/@REM   / ; s/$/\r/g' "$SCRIPTBASE/cook/ffmpeg-lgpl21.txt" > "$OUTDIR/RunMe.bat"
    mkfifo "$OUTDIR/ffmpeg.exe"
    timeout $DEF_TIMEOUT cat "$SCRIPTBASE/cook/ffmpeg-wav.exe" > "$OUTDIR/ffmpeg.exe" &

elif [ "$FORMAT" = "powersfx" ]
then
    mkfifo "$OUTDIR/ffmpeg.exe"
    timeout $DEF_TIMEOUT cat "$SCRIPTBASE/cook/ffmpeg-fat.exe" > "$OUTDIR/ffmpeg.exe" &

elif [ "$FORMAT" = "wavsfxm" -o "$FORMAT" = "wavsfxu" ]
then
    RUNMESUFFIX=sh
    if [ "$FORMAT" = "wavsfxm" ]
    then
        cp "$SCRIPTBASE/cook/ffmpeg-wav.macosx" "$OUTDIR/ffmpeg"
        chmod a+x "$OUTDIR/ffmpeg"
        RUNMESUFFIX=command
    fi

    (
        printf '#!/bin/sh\n'
        sed 's/^/#   /' "$SCRIPTBASE/cook/ffmpeg-lgpl21.txt"
        printf 'set -e\ncd "$(dirname "$0")"\n\n'
    ) > "$OUTDIR/RunMe.$RUNMESUFFIX"
    chmod a+x "$OUTDIR/RunMe.$RUNMESUFFIX"

elif [ "$FORMAT" = "powersfxm" ]
then
    cp "$SCRIPTBASE/cook/ffmpeg-fat.macosx" "$OUTDIR/ffmpeg"
    cp "$SCRIPTBASE/cook/powersfx.sh" "$OUTDIR/RunMe.command"
    chmod a+x "$OUTDIR/ffmpeg" "$OUTDIR/RunMe.command"

elif [ "$FORMAT" = "powersfxu" ]
then
    cp "$SCRIPTBASE/cook/powersfx.sh" "$OUTDIR/RunMe.sh"
    chmod a+x "$OUTDIR/RunMe.sh"

fi
if [ "$CONTAINER" = "aupzip" ]
then
    (
        sed 's/@PROJNAME@/'"$ID"'_data/g' "$SCRIPTBASE/cook/aup-header.xml";
        timeout $DEF_TIMEOUT cat $ID.ogg.header1 $ID.ogg.header2 $ID.ogg.data |
            timeout $DEF_TIMEOUT "$SCRIPTBASE/cook/extnotes" -f audacity
    ) > "$tmpdir/out/$ID.aup"
fi

# Make our fifos and surrounding content
for c in `seq -w 1 $NB_STREAMS`
do
    O_USER="`$SCRIPTBASE/cook/userinfo.js $ID $c`"
    [ "$O_USER" ] || unset O_USER
    O_FN="$c${O_USER+-}$O_USER.$ext"
    O_FFN="$OUTDIR/$O_FN"
    mkfifo "$O_FFN"

    # Make the extractor line for this file
    if [ "$FORMAT" = "wavsfx" ]
    then
        printf 'ffmpeg -i %s %s\r\ndel %s\r\n\r\n' "$O_FN" "${O_FN%.flac}.wav" "$O_FN" >> "$OUTDIR/RunMe.bat"
    elif [ "$FORMAT" = "wavsfxm" -o "$FORMAT" = "wavsfxu" ]
    then
        (
            [ "$FORMAT" != "wavsfxm" ] || printf './'
            printf 'ffmpeg -i %s %s\nrm %s\n\n' "$O_FN" "${O_FN%.flac}.wav" "$O_FN"
        ) >> "$OUTDIR/RunMe.$RUNMESUFFIX"
    fi

    # Or the XML line
    if [ "$CONTAINER" = "aupzip" ]
    then
        printf '\t<import filename="%s" offset="0.00000000" mute="0" solo="0" height="150" minimized="0" gain="1.0" pan="0.0"/>\n' \
            "$O_FN" >> "$tmpdir/out/$ID.aup"
    fi
done

if [ "$FORMAT" = "wavsfxm" -o "$FORMAT" = "wavsfxu" ]
then
    printf "printf '\\\\n\\\\n===\\\\nProcessing complete.\\\\n===\\\\n\\\\n'\\n" >> "$OUTDIR/RunMe.$RUNMESUFFIX"
fi
if [ "$CONTAINER" = "aupzip" ]
then
    printf '</project>\n' >> "$tmpdir/out/$ID.aup"
fi


# Encode thru fifos
for c in `seq -w 1 $NB_STREAMS`
do
    O_USER="`$SCRIPTBASE/cook/userinfo.js $ID $c`"
    [ "$O_USER" ] || unset O_USER
    O_FN="$c${O_USER+-}$O_USER.$ext"
    O_FFN="$OUTDIR/$O_FN"
    T_DURATION=`timeout $DEF_TIMEOUT $NICE "$SCRIPTBASE/cook/oggduration" $c < $ID.ogg.data`
    sno=`echo "$STREAM_NOS" | sed -n "$c"p`
    if [ "$FORMAT" = "copy" -o "$CONTAINER" = "mix" ]
    then
        timeout $DEF_TIMEOUT cat $ID.ogg.header1 $ID.ogg.header2 $ID.ogg.data |
            timeout $DEF_TIMEOUT $NICE "$SCRIPTBASE/cook/oggstender" $sno > "$O_FFN" &

    else
        CODEC=`echo "$CODECS" | sed -n "$c"p`
        [ "$CODEC" = "opus" ] && CODEC=libopus
        timeout $DEF_TIMEOUT cat $ID.ogg.header1 $ID.ogg.header2 $ID.ogg.data |
            timeout $DEF_TIMEOUT $NICE "$SCRIPTBASE/cook/oggstender" $sno |
            timeout $DEF_TIMEOUT $NICE ffmpeg -codec $CODEC -copyts -i - \
            -af "$FILTER" \
            -flags bitexact -f wav - |
            timeout $DEF_TIMEOUT $NICE "$SCRIPTBASE/cook/wavduration" "$T_DURATION" |
            (
                timeout $DEF_TIMEOUT $NICE $ENCODE > "$O_FFN";
                cat > /dev/null
            )

    fi
done &
if [ "$FORMAT" = "copy" -o "$CONTAINER" = "mix" ]
then
    # Wait for the immediate child, which has spawned more children
    wait
fi


# Also provide raw.dat and info.txt
if [ "$CONTAINER" = "zip" -o "$CONTAINER" = "aupzip" -o "$CONTAINER" = "exe" ]
then
    mkfifo $OUTDIR/raw.dat
    timeout 10 "$SCRIPTBASE/cook/recinfo.js" "$ID" |
        timeout $DEF_TIMEOUT cat - $ID.ogg.header1 $ID.ogg.header2 $ID.ogg.data > $OUTDIR/raw.dat &
    (
        timeout 10 "$SCRIPTBASE/cook/recinfo.js" "$ID" text;
        timeout $DEF_TIMEOUT cat $ID.ogg.header1 $ID.ogg.header2 $ID.ogg.data |
            timeout $DEF_TIMEOUT "$SCRIPTBASE/cook/extnotes"
    ) > $OUTDIR/info.txt
fi


# Put them into their container
cd "$tmpdir/out"
case "$CONTAINER" in
    ogg|matroska)
        if [ "$FORMAT" = "copy" -a "$CONTAINER" = "ogg" ]
        then
            "$SCRIPTBASE/cook/oggmultiplexer" *.ogg
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
            timeout $DEF_TIMEOUT $NICE ffmpeg $INPUT $MAP -c:a copy -f $CONTAINER - < /dev/null
        fi
        ;;

    mix)
        INPUT=""
        FILTER=""
        MIXFILTER=""
        ci=0
        co=0
        for i in *.$ext
        do
            INPUT="$INPUT -codec libopus -copyts -i $i"
            FILTER="$FILTER[$ci:a]$ARESAMPLE,dynaudnorm[aud$co];"
            MIXFILTER="$MIXFILTER[aud$co]"
            ci=$((ci+1))
            co=$((co+1))

            # amix can only mix 32 at a time, so if we reached that, we have to start again
            if [ "$co" = "32" ]
            then
                MIXFILTER="$MIXFILTER amix=32,dynaudnorm[aud0];[aud0]"
                co=1
            fi
        done
        MIXFILTER="$MIXFILTER amix=$co,dynaudnorm[aud]"
        FILTER="$FILTER$MIXFILTER"
        DURATION=`timeout $DEF_TIMEOUT $NICE "$SCRIPTBASE/cook/oggduration" < "$SCRIPTBASE/rec/$ID.ogg.data"`
        timeout $DEF_TIMEOUT $NICE ffmpeg $INPUT -filter_complex "$FILTER" -map '[aud]' -flags bitexact -f wav - < /dev/null |
            timeout $DEF_TIMEOUT $NICE "$SCRIPTBASE/cook/wavduration" "$DURATION" |
            (
                timeout $DEF_TIMEOUT $NICE $ENCODE;
                cat > /dev/null
            )
        ;;

    exe)
        SFX="$SCRIPTBASE/cook/sfx.exe"
        [ "$FORMAT" != "powersfx" ] || SFX="$SCRIPTBASE/cook/powersfx.exe"
        timeout $DEF_TIMEOUT $NICE zip $ZIPFLAGS -FI - *.$ext $EXTRAFILES info.txt raw.dat |
        cat "$SFX" -
        ;;

    aupzip)
        timeout $DEF_TIMEOUT $NICE zip $ZIPFLAGS -r -FI - "$ID.aup" "${ID}_data"/*.$ext "${ID}_data"/info.txt "${ID}_data"/raw.dat
        ;;

    *)
        timeout $DEF_TIMEOUT $NICE zip $ZIPFLAGS -FI - *.$ext $EXTRAFILES info.txt raw.dat
        ;;
esac | (cat || cat > /dev/null)

# And clean up after ourselves
cd
rm -rf "$tmpdir/"

wait
