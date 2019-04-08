#!/bin/sh
# Copyright (c) 2019 Yahweasel
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
ulimit -v $(( 8 * 1024 * 1024 ))
echo 10 > /proc/self/oom_adj

PATH="/opt/node/bin:$PATH"
export PATH

SCRIPTBASE=`dirname "$0"`
SCRIPTBASE=`realpath "$SCRIPTBASE/.."`

# Use raw-partwise.sh <ID>

[ "$1" ]
ID="$1"
STREAMS="$2"

cd "$SCRIPTBASE/rec"

NICE="nice -n10 taskset 3 ionice -c3 chrt -i 0"

if [ ! "$STREAMS" -o "$STREAMS" = info ]
then
    # Output the recording info
    timeout 10 "$SCRIPTBASE/cook/recinfo.js" "$ID"
    if [ "$STREAMS" = "info" ]
    then
        # Also tell them the tracks
        timeout 10 "$SCRIPTBASE/cook/oggtracks" -n < $ID.ogg.header1
        exit 0
    fi
fi

# If no streams were specified,
if [ ! "$STREAMS" ]
then
    # get every stream
    STREAMS=""
    STREAM_NOS=`timeout 10 "$SCRIPTBASE/cook/oggtracks" -n < $ID.ogg.header1`
    NB_STREAMS=`echo "$STREAM_NOS" | wc -l`
    for c in `seq 1 $NB_STREAMS`
    do
        sno=`echo "$STREAM_NOS" | sed -n "$c"p`
        STREAMS="$STREAMS $sno"
    done
fi

# Output each requested component
for c in $STREAMS
do
    timeout $DEF_TIMEOUT cat $ID.ogg.header1 $ID.ogg.header2 $ID.ogg.data |
        timeout $DEF_TIMEOUT $NICE "$SCRIPTBASE/cook/oggstender" $c
done
