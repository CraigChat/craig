/*
 * Copyright (c) 2019 Yahweasel
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <unistd.h>

/* NOTE: We don't use libogg here because the behavior of this program is so
 * trivial, the added memory bandwidth of using it is just a waste of energy */

/* NOTE: This program assumes little-endian for speed, it WILL NOT WORK on a
 * big-endian system */

static unsigned char outTrackNum = 0;

struct OggPreHeader {
    unsigned char capturePattern[4];
    unsigned char version;
} __attribute__((packed));

struct OggHeader {
    unsigned char type;
    uint64_t granulePos;
    uint32_t streamNo;
    uint32_t sequenceNo;
    uint32_t crc;
} __attribute__((packed));

static ssize_t readAll(int fd, void *vbuf, size_t count)
{
    unsigned char *buf = (unsigned char *) vbuf;
    ssize_t rd = 0, ret;
    while (rd < count) {
        ret = read(fd, buf + rd, count - rd);
        if (ret <= 0) return ret;
        rd += ret;
    }
    return rd;
}

static void out(struct OggHeader *header, int **alreadyPrinted, int *apSz, const char *type)
{
    if (*apSz <= header->streamNo) {
        int i, oldSz = *apSz;
        *apSz = header->streamNo + 1;
        *alreadyPrinted = realloc(*alreadyPrinted, sizeof(int) * (*apSz));
        if (!*alreadyPrinted) {
            perror("realloc");
            exit(1);
        }
        for (i = oldSz; i < *apSz; i++)
            (*alreadyPrinted)[i] = 0;
    }

    if ((*alreadyPrinted)[header->streamNo])
        return;
    (*alreadyPrinted)[header->streamNo] = 1;

    if (outTrackNum)
        printf("%d\n", header->streamNo);
    else
        printf("%s\n", type);
}

int main(int argc, char **argv)
{
    uint32_t packetSize;
    uint32_t skip;
    unsigned char segmentCount, segmentVal;
    unsigned char *buf = NULL;
    uint32_t bufSz = 0;
    struct OggPreHeader preHeader;
    int *alreadyPrinted = NULL;
    int apSz = 0;

    if (argc > 1 && !strcmp(argv[1], "-n"))
        outTrackNum = 1;

    while (readAll(0, &preHeader, sizeof(preHeader)) == sizeof(preHeader)) {
        struct OggHeader oggHeader;
        if (memcmp(preHeader.capturePattern, "OggS", 4))
            break;

        // It's an ogg header, get the header data
        if (readAll(0, &oggHeader, sizeof(oggHeader)) != sizeof(oggHeader))
            break;

        // Get the data size
        packetSize = 0;
        if (readAll(0, &segmentCount, 1) != 1)
            break;
        for (; segmentCount; segmentCount--) {
            if (readAll(0, &segmentVal, 1) != 1)
                break;
            packetSize += (uint32_t) segmentVal;
        }

        // Get the data
        if (packetSize > bufSz) {
            buf = realloc(buf, packetSize);
            if (!buf)
                break;
            bufSz = packetSize;
        }
        if (readAll(0, buf, packetSize) != packetSize)
            break;

        // Is it VAD data?
        skip = 0;
        if (packetSize > 8 && !memcmp(buf, "ECVADD", 6))
            skip = 8 + *((unsigned short *) (buf+6));
        if (packetSize < skip + 5)
            continue;

        // Is it a header?
        if (!memcmp(buf + skip, "Opus", 4))
            out(&oggHeader, &alreadyPrinted, &apSz, "opus");
        else if (!memcmp(buf + skip, "\x7f""FLAC", 5))
            out(&oggHeader, &alreadyPrinted, &apSz, "flac");
    }

    return 0;
}
