include ../Makefile.share

CC=$(CROSS_PREFIX)gcc
AR=$(CROSS_PREFIX)ar
RANLIB=$(CROSS_PREFIX)ranlib
CFLAGS=-DWIN32 -DFORCE_WIN32_OVER_UNIX -DIZ_CRCOPTIM_UNFOLDTBL -DASM_CRC -Os -mcpu=pentiumpro -DSFX -DMAIN=UzpMain

OBJS=crc32.o crypt.o extract.o fileio.o globals.o inflate.o match.o process.o ttyio.o ubz2err.o unzip.o win32/win32.o win32/nt.o crc_i386.o

all: unzipsfx.a

unzipsfx.a: $(OBJS)
	$(AR) rc $@ $(OBJS)
	$(RANLIB) $@

%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@

%.o: %.S
	$(CC) -c $< -o $@

clean:
	rm -f $(OBJS) unzipsfx.a
