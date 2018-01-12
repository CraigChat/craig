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

const cp = require("child_process");
const fs = require("fs");
const Discord = require("discord.js");
const opus = require("node-opus");
const ogg = require("ogg");
const ogg_packet = require("ogg-packet");
const cshared = require("./craig-shared.js");

const client = new Discord.Client();
const nameId = cshared.nameId;
var config = null;
var toRec = null;
var connection = null;
var disconnected = false;

// To end the process, disconnect from all
function die() {
    try {
        connection.channel.guild.members.get(client.user.id).setNickname(config.nick).then(die2).catch(die2);
    } catch(ex) {
        die2();
    }
}

function die2() {
    client.destroy();
    process.disconnect();
    setTimeout(() => { process.exit(0); }, 5);
}

// Host control messages
process.on("message", (msg) => {
    switch (msg.type) {
        case "config":
            config = msg.config;
            if (config && toRec)
                client.login(config.token);
            break;

        case "client":
            config.token = msg.config.token;
            config.nick = msg.config.nick;
            break;

        case "requester":
            config.requester = msg.config.requester;
            break;

        case "record":
            toRec = msg.record;
            if (config && toRec)
                client.login(config.token);
            break;

        case "stop":
            disconnected = true;
            if (connection)
                connection.disconnect();
            else
                die();
            break;
    }
});

// We log and reply via the host
function log(line) {
    if (process.connected)
        process.send({"type": "log", "line": line+""});
    else
        console.log(line);
}

function reply(dm, pubtext, privtext) {
    if (process.connected)
        process.send({"type": "reply", "dm": !!dm, "pubtext": pubtext+"", "privtext": privtext?(privtext+""):undefined});
    else if (config.requester) {
        if (typeof privtext === "undefined")
            privtext = pubtext;
        else
            privtext = pubtext + "\n\n" + privtext;
        client.fetchUser(config.requester).then((u) => {
            u.send(privtext).catch((err) => {
                disconnected = true;
                if (connection)
                    connection.disconnect();
                else
                    die();
            });
        }).catch((err) => {
            if (connection)
                connection.disconnect();
            else
                die();
        });
    }
}

