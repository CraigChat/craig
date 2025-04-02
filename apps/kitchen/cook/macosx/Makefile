CROSS_PREFIX=x86_64-apple-darwin15-
FFMPEG_VER=${COOK_FFMPEG_VERSION:-4.0.2}
CFG=--cross-prefix=$(CROSS_PREFIX) --cc=o64-gcc --cxx=o64-g++ --arch=x86_64 --target-os=darwin --disable-everything --enable-protocol=file --disable-xlib --disable-zlib --disable-schannel

all: ../ffmpeg-movqtrle.macosx ../ffmpeg-movpng.macosx \
	../ffmpeg-wav.macosx ../ffmpeg-fat.macosx

../ffmpeg-%.macosx: ffmpeg-$(FFMPEG_VER)/configure
	-cd ../ffmpeg-$(FFMPEG_VER)/build-$* && $(MAKE) distclean
	cd ../ffmpeg-$(FFMPEG_VER) && \
	mkdir -p build-$* && \
	cd build-$* && \
	../configure $(CFG) `cat ../../../ffmpeg-flags/$*.cfg` && \
	$(MAKE) && \
	cp ffmpeg ../../../ffmpeg-$*.macosx

ffmpeg-$(FFMPEG_VER)/configure:
	([ -f ../ffmpeg-$(FFMPEG_VER).tar.xz ] || curl https://ffmpeg.org/releases/ffmpeg-$(FFMPEG_VER).tar.xz -o ../ffmpeg-$(FFMPEG_VER).tar.xz) && \
	([ -d ../ffmpeg-$(FFMPEG_VER) ] || tar Jxf ../ffmpeg-$(FFMPEG_VER).tar.xz -C ..)
