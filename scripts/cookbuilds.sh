SCRIPTBASE=`dirname "$0"`
SCRIPTBASE=`realpath "$SCRIPTBASE"`
cd "$SCRIPTBASE/../cook"
wget https://get.snaz.in/8Ktu24P.zip -O cook.zip
unzip cook.zip
rm cook.zip