// Our recording session proper
function session(guildId, channelId, channel, id) {
    var receiver = connection.createReceiver();
    const partTimeout = setTimeout(() => {
        reply(true, "Sorry, but you've hit the recording time limit. Recording stopped.");
        disconnected = true;
        connection.disconnect();
    }, 1000*60*60*6);

    // Rename ourself to indicate that we're recording
    try {
        connection.channel.guild.members.get(client.user.id).setNickname(config.nick + " [RECORDING]").catch((err) => {
            reply(true, "I do not have permission to change my nickname on this server. I will not record without this permission.");
            disconnected = true;
            connection.disconnect();
        });
    } catch (ex) {}

    // Log it
    try {
        log("Started recording " + nameId(connection.channel) + "@" + nameId(connection.channel.guild) + " with ID " + id);
    } catch(ex) {}

    // Have we received any data?
    var received = false;

    // Our input Opus streams by user
    var userOpusStreams = {};

    // Our output streams by user
    var userOggStreams = {};

    // Our current track number
    var trackNo = 1;

    // Set up our recording OGG header and data file
    var startTime = process.hrtime();
    var recFileBase = "rec/" + id + ".ogg";

    // Set up our recording streams
    var recFHStream = [
        fs.createWriteStream(recFileBase + ".header1"),
        fs.createWriteStream(recFileBase + ".header2")
    ];
    var recFStream = fs.createWriteStream(recFileBase + ".data");

    // Make sure they get destroyed
    var atcp = cp.spawn("at", ["now + 48 hours"],
        {"stdio": ["pipe", 1, 2]});
    atcp.stdin.write("rm -f " + recFileBase + ".header1 " +
        recFileBase + ".header2 " + recFileBase + ".data " +
        recFileBase + ".key " + recFileBase + ".delete\n");
    atcp.stdin.end();

    // And our ogg encoders
    function mkEncoder(fstream, allow_b_o_s) {
        var encoder = new ogg.Encoder();
        var size = 0;
        encoder.on("data", (chunk) => {
            if (!allow_b_o_s) {
                /* Manually hack out b_o_s, assume (correctly) we'll never have
                 * inter-page chunks */
                chunk[5] &= 0xFD;
            }
            try {
                fstream.write(chunk);
            } catch (ex) {}

            size += chunk.length;
            if (config.hardLimit && size >= config.hardLimit) {
                reply(true, "Sorry, but you've hit the recording size limit. Recording stopped.");
                disconnected = true;
                connection.disconnect();
            }
        });
        return encoder;
    }
    var recOggHStream = [ mkEncoder(recFHStream[0], true), mkEncoder(recFHStream[1]) ];
    var recOggStream = mkEncoder(recFStream);

    // Function to encode a single Opus chunk to the ogg file
    function encodeChunk(oggStream, chunk, packetNo) {
        var chunkTime = process.hrtime(startTime);
        var chunkGranule = chunkTime[0] * 48000 + ~~(chunkTime[1] / 20833.333);
        var oggPacket = new ogg_packet();

        if (chunk.length > 4 && chunk[0] === 0xBE && chunk[1] === 0xDE) {
            // There's an RTP header extension here. Strip it.
            var rtpHLen = chunk.readUInt16BE(2);
            var off = 4;

            for (var rhs = 0; rhs < rtpHLen && off < chunk.length; rhs++) {
                var subLen = (chunk[off]&0xF)+2;
                off += subLen;
            }
            while (off < chunk.length && chunk[off] === 0)
                off++;
            if (off >= chunk.length)
                off = chunk.length;

            chunk = chunk.slice(off);
        }

        oggPacket.packet = chunk;
        oggPacket.bytes = chunk.length;
        oggPacket.b_o_s = 0;
        oggPacket.e_o_s = 0;
        oggPacket.granulepos = chunkGranule;
        oggPacket.packetno = packetNo;
        oggStream.packetin(oggPacket);
        oggStream.flush(() => {});
    }

    // And receiver for the actual data
    function onReceive(user, chunk) {
        if (user.id in userOpusStreams) return;
        received = true;

        var opusStream = userOpusStreams[user.id] = receiver.createOpusStream(user);
        var userOggStream;
        if (!(user.id in userOggStreams)) {
            var serialNo = trackNo++;
            var userOggHStream = [
                recOggHStream[0].stream(serialNo),
                recOggHStream[1].stream(serialNo)
            ];
            userOggStream = recOggStream.stream(serialNo);
            userOggStreams[user.id] = userOggStream;

            // Put a valid Opus header at the beginning
            var opusEncoder = new opus.Encoder(48000, 2);
            opusEncoder.on("data", (chunk) => {
                if (!chunk.e_o_s) {
                    try {
                        if (chunk.granulepos == 0)
                            userOggHStream[0].write(chunk);
                        else
                            userOggHStream[1].write(chunk);
                    } catch (ex) {}
                }
            });
            opusEncoder.on("end", () => {
                userOggHStream[0].flush(() => {
                    userOggHStream[0].end();
                });
                userOggHStream[1].flush(() => {
                    userOggHStream[1].end();
                });
            });
            opusEncoder.write(Buffer.alloc(480*2));
            opusEncoder.end();
        }
        userOggStream = userOggStreams[user.id];

        // And then receive the real data into the data stream
        var oggStream = userOggStreams[user.id];
        var packetNo = 2;

        encodeChunk(userOggStream, chunk, packetNo++);

        opusStream.on("data", (chunk) => {
            encodeChunk(userOggStream, chunk, packetNo++);
        });
        opusStream.on("end", () => {
            delete userOpusStreams[user.id];
        });
    }
    receiver.on("opus", onReceive);

    // When we're disconnected from the channel...
    var tryingReconnect = false;
    function onDisconnect() {
        if (!disconnected) {
            if (tryingReconnect)
                return;
            tryingReconnect = true;
            try {
                log("Unexpected disconnect from " + nameId(channel) + "@" + nameId(channel.guild) + " with ID " + id);
            } catch (ex) {}
            try {
                reply(true, "I've been unexpectedly disconnected! If you want me to stop recording, please command me to with :craig:, stop. Otherwise, I'm trying to reconnect now.");
            } catch (ex) {}
            channel.join().then((theConnection) => {
                connection = theConnection;
                receiver = connection.createReceiver();
                userOpusStreams = {};
                receiver.on("opus", onReceive);
                connection.on("disconnect", onDisconnect);
                connection.on("error", onDisconnect);

                // Don't trust being connected until we receive data
                received = false;
                setTimeout(() => {
                    if (!received) {
                        failReconnect();
                        return;
                    }
                    try {
                        reply(true, "Reconnected.");
                    } catch (ex) {}
                    tryingReconnect = false;
                }, 5000);
            }).catch((err) => {
                failReconnect();
            });
            return;
        }

        // Log it
        try {
            log("Finished recording " + nameId(channel) + "@" + nameId(channel.guild) + " with ID " + id);
        } catch (ex) {}

        // Close all our OGG streams
        for (var user in userOggStreams)
            userOggStreams[user].end();

        // Close the output files
        recFHStream[0].end();
        recFHStream[1].end();
        recFStream.end();

        // Delete our leave timeout
        clearTimeout(partTimeout);

        // And disconnect
        die();
    }
    connection.on("disconnect", onDisconnect);
    connection.on("error", onDisconnect);

    // When we fail to reconnect
    function failReconnect() {
        try {
            log("Failed to reconnect to " + nameId(channel) + "@" + nameId(channel.guild) + " with ID " + id);
        } catch (ex) {}
        try {
            reply(true, "I couldn't reconnect!");
        } catch (ex) {}
        disconnected = true;
        onDisconnect();
    }
}

