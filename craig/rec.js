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
 * Recording! Y'know, Craig's only feature. This file has support for recording
 * sessions, recording commands, and other recording-related functionality.
 */

const cp = require("child_process");
const fs = require("fs");

const ogg = require("./ogg.js");
const opus = new (require("node-opus")).OpusEncoder(48000);

const cc = require("./client.js");
const config = cc.config;
const client = cc.client;
const clients = cc.clients;
const log = cc.log;
const logex = cc.logex;
const nameId = cc.nameId;

const cu = require("./utils.js");
const reply = cu.reply;

const ccmds = require("./commands.js");
const commands = ccmds.commands;

const cf = require("./features.js");

/* Active recordings by guild, channel
 *
 * SHARDS:
 * The shard manager has ALL active recordings, with fake connections. All
 * shards have only the recordings active for them.
 */
const activeRecordings = {};

// Our recording session proper
function session(msg, prefix, rec) {
    var connection = rec.connection;
    var limits = rec.limits;
    var id = rec.id;
    var client = rec.client;
    var nick = rec.nick;

    function sReply(dm, pubtext, privtext) {
        reply(msg, dm, prefix, pubtext, privtext);
    }

    var receiver = connection.createReceiver();
    const partTimeout = setTimeout(() => {
        log("Terminating " + id + ": Time limit.");
        sReply(true, "Sorry, but you've hit the recording time limit. Recording stopped.");
        rec.disconnected = true;
        connection.disconnect();
    }, limits.record * 60*60*1000);

    // Rename ourself to indicate that we're recording
    try {
        connection.channel.guild.members.get(client.user.id).setNickname(nick + " [RECORDING]").catch((err) => {
            log("Terminating " + id + ": Lack nick change permission.");
            sReply(true, "I do not have permission to change my nickname on this server. I will not record without this permission.");
            rec.disconnected = true;
            connection.disconnect();
        });
    } catch (ex) {
        logex(ex);
    }

    // Log it
    try {
        log("Started recording " + nameId(connection.channel) + "@" + nameId(connection.channel.guild) + " with ID " + id);
    } catch(ex) {
        logex(ex);
    }
    cc.recordingEvents.emit("start", rec);

    // Our input Opus streams by user
    var userOpusStreams = {};

    // Track numbers for each active user
    var userTrackNos = {};

    // Packet numbers for each active user
    var userPacketNos = {};

    // Have we warned about this user's data being corrupt?
    var corruptWarn = {};

    // Our current track number
    var trackNo = 1;

    // Set up our recording OGG header and data file
    var startTime = process.hrtime();
    var recFileBase = "rec/" + id + ".ogg";

    // The amount of data I've recorded
    var size = 0;

    // Keep track and disconnect if we seem unused
    var lastSize = 0;
    var usedMinutes = 0;
    var unusedMinutes = 0;
    var warned = false;
    const useInterval = setInterval(() => {
        if (size != lastSize) {
            lastSize = size;
            usedMinutes++;
            unusedMinutes = 0;
        } else {
            unusedMinutes++;
            if (usedMinutes === 0) {
                // No recording at all!
                log("Terminating " + id + ": No data.");
                sReply(true, "I'm not receiving any data! Disconnecting.");
                rec.disconnected = true;
                connection.disconnect();
                return;
            } else if (unusedMinutes === 5 && !warned) {
                sReply(true, "Hello? I haven't heard anything for five minutes. Has something gone wrong, are you just taking a break, or have you forgotten to `:craig:, leave` to stop the recording? If it's just a break, disregard this message!");
                sReply(false, "Hello? I haven't heard anything for five minutes. Has something gone wrong, are you just taking a break, or have you forgotten to `:craig:, leave` to stop the recording? If it's just a break, disregard this message!");
                warned = true;
            }
        }
    }, 60000);

    // Set up our recording streams
    var recFHStream = [
        fs.createWriteStream(recFileBase + ".header1"),
        fs.createWriteStream(recFileBase + ".header2")
    ];
    var recFStream = fs.createWriteStream(recFileBase + ".data");

    // And our ogg encoders
    function write(stream, granulePos, streamNo, packetNo, chunk, flags) {
        size += chunk.length;
        if (config.hardLimit && size >= config.hardLimit) {
            log("Terminating " + id + ": Size limit.");
            reply(true, "Sorry, but you've hit the recording size limit. Recording stopped.");
            rec.disconnected = true;
            connection.disconnect();
        } else {
            stream.write(granulePos, streamNo, packetNo, chunk, flags);
        }
    }
    var recOggHStream = [ new ogg.OggEncoder(recFHStream[0]), new ogg.OggEncoder(recFHStream[1]) ];
    var recOggStream = new ogg.OggEncoder(recFStream);

    // Function to encode a single Opus chunk to the ogg file
    function encodeChunk(user, oggStream, streamNo, packetNo, chunk) {
        var chunkTime = process.hrtime(startTime);
        var chunkGranule = chunkTime[0] * 48000 + ~~(chunkTime[1] / 20833.333);

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

        // Occasionally check that it's valid Opus data
        if (packetNo % 50 === 49) {
            try {
                opus.decode(chunk, 960);
            } catch (ex) {
                if (!corruptWarn[user.id]) {
                    sReply(true, "WARNING: I am receiving corrupted voice data from " + user.username + "#" + user.discriminator + "! I will not be able to correctly process their audio!");
                    corruptWarn[user.id] = true;
                }
            }
            // FIXME: Eventually delete corruption warnings?
        }

        write(oggStream, chunkGranule, streamNo, packetNo, chunk);
    }

    // And receiver for the actual data
    function onReceive(user, chunk) {
        if (user.id in userOpusStreams) return;

        var opusStream = userOpusStreams[user.id] = receiver.createOpusStream(user);
        var userTrackNo, packetNo;
        if (!(user.id in userTrackNos)) {
            userTrackNo = trackNo++;
            userTrackNos[user.id] = userTrackNo;
            packetNo = userPacketNos[user.id] = 0;

            // Put a valid Opus header at the beginning
            try {
                write(recOggHStream[0], 0, userTrackNo, 0, cu.opusHeader[0], ogg.BOS);
                write(recOggHStream[1], 0, userTrackNo, 0, cu.opusHeader[1]);
            } catch (ex) {
                logex(ex);
            }
        } else {
            userTrackNo = userTrackNos[user.id];
            packetNo = userPacketNos[user.id];
        }

        try {
            encodeChunk(user, recOggStream, userTrackNo, packetNo++, chunk);
            userPacketNos[user.id] = packetNo;
        } catch (ex) {
            logex(ex);
        }

        opusStream.on("data", (chunk) => {
            try {
                encodeChunk(user, recOggStream, userTrackNo, packetNo++, chunk);
                userPacketNos[user.id] = packetNo;
            } catch (ex) {
                logex(ex);
            }
        });
        opusStream.on("end", () => {
            delete userOpusStreams[user.id];
        });
    }
    receiver.on("opus", onReceive);

    // When we're disconnected from the channel...
    function onDisconnect() {
        if (!rec.disconnected) {
            // Not an intentional disconnect
            try {
                log("Unexpected disconnect from " + nameId(connection.channel) + "@" + nameId(connection.channel.guild) + " with ID " + id);
            } catch (ex) {
                logex(ex);
            }
            try {
                sReply(true, "I've been unexpectedly disconnected! If you want me to stop recording, please command me to with :craig:, stop.");
            } catch (ex) {
                logex(ex);
            }
            rec.disconnected = true;
        }

        // Log it
        try {
            log("Finished recording " + nameId(connection.channel) + "@" + nameId(connection.channel.guild) + " with ID " + id);
        } catch (ex) {
            logex(ex);
        }
        cc.recordingEvents.emit("stop", rec);

        // Close the output files
        recOggHStream[0].end();
        recOggHStream[1].end();
        recOggStream.end();

        // Delete our leave timeout
        clearTimeout(partTimeout);
        clearInterval(useInterval);

        // Destroy the receiver (unnecessary)
        try {
            receiver.destroy();
        } catch (ex) {}

        // And callback
        rec.close();
    }
    connection.on("disconnect", onDisconnect);
    connection.on("error", onDisconnect);
}

