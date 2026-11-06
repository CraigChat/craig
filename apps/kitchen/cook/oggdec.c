/*
 * oggdec: decode one corrected Craig track (output of oggcorrect/oggsplit)
 * straight to WAV with libopus, replacing ffmpeg piped to wavduration
 *
 *   oggdec [-d duration] [-v] <in.ogg|->  > out.wav
 *
 *   -d D  pad/truncate to D seconds
 *   -v    print decode statistics to stderr at the end
 */
#define _GNU_SOURCE /* F_SETPIPE_SZ */
#include <fcntl.h>
#include <opus/opus.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "crc32.h"

#define SAMPLE_RATE 48000
#define MAX_FRAME 5760 /* 120 ms, the longest Opus packet */
#define PROGRESS_SAMPLES (5 * SAMPLE_RATE)
#define PIPE_SIZE (1 << 20)

/* ---- input: buffered Ogg page reader that resyncs on bad data ---- */

#define IBUF (1 << 20) /* larger than the biggest page (27 + 255 + 255 * 255) */
static int inFd;
static unsigned char ibuf[IBUF];
static size_t ipos = 0, ilen = 0;
static int ieof = 0;
static long resyncs = 0;

static int fill(size_t need)
{
    if (ilen - ipos >= need) return 1;
    memmove(ibuf, ibuf + ipos, ilen - ipos);
    ilen -= ipos;
    ipos = 0;
    while (!ieof && ilen < need) {
        ssize_t n = read(inFd, ibuf + ilen, IBUF - ilen);
        if (n <= 0) ieof = 1;
        else ilen += n;
    }
    return ilen - ipos >= need;
}

static int pageValid(const unsigned char *p, size_t size)
{
    uint32_t want = p[22] | (p[23] << 8) | (p[24] << 16) | ((uint32_t) p[25] << 24);
    uint32_t crc = 0;
    static const unsigned char zero[4] = {0};
    crc32(p, 22, &crc);
    crc32(zero, 4, &crc);
    crc32(p + 26, size - 26, &crc);
    return crc == want;
}

/* Returns the next valid page (pointer into ibuf, valid until the next call)
 * or NULL at end of input. Skipped bytes count as one resync per run. */
static const unsigned char *nextPage(size_t *pageSize)
{
    int skipping = 0;
    for (;;) {
        if (!fill(27)) {
            if (ilen > ipos && !skipping) resyncs++; /* truncated or junk tail */
            return NULL;
        }
        const unsigned char *p = ibuf + ipos;
        size_t size = 0;
        int ok = !memcmp(p, "OggS", 4) && p[4] == 0;
        if (ok) {
            unsigned nseg = p[26];
            ok = fill(27 + nseg);
            if (ok) {
                p = ibuf + ipos;
                size = 27 + nseg;
                for (unsigned i = 0; i < nseg; i++) size += p[27 + i];
                ok = fill(size);
                p = ibuf + ipos;
                ok = ok && pageValid(p, size);
            }
        }
        if (ok) {
            ipos += size;
            *pageSize = size;
            return p;
        }
        if (!skipping) { skipping = 1; resyncs++; }
        ipos++;
    }
}

/* Packets, reassembled across pages. A resync drops any partial packet. */
static unsigned char *pkt = NULL;
static size_t pktCap = 0;
static const unsigned char *page = NULL;
static size_t pageSize = 0, segPos = 0, dataPos = 0;
static unsigned nseg = 0, seg = 0;

static long nextPacket(void)
{
    size_t len = 0;
    for (;;) {
        if (!page || seg >= nseg) {
            long before = resyncs;
            if (!(page = nextPage(&pageSize))) return -1;
            if (resyncs != before) len = 0;
            nseg = page[26];
            seg = 0;
            segPos = 27;
            dataPos = 27 + nseg;
            continue;
        }
        unsigned l = page[segPos + seg++];
        if (len + l > pktCap) {
            pktCap = (len + l) * 2 + 4096;
            if (!(pkt = realloc(pkt, pktCap))) { perror("realloc"); exit(1); }
        }
        memcpy(pkt + len, page + dataPos, l);
        dataPos += l;
        len += l;
        if (l < 255) return (long) len;
    }
}

/* ---- output ---- */

#define OBUF (1 << 18)
static unsigned char obuf[OBUF];
static size_t olen = 0;
static uint64_t written = 0, limit = UINT64_MAX, nextProgress = 0, progressStep = 0;
static int outCh = 2;

static void progress(void)
{
    uint64_t cs = written / (outCh * 2) * 100 / SAMPLE_RATE;
    char line[64];
    int n = snprintf(line, sizeof(line), "time=%02u:%02u:%02u.%02u\n", (unsigned) (cs / 360000), (unsigned) (cs / 6000 % 60),
                     (unsigned) (cs / 100 % 60), (unsigned) (cs % 100));
    if (write(2, line, n) < 0) { /* progress is best effort */ }
}

static void out(const void *p, size_t n)
{
    if (written + n > limit) n = limit - written;
    written += n;
    const unsigned char *c = p;
    while (n) {
        size_t k = OBUF - olen < n ? OBUF - olen : n;
        memcpy(obuf + olen, c, k);
        olen += k;
        c += k;
        n -= k;
        if (olen == OBUF) {
            fwrite(obuf, 1, olen, stdout);
            olen = 0;
        }
    }
    if (written >= nextProgress) {
        progress();
        while (nextProgress <= written) nextProgress += progressStep;
    }
}

static void flush(void)
{
    if (olen) fwrite(obuf, 1, olen, stdout);
    olen = 0;
    fflush(stdout);
}

