/*
 * Copyright (c) 2017, 2018 Yahweasel
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
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <unistd.h>

/* NOTE: We don't use libogg here because the behavior if this program is so
 * trivial, the added memory bandwidth of using it is just a waste of energy */

/* NOTE: This program assumes little-endian for speed, it WILL NOT WORK on a
 * big-endian system */

struct OggHeader {
    unsigned char type;
    uint64_t granulePos;
    uint32_t streamNo;
    uint32_t sequenceNo;
    uint32_t crc;
} __attribute__((packed));

int main(int argc, char **argv)
{
    uint64_t lastGranulePos = ((uint16_t) 6)*60*60*48000;
    unsigned char buf[4096];
    const uint32_t bufSz = 4096;
    ssize_t bufUsed;
    struct OggHeader *oggHeader;
    int oggFd, i;
    off_t foff;

    // Read the end of the file
    if (argc != 2) return 1;
    oggFd = open(argv[1], O_RDONLY);
    if (oggFd == -1) {
        perror(argv[1]);
        goto done;
    }
    foff = lseek(oggFd, 0, SEEK_END);
    if (lseek(oggFd, foff - bufSz, SEEK_SET) == (off_t) -1) {
        if (errno != EINVAL) {
            // EINVAL is actually fine, just a short file
            perror("lseek");
            goto done;
        }
    }
    bufUsed = read(oggFd, buf, bufSz);
    if (bufUsed < 0) {
        perror("read");
        goto done;
    } else if (bufUsed < bufSz) {
        fprintf(stderr, "WARNING: Only read %d bytes.\n", (int) bufUsed);
    }

    // Now seek backwards for a header
    for (i = bufUsed - sizeof(struct OggHeader); i >= 0; i--) {
        if (!memcmp(buf + i, "OggS\0", 5)) {
            // Found a header
            oggHeader = (struct OggHeader *) (buf + i + 5);
            lastGranulePos = oggHeader->granulePos;
            break;
        }
    }

    close(oggFd);

done:
    printf("%f\n", ((double) lastGranulePos)/48000.0+2);

    return 0;
}
