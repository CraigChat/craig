include Makefile.share

FFMPEG_VER=4.0.2
CFG=--cross-prefix=$(CROSS_PREFIX) --arch=i686 --target-os=win32 --disable-everything --enable-protocol=file --disable-xlib --disable-zlib --disable-schannel

all: ../cook/ffmpeg-movqtrle.exe ../cook/ffmpeg-movpng.exe \
	../cook/ffmpeg-wav.exe ../cook/ffmpeg-fat.exe ../cook/sfx.exe

../cook/ffmpeg-%.exe: ffmpeg-$(FFMPEG_VER)/configure
	-cd ffmpeg-$(FFMPEG_VER)/build-$* && $(MAKE) distclean
	cd ffmpeg-$(FFMPEG_VER) && \
	mkdir -p build-$* && \
	cd build-$* && \
	../configure $(CFG) `cat ../../../cook/ffmpeg-flags/$*.cfg` && \
	$(MAKE) && \
	upx ffmpeg.exe && \
	cp ffmpeg.exe ../../../cook/ffmpeg-$*.exe

ffmpeg-$(FFMPEG_VER)/configure:
	tar Jxf ffmpeg-$(FFMPEG_VER).tar.xz

../cook/sfx.exe: unzip/unzipsfx.a sfx.cxx
	$(CROSS_PREFIX)g++ -static -Os -mwindows sfx.cxx sfxcb.cxx unzip/unzipsfx.a -lfltk -lgdi32 -lole32 -lcomctl32 -luuid -o sfx.exe
	$(CROSS_PREFIX)strip sfx.exe
	upx sfx.exe
	mv sfx.exe ../cook/

unzip/unzipsfx.a:
	cd unzip && \
	$(MAKE)

sfx.cxx:
	fluid -c sfx.fl

clean:
	rm -f sfx.cxx sfx.h
