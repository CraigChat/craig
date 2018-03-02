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

/*
 * Craig: A multi-track voice channel recording bot for Discord.
 *
 * Craig has its own version of ogg because the existing ogg encoders in Node
 * all either leak memory or modify streaming data in ways that break Craig.
 * This is an incredibly raw version of an ogg encoder.
 */

const crc32 = require("cyclic-32");

// Flags for all ogg
const BOS = 2;
const EOS = 4;
exports.BOS = BOS;
exports.EOS = EOS;

// Our ogg encoder itself
function OggEncoder(fstream) {
    this.fstream = fstream;
}
exports.OggEncoder = OggEncoder;

OggEncoder.prototype.write = function(granulePos, streamNo, packetNo, chunk, flags) {
    // How many bytes will be required to explain this chunk?
    var lengthBytes = Math.ceil(chunk.length / 255) + 1;

    // The total header length
    var headerBytes = 26 + lengthBytes;
    var header = Buffer.alloc(headerBytes + chunk.length);

    // Byte 0: Initial header
    header.write("OggS");

    // Byte 4: Stream structure 0

    // Byte 5: Flags
    if (typeof flags === "undefined")
        flags = 0;
    header.writeUInt8(flags, 5);

    // Byte 6: Granule pos
    header.writeUIntLE(granulePos, 6, 6);

    // Byte 14: Stream number
    header.writeUInt32LE(streamNo, 14);

    // Byte 18: Sequence number
    header.writeUInt32LE(packetNo, 18);

    // Byte 22: CRC-32, filled in later

    // Byte 26: Number of segments
    header.writeUInt8(lengthBytes - 1, 26);

    // And the segment lengths themselves
    var i = 27;
    if (chunk.length) {
        var r = chunk.length;
        while (r > 255) {
            header.writeUInt8(255, i++);
            r -= 255;
        }
        header.writeUInt8(r, i);
    }

    // Then of course the actual data
    chunk.copy(header, headerBytes);
    chunk = header;

    // Now that it's together we can figure out the checksum
    chunk.writeInt32LE(crc32(chunk), 22);

    // And write it out
    this.fstream.write(chunk);
}

OggEncoder.prototype.end = function() {
    this.fstream.end();
}