static void le16(unsigned char *p, uint16_t v) { p[0] = v; p[1] = v >> 8; }
static void le32(unsigned char *p, uint32_t v) { p[0] = v; p[1] = v >> 8; p[2] = v >> 16; p[3] = v >> 24; }
static void le64(unsigned char *p, uint64_t v) { le32(p, (uint32_t) v); le32(p + 4, (uint32_t) (v >> 32)); }

static void writeHeader(double duration, int haveDuration, int ch)
{
    unsigned char h[80];
    size_t n = 0;
    uint64_t bytes = haveDuration ? (uint64_t) (duration * SAMPLE_RATE * ch * 16 / 8) : 0xFFFFFFFFull - 36;
    if (haveDuration) bytes -= bytes % (ch * 2); /* whole sample frames only: flac rejects a partial last frame */
    int ds64 = haveDuration && bytes >= (((uint64_t) 1) << 32) - 36;
    memcpy(h, ds64 ? "RF64" : "RIFF", 4);
    le32(h + 4, ds64 ? 0xFFFFFFFF : (uint32_t) (bytes + 36));
    memcpy(h + 8, "WAVE", 4);
    n = 12;
    if (ds64) {
        memcpy(h + n, "ds64", 4);
        le32(h + n + 4, 28);
        le64(h + n + 8, bytes + 64);
        le64(h + n + 16, bytes);
        le64(h + n + 24, bytes / (ch * 2));
        le32(h + n + 32, 0);
        n += 36;
    }
    memcpy(h + n, "fmt ", 4);
    le32(h + n + 4, 16);
    le16(h + n + 8, 1);
    le16(h + n + 10, ch);
    le32(h + n + 12, SAMPLE_RATE);
    le32(h + n + 16, SAMPLE_RATE * ch * 2);
    le16(h + n + 20, ch * 2);
    le16(h + n + 22, 16);
    n += 24;
    memcpy(h + n, "data", 4);
    le32(h + n + 4, ds64 ? 0xFFFFFFFF : (uint32_t) bytes);
    n += 8;
    fwrite(h, 1, n, stdout);
    if (haveDuration) limit = bytes;
}

int main(int argc, char **argv)
{
    double duration = 0;
    int haveDuration = 0, verbose = 0, c;
    while ((c = getopt(argc, argv, "d:v")) != -1) {
        if (c == 'd') { duration = atof(optarg); haveDuration = 1; }
        else if (c == 'v') verbose = 1;
        else return 1;
    }
    if (optind >= argc) {
        fprintf(stderr, "Use: oggdec [-d duration] [-v] <in.ogg|->\n");
        return 1;
    }
    if (strcmp(argv[optind], "-")) {
        if ((inFd = open(argv[optind], O_RDONLY)) < 0) { perror(argv[optind]); return 1; }
        posix_fadvise(inFd, 0, 0, POSIX_FADV_SEQUENTIAL);
    } else inFd = 0;

    // With the default 64 KB pipe, oggdec and the encoder take turns instead of running at the same time
    fcntl(STDOUT_FILENO, F_SETPIPE_SZ, PIPE_SIZE);

    long len = nextPacket();
    if (len < 19 || memcmp(pkt, "OpusHead", 8)) return 2;
    int channels = pkt[9];
    int preskip = pkt[10] | (pkt[11] << 8);
    if (nextPacket() < 0) return 1; /* OpusTags */

    int err;
    OpusDecoder *dec = opus_decoder_create(SAMPLE_RATE, channels, &err);
    if (err != OPUS_OK) {
        fprintf(stderr, "oggdec: cannot create a decoder for %d channels: %s\n", channels, opus_strerror(err));
        return 1;
    }
    outCh = channels;
    progressStep = nextProgress = (uint64_t) PROGRESS_SAMPLES * channels * 2;
    writeHeader(duration, haveDuration, channels);

    static int16_t pcm[MAX_FRAME * 2];
    long toSkip = preskip, silentRun = 0, skippedFrames = 0, concealed = 0;
    while ((len = nextPacket()) >= 0) {
        int n;
        // Skip decoding silence packets
        if (len == 3 && pkt[0] == 0xF8 && pkt[1] == 0xFF && pkt[2] == 0xFE && ++silentRun > 2) {
            n = 960;
            memset(pcm, 0, sizeof(int16_t) * n * channels);
            skippedFrames++;
        } else {
            if (!(len == 3 && pkt[0] == 0xF8)) silentRun = 0;
            n = opus_decode(dec, pkt, len, pcm, MAX_FRAME, 0);
            if (n < 0) {
                // Conceal a packet libopus rejects, for as long as it claims to last.
                int samples = opus_packet_get_nb_samples(pkt, len, SAMPLE_RATE);
                if (samples <= 0 || samples > MAX_FRAME) samples = 960;
                n = opus_decode(dec, NULL, 0, pcm, samples, 0);
                if (n < 0) {
                    n = samples;
                    memset(pcm, 0, sizeof(int16_t) * n * channels);
                }
                concealed++;
                silentRun = 0;
            }
        }
        int off = 0;
        if (toSkip) {
            off = toSkip < n ? toSkip : n;
            toSkip -= off;
        }
        out(pcm + off * channels, (size_t) (n - off) * channels * 2);
        if (written >= limit) break;
    }
    if (haveDuration && written < limit) {
        static unsigned char zero[65536];
        while (written < limit) out(zero, limit - written < sizeof(zero) ? limit - written : sizeof(zero));
    }
    flush();
    if (concealed || resyncs)
        fprintf(stderr, "oggdec: warning: %ld packets concealed, %ld resyncs\n", concealed, resyncs);
    if (verbose)
        fprintf(stderr, "oggdec: channels=%d, skipped silence frames=%ld, concealed=%ld, resyncs=%ld\n", channels, skippedFrames,
                concealed, resyncs);
    opus_decoder_destroy(dec);
    return 0;
}
