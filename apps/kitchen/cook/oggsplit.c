/*
 * oggsplit: single-pass streamed split and correct all tracks from a recording (and handling the duration)
 *
 *   oggsplit <recFileBase> <outPrefix> [track ...]
 */
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "crc32.h"

struct OggHeader {
    unsigned char type;
    uint64_t granulePos;
    uint32_t streamNo;
    uint32_t sequenceNo;
    uint32_t crc;
} __attribute__((packed));

#define FLAG_BEGIN      1
#define FLAG_END        2
#define FLAG_SILENT     4
#define FLAG_DROP       8

struct PacketList {
    struct PacketList *next;
    int flags;
    int framesInPacket;
    int frameSize;
    int preSkip;
    uint64_t inputGranulePos;
    uint64_t outputGranulePos;
    struct OggHeader hdr;  /* original page header */
    off_t offset;          /* payload offset in .data (after VAD skip) */
    uint32_t size;
};

const unsigned char zeroPacket[] = { 0xF8, 0xFF, 0xFE };
const uint32_t packetTime = 960;
const unsigned char zeroPacketFLAC48k[] = { 0xFF, 0xF8, 0x7A, 0x0C, 0x00, 0x03,
    0xBF, 0x94, 0x00, 0x00, 0x00, 0x00, 0xB1, 0xCA };
const unsigned char zeroPacketFLAC44k[] = { 0xFF, 0xF8, 0x79, 0x0C, 0x00, 0x03,
    0x71, 0x56, 0x00, 0x00, 0x00, 0x00, 0x63, 0xC5 };

#define MAX_TRACKS 1024
#define MAX_HEADER_PAGES 32
#define MODE_NORMAL 0
#define MODE_SILENT 1

struct Track {
    int used, wanted;
    unsigned char vadLevel;
    uint32_t flacRate;
    int nHdr;
    struct OggHeader hdrH[MAX_HEADER_PAGES];
    unsigned char *hdrD[MAX_HEADER_PAGES];
    uint32_t hdrS[MAX_HEADER_PAGES];
    uint64_t lastGranule;      /* oggduration semantics */
    /* streaming state */
    FILE *out;
    uint32_t lastSequenceNo;
    double granulePos;
    int started;               /* first packet seen */
    int mode;                  /* kind of the open block */
    struct PacketList *blkHead, *blkTail;  /* the open block */
};
static struct Track tracks[MAX_TRACKS];

static int dataFd = -1;
static unsigned char *payBuf = NULL;
static size_t payCap = 0;
static long badVadHeaders = 0, shortPackets = 0, strayPackets = 0, extraHeaders = 0;

/* free-list allocator: memory stays proportional to the largest open blocks */
static struct PacketList *freeList = NULL;
static struct PacketList *newPacket(void)
{
    struct PacketList *p = freeList;
    if (p) freeList = p->next;
    else if (!(p = malloc(sizeof(*p)))) { perror("malloc"); exit(1); }
    memset(p, 0, sizeof(*p));
    return p;
}
static void freePacket(struct PacketList *p) { p->next = freeList; freeList = p; }

/* ---- buffered page reader over header1, header2, data ---- */
#define RBUF (1 << 20)
struct Reader {
    int fds[3];
    int which;
    unsigned char *buf;
    size_t pos, len;
    off_t fileOff;   /* file offset of buf[0] in the current file */
    int eof;
};

static int fill(struct Reader *r, size_t need)
{
    if (r->len - r->pos >= need) return 1;
    if (r->eof) return 0;
    memmove(r->buf, r->buf + r->pos, r->len - r->pos);
    r->fileOff += r->pos;
    r->len -= r->pos;
    r->pos = 0;
    while (r->len < need) {
        ssize_t n = read(r->fds[r->which], r->buf + r->len, RBUF - r->len);
        if (n < 0) { perror("read"); exit(1); }
        if (n == 0) { r->eof = 1; break; }
        r->len += n;
    }
    return r->len - r->pos >= need;
}

