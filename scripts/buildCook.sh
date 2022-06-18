SCRIPTBASE=`dirname "$0"`
SCRIPTBASE=`realpath "$SCRIPTBASE"`
cd "$SCRIPTBASE/../cook"
for i in *.c; do gcc -O3 -o ${i%.c} $i; done && for i in *.svg; do inkscape -e ${i%.svg}.png $i; done