// Join a voice channel, working around discord.js' knot of insane bugs
function safeJoin(channel, err) {
    var guild = channel.guild;
    var insaneInterval;

    function catchConnection() {
        if (guild.voiceConnection) {
            guild.voiceConnection.on("error", (ex) => {
                // Work around the hellscape of discord.js bugs
                try {
                    guild.client.voice.connections.delete(guild.id);
                } catch (noex) {}
                if (err)
                    err(ex);
            });
            clearInterval(insaneInterval);
        }
    }

    var ret = channel.join();
    var insaneInterval = setInterval(catchConnection, 200);

    return ret;
}

// Start recording
commands["join"] = commands["record"] = commands["rec"] = function(msg, cmd) {
    var guild = msg.guild;
    if (!guild)
        return;
    var cname = cmd[3].toLowerCase();
    var channel = null;

    if (cc.dead) {
        // Not our job
        return;
    }

    channel = cu.findChannel(msg, guild, cname);

    if (channel !== null) {
        var guildId = guild.id;
        var channelId = channel.id;
        if (!(guildId in activeRecordings))
            activeRecordings[guildId] = {};

        // Choose the right client
        var takenClients = {};
        var chosenClient = null;
        var chosenClientNum = -1;
        for (var oChannelId in activeRecordings[guildId]) {
            var recording = activeRecordings[guildId][oChannelId];
            takenClients[recording.clientNum] = true;
        }
        for (var ci = 0; ci < clients.length; ci++) {
            if (takenClients[ci]) continue;
            chosenClient = clients[ci];
            chosenClientNum = ci;
            break;
        }

        // Translate the guild and channel to the secondary client
        if (chosenClient && chosenClient !== client) {
            guild = chosenClient.guilds.get(guildId);
            if (guild)
                channel = guild.channels.get(channelId);
        }

        // Joinable can crash if the voiceConnection is in a weird state
        var joinable = false;
        try {
            if (channel)
                joinable = channel.joinable;
        } catch (ex) {}

        // Choose the right action
        if (channelId in activeRecordings[guildId]) {
            var rec = activeRecordings[guildId][channelId];
            reply(msg, true, cmd[1],
                    "I'm already recording that channel: " + config.dlUrl + "?id=" +
                    rec.id + "&key=" + rec.accessKey);

        } else if (!chosenClient) {
            reply(msg, false, cmd[1],
                    "Sorry, but I can't record any more channels on this server! Please ask me to leave a channel I'm currently in first with “:craig:, leave <channel>”, or ask me to leave all channels on this server with “:craig:, stop”");

        } else if (!guild) {
            reply(msg, false, cmd[1],
                    "In Discord, one bot can only record one channel. If you want another channel recorded, you'll have to invite my brother: " + config.secondary[chosenClientNum-1].invite);

        } else if (!channel) {
            reply(msg, false, cmd[1],
                    "My brother can't see that channel. Make sure his permissions are correct.");

        } else if (!joinable) {
            reply(msg, false, cmd[1], "I don't have permission to join that channel!");

        } else {
            // Figure out the recording features for this user
            var f = cf.features(msg.author.id, guildId);

            // Make a random ID for it
            var id;
            do {
                id = ~~(Math.random() * 1000000000);
            } while (cu.accessSyncer("rec/" + id + ".ogg.key"));
            var recFileBase = "rec/" + id + ".ogg";

            // Make an access key for it
            var accessKey = ~~(Math.random() * 1000000000);
            fs.writeFileSync(recFileBase + ".key", ""+accessKey, "utf8");

            // Make a deletion key for it
            var deleteKey = ~~(Math.random() * 1000000000);
            fs.writeFileSync(recFileBase + ".delete", ""+deleteKey, "utf8");

            // If the user has features, mark them down
            if (f !== cf.defaultFeatures)
                fs.writeFileSync(recFileBase + ".features", JSON.stringify(f), "utf8");

            // Make sure they get destroyed
            var atcp = cp.spawn("at", ["now + " + f.limits.download + " hours"],
                    {"stdio": ["pipe", 1, 2]});
            atcp.stdin.write("rm -f " + recFileBase + ".header1 " +
                    recFileBase + ".header2 " + recFileBase + ".data " +
                    recFileBase + ".key " + recFileBase + ".delete " +
                    recFileBase + ".features\n");
            atcp.stdin.end();

            // We have a nick per the specific client
            var reNick = config.nick;
            if (chosenClient !== client)
                reNick = config.secondary[chosenClientNum-1].nick;

            var closed = false;
            function close() {
                if (closed)
                    return;
                closed = true;

                // Now get rid of it
                delete activeRecordings[guildId][channelId];
                if (Object.keys(activeRecordings[guildId]).length === 0) {
                    delete activeRecordings[guildId];
                }

                // Rename the bot in this guild
                try {
                    guild.members.get(chosenClient.user.id).setNickname(reNick).catch(logex);
                } catch (ex) {
                    logex(ex);
                }

                // Try to reset our voice connection nonsense by joining a different channel
                var diffChannel = channel;
                guild.channels.some((maybeChannel) => {
                    if (maybeChannel === channel)
                        return false;

                    var joinable = false;
                    try {
                        joinable = maybeChannel.joinable;
                    } catch (ex) {}
                    if (!joinable)
                        return false;

                    diffChannel = maybeChannel;
                    return true;
                });
                function leave() {
                    setTimeout(()=>{
                        try {
                            diffChannel.leave();
                        } catch (ex) {}
                    }, 1000);
                }
                safeJoin(diffChannel, leave).then(leave).catch(leave);
            }

            var rec = {
                gid: guild.id,
                cid: channel.id,
                connection: null,
                id: id,
                accessKey: accessKey,
                client: chosenClient,
                clientNum: chosenClientNum,
                limits: f.limits,
                nick: reNick,
                disconnected: false,
                close: close
            };
            activeRecordings[guildId][channelId] = rec;

            // If we have voice channel issue, do our best to rectify them
            function onError(ex) {
                reply(msg, false, cmd[1], "Failed to join! " + ex);
                close();
            }

            // Join the channel
            safeJoin(channel, onError).then((connection) => {
                // Tell them
                reply(msg, true, cmd[1],
                    "Recording! I will record up to " + f.limits.record +
                    " hours. Recordings are deleted automatically after " + f.limits.download +
                    " hours from the start of recording. The audio can be downloaded even while I'm still recording.\n\n" +
                    "Download link: " + config.dlUrl + "?id=" + id + "&key=" + accessKey,
                    "To delete: " + config.dlUrl + "?id=" + id + "&key=" + accessKey + "&delete=" + deleteKey + "\n.");

                rec.connection = connection;

                session(msg, cmd[1], rec);
            }).catch(onError);

            // If we don't have a connection in 15 seconds, assume something went wrong
            setTimeout(()=>{
                if (!rec.connection) close();
            }, 15000);
        }

    } else if (!cc.dead) {
        reply(msg, false, cmd[1], "What channel?");

    }

}

