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

void printNote(unsigned char *buf, uint32_t packetSize)
{
    int i;
    for (i = 4; i < packetSize; i++) {
        switch (buf[i]) {
            case '"':
            case '\\':
                printf("\\%c", buf[i]);
                break;

            case '\n':
                printf("\\n");
                break;

            case '\r':
                printf("\\r");
                break;

            default:
                putchar(buf[i]);
        }
    }
}

int main(int argc, char **argv)
{
    uint32_t noteStreamNo = (uint32_t) -1;
    uint32_t packetSize;
    unsigned char segmentCount, segmentVal;
    unsigned char *buf = NULL;
    uint32_t bufSz = 0;
    struct OggPreHeader preHeader;
    unsigned char outputAudacity = 0, outputHeader = 0;
    int ai;

    for (ai = 1; ai < argc; ai++) {
        char *arg = argv[ai];
        if (!strcmp(arg, "-f") || !strcmp(arg, "--format")) {
            arg = argv[++ai];
            if (arg && !strcmp(arg, "audacity"))
                outputAudacity = 1;
        } else {
            fprintf(stderr, "Use: extnotes [--format audacity|-f audacity]\n");
            exit(1);
        }
    }

    while (readAll(0, &preHeader, sizeof(preHeader)) == sizeof(preHeader)) {
        struct OggHeader oggHeader;
        double time;
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

        // Check for headers
        if (oggHeader.granulePos == 0 && packetSize == 10 && !memcmp(buf, "STREAMNOTE", 10))
            noteStreamNo = oggHeader.streamNo;
        else if (noteStreamNo == (uint32_t) -1 && oggHeader.granulePos > 0)
            break;

        // Do we care?
        if (oggHeader.streamNo != noteStreamNo)
            continue;

        // Is this actually a note?
        if (packetSize < 4 || memcmp(buf, "NOTE", 4))
            continue;

        time = oggHeader.granulePos / 48000.0;

        // Now output this line
        if (outputAudacity) {
            if (!outputHeader) {
                // Header first
                printf("\t<labeltrack name=\"Label Track\" height=\"73\" minimized=\"0\">\n");
                outputHeader = 1;
            }

            // Output this note
            printf("\t\t<label t=\"%f\" t1=\"%f\" title=\"", time, time);
            printNote(buf, packetSize);
            printf("\"/>\n");

        } else {
            int h, m;
            if (!outputHeader) {
                printf("Notes:\r\n");
                outputHeader = 1;
            }
            h = time / 3600.0;
            time -= h * 3600;
            m = time / 60.0;
            time -= m * 60;
            printf("\t%d:%02d:%02d: ", h, m, (int) time);
            printNote(buf, packetSize); 
            printf("\r\n");

        }
    }

    if (outputAudacity && outputHeader)
        printf("\t</labeltrack>\n");

    return 0;
}
