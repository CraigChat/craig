/*
 * Copyright (c) 2018 Yahweasel
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

#include <fcntl.h>
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

void writeOgg(struct OggHeader *header, const unsigned char *data, uint32_t size)
{
    unsigned char sequencePart;
    uint32_t sizeMod;

    if (write(1, "OggS\0", 5) != 5 ||
        write(1, header, sizeof(*header)) != sizeof(*header))
        exit(1);

    // Write out the sequence info
    sequencePart = (size+254)/255;
    if (write(1, &sequencePart, 1) != 1) exit(1);
    sequencePart = 255;
    sizeMod = size;
    while (sizeMod > 255) {
        if (write(1, &sequencePart, 1) != 1) exit(1);
        sizeMod -= 255;
    }
    sequencePart = sizeMod;
    if (write(1, &sequencePart, 1) != 1) exit(1);

    // Then write the data
    if (write(1, data, size) != size) exit(1);
}

int main(int argc, char **argv)
{
    uint32_t packetSize;
    uint64_t pos;
    unsigned char segmentCount, segmentVal;
    unsigned char *buf = NULL;
    uint32_t bufSz = 0;
    struct OggPreHeader preHeader;

    int files, fi;
    int *infiles;
    struct OggHeader *headers;
    int *alive;
    int *used;

    if (argc < 2) {
        fprintf(stderr, "Use: oggmultiplexer <tracks>\n");
        exit(1);
    }
    files = argc - 1;

    // Allocate
#define ALLOC(into, sz) do { \
    (into) = malloc(sz); \
    if (!(into)) { \
        perror("malloc"); \
        return 1; \
    } \
} while(0)
    ALLOC(infiles, sizeof(FILE*)*files);
    ALLOC(headers, sizeof(struct OggHeader)*files);
    ALLOC(alive, sizeof(int)*files);
    ALLOC(used, sizeof(int)*files);
#undef ALLOC

    // Open all the input files
    for (fi = 0; fi < files; fi++) {
        infiles[fi] = open(argv[fi+1], O_RDONLY);
        if (infiles[fi] == -1) {
            perror(argv[fi+1]);
            exit(1);
        }
        alive[fi] = 1;
        used[fi] = 1;
    }

    while (1) {
        for (fi = 0; fi < files; fi++) {
            if (!used[fi] || !alive[fi])
                continue;
            if (readAll(infiles[fi], &preHeader, sizeof(preHeader)) != sizeof(preHeader)) {
                alive[fi] = 0;
                continue;
            }
            if (memcmp(preHeader.capturePattern, "OggS", 4)) {
                alive[fi] = 0;
                continue;
            }

            // OK, it's a valid ogg packet. Try to read the header.
            if (readAll(infiles[fi], &headers[fi], sizeof(struct OggHeader)) != sizeof(struct OggHeader)) {
                alive[fi] = 0;
                continue;
            }
            used[fi] = 0;
        }

        // Now figure out the current timestamp
        pos = -1;
        for (fi = 0; fi < files; fi++) {
            if (!used[fi] && headers[fi].granulePos < pos)
                pos = headers[fi].granulePos;
        }
        if (pos == -1)
            break;

        // And output each packet at that timestamp
        for (fi = 0; fi < files; fi++) {
            if (used[fi] || headers[fi].granulePos > pos)
                continue;

            // Get the data size
            packetSize = 0;
            if (readAll(infiles[fi], &segmentCount, 1) != 1)
                goto bad;
            for (; segmentCount; segmentCount--) {
                if (readAll(infiles[fi], &segmentVal, 1) != 1)
                    goto bad;
                packetSize += (uint32_t) segmentVal;
            }

            // Get the data
            if (packetSize > bufSz) {
                buf = realloc(buf, packetSize);
                if (!buf)
                    break;
                bufSz = packetSize;
            }
            if (readAll(infiles[fi], buf, packetSize) != packetSize)
                goto bad;

            // And output it
            writeOgg(&headers[fi], buf, packetSize);
            used[fi] = 1;
            continue;

bad:
            alive[fi] = 0;
            used[fi] = 1;
        }
        if (!buf)
            break;
    }

    return 0;
}