// Stop recording
commands["leave"] = commands["part"] = function(msg, cmd) {
    var guild = msg.guild;
    if (!msg.guild)
        return;
    var cname = cmd[3].toLowerCase();

    var channel = cu.findChannel(msg, guild, cname);

    if (channel !== null) {
        var guild = msg.guild;
        var guildId = guild.id;
        var channelId = channel.id;
        if (!(guildId in activeRecordings) ||
            !(channelId in activeRecordings[guildId])) {
            /* Maybe we can just ignore the channel name and leave whatever
             * channel we're in? */
            if (cname === "" && guild.voiceConnection) {
                channel = guild.voiceConnection.channel;
                channelId = channel.id;
            }
        }
        if (guildId in activeRecordings &&
            channelId in activeRecordings[guildId]) {
            try {
                var rec = activeRecordings[guildId][channelId];
                if (rec.connection) {
                    rec.disconnected = true;
                    rec.connection.disconnect();
                }
            } catch (ex) {
                logex(ex);
            }

        } else if (!cc.dead) {
            reply(msg, false, cmd[1], "But I'm not recording that channel!");
        }

    } else if (!cc.dead) {
        reply(msg, false, cmd[1], "What channel?");

    }

}

// Stop all recordings
commands["stop"] = function(msg, cmd) {
    var guild = msg.guild;
    if (!guild)
        return;
    var guildId = guild.id;
    if (guildId in activeRecordings) {
        for (var channelId in activeRecordings[guildId]) {
            try {
                var rec = activeRecordings[guildId][channelId];
                if (rec.connection) {
                    rec.disconnected = true;
                    rec.connection.disconnect();
                }
            } catch (ex) {
                logex(ex);
            }
        }
    } else if (!cc.dead) {
        reply(msg, false, cmd[1], "But I haven't started!");
    }

}

