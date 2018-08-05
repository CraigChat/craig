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

DEF_TIMEOUT=7200
ulimit -v $(( 2 * 1024 * 1024 ))
echo 10 > /proc/self/oom_adj

PATH="/opt/node/bin:$PATH"
export PATH

SCRIPTBASE=`dirname "$0"`
SCRIPTBASE=`realpath "$SCRIPTBASE"`

[ "$1" ]

FORMAT=flac
[ "$2" ] && FORMAT="$2"

CONTAINER=zip
[ "$3" ] && CONTAINER="$3"

ARESAMPLE="aresample=flags=res:min_comp=0.001:max_soft_comp=0.025:min_hard_comp=15:first_pts=0"

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
    wavsfxm)
        ext=flac
        ENCODE="flac - -c"
        EXTRAFILES="RunMe.command ffmpeg"
        ;;
    wavsfxu)
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
    OUTDIR="$OUTDIR/${1}_data"
    mkdir "$OUTDIR" || exit 1
fi

# Take a lock on the data file so that we can detect active downloads
exec 9< "$1.ogg.data"
flock -s 9

NICE="nice -n10 ionice -c3 chrt -i 0"
NB_STREAMS=`timeout 10 cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data |
    timeout 10 ffprobe - 2>&1 |
    grep 'Audio: opus' |
    wc -l`

# Prepare the self-extractor or project file
if [ "$FORMAT" = "wavsfx" ]
then
    sed 's/^/@REM   / ; s/$/\r/g' "$SCRIPTBASE/cook/ffmpeg-lgpl21.txt" > "$OUTDIR/RunMe.bat"
    mkfifo "$OUTDIR/ffmpeg.exe"
    timeout $DEF_TIMEOUT cat "$SCRIPTBASE/cook/ffmpeg-wav.exe" > "$OUTDIR/ffmpeg.exe" &

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

fi
if [ "$CONTAINER" = "aupzip" ]
then
    (
        sed 's/@PROJNAME@/'"$1"'_data/g' "$SCRIPTBASE/cook/aup-header.xml";
        timeout $DEF_TIMEOUT cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data |
            timeout $DEF_TIMEOUT "$SCRIPTBASE/cook/extnotes" -f audacity
    ) > "$tmpdir/out/$1.aup"
fi

# Encode thru fifos
for c in `seq -w 1 $NB_STREAMS`
do
    O_USER="`$SCRIPTBASE/cook/userinfo.js $1 $c`"
    [ "$O_USER" ] || unset O_USER
    O_FN="$c${O_USER+-}$O_USER.$ext"
    O_FFN="$OUTDIR/$O_FN"
    T_DURATION=`timeout $DEF_TIMEOUT $NICE "$SCRIPTBASE/cook/oggduration" $c < $1.ogg.data`
    mkfifo "$O_FFN"
    if [ "$FORMAT" = "copy" -o "$CONTAINER" = "mix" ]
    then
        timeout $DEF_TIMEOUT cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data |
            timeout $DEF_TIMEOUT $NICE "$SCRIPTBASE/cook/oggstender" $c > "$O_FFN" &

    else
        timeout $DEF_TIMEOUT cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data |
            timeout $DEF_TIMEOUT $NICE "$SCRIPTBASE/cook/oggstender" $c |
            timeout $DEF_TIMEOUT $NICE ffmpeg -codec libopus -copyts -i - \
            -af "$ARESAMPLE" \
            -flags bitexact -f wav - |
            timeout $DEF_TIMEOUT $NICE "$SCRIPTBASE/cook/wavduration" "$T_DURATION" |
            (
                timeout $DEF_TIMEOUT $NICE $ENCODE > "$O_FFN";
                cat > /dev/null
            ) &

    fi

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
            "$O_FN" >> "$tmpdir/out/$1.aup"
    fi
done
if [ "$FORMAT" = "wavsfxm" -o "$FORMAT" = "wavsfxu" ]
then
    printf "printf '\\\\n\\\\n===\\\\nProcessing complete.\\\\n===\\\\n\\\\n'\\n" >> "$OUTDIR/RunMe.$RUNMESUFFIX"
fi
if [ "$CONTAINER" = "aupzip" ]
then
    printf '</project>\n' >> "$tmpdir/out/$1.aup"
fi
if [ "$CONTAINER" = "zip" -o "$CONTAINER" = "aupzip" -o "$CONTAINER" = "exe" ]
then
    mkfifo $OUTDIR/raw.dat
    timeout 10 "$SCRIPTBASE/cook/recinfo.js" "$1" |
        timeout $DEF_TIMEOUT cat - $1.ogg.header1 $1.ogg.header2 $1.ogg.data > $OUTDIR/raw.dat &
    (
        timeout 10 "$SCRIPTBASE/cook/recinfo.js" "$1" text;
        timeout $DEF_TIMEOUT cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data |
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
        c=0
        for i in *.$ext
        do
            INPUT="$INPUT -codec libopus -copyts -i $i"
            FILTER="$FILTER[$c:a]$ARESAMPLE,dynaudnorm[aud$c];"
            MIXFILTER="$MIXFILTER[aud$c]"
            c=$((c+1))
        done
        MIXFILTER="$MIXFILTER amix=$c,dynaudnorm[aud]"
        FILTER="$FILTER$MIXFILTER"
        DURATION=`timeout $DEF_TIMEOUT $NICE "$SCRIPTBASE/cook/oggduration" < $1.ogg.data`
        timeout $DEF_TIMEOUT $NICE ffmpeg $INPUT -filter_complex "$FILTER" -map '[aud]' -flags bitexact -f wav - < /dev/null |
            timeout $DEF_TIMEOUT $NICE "$SCRIPTBASE/cook/wavduration" "$DURATION" |
            (
                timeout $DEF_TIMEOUT $NICE $ENCODE;
                cat > /dev/null
            )
        ;;

    exe)
        timeout $DEF_TIMEOUT $NICE zip $ZIPFLAGS -FI - *.$ext $EXTRAFILES info.txt raw.dat |
        cat "$SCRIPTBASE/cook/sfx.exe" -
        ;;

    aupzip)
        timeout $DEF_TIMEOUT $NICE zip $ZIPFLAGS -r -FI - "$1.aup" "${1}_data"/*.$ext "${1}_data"/info.txt "${1}_data"/raw.dat
        ;;

    *)
        timeout $DEF_TIMEOUT $NICE zip $ZIPFLAGS -FI - *.$ext $EXTRAFILES info.txt raw.dat
        ;;
esac | (cat || cat > /dev/null)

# And clean up after ourselves
cd
rm -rf "$tmpdir/"

wait
