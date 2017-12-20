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

/* NOTE: We don't use libogg here because the behavior if this program is so
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

// The encoding for a packet with only zeroes
const unsigned char zeroPacket[] = { 0xF8, 0xFF, 0xFE };
const uint32_t zeroPacketCRC = 0xD8881845;
const uint32_t packetTime = 960;

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
    uint32_t keepStreamNo;
    uint64_t lastGranulePos = 0;
    uint64_t trueGranulePos = 0;
    uint32_t lastSequenceNo = 0;
    uint32_t packetSize;
    unsigned char segmentCount, segmentVal;
    unsigned char *buf = NULL;
    uint32_t bufSz = 0;
    struct OggPreHeader preHeader;
    unsigned char correctTimestamps = 0;

    if (argc != 2) {
        fprintf(stderr, "Use: oggstender <track no>\n");
        exit(1);
    }
    keepStreamNo = atoi(argv[1]);

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

        // Do we care?
        if (oggHeader.streamNo != keepStreamNo)
            continue;

        // Is this badly-timed data?
        if (oggHeader.granulePos == 0 && packetSize > 4 && memcmp(buf, "Opus", 4))
            continue;

        // Account for gaps
        if (oggHeader.granulePos > trueGranulePos + packetTime * 5) {
            // We are behind
            if (oggHeader.granulePos > lastGranulePos + packetTime * 5) {
                // There was a real gap, fill it
                uint64_t gapTime = oggHeader.granulePos - trueGranulePos;
                while (gapTime >= packetTime) {
                    struct OggHeader gapHeader;
                    gapHeader.type = 0;
                    gapHeader.granulePos = trueGranulePos;
                    gapHeader.streamNo = keepStreamNo;
                    gapHeader.sequenceNo = lastSequenceNo++;
                    gapHeader.crc = zeroPacketCRC;
                    writeOgg(&gapHeader, zeroPacket, sizeof(zeroPacket));
                    trueGranulePos += packetTime;
                    gapTime -= packetTime;
                }
                correctTimestamps = 0;

            } else {
                // No real gap, just adjust timestamps a bit and fix the audio in post
                correctTimestamps = 1;

            }
        }

        // Fix timestamps
        if (correctTimestamps) {
            if (oggHeader.granulePos <= trueGranulePos + packetTime * 5) {
                // We've adjusted enough
                correctTimestamps = 0;

            } else {
                // Jump a bit
                trueGranulePos += packetTime / 10;

            }
        }

        // Now fix up our own granule positions
        lastGranulePos = oggHeader.granulePos;
        oggHeader.granulePos = trueGranulePos;
        trueGranulePos += packetTime;

        // Then insert the current packet
        oggHeader.sequenceNo = lastSequenceNo++;
        writeOgg(&oggHeader, buf, packetSize);
    }

    return 0;
}