static void nextFile(struct Reader *r)
{
    r->which++;
    r->pos = r->len = 0;
    r->fileOff = 0;
    r->eof = 0;
}

static int nextPage(struct Reader *r, struct OggHeader *h, unsigned char **data, uint32_t *size, off_t *dataOff, int *inData)
{
    for (;;) {
        if (r->which >= 3) return 0;
        if (!fill(r, 27)) { nextFile(r); continue; }
        unsigned char *p = r->buf + r->pos;
        if (memcmp(p, "OggS", 4)) { nextFile(r); continue; }
        unsigned nseg = p[26];
        if (!fill(r, 27 + nseg)) { nextFile(r); continue; }
        p = r->buf + r->pos;
        uint32_t sz = 0;
        for (unsigned i = 0; i < nseg; i++) sz += p[27 + i];
        if (!fill(r, 27 + nseg + sz)) { nextFile(r); continue; }
        p = r->buf + r->pos;
        memcpy(h, p + 5, sizeof(*h));
        *data = p + 27 + nseg;
        *size = sz;
        *dataOff = r->fileOff + r->pos + 27 + nseg;
        *inData = r->which == 2;
        r->pos += 27 + nseg + sz;
        return 1;
    }
}

static void writeOgg(FILE *f, struct OggHeader *header, const unsigned char *data, uint32_t size)
{
    unsigned char seqBuf[256];
    uint32_t seqCt = 0, sizeMod, crc;
    seqBuf[seqCt++] = (size+255)/255;
    sizeMod = size;
    while (sizeMod >= 255) { seqBuf[seqCt++] = 255; sizeMod -= 255; }
    seqBuf[seqCt++] = sizeMod;
    header->crc = 0;
    crc = 0xf07159ba;
    crc32(header, sizeof(*header), &crc);
    crc32(seqBuf, seqCt, &crc);
    crc32(data, size, &crc);
    header->crc = crc;
    fwrite("OggS\0", 1, 5, f);
    fwrite(header, 1, sizeof(*header), f);
    fwrite(seqBuf, 1, seqCt, f);
    fwrite(data, 1, size, f);
}

static void preSkip(struct PacketList *packet, double *granulePos)
{
    if (packet && packet->inputGranulePos > *granulePos) {
        packet->preSkip = (packet->inputGranulePos - *granulePos) / packetTime;
        *granulePos += packet->preSkip * packetTime;
    }
}

static void processBlock(struct Track *tr, struct PacketList *begin, struct PacketList *end, struct PacketList *next)
{
    struct PacketList *mid;
    int ct = 0;
    double granulePos = tr->granulePos;
    for (mid = begin; mid != end; mid = mid->next) ct += mid->framesInPacket;
    double expected = granulePos + ct * packetTime;
    double actual = end->inputGranulePos + end->framesInPacket * end->frameSize;
    if (actual < expected && (begin->flags & FLAG_SILENT)) {
        while (actual < expected) {
            if (begin->preSkip) {
                begin->preSkip--;
                expected -= begin->frameSize;
                if (granulePos > begin->frameSize) granulePos -= begin->frameSize;
                else granulePos = 0;
            } else if (begin != end) {
                begin->flags |= FLAG_DROP;
                expected -= begin->framesInPacket * begin->frameSize;
                begin = begin->next;
            } else break;
        }
    }
    for (mid = begin; mid != end->next; mid = mid->next) {
        if (granulePos + packetTime * 25 < mid->inputGranulePos) {
            int64_t diff = mid->inputGranulePos - granulePos;
            mid->preSkip = diff / packetTime;
            granulePos += mid->preSkip * packetTime;
            mid->outputGranulePos = granulePos;
            granulePos += mid->framesInPacket * packetTime;
        } else if (granulePos > mid->inputGranulePos + mid->frameSize * 25) {
            mid->flags |= FLAG_DROP;
        } else {
            mid->outputGranulePos = granulePos;
            granulePos += mid->framesInPacket * mid->frameSize;
        }
    }
    preSkip(next, &granulePos);
    tr->granulePos = granulePos;
}

