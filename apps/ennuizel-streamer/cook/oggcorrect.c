/*
 * Copyright (c) 2017-2021 Yahweasel
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

#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <sys/select.h>
#include <unistd.h>

#include "crc32.h"

/* NOTE: We don't use libogg here because the behavior of this program is so
 * trivial, the added memory bandwidth of using it is just a waste of energy */

/* NOTE: This program assumes little-endian for speed. It WILL NOT WORK on a
 * big-endian system. */

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

#define FLAG_BEGIN      1
#define FLAG_END        2
#define FLAG_SILENT     4
#define FLAG_DROP       8

struct PacketList {
    struct PacketList *next;
    int flags;
    int framesInPacket; // Number of audio frames in this packet
    int frameSize; // Size of frame
    int preSkip; // Number of frames to insert before this
    uint64_t inputGranulePos;
    uint64_t outputGranulePos;
};

// The encoding for a packet with only zeroes
const unsigned char zeroPacket[] = { 0xF8, 0xFF, 0xFE };
const uint32_t packetTime = 960;

// The encoding for a FLAC packet with only zeroes, 48k
const unsigned char zeroPacketFLAC48k[] = { 0xFF, 0xF8, 0x7A, 0x0C, 0x00, 0x03,
    0xBF, 0x94, 0x00, 0x00, 0x00, 0x00, 0xB1, 0xCA };

// The encoding for a FLAC packet with only zeroes, 44.1k
const unsigned char zeroPacketFLAC44k[] = { 0xFF, 0xF8, 0x79, 0x0C, 0x00, 0x03,
    0x71, 0x56, 0x00, 0x00, 0x00, 0x00, 0x63, 0xC5 };

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

// Read an Ogg packet
int readOgg(struct OggPreHeader *preHeader,
            struct OggHeader *oggHeader,
            unsigned char **buf,
            uint32_t *bufSz,
            uint32_t *packetSize)
{
    unsigned char segmentCount, segmentVal;

    // Check the pre-header
    if (readAll(0, preHeader, sizeof(*preHeader)) != sizeof(*preHeader))
        return 0;
    if (memcmp(preHeader->capturePattern, "OggS", 4))
        return 0;

    // It's an ogg header, get the header data
    if (readAll(0, oggHeader, sizeof(*oggHeader)) != sizeof(*oggHeader))
        return 0;

    // Get the data size
    *packetSize = 0;
    if (readAll(0, &segmentCount, 1) != 1)
        return 0;
    for (; segmentCount; segmentCount--) {
        if (readAll(0, &segmentVal, 1) != 1)
            return 0;
        *packetSize += (uint32_t) segmentVal;
    }

    // Get the data
    if (*packetSize > *bufSz) {
        *buf = realloc(*buf, *packetSize);
        if (!*buf)
            return 0;
        *bufSz = *packetSize;
    }
    if (readAll(0, *buf, *packetSize) != *packetSize)
        return 0;

    return 1;
}

ssize_t writeAll(int fd, const void *vbuf, size_t count)
{
    const unsigned char *buf = (const unsigned char *) vbuf;
    ssize_t wt = 0, ret;
    while (wt < count) {
        ret = write(fd, buf + wt, count - wt);

        if (ret <= 0) {
            if (ret < 0 && errno == EAGAIN) {
                // Wait 'til we can write again
                fd_set wfds;
                FD_ZERO(&wfds);
                FD_SET(fd, &wfds);
                select(fd + 1, NULL, &wfds, NULL, NULL);
                continue;
            }

            perror("write");
            return ret;
        }
        wt += ret;
    }
    return wt;
}

void writeOgg(struct OggHeader *header, const unsigned char *data, uint32_t size)
{
    static unsigned char seqBuf[256];
    uint32_t seqCt = 0;
    uint32_t sizeMod;
    uint32_t crc;

    // Calculate the sequence info
    seqBuf[seqCt++] = (size+255)/255;
    sizeMod = size;
    while (sizeMod >= 255) {
        seqBuf[seqCt++] = 255;
        sizeMod -= 255;
    }
    seqBuf[seqCt++] = sizeMod;

    // Calculate the CRC
    header->crc = 0;
    crc = 0xf07159ba; // crc32("OggS\0", 5, &crc);
    crc32(header, sizeof(*header), &crc);
    crc32(seqBuf, seqCt, &crc);
    crc32(data, size, &crc);
    header->crc = crc;

    // Write the header
    if (writeAll(1, "OggS\0", 5) != 5 ||
        writeAll(1, header, sizeof(*header)) != sizeof(*header))
        exit(1);

    // Write the sequence info
    if (writeAll(1, seqBuf, seqCt) != seqCt) exit(1);

    // Then write the data
    if (writeAll(1, data, size) != size) exit(1);
}

