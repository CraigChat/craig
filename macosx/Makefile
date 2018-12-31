CROSS_PREFIX=x86_64-apple-darwin15-
FFMPEG_VER=4.0.2
CFG=--cross-prefix=$(CROSS_PREFIX) --cc=o64-gcc --cxx=o64-g++ --arch=x86_64 --target-os=darwin --disable-everything --enable-protocol=file --disable-xlib --disable-zlib --disable-schannel

all: ../cook/ffmpeg-movqtrle.macosx ../cook/ffmpeg-movpng.macosx \
	../cook/ffmpeg-wav.macosx ../cook/ffmpeg-fat.macosx

../cook/ffmpeg-%.macosx: ffmpeg-$(FFMPEG_VER)/configure
	-cd ffmpeg-$(FFMPEG_VER)/build-$* && $(MAKE) distclean
	cd ffmpeg-$(FFMPEG_VER) && \
	mkdir -p build-$* && \
	cd build-$* && \
	../configure $(CFG) `cat ../../../cook/ffmpeg-flags/$*.cfg` && \
	$(MAKE) && \
	cp ffmpeg ../../../cook/ffmpeg-$*.macosx

ffmpeg-$(FFMPEG_VER)/configure:
	tar Jxf ../windows/ffmpeg-$(FFMPEG_VER).tar.xz
