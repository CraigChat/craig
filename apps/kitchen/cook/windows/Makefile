CROSS_PREFIX=i686-w64-mingw32-
FFMPEG_VER?=4.0.2
CFG=--cross-prefix=$(CROSS_PREFIX) --arch=i686 --target-os=win32 --disable-everything --enable-protocol=file --disable-xlib --disable-zlib --disable-schannel

all: ../ffmpeg-movqtrle.exe ../ffmpeg-movpng.exe \
	../ffmpeg-wav.exe ../ffmpeg-fat.exe \
	../sfx.exe ../powersfx.exe

../ffmpeg-%.exe: ffmpeg-$(FFMPEG_VER)/configure
	-cd ../ffmpeg-$(FFMPEG_VER)/build-$* && $(MAKE) distclean
	cd ../ffmpeg-$(FFMPEG_VER) && \
	mkdir -p build-$* && \
	cd build-$* && \
	../configure $(CFG) `cat ../../../ffmpeg-flags/$*.cfg` && \
	$(MAKE) && \
	cp ffmpeg.exe ../../../ffmpeg-$*.exe

ffmpeg-$(FFMPEG_VER)/configure:
	([ -f ../ffmpeg-$(FFMPEG_VER).tar.xz ] || curl https://ffmpeg.org/releases/ffmpeg-$(FFMPEG_VER).tar.xz -o ../ffmpeg-$(FFMPEG_VER).tar.xz) && \
	([ -d ../ffmpeg-$(FFMPEG_VER) ] || tar Jxf ../ffmpeg-$(FFMPEG_VER).tar.xz -C ..)

../%fx.exe: unzip/unzipsfx.a %fx.cxx
	$(CROSS_PREFIX)g++ -static -Os $*fx.cxx $*fxcb.cxx unzip/unzipsfx.a -lfltk -lgdi32 -lole32 -lcomctl32 -luuid -o $*fx.exe
	$(CROSS_PREFIX)strip $*fx.exe
	mv $*fx.exe ../

unzip/unzipsfx.a:
	cd unzip && \
	$(MAKE)

%fx.cxx:
	fluid -c $*fx.fl

clean:
	rm -f sfx.cxx sfx.h powersfx.cxx powersfx.h
