CROSS_PREFIX=x86_64-apple-darwin15-
FFMPEG_VER=3.4.2
CFG=--cross-prefix=$(CROSS_PREFIX) --cc=o64-gcc --cxx=o64-g++ --arch=x86_64 --target-os=darwin --disable-everything --enable-protocol=file --disable-xlib --disable-zlib --disable-schannel

all: ../cook/ffmpeg-movqtrle ../cook/ffmpeg-wav

../cook/ffmpeg-movqtrle: ffmpeg-$(FFMPEG_VER)/configure
	-cd ffmpeg-$(FFMPEG_VER) && $(MAKE) distclean
	cd ffmpeg-$(FFMPEG_VER) && \
	./configure $(CFG) --enable-encoder=qtrle --enable-decoder=h264 --enable-muxer=mov --enable-demuxer=matroska \
		--enable-filter=alphamerge --enable-filter=crop --enable-filter=split --enable-filter=scale && \
	$(MAKE) && \
	upx ffmpeg && \
	cp ffmpeg ../../cook/ffmpeg-movqtrle.macosx

../cook/ffmpeg-wav: ../cook/ffmpeg-movqtrle ffmpeg-$(FFMPEG_VER)/configure
	-cd ffmpeg-$(FFMPEG_VER) && $(MAKE) distclean
	cd ffmpeg-$(FFMPEG_VER) && \
	./configure $(CFG) --enable-encoder=pcm_s16le --enable-decoder=flac --enable-muxer=wav --enable-demuxer=flac && \
	$(MAKE) && \
	upx ffmpeg && \
	cp ffmpeg ../../cook/ffmpeg-wav.macosx

ffmpeg-$(FFMPEG_VER)/configure:
	tar Jxf ../windows/ffmpeg-$(FFMPEG_VER).tar.xz
