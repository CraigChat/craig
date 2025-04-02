#!/bin/sh
# This is just an extremely simple wrapper to get info.json
PATH="/opt/node/bin:$PATH"
export PATH
SCRIPTBASE=`dirname "$0"`
SCRIPTBASE=`realpath "$SCRIPTBASE/.."`
cd "$SCRIPTBASE/rec"
exec "$SCRIPTBASE/cook/recinfo.js" "$@"
