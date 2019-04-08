#!/usr/bin/env node
/*
 * Copyright (c) 2019 Yahweasel 
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
const https = require("https");
const pipe = require("posix-pipe").pipe;
const ws = require("ws");

process.chdir("../..");

var hs;
var wss;

function start() {
    var home = process.env.HOME; // FIXME: Make this path configurable
    var hst = https.createServer({
        cert: fs.readFileSync(home+"/cert/fullchain.pem", "utf8"),
        key: fs.readFileSync(home+"/cert/privkey.pem", "utf8")
    });

    hst.on("error", (err) => {
        console.error(err);
        process.exit(1);
    });

    hst.on("listening", startWS);

    // Start the HTTPS server
    hst.listen(34182);

    // Start the websocket server
    function startWS() {
        hs = hst;
        wss = new ws.Server({
            server: hs
        });

        wss.on("connection", (ws) => {
            // We must receive a login first
            ws.once("message", connection(ws));
        });
    }
}

function connection(ws) {
    return function(msg) {
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
            return ws.close();

        var cmd = msg.readUInt32LE(p.cmd);
        if (cmd !== p.alllogin && cmd !== p.onelogin)
            return ws.close();

        var id = ""+msg.readUInt32LE(p.id);

        // Check whether the ID even exists
        var info;
        try {
            info = JSON.parse(fs.readFileSync("rec/" + id + ".ogg.info"));
        } catch (ex) {
            return ws.close();
        }

        // Check if the key is correct
        var key = msg.readUInt32LE(p.key);
        if (key !== info.key)
            return ws.close();

        // Get the requested track
        var track = null;
        if (cmd === p.onelogin) {
            if (msg.length !== p.track + 4)
                return ws.close();
            track = msg.readInt32LE(p.track);
            if (track < 0) track = "info";
        }

        // Tell them "OK"
        var buf = Buffer.alloc(8);
        buf.writeUInt32LE(0, 0);
        buf.writeUInt32LE(cmd, 4);
        ws.send(buf);

        // Send based on what's acknowledged
        var ackd = -1;
        var sending = 0;

        // Start getting data
        buf = Buffer.alloc(4);
        buf.writeUInt32LE(sending, 0);
        var c = cp.spawn("cook/raw-partwise.sh", (track === null) ? [id] : [id, ""+track], {
            stdio: ["ignore", "pipe", "inherit"]
        });

        c.stdout.on("data", (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            if (buf.length >= 1024*1024)
                sendBuffer();
        });
        c.stdout.on("end", () => {
            if (buf.length > 0)
                sendBuffer();
            ws.close();
        });

        function sendBuffer() {
            try {
                ws.send(buf);
            } catch (ex) {}

            buf = Buffer.alloc(4);
            sending++;
            buf.writeUInt32LE(sending, 0);

            if (sending > ackd + 16) {
                // Stop accepting data
                c.stdout.pause();
            }
        }

        // The only accepted message from here on out is acknowledgement
        ws.on("message", (msg) => {
            msg = Buffer.from(msg);
            var cmd = msg.readUInt32LE(0);
            var p = msg.readUInt32LE(4);
            if (cmd !== 0) return ws.close();
            if (p > ackd) {
                ackd = p;
                if (sending <= ackd + 16) {
                    // Accept data
                    c.stdout.resume();
                }
            }
        });

        ws.on("close", () => {
            // If they close early, we need to let the processing finish
            ackd = Infinity;
            try {
                c.stdout.resume();
            } catch (ex) {}
        });
    };
}

start();