// When we connect, it's time to record
client.on('ready', () => {
    if (connection)
        return;

    var guild = null;
    client.guilds.some((maybeGuild) => {
        if (maybeGuild.id === toRec.guild) {
            guild = maybeGuild;
            return true;
        }
        return false;
    });
    if (!guild) {
        die();
        return;
    }
    var channel = null;
    guild.channels.some((maybeChannel) => {
        if (maybeChannel.id === toRec.channel) {
            channel = maybeChannel;
            return true;
        }
        return false;
    });
    if (!channel) {
        die();
        return;
    }

    if (channel.type !== "voice")
        process.exit(1);

    var guildId = guild.id;
    var channelId = channel.id;

    channel.join().then((theConnection) => {
        var id = toRec.id;
        connection = theConnection;

        // Tell them
        reply(true,
            "Recording! https://craigrecords.yahweasel.com/?id=" + id + "&key=" + toRec.accessKey,
            "To delete: https://craigrecords.yahweasel.com/?id=" + id + "&key=" + toRec.accessKey + "&delete=" + toRec.deleteKey + "\n.");

        // Then start the recording session
        session(guildId, channelId, channel, id);

    }).catch((err) => {
        reply(false, "Failed to join! " + err);
        die();

    });
});

client.on("voiceStateUpdate", (from, to) => {
    try {
        if (from.id === client.user.id) {
            if (from.voiceChannelID !== to.voiceChannelID ||
                from.voiceSessionID !== to.voiceSessionID) {
                // We do not tolerate being moved
                to.guild.voiceConnection.disconnect();
            }
        }
    } catch (err) {}
});

client.on("guildUpdate", (from, to) => {
    try {
        if (from.id === connection.channel.guild.id) {
            if (from.region !== to.region) {
                // The server has moved regions. This breaks recording.
                to.voiceConnection.disconnect();
            }
        }
    } catch (err) {}
});

process.on("disconnect", () => {
    reply(true, "Craig is currently undergoing problems or maintenance. I'm still recording, but don't be surprised if I refuse to leave the room when you ask; when parts of my brain die, I forget where I am. Sorry about that!");
});
