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

    // Format data:
    unsigned char formatMagic[4];
    uint32_t formatSize;
    uint16_t formatAudio;
    uint16_t formatChannels;
    uint32_t formatSampleRate;
    uint32_t formatByteRate;
    uint16_t formatBlockAlign;
    uint16_t formatBitsPerSample;

    // Wave data:
    unsigned char wavMagic[4];
    uint32_t wavSize;
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

    // Read the header
    bufUsed = readAll(0, &wavHeader, sizeof(struct WavHeader));
    if (bufUsed < 0)
        return 1;
    if (bufUsed < sizeof(struct WavHeader)) {
        write(1, &wavHeader, bufUsed);
        return 0;
    }

    // Make sure it IS a wav header
    if (!memcmp(wavHeader.magic, "RIFF", 4) && 
        !memcmp(wavHeader.formatMagic, "fmt ", 4) && 
        !memcmp(wavHeader.wavMagic, "data", 4)) {
        // Update its duration
        double duration = 6.0*60*60;
        uint64_t bytes;
        if (argc > 1)
            duration = atof(argv[1]);
        bytes = duration * wavHeader.formatSampleRate *
            wavHeader.formatChannels * (wavHeader.formatBitsPerSample/8) + 36;
        if (bytes >= ((uint64_t) 1)<<32) {
            wavHeader.wavSize = wavHeader.fileSize = -1;
        } else {
            wavHeader.wavSize = bytes - 36;
            wavHeader.fileSize = bytes;
        }
    }

    // Write out the header
    write(1, &wavHeader, sizeof(struct WavHeader));

    // Then write out the rest
    while ((bufUsed = read(0, buf, bufSz)) > 0)
        write(1, buf, bufUsed);

    return (bufUsed<0);
}
