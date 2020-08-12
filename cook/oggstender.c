/*
 * Copyright (c) 2017-2019 Yahweasel
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
    unsigned char sequencePart;
    uint32_t sizeMod;

    if (writeAll(1, "OggS\0", 5) != 5 ||
        writeAll(1, header, sizeof(*header)) != sizeof(*header))
        exit(1);

    // Write out the sequence info
    sequencePart = (size+254)/255;
    if (writeAll(1, &sequencePart, 1) != 1) exit(1);
    sequencePart = 255;
    sizeMod = size;
    while (sizeMod > 255) {
        if (writeAll(1, &sequencePart, 1) != 1) exit(1);
        sizeMod -= 255;
    }
    sequencePart = sizeMod;
    if (writeAll(1, &sequencePart, 1) != 1) exit(1);

    // Then write the data
    if (writeAll(1, data, size) != size) exit(1);
}

int main(int argc, char **argv)
{
    uint32_t keepStreamNo;
    uint64_t trueGranulePos = 0;
    uint32_t lastSequenceNo = 0;
    uint32_t packetSize, skip, framesInPacket;
    unsigned char segmentCount, segmentVal;
    unsigned char *buf = NULL;
    uint32_t bufSz = 0;
    struct OggPreHeader preHeader;
    unsigned char vadLevel = 0, correctTimestampsUp = 0,
        correctTimestampsDown = 0, lastWasSilence = 1;
    uint32_t flacRate = 0;

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

        // Handle headers
        if (oggHeader.granulePos == 0) {
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

            // Pass through the normal header
            writeOgg(&oggHeader, buf + skip, packetSize - skip);
            continue;
        }

        // Is this empty data (Craig uses empty data packets for timestamp references)
        if (packetSize == 0)
            continue;

        // Does this have obscure nonsense attached?
        skip = 0;
        if (packetSize > 2 && !memcmp(buf, "\x90\x00", 2))
            skip = 2;

        // Account for VAD
        if (vadLevel)
            skip++;

        // Figure out how many frames are in this packet
        if (!flacRate) {
            framesInPacket = buf[skip] & 0x3;
            switch (framesInPacket) {
                case 0:
                    framesInPacket = 1;
                    break;

                case 1:
                case 2:
                    framesInPacket = 2;
                    break;

                case 3: // Signaled
                    framesInPacket = buf[skip+1] & 0x3F;
                    break;

                default:
                    framesInPacket = 1;
            }

            fprintf(stderr, "%X\n", framesInPacket);

        } else {
            framesInPacket = 1;

        }

        // Account for gaps
        if (oggHeader.granulePos > trueGranulePos + packetTime * (lastWasSilence ? 1 : 5)) {
            correctTimestampsDown = 0;

            // We are behind
            if (lastWasSilence ||
                oggHeader.granulePos > trueGranulePos + packetTime * 25) {
                // There was a real gap, fill it
                uint64_t gapTime = oggHeader.granulePos - trueGranulePos;
                while (gapTime >= packetTime) {
                    struct OggHeader gapHeader;
                    gapHeader.type = 0;
                    gapHeader.granulePos = trueGranulePos;
                    if (flacRate == 44100)
                        gapHeader.granulePos = gapHeader.granulePos * 147 / 160;
                    gapHeader.streamNo = keepStreamNo;
                    gapHeader.sequenceNo = lastSequenceNo++;
                    gapHeader.crc = 0;
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
                    trueGranulePos += packetTime;
                    gapTime -= packetTime;
                }
                correctTimestampsUp = 0;

            } else {
                // No real gap, just adjust timestamps a bit and fix the audio in post
                correctTimestampsUp = 1;

            }
        }

        // And account for excess data
        if (trueGranulePos > oggHeader.granulePos + packetTime * (lastWasSilence ? 1 : 25)) {
            // We are ahead
            correctTimestampsUp = 0;
            if (vadLevel && buf[0] < vadLevel) {
                // It's just silence. We can skip it.
                correctTimestampsDown = 0;
                continue;
            } else {
                correctTimestampsDown = 1;
            }
        }

        // Fix timestamps
        if (correctTimestampsUp) {
            if (oggHeader.granulePos <= trueGranulePos + packetTime) {
                // We've adjusted enough
                correctTimestampsUp = 0;

            } else {
                /* We adjust our rate of correction based on how far we are
                 * behind. There's no "correct" scale for this, but my metric
                 * is that if we're 5 frames behind (the minimum to enable
                 * this), we do 2.5% correction, and we scale linearly from
                 * there at a rate of 1% per frame. If we get more than half a
                 * second behind, we just fill the gap.
                 * */
                uint64_t pmcorr = 10 * (oggHeader.granulePos - trueGranulePos) / packetTime;
                if (pmcorr < 50)
                    pmcorr = 50;
                trueGranulePos += packetTime * (pmcorr-25) / 1000;

            }
        }
        if (correctTimestampsDown) {
            if (trueGranulePos <= oggHeader.granulePos + packetTime) {
                correctTimestampsDown = 0;
            } else {
                trueGranulePos -= packetTime / 100;
            }
        }

        // It's safer to place gaps during silence, so silence detect
        if (vadLevel) {
            lastWasSilence = (buf[0] < vadLevel);
        } else {
            // Silly detection: look for tiny packets
            lastWasSilence = (packetSize < (flacRate?16:8));
        }

        // Now fix up our own granule positions
        oggHeader.granulePos = trueGranulePos;
        trueGranulePos += packetTime * framesInPacket;

        // Then insert the current packet
        oggHeader.sequenceNo = lastSequenceNo++;
        if (flacRate == 44100)
            oggHeader.granulePos = oggHeader.granulePos * 147 / 160;
        writeOgg(&oggHeader, buf + skip, packetSize - skip);
    }

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