// Checks for catastrophic recording errors
clients.forEach((client) => {
    if (!client) return;

    client.on("voiceStateUpdate", (from, to) => {
        try {
            if (from.id === client.user.id &&
                from.voiceChannel) {
                var guildId = from.guild.id;
                var channelId = from.voiceChannel.id;
                if (guildId in activeRecordings &&
                    channelId in activeRecordings[guildId] &&
                    from.voiceChannelID !== to.voiceChannelId) {
                    // We do not tolerate being moved
                    log("Terminating recording: Moved to a different channel.");
                    to.guild.voiceConnection.disconnect();
                }
            }
        } catch (ex) {
            logex(ex);
        }
    });

    client.on("guildUpdate", (from, to) => {
        try {
            if (from.region !== to.region &&
                to.voiceConnection) {
                // The server has moved regions. This breaks recording.
                log("Terminating recording: Moved to a different voice region.");
                to.voiceConnection.disconnect();
            }
        } catch (ex) {
            logex(ex);
        }
    });

    client.on("guildMemberUpdate", (from, to) => {
        try {
            if (from.id === client.user.id &&
                from.nickname !== to.nickname &&
                to.guild.voiceConnection &&
                (!to.nickname || to.nickname.indexOf("[RECORDING]") === -1)) {
                // Make sure this isn't just a transient state
                if (to.guild.id in activeRecordings &&
                    to.guild.voiceConnection.channel.id in activeRecordings[to.guild.id]) {
                    // They attempted to hide the fact that Craig is recording. Not acceptable.
                    log("Terminating recording: Nick changed wrongly.");
                    to.guild.voiceConnection.disconnect();
                }
            }
        } catch (ex) {
            logex(ex);
        }
    });
});