static void writeZeroPacket(struct Track *tr, struct OggHeader *h)
{
    switch (tr->flacRate) {
        case 0: writeOgg(tr->out, h, zeroPacket, sizeof(zeroPacket)); break;
        case 44100: writeOgg(tr->out, h, zeroPacketFLAC44k, sizeof(zeroPacketFLAC44k)); break;
        default: writeOgg(tr->out, h, zeroPacketFLAC48k, sizeof(zeroPacketFLAC48k));
    }
}

static void writeGaps(struct Track *tr, int t, struct PacketList *cur)
{
    struct OggHeader gap = {0};
    uint32_t time = (tr->flacRate == 44100) ? (packetTime * 147 / 160) : packetTime;
    gap.granulePos = cur->outputGranulePos - time * cur->preSkip;
    gap.streamNo = t;
    for (int i = 0; i < cur->preSkip; i++) {
        gap.sequenceNo = tr->lastSequenceNo++;
        writeZeroPacket(tr, &gap);
        gap.granulePos += time;
    }
}

/* Process, write and free the open block. */
static void closeBlock(struct Track *tr, int t, struct PacketList *next)
{
    struct PacketList *begin = tr->blkHead, *end = tr->blkTail, *cur, *nx;
    begin->flags |= FLAG_BEGIN;
    end->flags |= FLAG_END;
    end->next = NULL;
    processBlock(tr, begin, end, next);
    for (cur = begin; cur; cur = nx) {
        nx = cur->next;
        if (tr->flacRate == 44100) cur->outputGranulePos = cur->outputGranulePos * 147 / 160;
        if (cur->preSkip) writeGaps(tr, t, cur);
        if (!(cur->flags & FLAG_DROP)) {
            if (cur->size > payCap) {
                payCap = cur->size * 2;
                if (!(payBuf = realloc(payBuf, payCap))) { perror("realloc"); exit(1); }
            }
            if (pread(dataFd, payBuf, cur->size, cur->offset) != (ssize_t) cur->size) { perror("pread"); exit(1); }
            struct OggHeader hh = cur->hdr;
            hh.granulePos = cur->outputGranulePos;
            hh.sequenceNo = tr->lastSequenceNo++;
            writeOgg(tr->out, &hh, payBuf, cur->size);
        }
        freePacket(cur);
    }
    tr->blkHead = tr->blkTail = NULL;
}

/* First loop of oggcorrect, incrementally: does p continue the open block? */
static void addPacket(struct Track *tr, int t, struct PacketList *p)
{
    if (!tr->started) {
        tr->started = 1;
        preSkip(p, &tr->granulePos);
        tr->blkHead = tr->blkTail = p;
        tr->mode = MODE_NORMAL;
        return;
    }
    struct PacketList *last = tr->blkTail;
    int extends;
    if (tr->mode == MODE_NORMAL)
        extends = !(p->flags & FLAG_SILENT) && !(p->inputGranulePos > last->inputGranulePos + packetTime * 25);
    else
        extends = (p->flags & FLAG_SILENT) != 0;
    if (extends) {
        last->next = p;
        tr->blkTail = p;
        return;
    }
    int nextMode = (tr->mode == MODE_NORMAL && (p->flags & FLAG_SILENT)) ? MODE_SILENT : MODE_NORMAL;
    closeBlock(tr, t, p);
    tr->blkHead = tr->blkTail = p;
    tr->mode = nextMode;
}

static int opusFrameSize(unsigned char toc)
{
    switch (toc >> 3) {
        case 0: case 4: case 8: case 12: case 14: case 18: case 22: case 26: case 30: return 480;
        case 2: case 6: case 10: return 1920;
        case 3: case 7: case 11: return 2880;
        case 17: case 21: case 25: case 29: return 240;
        case 16: case 20: case 24: case 28: return 120;
        default: return 960;
    }
}

