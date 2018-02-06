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

const EventEmitter = require("events");
const fs = require("fs");
const Discord = require("discord.js");

const clientOptions = {fetchAllMembers: false, apiRequestMethod: "sequential"};

const client = new Discord.Client(clientOptions);
exports.client = client;
const clients = [client]; // For secondary connections
exports.clients = clients;
const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
exports.config = config;
const defaultConfig = require("./default-config.js");

for (var ck in defaultConfig)
    if (!(ck in config))
        config[ck] = defaultConfig[ck];

// Log in
client.login(config.token).catch(()=>{});

// If there are secondary Craigs, log them in
for (var si = 0; si < config.secondary.length; si++) {
    clients.push(new Discord.Client(clientOptions));
    clients[si+1].login(config.secondary[si].token).catch(()=>{});
}

// An event emitter for whenever we start or stop any recording
class RecordingEvent extends EventEmitter {}
const recordingEvents = new RecordingEvent();
exports.recordingEvents = recordingEvents;