// Make a pseudo-recording sufficient for stats and keeping track but little else
function pseudoRecording(gid, cid, id, accessKey, size) {
    var rec = {
        id: id,
        accessKey: accessKey,
        connection: {
            channel: {
                members: {
                    size: size
                }
            },
            disconnect: function() {
                cc.recordingEvents.emit("stop", rec);
                delete activeRecordings[gid][cid];
                if (Object.keys(activeRecordings[gid]).length === 0)
                    delete activeRecordings[gid];
            }
        }
    };
    return rec;
}

// Inform the shard manager when recordings start or end
if (!cc.master) {
    cc.recordingEvents.on("start", (rec) => {
        var size = 1;
        try {
            size = rec.connection.channel.members.size;
        } catch (ex) {
            logex(ex);
        }
        client.shard.send({t:"startRecording", g:rec.gid, c:rec.cid, id: rec.id, accessKey: rec.accessKey, size: size});
    });

    cc.recordingEvents.on("stop", (rec) => {
        client.shard.send({t:"stopRecording", g:rec.gid, c:rec.cid});
    });

} else if (cc.sm) {
    // Handle recordings from shards
    cc.shardCommands["startRecording"] = function(shard, msg) {
        if (!(msg.g in activeRecordings)) activeRecordings[msg.g] = {};
        activeRecordings[msg.g][msg.c] = pseudoRecording(msg.g, msg.c, msg.id, msg.accessKey, msg.size);
    }

    cc.shardCommands["stopRecording"] = function(shard, msg) {
        try {
            activeRecordings[msg.g][msg.c].connection.disconnect();
        } catch (ex) {}
    }

}

