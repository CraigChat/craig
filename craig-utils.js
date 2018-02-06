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

const fs = require("fs");
const cc = require("./craig-client.js");

const config = cc.config;

// accessSync with a less stupid UI
function accessSyncer(file) {
    try {
        fs.accessSync(file);
    } catch (ex) {
        return false;
    }
    return true;
}

// Convenience functions to turn entities into name#id strings:
function nameId(entity) {
    var nick = "";
    if ("displayName" in entity) {
        nick = entity.displayName;
    } else if ("username" in entity) {
        nick = entity.username;
    } else if ("name" in entity) {
        nick = entity.name;
    }
    return nick + "#" + entity.id;
}

// A precomputed Opus header, made by node-opus 
const opusHeader = [
    Buffer.from([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 0x01, 0x02,
        0x00, 0x0f, 0x80, 0xbb, 0x00, 0x00, 0x00, 0x00, 0x00]),
    Buffer.from([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73, 0x09, 0x00,
        0x00, 0x00, 0x6e, 0x6f, 0x64, 0x65, 0x2d, 0x6f, 0x70, 0x75, 0x73, 0x00,
        0x00, 0x00, 0x00, 0xff])
];

var log;
if ("log" in config) {
    const logStream = fs.createWriteStream(config.log, {"flags": "a"});
    log = function(line) {
        logStream.write((new Date().toISOString()) + ": " + line + "\n");
    }
} else {
    log = function(line) {
        console.log((new Date().toISOString()) + ": " + line);
    }
}

module.exports = {accessSyncer, nameId, opusHeader, log};