/* oggduration semantics: the highest granule of any non-empty page in .data */
static void noteGranule(const struct OggHeader *h, uint32_t packetSize, int inData)
{
    if (inData && packetSize > 0 && h->streamNo < MAX_TRACKS && h->granulePos > tracks[h->streamNo].lastGranule)
        tracks[h->streamNo].lastGranule = h->granulePos;
}

int main(int argc, char **argv)
{
    if (argc < 3) { fprintf(stderr, "Use: oggsplit <recFileBase> <outPrefix> [track...]\n"); return 1; }
    char path[4096];
    struct Reader rd = {0};
    const char *ext[3] = { "header1", "header2", "data" };
    for (int i = 0; i < 3; i++) {
        snprintf(path, sizeof(path), "%s.%s", argv[1], ext[i]);
        if ((rd.fds[i] = open(path, O_RDONLY)) < 0) { perror(path); return 1; }
        posix_fadvise(rd.fds[i], 0, 0, POSIX_FADV_SEQUENTIAL);
    }
    dataFd = rd.fds[2];
    if (!(rd.buf = malloc(RBUF))) { perror("malloc"); return 1; }
    int anyWanted = argc > 3;
    for (int i = 3; i < argc; i++) {
        char *end;
        long t = strtol(argv[i], &end, 10);
        if (*end || t <= 0 || t >= MAX_TRACKS) {
            fprintf(stderr, "oggsplit: invalid track \"%s\" (must be 1-%d)\n", argv[i], MAX_TRACKS - 1);
            return 1;
        }
        tracks[t].wanted = 1;
    }

    struct OggHeader h;
    unsigned char *buf;
    uint32_t packetSize;
    off_t off;
    int inData, have;
    int foundMeta = 0;
    uint32_t metaStreamNo = 0;
    uint64_t granuleOffset = 0, pauseTime = 0;

    /* Header section (same rules as oggcorrect's first loop, every track at once) */
    while ((have = nextPage(&rd, &h, &buf, &packetSize, &off, &inData))) {
        if (h.granulePos != 0) { granuleOffset = h.granulePos; break; }
        if (!foundMeta && packetSize >= 8 && !memcmp(buf, "ECMETA", 6)) { foundMeta = 1; metaStreamNo = h.streamNo; }
        if (h.streamNo >= MAX_TRACKS) continue;
        struct Track *tr = &tracks[h.streamNo];
        uint32_t skip = 0;
        if (packetSize > 8 && !memcmp(buf, "ECVADD", 6)) {
            skip = 8 + (buf[6] | (buf[7] << 8));
            if (skip > packetSize) { badVadHeaders++; continue; }
            if (packetSize > 10) tr->vadLevel = buf[10];
        }
        /* oggcorrect passes every granule-0 page of the track through, VAD prefix stripped */
        if (tr->nHdr < MAX_HEADER_PAGES) {
            tr->hdrH[tr->nHdr] = h;
            tr->hdrS[tr->nHdr] = packetSize - skip;
            if (!(tr->hdrD[tr->nHdr] = malloc(packetSize - skip + 1))) { perror("malloc"); return 1; }
            memcpy(tr->hdrD[tr->nHdr], buf + skip, packetSize - skip);
            tr->nHdr++;
        } else extraHeaders++;
        if (packetSize < (skip+5) ||
            (memcmp(buf + skip, "Opus", 4) && memcmp(buf + skip, "\x7f""FLAC", 5) && memcmp(buf + skip, "\x04\0\0\x41", 4)))
            continue;
        tr->used = 1;
        if (packetSize > skip + 29 && !memcmp(buf + skip, "\x7f""FLAC", 5))
            tr->flacRate = ((uint32_t) buf[skip+27] << 12) + ((uint32_t) buf[skip+28] << 4) + ((uint32_t) buf[skip+29] >> 4);
    }

    /* Open outputs and pass the headers through. A requested track gets a file
     * even without an audio header, as `oggcorrect N` still produces output. */
    for (int t = 1; t < MAX_TRACKS; t++) {
        struct Track *tr = &tracks[t];
        if (anyWanted ? !tr->wanted : !tr->used) continue;
        snprintf(path, sizeof(path), "%s%d.ogg", argv[2], t);
        if (!(tr->out = fopen(path, "wb"))) { perror(path); return 1; }
        setvbuf(tr->out, NULL, _IOFBF, 1 << 16);
        for (int i = 0; i < tr->nHdr; i++) {
            struct OggHeader hh = tr->hdrH[i];
            hh.sequenceNo = tr->lastSequenceNo++;
            writeOgg(tr->out, &hh, tr->hdrD[i], tr->hdrS[i]);
        }
    }

    /* Data section: one pass, each track keeps only its open block */
    if (have) do {
        noteGranule(&h, packetSize, inData);
        if (h.granulePos == 0 && packetSize > 1) break;
        if (foundMeta && h.streamNo == metaStreamNo) {
            if (!strncmp((char *) buf, "{\"c\":\"pause\"}", packetSize)) pauseTime = h.granulePos;
            else if (!strncmp((char *) buf, "{\"c\":\"resume\"}", packetSize)) granuleOffset += h.granulePos - pauseTime;
        }
        if (h.streamNo >= MAX_TRACKS) continue;
        struct Track *tr = &tracks[h.streamNo];
        if (packetSize <= 1 || !tr->out) continue;
        if (!inData) { strayPackets++; continue; }
        unsigned skip = tr->vadLevel ? 1 : 0;
        struct PacketList *p = newPacket();
        p->inputGranulePos = (h.granulePos > granuleOffset) ? h.granulePos - granuleOffset : 0;
        p->hdr = h; p->offset = off + skip; p->size = packetSize - skip;
        p->frameSize = 960;
        if (!tr->flacRate) {
            p->framesInPacket = buf[skip] & 0x3;
            switch (p->framesInPacket) {
                case 0: p->framesInPacket = 1; break;
                case 1: case 2: p->framesInPacket = 2; break;
                case 3:
                    if (packetSize > skip + 1) p->framesInPacket = buf[skip+1] & 0x3F;
                    else { p->framesInPacket = 1; shortPackets++; }
                    break;
                default: p->framesInPacket = 1;
            }
            p->frameSize = opusFrameSize(buf[skip]);
        } else {
            p->framesInPacket = 1;
            p->frameSize = 960;
        }
        if (tr->vadLevel) { if (buf[0] < tr->vadLevel) p->flags |= FLAG_SILENT; }
        else if (packetSize < (tr->flacRate ? 16 : 8)) p->flags |= FLAG_SILENT;
        addPacket(tr, h.streamNo, p);
    } while (nextPage(&rd, &h, &buf, &packetSize, &off, &inData));

    /* oggduration reads all of .data, also past an in-band header page */
    while (nextPage(&rd, &h, &buf, &packetSize, &off, &inData)) noteGranule(&h, packetSize, inData);

    /* Flush the last block of every track */
    for (int t = 1; t < MAX_TRACKS; t++) {
        struct Track *tr = &tracks[t];
        if (!tr->out) continue;
        if (tr->blkHead) closeBlock(tr, t, NULL);
        if (tr->lastSequenceNo <= 2) {
            /* oggcorrect: "This track had no actual audio. To avoid breakage, throw some on." */
            struct OggHeader hh = {0};
            hh.streamNo = t;
            hh.sequenceNo = tr->lastSequenceNo++;
            writeZeroPacket(tr, &hh);
        }
        if (fclose(tr->out)) { perror("fclose"); return 1; }
        printf("%d %f\n", t, ((double) tr->lastGranule) / 48000.0 + 2);
    }
    if (badVadHeaders || shortPackets || strayPackets || extraHeaders)
        fprintf(stderr, "oggsplit: warning: %ld bad VAD headers, %ld short code-3 packets, %ld audio pages outside .data, %ld extra header pages\n",
                badVadHeaders, shortPackets, strayPackets, extraHeaders);
    return 0;
}
