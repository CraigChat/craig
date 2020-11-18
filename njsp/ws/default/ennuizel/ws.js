/*
 * Copyright (c) 2019-2020 Yahweasel 
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

const cp = require("child_process");
const fs = require("fs");

const sendSize = 65536;

sock.once("message", async function(msg) {
    msg = Buffer.from(msg); // Just in case

    // The first message has to be a login request
    var p = {
        alllogin: 0x10,
        onelogin: 0x11,
        id: 4,
        key: 8,
        track: 12
    };
    if (msg.length < p.track)
        return sock.close();

    var cmd = msg.readUInt32LE(p.cmd);
    if (cmd !== p.alllogin && cmd !== p.onelogin)
        return sock.close();

    var id = msg.readUInt32LE(p.id);

    // Get the info for it
    var info = null;
    try {
        info = JSON.parse(fs.readFileSync(process.env.HOME + "/craig/rec/" + id + ".ogg.info", "utf8"));
    } catch (ex) {}
    if (!info)
        return sock.close();

    // Check if the key is correct
    var key = msg.readUInt32LE(p.key);
    if (key !== info.key)
        return sock.close();

    // Get the requested track
    var track = null;
    if (cmd === p.onelogin) {
        if (msg.length !== p.track + 4)
            return sock.close();
        track = msg.readInt32LE(p.track);
        if (track < 0) return sock.close();
    }

    // Tell them "OK"
    var buf = Buffer.alloc(8);
    buf.writeUInt32LE(0, 0);
    buf.writeUInt32LE(cmd, 4);
    sock.send(buf);

    // Send based on what's acknowledged
    var ackd = -1;
    var sending = 0;

    // Start getting data
    buf = Buffer.alloc(4);
    buf.writeUInt32LE(sending, 0);
    var c = cp.spawn(process.env.HOME + "/craig/cook/raw-partwise.sh",
        (track === null) ? [id] : [id, ""+track], {
        stdio: ["ignore", "pipe", "inherit"]
    });

    var paused = false;
    var onack = null;

    c.stdout.on("readable", readable);
    function readable() {
        if (paused) return;
        var chunk;
        while (chunk = c.stdout.read(sendSize)) {
            data(chunk);
            if (paused) break;
        }
    }

    function data(chunk) {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= sendSize)
            sendBuffer();
    }

    c.stdout.on("end", () => {
        while (buf.length > 4)
            sendBuffer();
        sendBuffer();
        sock.close();
    });

    function sendBuffer() {
        // Get the sendable part
        var toSend;
        if (buf.length > sendSize) {
            toSend = buf.subarray(0, sendSize);
            buf = buf.subarray(sendSize);
        } else {
            toSend = buf;
            buf = null;
        }

        try {
            sock.send(toSend);
        } catch (ex) {}

        var hdr = Buffer.alloc(4);
        sending++;
        hdr.writeUInt32LE(sending, 0);
        if (buf)
            buf = Buffer.concat([hdr, buf]);
        else
            buf = hdr;

        if (sending > ackd + 128) {
            // Stop accepting data
            paused = true;
        }
    }

    // The only accepted message from here on out is acknowledgement
    sock.on("message", (msg) => {
        msg = Buffer.from(msg);
        var cmd = msg.readUInt32LE(0);
        var p = msg.readUInt32LE(4);
        if (cmd !== 0) return sock.close();
        if (p > ackd) {
            ackd = p;
            if (onack) onack();
            if (sending <= ackd + 128) {
                // Accept data
                paused = false;
                readable();
            }
        }
    });

    sock.on("close", () => {
        // If they close early, we need to let the processing finish
        ackd = Infinity;
        paused = false;
        readable();
    });
});
