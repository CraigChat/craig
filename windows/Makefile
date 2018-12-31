include Makefile.share

FFMPEG_VER=4.0.2
CFG=--cross-prefix=$(CROSS_PREFIX) --arch=i686 --target-os=win32 --disable-everything --enable-protocol=file --disable-xlib --disable-zlib --disable-schannel

all: ../cook/ffmpeg-movqtrle.exe ../cook/ffmpeg-movpng.exe \
	../cook/ffmpeg-wav.exe ../cook/ffmpeg-fat.exe \
	../cook/sfx.exe ../cook/powersfx.exe

../cook/ffmpeg-%.exe: ffmpeg-$(FFMPEG_VER)/configure
	-cd ffmpeg-$(FFMPEG_VER)/build-$* && $(MAKE) distclean
	cd ffmpeg-$(FFMPEG_VER) && \
	mkdir -p build-$* && \
	cd build-$* && \
	../configure $(CFG) `cat ../../../cook/ffmpeg-flags/$*.cfg` && \
	$(MAKE) && \
	cp ffmpeg.exe ../../../cook/ffmpeg-$*.exe

ffmpeg-$(FFMPEG_VER)/configure:
	tar Jxf ffmpeg-$(FFMPEG_VER).tar.xz

../cook/%fx.exe: unzip/unzipsfx.a %fx.cxx
	$(CROSS_PREFIX)g++ -static -Os $*fx.cxx $*fxcb.cxx unzip/unzipsfx.a -lfltk -lgdi32 -lole32 -lcomctl32 -luuid -o $*fx.exe
	$(CROSS_PREFIX)strip $*fx.exe
	mv $*fx.exe ../cook/

unzip/unzipsfx.a:
	cd unzip && \
	$(MAKE)

%fx.cxx:
	fluid -c $*fx.fl

clean:
	rm -f sfx.cxx sfx.h powersfx.cxx powersfx.h
