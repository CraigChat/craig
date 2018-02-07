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

/*
 * Craig: A multi-track voice channel recording bot for Discord.
 *
 * The actual Discord client, logging and other core functionality.
 */

const EventEmitter = require("events");
const fs = require("fs");
const Discord = require("discord.js");

const clientOptions = {fetchAllMembers: false, apiRequestMethod: "sequential"};

const client = new Discord.Client(clientOptions);
const clients = [client]; // For secondary connections
const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
const defaultConfig = require("./default-config.js");

for (var ck in defaultConfig)
    if (!(ck in config))
        config[ck] = defaultConfig[ck];

// An event emitter for whenever we start or stop any recording
class RecordingEvent extends EventEmitter {}
const recordingEvents = new RecordingEvent();

// Logging function (not REALLY client-related, but this is the best place for it)
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

// Log exceptions
function logex(ex, r) {
    if (typeof r === "undefined") r = "";
    log("EXCEPTION: " + r + " " + JSON.stringify(ex.stack+""));
}

// Convenience function to turn entities into name#id strings:
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

// Log in
client.login(config.token).catch(logex);

// If there are secondary Craigs, log them in
for (var si = 0; si < config.secondary.length; si++) {
    clients.push(new Discord.Client(clientOptions));
    clients[si+1].login(config.secondary[si].token).catch(logex);
}

// Reconnect when we disconnect
clients.forEach((client) => {
    var reconnectTimeout = null;
    client.on("disconnect", () => {
        if (reconnectTimeout !== null) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
        reconnectTimeout = setTimeout(() => {
            if (client.status !== 0)
                client.login(config.token).catch(logex);
            reconnectTimeout = null;
        }, 10000);
    });
});

module.exports = {client, clients, config, recordingEvents, log, logex, nameId, dead: false};
