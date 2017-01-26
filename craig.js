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
const client = new Discord.Client();
const config = JSON.parse(fs.readFileSync("config.json", "utf8"));

if (!("nick" in config))
    config.nick = "Craig";
if (!("hardLimit" in config))
    config.hardLimit = 536870912;

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

// Set to true when we've been gracefully restarted
var dead = false;

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

// Active recordings by guild, channel
var activeRecordings = {};

// Given a connection, our recording session proper
function newConnection(guildId, channelId, connection, id) {
    const receiver = connection.createReceiver();
    const partTimeout = setTimeout(() => {
        connection.disconnect();
    }, 1000*60*60*6);

    // Rename ourself to indicate that we're recording
    try {
        connection.channel.guild.members.get(client.user.id).setNickname(config.nick + " [RECORDING]");
    } catch (ex) {}

    // Log it
    try {
        log("Started recording " + nameId(connection.channel) + "@" + nameId(connection.channel.guild) + " with ID " + id);
    } catch(ex) {}

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
            if (config.hardLimit && size >= config.hardLimit)
                connection.disconnect();
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
    receiver.on('opus', (user, chunk) => {
        if (user.id in userOpusStreams) return;

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
            var opusEncoder = new opus.Encoder(48000, 1, 480);
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

        // Give it some empty audio data to start it out
        var opusEncoder = new opus.OpusEncoder(48000);
        var oggPacket = new ogg_packet();
        oggPacket.packet = opusEncoder.encode(Buffer.alloc(480*2), 480);
        oggPacket.bytes = oggPacket.packet.length;
        oggPacket.b_o_s = 0;
        oggPacket.e_o_s = 0;
        oggPacket.granulepos = 0;
        oggPacket.packetno = packetNo++;
        oggStream.packetin(oggPacket);
        oggStream.flush(() => {});

        encodeChunk(userOggStream, chunk, packetNo++);

        opusStream.on("data", (chunk) => {
            encodeChunk(userOggStream, chunk, packetNo++);
        });
        opusStream.on("end", () => {
            delete userOpusStreams[user.id];
        });
    });

    // When we're disconnected from the channel...
    connection.on("disconnect", () => {
        // Log it
        try {
            log("Finished recording " + nameId(connection.channel) + "@" + nameId(connection.channel.guild) + " with ID " + id);
        } catch (ex) {}

        // Close all our OGG streams
        for (var user in userOggStreams)
            userOggStreams[user].end();

        // Close the output files
        recFHStream[0].end();
        recFHStream[1].end();
        recFStream.end();

        // Delete the active recording
        try {
            delete activeRecordings[guildId][channelId];
        } catch (ex) {}

        // If it was the last one, rename ourself in that guild
        if (Object.keys(activeRecordings[guildId]).length === 0) {
            try {
                connection.channel.guild.members.get(client.user.id).setNickname(config.nick);
            } catch (ex) {}
            delete activeRecordings[guildId];

            // And maybe quit
            if (dead && Object.keys(activeRecordings).length === 0)
                client.destroy();
        }

        // And delete our leave timeout
        clearTimeout(partTimeout);
    });
}

client.on('ready', () => {
    log("Logged in as " + client.user.username);
});

const craigCommand = /^(:craig:|<:craig:[0-9]*>),? *([^ ]*) ?(.*)$/;

function userIsAuthorized(member) {
    if (!member) return false;

    // Guild owners are always allowed
    if (member.hasPermission("MANAGE_GUILD"))
        return true;

    // Otherwise, they must be a member of the right role
    if (member.roles.some((role) => { return role.name.toLowerCase() === "craig"; }))
        return true;

    // Not for you!
    return false;
}

// Special commands from the owner
function ownerCommand(msg, cmd) {
    var op = cmd[2].toLowerCase();

    try {
        log("Owner command: " + nameId(msg.author) + ": " + msg.content);
    } catch (ex) {}

    if (op === "graceful-restart") {
        // Start a new craig
        var ccp = cp.spawn(
            process.argv[0], ["craig.js"],
            {"stdio": "inherit", "detached": true});

        // Stop responding to input
        dead = true;

        // And if we're not recording anything, disconnect
        if (Object.keys(activeRecordings).length === 0)
            client.destroy();

    } else {
        msg.reply(cmd[1] + " <(Huh? '" + op + "')");

    }
}