// Get our currect active recordings from the launcher
if (process.channel && cc.master)
    process.send({t:"requestActiveRecordings"});
cc.processCommands["activeRecordings"] = function(msg) {
    for (var gid in msg.activeRecordings) {
        var ng = msg.activeRecordings[gid];
        if (!(gid in activeRecordings))
            activeRecordings[gid] = {};
        var g = activeRecordings[gid];
        for (var cid in ng) {
            if (cid in g)
                continue;
            var nc = ng[cid];
            (function(gid, cid, nc) {
                var rec = g[cid] = pseudoRecording(gid, cid, nc.id, nc.accessKey, nc.size?nc.size:1);
                setTimeout(() => {
                    try {
                        if (activeRecordings[gid][cid] === rec)
                            rec.connection.disconnect();
                    } catch (ex) {}
                }, 1000*60*60*6);
            })(gid, cid, nc);
        }
    }

    if (cc.sm) {
        // Relay it to shards
        cc.sm.broadcast(msg);
        cc.sm.on("launch", (shard) => { shard.send(msg); });
    }
}

/* Graceful restart. This doesn't REALLY belong in rec.js, but maintaining the
 * currently active recordings is the only complicated part of gracefully
 * restarting, so here it is. */
function gracefulRestart() {
    if (!cc.master) {
        // Not our job! We'll trust the shard manager to do the restarting
        client.shard.send({t:"gracefulRestart"});
        return;

    } else if (process.channel) {
        // Launched by launcher. Get the list of active recordings.
        var nar = {};
        for (var gid in activeRecordings) {
            var g = activeRecordings[gid];
            var ng = nar[gid] = {};
            for (var cid in g) {
                var c = g[cid];
                var size = 1;
                try {
                    size = c.connection.channel.members.size;
                } catch (ex) {}
                var nc = ng[cid] = {
                    id: c.id,
                    accessKey: c.accessKey,
                    size: size
                };
            }
        }

        // Let the runner spawn a new Craig
        process.send({"t": "gracefulRestart", "activeRecordings": nar});

        // And then exit when we're done
        function maybeQuit(rec) {
            for (var gid in activeRecordings) {
                var g = activeRecordings[gid];
                for (var cid in g) {
                    var c = g[cid];
                    if (c !== rec && c.connection)
                        return;
                }
            }

            // No recordings left, we're done
            if (cc.sm)
                cc.sm.broadcast({t:"exit"});
            setTimeout(() => {
                process.exit(0);
            }, 30000);
        }
        maybeQuit();
        cc.recordingEvents.on("stop", maybeQuit);

    } else {
        // Start a new craig
        var ccp = cp.spawn(
            process.argv[0], ["craig.js"],
            {"stdio": "inherit", "detached": true});
        ccp.on("exit", (code) => {
            process.exit(code ? code : 1);
        });

    }

    // Stop responding to input
    cc.dead = true;
    if (cc.sm) {
        // And make sure the shards do too
        cc.sm.broadcast({t:"term"});
    }
}

// Shard command for graceful restart
cc.shardCommands["gracefulRestart"] = gracefulRestart;

// Owner command for graceful restart
ccmds.ownerCommands["graceful-restart"] = function(msg, cmd) {
    reply(msg, false, cmd[1], "Restarting!");
    gracefulRestart();
}

// Terminus command
cc.processCommands["term"] = function(msg) {
    cc.dead = true;
}

// And exit command
cc.processCommands["exit"] = function(msg) {
    setTimeout(() => {
        process.exit(0);
    }, 30000);
}

// Memory leaks (yay) force us to gracefully restart every so often
if(cc.master)
    var uptimeTimeout = setTimeout(() => { if (!cc.dead) gracefulRestart(); }, 24*60*60*1000);

module.exports = {activeRecordings, gracefulRestart, uptimeTimeout};
