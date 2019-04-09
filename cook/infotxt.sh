#!/bin/sh
# This is just an extremely simple wrapper to get info.txt
PATH="/opt/node/bin:$PATH"
export PATH
ID="$1"
SCRIPTBASE=`dirname "$0"`
SCRIPTBASE=`realpath "$SCRIPTBASE/.."`
DEF_TIMEOUT=7200
timeout() {
    /usr/bin/timeout -k 5 "$@"
}
cd "$SCRIPTBASE/rec"
"$SCRIPTBASE/cook/recinfo.js" "$ID" text;
timeout $DEF_TIMEOUT cat $ID.ogg.header1 $ID.ogg.header2 $ID.ogg.data |
    timeout $DEF_TIMEOUT "$SCRIPTBASE/cook/extnotes"