// Desperation function to try to tell them "I can't talk!"
function desperation(guild, msg) {
    // Try to get a message out
    guild.channels.some((channel) => {
        if (channel.type !== "text")
            return false;

        var perms = channel.permissionsFor(client.user);
        if (!perms)
            return false;

        if (perms.hasPermission("SEND_MESSAGES")) {
            // Finally!
            channel.send("Sorry to spam this channel, but I don't have privileges to respond in the channel you talked to me in! Please give me permission to talk :(");
            return true;
        }

        return false;
    });

    // And give ourself a name indicating error
    try {
        guild.members.get(client.user.id).setNickname("ERROR CANNOT SEND MESSAGES");
    } catch (ex) {}
}

client.on('message', (msg) => {
    if (dead) return;

    // We don't care if it's not a command
    var cmd = msg.content.match(craigCommand);
    if (cmd === null) return;

    // Is this from our glorious leader?
    if (msg.channel.type === "dm" && msg.author.id && msg.author.id === config.owner) {
        ownerCommand(msg, cmd);
        return;
    }

    // Ignore it if it's from an unauthorized user
    if (!userIsAuthorized(msg.member)) return;

    // Log it
    try {
        log("Command: " + nameId(msg.member) + "@" + nameId(msg.channel) + "@" + nameId(msg.channel.guild) + ": " + msg.content);
    } catch (ex) {}

    var op = cmd[2].toLowerCase();
    if (op === "join" || op === "record" || op === "rec" ||
        op === "leave" || op === "part") {
        var cname = cmd[3].toLowerCase();
        var found = false;
        if (!msg.guild)
            return;

        msg.guild.channels.every((channel) => {
            if (channel.type !== "voice")
                return true;

            if (channel.name.toLowerCase() === cname) {
                found = true;
                if (op === "join" || op === "record" || op === "rec") {
                    var guildId = channel.guild.id;
                    var channelId = channel.id;
                    if (!(guildId in activeRecordings))
                        activeRecordings[guildId] = {};

                    if (channelId in activeRecordings[guildId]) {
                        var rmsg = "I'm already recording that channel: https://craigrecords.yahweasel.com/?id=" + activeRecordings[guildId][channelId];
                        msg.author.send(rmsg).catch((err) => {
                            msg.reply(cmd[1] + " <(I can't DM you. " + rmsg + ")").catch((err) => {
                                desperation(msg.guild, rmsg);
                            });
                        });

                    } else {
                        channel.join().then((connection) => {
                            // Make a random ID for it
                            var id;
                            do {
                                id = ~~(Math.random() * 1000000000);
                            } while (accessSyncer("rec/" + id + ".ogg.key"));

                            // Make an access key for it
                            var accessKey = ~~(Math.random() * 1000000000);
                            fs.writeFileSync("rec/" + id + ".ogg.key", ""+accessKey, "utf8");

                            // Make a deletion key for it
                            var deleteKey = ~~(Math.random() * 1000000000);
                            fs.writeFileSync("rec/" + id + ".ogg.delete", ""+deleteKey, "utf8");

                            // Tell them
                            activeRecordings[guildId][channelId] = id;
                            var rmsg = "Recording! https://craigrecords.yahweasel.com/?id=" + id + "&key=" + accessKey;
                            msg.author.send(
                                rmsg + "\n\n" +
                                "To delete: https://craigrecords.yahweasel.com/?id=" + id + "&key=" + accessKey + "&delete=" + deleteKey + "\n\n").catch((err) => {
                                msg.reply(cmd[1] + " <(I can't DM you. " + rmsg + ")").catch((err) => {
                                    desperation(msg.guild, rmsg);
                                });
                            });

                            // Then start the connection
                            newConnection(guildId, channelId, connection, id);

                        }).catch((err) => {
                            msg.reply(cmd[1] + " <(Failed to join! " + err + ")").catch((err) => {
                                desperation(msg.guild, ""+err);
                            });
                        });

                    }

                } else {
                    channel.leave();

                }
            }

            return true;
        });

        if (!found)
            msg.reply(cmd[1] + " <(What channel?)");
    }
});

client.login(config.token);
