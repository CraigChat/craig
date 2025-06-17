# Install apt dependencies
sudo apt update
# Craig Dependencies
sudo apt install -y ffmpeg flac lame vorbis-tools opus-tools node-gyp libfltk1.3 libfltk1.3-dev
# Legacy dependencies
sudo apt install -y at fluid
# Some dependencies for building FFmpeg (https://trac.ffmpeg.org/wiki/CompilationGuide/Ubuntu#GettheDependencies)
sudo apt install -y libtool yasm
# MinGW dependencies for FFmpeg Windows compilation
sudo apt install -y mingw-w64-tools gcc-mingw-w64-i686 g++-mingw-w64-i686 libz-mingw-w64 libz-mingw-w64-dev


# Build cook dependencies
./apps/kitchen/scripts/build_cook.sh
./apps/ennuizel-streamer/scripts/build_cook.sh

# Install libfdk-aac (see https://github.com/mstorsjo/fdk-aac)
printf "Installing libfdk-aac...\n\n"

git clone https://github.com/mstorsjo/fdk-aac libfdk-aac --depth 1
cd libfdk-aac
./autogen.sh
./configure --enable-shared --enable-static
make
sudo make install

cd ..

# Install fdkaac (see https://github.com/nu774/fdkaac)
printf "Installing fdkaac...\n\n"

git clone https://github.com/nu774/fdkaac --depth 1
cd fdkaac
autoreconf -i
./configure
make
sudo make install
sudo ldconfig

cd ..

# Clean up
rm -rf libfdk-aac
rm -rf fdkaac
