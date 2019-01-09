/*
 * Copyright (c) 2017 Yahweasel
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

ssize_t readAll(int fd, void *vbuf, size_t count)
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

int main(int argc, char **argv)
{
    int32_t streamNo = -1;
    uint64_t lastGranulePos = 0;
    uint32_t packetSize;
    unsigned char segmentCount, segmentVal;
    unsigned char buf[1024];
    const uint32_t bufSz = 1024;
    struct OggPreHeader preHeader;

    if (argc >= 2)
        streamNo = atoi(argv[1]);

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

        // If it's zero-size, skip it entirely (timestamp reference)
        if (packetSize == 0)
            continue;

        // Skip the data
        while (packetSize > bufSz) {
            if (readAll(0, buf, bufSz) != bufSz)
                break;
            packetSize -= bufSz;
        }
        if (readAll(0, buf, packetSize) != packetSize)
            break;

        if (streamNo >= 0 && oggHeader.streamNo != streamNo)
            continue;

        if (oggHeader.granulePos > lastGranulePos)
            lastGranulePos = oggHeader.granulePos;
    }

    printf("%f\n", ((double) lastGranulePos)/48000.0+2);

    return 0;
}
