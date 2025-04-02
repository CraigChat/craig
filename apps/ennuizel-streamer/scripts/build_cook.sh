#!/bin/bash

# set CWD
SCRIPTBASE=`dirname "$0"`
SCRIPTBASE=`realpath "$SCRIPTBASE"`
cd $SCRIPTBASE
cd ../cook

# Generic build stuff
for i in *.c; do gcc -O3 -o ${i%.c} $i; done
