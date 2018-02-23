CROSS_PREFIX=i686-w64-mingw32-
FFMPEG_VER=3.4.2
CFG=--cross-prefix=$(CROSS_PREFIX) --arch=i686 --target-os=win32 --disable-everything --enable-protocol=file --disable-xlib --disable-zlib --disable-schannel

all: ../cook/ffmpeg-movqtrle.exe ../cook/ffmpeg-wav.exe

../cook/ffmpeg-movqtrle.exe: ffmpeg-$(FFMPEG_VER)/configure
	-cd ffmpeg-$(FFMPEG_VER) && $(MAKE) distclean
	cd ffmpeg-$(FFMPEG_VER) && \
	./configure $(CFG) --enable-encoder=qtrle --enable-decoder=h264 --enable-muxer=mov --enable-demuxer=matroska \
		--enable-filter=alphamerge --enable-filter=crop --enable-filter=split --enable-filter=scale && \
	$(MAKE) && \
	upx ffmpeg.exe && \
	cp ffmpeg.exe ../../cook/ffmpeg-movqtrle.exe

../cook/ffmpeg-wav.exe: ../cook/ffmpeg-movqtrle.exe ffmpeg-$(FFMPEG_VER)/configure
	-cd ffmpeg-$(FFMPEG_VER) && $(MAKE) distclean
	cd ffmpeg-$(FFMPEG_VER) && \
	./configure $(CFG) --enable-encoder=pcm_s16le --enable-decoder=flac --enable-muxer=wav --enable-demuxer=flac && \
	$(MAKE) && \
	upx ffmpeg.exe && \
	cp ffmpeg.exe ../../cook/ffmpeg-wav.exe

ffmpeg-$(FFMPEG_VER)/configure:
	tar Jxf ffmpeg-$(FFMPEG_VER).tar.xz
