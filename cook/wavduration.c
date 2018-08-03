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

/* NOTE: This program assumes little-endian for speed. It WILL NOT WORK on a
 * big-endian system */

struct WavHeader {
    // RIFF header:
    unsigned char magic[4];
    uint32_t fileSize;
    unsigned char format[4];
} __attribute__((packed));;

struct WavSectHeader {
    unsigned char magic[4];
    uint32_t sectSize;
} __attribute__((packed));;

struct WavFmtHeader {
    uint16_t type;
    uint16_t channels;
    uint32_t sampleRate;
    uint32_t byteRate;
    uint16_t blockAlign;
    uint16_t bitsPerSample;
} __attribute__((packed));

struct WavDS64Header {
    uint64_t fileSize;
    uint64_t dataSize;
    uint64_t sampleCount;
    uint32_t zero;
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
    unsigned char buf[4096];
    const uint32_t bufSz = 4096;
    ssize_t bufUsed;
    struct WavHeader wavHeader;
    struct WavSectHeader sectHeader;
    struct WavFmtHeader fmtHeader;
    struct WavDS64Header ds64Header;
    int needDS64Header = 0;
    unsigned int extra;

    // Read the header
    bufUsed = readAll(0, &wavHeader, sizeof(struct WavHeader));
    if (bufUsed < 0)
        return 1;
    if (bufUsed < sizeof(struct WavHeader)) {
        write(1, &wavHeader, bufUsed);
        return 0;
    }

    // Make sure it IS a wav header
    if (!memcmp(wavHeader.magic, "RIFF", 4) || !memcmp(wavHeader.magic, "RF64", 4)) {
        // Skip other headers looking for fmt and data
        memset(&fmtHeader, 0, sizeof(fmtHeader));
        while (1) {
            bufUsed = readAll(0, &sectHeader, sizeof(sectHeader));
            if (bufUsed < sizeof(sectHeader))
                return 1;
            if (!memcmp(sectHeader.magic, "fmt ", 4) &&
                sectHeader.sectSize >= sizeof(fmtHeader)) {
                // Found our format header
                bufUsed = readAll(0, &fmtHeader, sizeof(fmtHeader));
                if (bufUsed < sizeof(fmtHeader))
                    return 1;

                // Skip any remainder
                sectHeader.sectSize -= sizeof(fmtHeader);

            } else if (!memcmp(sectHeader.magic, "data", 4)) {
                // The data itself
                break;

            }

            // Some other header, ignore it
            while (sectHeader.sectSize > bufSz) {
                readAll(0, buf, bufSz);
                sectHeader.sectSize -= bufSz;
            }
            if (sectHeader.sectSize > 0)
                readAll(0, buf, sectHeader.sectSize);
        }

        // Update its duration
        double duration = 6.0*60*60;
        uint64_t bytes;
        uint32_t dataSize;
        if (argc > 1)
            duration = atof(argv[1]);
        bytes = duration * fmtHeader.sampleRate * fmtHeader.channels *
            (fmtHeader.bitsPerSample/8);
        if (bytes >= (((uint64_t) 1)<<32) - 36) {
            needDS64Header = 1;
            memcpy(wavHeader.magic, "RF64", 4);
            wavHeader.fileSize = dataSize = -1;
            ds64Header.fileSize = bytes + 64;
            ds64Header.dataSize = bytes;
            ds64Header.sampleCount = duration * fmtHeader.sampleRate;
            ds64Header.zero = 0;

        } else {
            memcpy(wavHeader.magic, "RIFF", 4);
            wavHeader.fileSize = bytes + 36;
            dataSize = bytes;

        }

        // Write out the header
        write(1, &wavHeader, sizeof(struct WavHeader));

        // Write out the DS64 header if applicable
        if (needDS64Header) {
            memcpy(sectHeader.magic, "ds64", 4);
            sectHeader.sectSize = sizeof(ds64Header);
            write(1, &sectHeader, sizeof(sectHeader));
            write(1, &ds64Header, sizeof(ds64Header));
        }

        // Write out the fmt header
        memcpy(sectHeader.magic, "fmt ", 4);
        sectHeader.sectSize = sizeof(fmtHeader);
        write(1, &sectHeader, sizeof(sectHeader));
        write(1, &fmtHeader, sizeof(fmtHeader));

        // And finally the data header
        memcpy(sectHeader.magic, "data", 4);
        sectHeader.sectSize = dataSize;
        write(1, &sectHeader, sizeof(sectHeader));

    } else {
        // Wasn't even a RIFF file, just copy it
        write(1, &wavHeader, sizeof(struct WavHeader));

    }

    // Then write out the rest
    while ((bufUsed = read(0, buf, bufSz)) > 0)
        write(1, buf, bufUsed);

    // Along with a fair bit of nothing
    memset(buf, 0, bufSz);
    for (extra = 0; extra < 256; extra++)
        write(1, buf, bufSz);

    return (bufUsed<0);
}