struct PacketList *pushPacket(struct PacketList *tail)
{
    struct PacketList *ret = calloc(1, sizeof(struct PacketList));
    if (ret == NULL) {
        perror("calloc");
        exit(1);
    }
    tail->next = ret;
    return ret;
}

void preSkip(struct PacketList *packet, double *granulePos)
{
    if (packet && packet->inputGranulePos > *granulePos) {
        packet->preSkip = (packet->inputGranulePos - *granulePos) / packetTime;
        *granulePos += packet->preSkip * packetTime;
    }
}

int main(int argc, char **argv)
{
    // Which stream are we keeping?
    uint32_t keepStreamNo;

    // Meta track info (used for pauses)
    int foundMeta = 0;
    uint32_t metaStreamNo = 0;

    // What should we be subtracting from our granule position?
    uint64_t granuleOffset = 0;

    // When did we last pause?
    uint64_t pauseTime = 0;

    // What was the sequence number of the last packet we wrote?
    uint32_t lastSequenceNo = 0;

    // Size of our packet and how many bytes to skip
    uint32_t packetSize, skip;

    // Working granule position
    double granulePos;

    // Our list of packets
    struct PacketList head = {0};
    struct PacketList *cur, *tail = &head;

    // Buffer info
    unsigned char *buf = NULL;
    uint32_t bufSz = 0;

    // Header
    struct OggPreHeader preHeader;
    struct OggHeader oggHeader;

    // VAD info if applicable
    unsigned char vadLevel = 0;

    // Sample rate if we're doing FLAC
    uint32_t flacRate = 0;

    if (argc != 2) {
        fprintf(stderr, "Use: oggcorrect <track no>\n");
        exit(1);
    }
    keepStreamNo = atoi(argv[1]);

    // First look for the header info
    while (readOgg(&preHeader, &oggHeader, &buf, &bufSz, &packetSize)) {
        if (oggHeader.granulePos != 0) {
            // Not a header
            granuleOffset = oggHeader.granulePos;
            break;
        }

        // Look for a meta track
        if (!foundMeta && packetSize >= 8 && !memcmp(buf, "ECMETA", 6)) {
            foundMeta = 1;
            metaStreamNo = oggHeader.streamNo;
        }

        if (oggHeader.streamNo != keepStreamNo)
            continue;

        skip = 0;
        if (packetSize > 8 && !memcmp(buf, "ECVADD", 6)) {
            // It's our VAD header. Get our VAD info and skip
            skip = 8 + *((unsigned short *) (buf + 6));
            if (packetSize > 10)
                vadLevel = buf[10];
        }

        if (packetSize < (skip+5) ||
            (memcmp(buf + skip, "Opus", 4) &&
             memcmp(buf + skip, "\x7f""FLAC", 5) &&
             memcmp(buf + skip, "\x04\0\0\x41", 4))) {
            // This isn't an expected header!
            continue;
        }

        // Check if this is a FLAC header
        if (packetSize > skip + 29 && !memcmp(buf + skip, "\x7f""FLAC", 5)) {
            // Get our sample rate
            flacRate = ((uint32_t) buf[skip+27] << 12) + ((uint32_t) buf[skip+28] << 4) + ((uint32_t) buf[skip+29] >> 4);
        }
    }

    skip = vadLevel ? 1 : 0;

    // Now get the actual packet info
    do {
        if (oggHeader.granulePos == 0 && packetSize > 1) {
            // We've come back to the header, so break out
            break;
        }

        // Check for pauses and adjust
        if (foundMeta && oggHeader.streamNo == metaStreamNo) {
            if (!strncmp((char *) buf, "{\"c\":\"pause\"}", packetSize)) {
                // Start of pause
                pauseTime = oggHeader.granulePos;
            } else if (!strncmp((char *) buf, "{\"c\":\"resume\"}", packetSize)) {
                // End of pause
                granuleOffset += oggHeader.granulePos - pauseTime;
            }
        }

        if (oggHeader.streamNo != keepStreamNo || packetSize <= 1)
            continue;

        // Add it to the list
        tail = pushPacket(tail);
        tail->inputGranulePos = (oggHeader.granulePos > granuleOffset) ? oggHeader.granulePos - granuleOffset : 0;

        // Figure out how many frames are in this packet
        tail->frameSize = 960;
        if (!flacRate) {
            // Update frame in packet
            tail->framesInPacket = buf[skip] & 0x3;
            switch (tail->framesInPacket) {
                case 0:
                    tail->framesInPacket = 1;
                    break;

                case 1:
                case 2:
                    tail->framesInPacket = 2;
                    break;

                case 3: // Signaled
                    tail->framesInPacket = buf[skip+1] & 0x3F;
                    break;

                default:
                    tail->framesInPacket = 1;
            }

            // Plot out each frame time and set it
            // https://datatracker.ietf.org/doc/html/rfc6716#section-3.1
            tail->frameSize = 960;
            // fprintf(stderr, "lol %d\n", buf[skip]);
            switch (buf[skip] >> 3) {
                case 0:
                case 4:
                case 8:
                case 12:
                case 14:
                case 18:
                case 22:
                case 26:
                case 30:
                    tail->frameSize = 480; // 10ms
                    break;
                case 2:
                case 6:
                case 10:
                    tail->frameSize = 1920; // 40ms
                    break;
                case 3:
                case 7:
                case 11:
                    tail->frameSize = 2880; // 60ms
                    break;
                case 17:
                case 21:
                case 25:
                case 29:
                    tail->frameSize = 240; // 5ms
                    break;
                case 16:
                case 20:
                case 24:
                case 28:
                    tail->frameSize = 120; // 2.5ms
                    break;
                default:
                    tail->frameSize = 960; // 20ms
                    break;
            }
        } else {
            tail->framesInPacket = 1;
            tail->frameSize = 960;
        }

        // Check if it's silent
        if (vadLevel) {
            if (buf[0] < vadLevel) {
                // Silent
                tail->flags |= FLAG_SILENT;
            }
        } else {
            // Silly detection
            if (packetSize < (flacRate?16:8))
                tail->flags |= FLAG_SILENT;
        }

    } while (readOgg(&preHeader, &oggHeader, &buf, &bufSz, &packetSize));

    // Now, find ranges of audio that ought to be continuous
    for (cur = head.next; cur; cur = cur->next) {
        cur->flags |= FLAG_BEGIN;

        // Look for a gap or silence to end this block
        for (; cur->next; cur = cur->next) {
            if (cur->next->flags & FLAG_SILENT) {
                // Gap of silence
                break;
            } else if (cur->next->inputGranulePos > cur->inputGranulePos + packetTime * 25) {
                // Significant gap in timestamps
                break;
            }
        }
        cur->flags |= FLAG_END;

        // If this is silence, make a silent block
        if (cur->next && cur->next->flags & FLAG_SILENT) {
            cur = cur->next;
            cur->flags |= FLAG_BEGIN;
            for (; cur->next; cur = cur->next) {
                if (!(cur->next->flags & FLAG_SILENT))
                    break;
            }
            cur->flags |= FLAG_END;
        }
    }

    // Adjust timestamps for the blocks
    cur = head.next;
    granulePos = 0;
    preSkip(cur, &granulePos);
    for (; cur; cur = cur->next) {
        struct PacketList *begin, *end, *mid;
        int ct;

        // We should be at the beginning of a block. Find the end
        begin = cur;
        ct = 0;
        for (end = begin; end; end = end->next) {
            if (end->flags & FLAG_END)
                break;
            ct += end->framesInPacket;
        }
        if (!end)
            break;

        // Check the difference between the expected range and the actual range
        double expected = granulePos + ct * packetTime;
        double actual = end->inputGranulePos + end->framesInPacket * end->frameSize;
        if (actual < expected && (begin->flags & FLAG_SILENT)) {
            // Cut out silence from the beginning
            while (actual < expected) {
                if (begin->preSkip) {
                    begin->preSkip--;
                    expected -= begin->frameSize;
                    if (granulePos > begin->frameSize)
                        granulePos -= begin->frameSize;
                    else
                        granulePos = 0;
                } else if (begin != end) {
                    begin->flags |= FLAG_DROP;
                    expected -= begin->framesInPacket * begin->frameSize;
                    begin = begin->next;
                } else break;
            }
        }

        // Set the output granule positions
        for (mid = begin; mid != end->next; mid = mid->next) {
            if (granulePos + packetTime * 25 <
                mid->inputGranulePos) {
                // Too little data, add a gap
                int64_t diff = mid->inputGranulePos - granulePos;
                mid->preSkip = diff / packetTime;
                granulePos += mid->preSkip * packetTime;
                mid->outputGranulePos = granulePos;
                granulePos += mid->framesInPacket * packetTime;

            } else if (granulePos >
                mid->inputGranulePos + mid->frameSize * 25) {
                // Too much data, drop a packet
                mid->flags |= FLAG_DROP;

            } else {
                // Just right!
                mid->outputGranulePos = granulePos;
                granulePos += mid->framesInPacket * mid->frameSize;
            }
        }

        // And adjust for any skip at the end
        preSkip(mid, &granulePos);
        cur = end;
    }

    // If we're FLAC 44100kHz, adjust the granule positions for that
    if (flacRate == 44100) {
        for (cur = head.next; cur; cur = cur->next)
            cur->outputGranulePos = cur->outputGranulePos * 147 / 160;
    }

    // Now read and pass thru the header
    do {
        if (oggHeader.granulePos != 0) {
            // Passed the header
            break;
        }

        if (oggHeader.streamNo != keepStreamNo)
            continue;

        skip = 0;
        if (packetSize > 8 && !memcmp(buf, "ECVADD", 6)) {
            // It's our VAD header, so skip that
            skip = 8 + *((unsigned short *) (buf + 6));
        }

        // Pass through the normal header
        oggHeader.sequenceNo = lastSequenceNo++;
        writeOgg(&oggHeader, buf + skip, packetSize - skip);

    } while (readOgg(&preHeader, &oggHeader, &buf, &bufSz, &packetSize));

    skip = vadLevel ? 1 : 0;

    // And finally, pass thru the data with corrected timestamps
    cur = head.next;
    do {
        if (oggHeader.streamNo != keepStreamNo || packetSize <= 1)
            continue;

        // Add any gaps
        if (cur->preSkip) {
            struct OggHeader gapHeader = {0};
            uint32_t time = (flacRate == 44100) ? (packetTime * 147 / 160) : packetTime;
            gapHeader.type = 0;
            gapHeader.granulePos = cur->outputGranulePos - time * cur->preSkip;
            gapHeader.streamNo = keepStreamNo;

            for (int i = 0; i < cur->preSkip; i++) {
                gapHeader.sequenceNo = lastSequenceNo++;
                switch (flacRate) {
                    case 0: // Opus
                        writeOgg(&gapHeader, zeroPacket, sizeof(zeroPacket));
                        break;
                    case 44100:
                        writeOgg(&gapHeader, zeroPacketFLAC44k, sizeof(zeroPacketFLAC44k));
                        break;
                    default:
                        writeOgg(&gapHeader, zeroPacketFLAC48k, sizeof(zeroPacketFLAC48k));
                }
                gapHeader.granulePos += time;
            }
        }

        // Then insert the current packet
        if (!(cur->flags & FLAG_DROP)) {
            oggHeader.granulePos = cur->outputGranulePos;
            oggHeader.sequenceNo = lastSequenceNo++;
            writeOgg(&oggHeader, buf + skip, packetSize - skip);
        }

        cur = cur->next ? cur->next : cur;

    } while (readOgg(&preHeader, &oggHeader, &buf, &bufSz, &packetSize));

    if (lastSequenceNo <= 2) {
        // This track had no actual audio. To avoid breakage, throw some on.
        struct OggHeader oggHeader = {0};
        oggHeader.streamNo = keepStreamNo;
        oggHeader.sequenceNo = lastSequenceNo++;
        switch (flacRate) {
            case 0: // Ogg
                writeOgg(&oggHeader, zeroPacket, sizeof(zeroPacket));
                break;
            case 44100:
                writeOgg(&oggHeader, zeroPacketFLAC44k, sizeof(zeroPacketFLAC44k));
                break;
            default:
                writeOgg(&oggHeader, zeroPacketFLAC48k, sizeof(zeroPacketFLAC48k));
        }
    }

    return 0;
}
