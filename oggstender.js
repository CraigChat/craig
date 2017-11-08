#!/usr/bin/env node

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

const opus = require("node-opus");
const ogg = require("ogg");
const ogg_packet = require("ogg-packet");

var encoder = new ogg.Encoder();
var opusEncoder = new opus.OpusEncoder(48000);
var packetTime = 960; // 2/100ths of a second, which is what Discord always uses
var oggS = Buffer.from("OggS");
var opusHeader = Buffer.from("Opus");
var zeroPacket = opusEncoder.encode(Buffer.alloc(packetTime*2), packetTime);

// Data goes to stdout
encoder.on("data", (chunk) => {
    process.stdout.write(chunk);
});

var streams = {};
var streamTimes = {};
var streamPNos = {};

var select = null;
if (process.argv.length > 2)
    select = +process.argv[2];

var prevChunk = Buffer.alloc(0);
var inputPos = 0;
process.stdin.on("data", (chunk) => {
    // Copy in the full buffer
    var newChunk = Buffer.alloc(prevChunk.length + chunk.length);
    prevChunk.copy(newChunk);
    chunk.copy(newChunk, prevChunk.length);
    chunk = newChunk;

    // Handle ogg packets
    while (true) {
        // Make sure we have at least a header worth
        if (chunk.length < 27)
            break;

        // Make sure this is an ogg packet
        if (chunk.compare(oggS, 0, 4, 0, 4) !== 0) {
            console.error(inputPos + " not an ogg packet!");
            break;
        }

        // Figure out the stream number and time
        var streamNo = chunk.readUInt32LE(14);

        // Get our segment count
        var segCount = chunk.readUInt8(26);

        // Make sure we have enough segments
        var headerEnd = 27 + segCount;
        if (chunk.length < headerEnd)
            break;

        // Figure out the full packet length
        var packetLength = 0;
        for (var segI = 0; segI < segCount; segI++)
            packetLength += chunk.readUInt8(27 + segI);
        var packetEnd = headerEnd + packetLength;
        if (chunk.length < packetEnd)
            break;

        // Only output packets we care about
        if (select === null || streamNo === select) {
            // Get the output info
            var stream, lastTime, packetNo;
            if (!(streamNo in streams)) {
                stream = encoder.stream(streamNo);
                streams[streamNo] = stream;
                streamTimes[streamNo] = lastTime = 0;
                streamPNos[streamNo] = packetNo = 0;
            } else {
                stream = streams[streamNo];
                lastTime = streamTimes[streamNo];
                packetNo = streamPNos[streamNo];
            }

            // Extract the data
            var packetData = Buffer.from(chunk.slice(headerEnd, packetEnd));

            // Get our current time
            var curTime = (chunk.readUInt32LE(10) << 32) + chunk.readUInt32LE(6);

            /* The first packet gets stuck at time 0 even though that's not the
             * correct time, so drop it, but don't drop headers */
            if (curTime === 0 && packetData.length > 4 &&
                packetData.compare(opusHeader, 0, 4, 0, 4) !== 0)
                packetData = zeroPacket;

            // If there's a big gap, add a break
            if (curTime - lastTime > packetTime*10) {
                var gapTime = curTime - lastTime - packetTime;
                lastTime += packetTime;
                while (gapTime >= packetTime) {
                    var packet = new ogg_packet();
                    packet.packet = zeroPacket;
                    packet.bytes = zeroPacket.length;
                    packet.b_o_s = packet.e_o_s = 0;
                    packet.granulepos = lastTime;
                    packet.packetno = packetNo++;
                    stream.packetin(packet);
                    stream.flush();
                    lastTime += packetTime;
                    gapTime -= packetTime;
                }
            }
            streamTimes[streamNo] = curTime;

            // Now form the packet
            var packet = new ogg_packet();
            packet.packet = packetData;
            packet.bytes = packetData.length;
            packet.b_o_s = (chunk.readUInt8(5) & 0x02);
            packet.e_o_s = (chunk.readUInt8(5) & 0x04);
            packet.granulepos = curTime;
            packet.packetno = packetNo++;
            streamPNos[streamNo] = packetNo;
            stream.packetin(packet);
            stream.flush();
        }

        // Move on to the next packet
        chunk = chunk.slice(packetEnd);
        inputPos += packetEnd;
    }

    prevChunk = chunk;
});

process.stdin.on("end", () => {
    for (var streamNo in streams) {
        streams[streamNo].end();
    }
});
