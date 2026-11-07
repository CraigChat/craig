/*
 * Prints the same duration as `oggduration < FILE`, reading only the end of FILE.
 * Relies on .data being append-only, so the highest granule is near EOF.
 * Usage: tailduration FILE
 */

#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define WINDOW (1024 * 1024)
#define HEADER_SIZE 27

static int isPageStart(const unsigned char *buf, size_t off, size_t len)
{
    return off + HEADER_SIZE <= len && !memcmp(buf + off, "OggS", 4) && buf[off + 4] == 0;
}

/* 0 if the page at off is cut off by len */
static size_t pageSize(const unsigned char *buf, size_t off, size_t len)
{
    unsigned segmentCount = buf[off + 26];
    if (off + HEADER_SIZE + segmentCount > len)
        return 0;

    size_t size = HEADER_SIZE + segmentCount;
    for (unsigned i = 0; i < segmentCount; i++)
        size += buf[off + HEADER_SIZE + i];
    return off + size <= len ? size : 0;
}

/* Pages must chain exactly to EOF; a cut-off last page is allowed. */
static int chainsToEnd(const unsigned char *buf, size_t off, size_t len)
{
    while (off + HEADER_SIZE <= len) {
        if (!isPageStart(buf, off, len))
            return 0;
        size_t size = pageSize(buf, off, len);
        if (!size)
            return 1;
        off += size;
    }
    return 1;
}

static uint64_t lastGranulePos(const unsigned char *buf, size_t off, size_t len)
{
    uint64_t last = 0;

    while (isPageStart(buf, off, len)) {
        size_t size = pageSize(buf, off, len);
        if (!size)
            break;

        // Zero-size pages are timestamp references
        unsigned segmentCount = buf[off + 26];
        if (size > HEADER_SIZE + segmentCount) {
            uint64_t granulePos;
            memcpy(&granulePos, buf + off + 6, sizeof(granulePos));
            if (granulePos > last)
                last = granulePos;
        }
        off += size;
    }

    return last;
}

int main(int argc, char **argv)
{
    if (argc < 2) {
        fprintf(stderr, "Usage: %s FILE\n", argv[0]);
        return 1;
    }

    int fd = open(argv[1], O_RDONLY);
    struct stat st;
    if (fd < 0 || fstat(fd, &st) < 0) {
        perror(argv[1]);
        return 1;
    }

    size_t fileSize = st.st_size;
    size_t window = WINDOW;
    uint64_t last;

    for (;;) {
        size_t start = fileSize > window ? fileSize - window : 0;
        size_t len = fileSize - start;
        unsigned char *buf = malloc(len ? len : 1);
        if (!buf || pread(fd, buf, len, start) != (ssize_t) len) {
            perror(argv[1]);
            return 1;
        }

        size_t off = 0;
        if (start) {
            while (off + HEADER_SIZE <= len && !(isPageStart(buf, off, len) && chainsToEnd(buf, off, len)))
                off++;
            if (off + HEADER_SIZE > len) {
                // No page boundary found, read everything
                free(buf);
                window = fileSize;
                continue;
            }
        }

        last = lastGranulePos(buf, off, len);
        free(buf);
        break;
    }

    printf("%f\n", ((double) last) / 48000.0 + 2);
    return 0;
}
