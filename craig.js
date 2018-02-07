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

const cp = require("child_process");
const fs = require("fs");
const https = require("https");
const ogg = require("./craig-ogg.js");
const opus = new (require("node-opus")).OpusEncoder(48000);

const cc = require("./craig-client.js");
const client = cc.client;
const clients = cc.clients;
const config = cc.config;
const commands = cc.commands;
const recordingEvents = cc.recordingEvents;

const cu = require("./craig-utils.js");
const nameId = cu.nameId;
const log = cu.log;
const reply = cu.reply;

const gms = require("./craig-gms.js");

// Active recordings by guild, channel
var activeRecordings = {};

// A map user ID -> rewards
var rewards = {};
var defaultFeatures = {"limits": config.limits};

// A map of users with rewards -> blessed guilds and vice-versa
var blessU2G = {};
var blessG2U = {};

// Get our currect active recordings from the launcher
if (process.channel) {
    process.send({t:"requestActiveRecordings"});
    process.on("message", (msg) => {
        if (typeof msg !== "object")
            return;
        switch (msg.t) {
            case "activeRecordings":
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
                            var rec = g[cid] = {
                                id: nc.id,
                                accessKey: nc.accessKey,
                                connection: {
                                    channel: {
                                        members: {
                                            size: (nc.size?nc.size:1)
                                        }
                                    },
                                    disconnect: function() {
                                        delete activeRecordings[gid][cid];
                                        if (Object.keys(activeRecordings[gid]).length === 0)
                                            delete activeRecordings[gid];
                                    }
                                }
                            };
                            setTimeout(() => {
                                try {
                                    if (activeRecordings[gid][cid] === rec)
                                        rec.connection.disconnect();
                                } catch (ex) {}
                            }, 1000*60*60*6);
                        })(gid, cid, nc);
                    }
                }
                break;
        }
    });
}

// Get the features for a given user
function features(id, gid) {
    // Do they have their own rewards?
    var r = rewards[id];
    if (r) return r;

    // Are they in a blessed guild?
    if (gid && gid in blessG2U) {
        r = rewards[blessG2U[gid]];
        if (r) return r;
    }

    return defaultFeatures;
}

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
    } catch (ex) {}

    // Log it
    try {
        log("Started recording " + nameId(connection.channel) + "@" + nameId(connection.channel.guild) + " with ID " + id);
    } catch(ex) {}
    recordingEvents.emit("start", rec);

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
            } catch (ex) {}
        } else {
            userTrackNo = userTrackNos[user.id];
            packetNo = userPacketNos[user.id];
        }

        try {
            encodeChunk(user, recOggStream, userTrackNo, packetNo++, chunk);
            userPacketNos[user.id] = packetNo;
        } catch (ex) {}

        opusStream.on("data", (chunk) => {
            try {
                encodeChunk(user, recOggStream, userTrackNo, packetNo++, chunk);
                userPacketNos[user.id] = packetNo;
            } catch (ex) {}
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
            } catch (ex) {}
            try {
                sReply(true, "I've been unexpectedly disconnected! If you want me to stop recording, please command me to with :craig:, stop.");
            } catch (ex) {}
            rec.disconnected = true;
        }

        // Log it
        try {
            log("Finished recording " + nameId(connection.channel) + "@" + nameId(connection.channel.guild) + " with ID " + id);
        } catch (ex) {}
        recordingEvents.emit("stop", rec);

        // Close the output files
        recOggHStream[0].end();
        recOggHStream[1].end();
        recOggStream.end();

        // Delete our leave timeout
        clearTimeout(partTimeout);
        clearInterval(useInterval);

        // Destroy the receiver
        try {
            receiver.destroy();
        } catch (ex) {}

        // And callback
        rec.close();
    }
    connection.on("disconnect", onDisconnect);
    connection.on("error", onDisconnect);
}

// Our command regex changes to match our user ID
var craigCommand = /^(:craig:|<:craig:[0-9]*>)[, ]*([^ ]*) ?(.*)$/;
client.on("ready", () => {
    log("Logged in as " + client.user.username);
    craigCommand = new RegExp("^(:craig:|<:craig:[0-9]*>|<@!?" + client.user.id + ">)[, ]*([^ ]*) ?(.*)$");
    if ("url" in config)
        client.user.setPresence({game: {name: config.url, type: 0}}).catch(()=>{});
});

// Only admins and those with the Craig role are authorized to use Craig
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

// Graceful restart
function gracefulRestart() {
    if (process.channel) {
        // Get the list of active recordings
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
            setTimeout(() => {
                process.exit(0);
            }, 30000);
        }
        maybeQuit();
        recordingEvents.on("stop", maybeQuit);

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
}

// Memory leaks (yay) force us to gracefully restart every so often
var uptimeTimeout = setTimeout(() => { if (!cc.dead) gracefulRestart(); }, 24*60*60*1000);

// Find a channel matching the given name
function findChannel(msg, guild, cname) {
    var channel = null;

    guild.channels.some((schannel) => {
        if (schannel.type !== "voice")
            return false;

        if (schannel.name.toLowerCase() === cname ||
            (cname === "" && msg.member.voiceChannel === schannel)) {
            channel = schannel;
            return true;

        } else if (channel === null && schannel.name.toLowerCase().startsWith(cname)) {
            channel = schannel;

        }

        return false;
    });

    return channel;
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

    channel = findChannel(msg, guild, cname);

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
            var f = features(msg.author.id, guildId);

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
            if (f !== defaultFeatures)
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
                    guild.members.get(chosenClient.user.id).setNickname(reNick).catch(() => {});
                } catch (ex) {}

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

    var channel = findChannel(msg, guild, cname);

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
            } catch (ex) {}

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
            } catch (ex) {}
        }
    } else if (!cc.dead) {
        reply(msg, false, cmd[1], "But I haven't started!");
    }

}

// Turn features into a string
function featuresToStr(f, guild, prefix) {
    var ret = "\n";
    if (f === defaultFeatures)
        ret += "Default features:";
    else
        ret += prefix + ":";
    ret += "\nRecording time limit: " + f.limits.record + " hours" +
           "\nDownload time limit: " + f.limits.download + " hours";

    if (f.mix)
        ret += "\nYou may download auto-leveled mixed audio.";
    if (f.auto)
        ret += "\nYou may autorecord channels.";
    if (f.bless && !guild)
        ret += "\nYou may bless servers.";
    if (f.mp3)
        ret += "\nYou may download MP3.";

    return ret;
}

// Tell the user their features
commands["features"] = function(msg, cmd) {
    if (cc.dead) return;

    var f = features(msg.author.id);
    var gf = features(msg.author.id, msg.guild ? msg.guild.id : undefined);

    var ret = featuresToStr(f, false, "For you");
    if (gf !== f)
        ret += "\n" + featuresToStr(gf, true, "For this server");
   
    reply(msg, false, false, ret);
}

// And finally, help commands
commands["help"] = commands["commands"] = commands["hello"] = commands["info"] = function(msg, cmd) {
    if (cc.dead) return;
    reply(msg, false, cmd[1],
        "Hello! I'm Craig! I'm a multi-track voice channel recorder. For more information, see " + config.longUrl + " ");
}

// Checks for catastrophic recording errors
clients.forEach((client) => {
    client.on("voiceStateUpdate", (from, to) => {
        try {
            if (from.id === client.user.id) {
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
        } catch (err) {}
    });

    client.on("guildUpdate", (from, to) => {
        try {
            if (from.region !== to.region &&
                to.voiceConnection) {
                // The server has moved regions. This breaks recording.
                log("Terminating recording: Moved to a different voice region.");
                to.voiceConnection.disconnect();
            }
        } catch (err) {}
    });

    client.on("guildMemberUpdate", (from, to) => {
        try {
            if (from.id === client.user.id &&
                from.nickname !== to.nickname &&
                to.guild.voiceConnection &&
                to.nickname.indexOf("[RECORDING]") === -1) {
                // They attempted to hide the fact that Craig is recording. Not acceptable.
                log("Terminating recording: Nick changed wrongly.");
                to.guild.voiceConnection.disconnect();
            }
        } catch (err) {}
    });
});

// Reconnect when we disconnect
var reconnectTimeout = null;
client.on("disconnect", () => {
    if (reconnectTimeout !== null) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    reconnectTimeout = setTimeout(() => {
        if (client.status !== 0)
            client.login(config.token).catch(()=>{});
        reconnectTimeout = null;
    }, 10000);
});

/***************************************************************
 * FEATURES BELOW THIS LINE ARE CONVENIENCE/UI FUNCTIONALITY
 **************************************************************/

// Keep track of "important" servers
var importantServers = {};
(function() {
    for (var ii = 0; ii < config.importantServers.length; ii++)
        importantServers[config.importantServers[ii]] = true;
})();

// Update our guild count every hour
var lastServerCount = 0;
setInterval(() => {
    if (cc.dead)
        return;

    if (config.discordbotstoken) {
        // Report to discordbots.org
        try {
            var curServerCount = client.guilds.size;
            if (lastServerCount === curServerCount)
                return;
            lastServerCount = curServerCount;
            var postData = JSON.stringify({
                server_count: curServerCount
            });
            var req = https.request({
                hostname: "discordbots.org",
                path: "/api/bots/" + client.user.id + "/stats",
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": postData.length,
                    "Authorization": config.discordbotstoken
                }
            }, () => {});
            req.write(postData);
            req.end();
        } catch(ex) {}
    }
}, 3600000);

// Use a server topic to show stats
if (config.stats) {
    (function(){
        var channel = null;
        
        client.on("ready", ()=>{
            try {
                channel = client.guilds.get(config.stats.guild).channels.get(config.stats.channel);
            } catch (ex) {}
        });

        var users = -1;
        var channels = -1;
        function updateTopic(stoppedRec) {
            if (cc.dead)
                return;

            try {
                var newUsers = 0;
                var newChannels = 0;

                for (var gid in activeRecordings) {
                    var g = activeRecordings[gid];
                    for (var cid in g) {
                        var rec = g[cid];
                        if (rec === stoppedRec)
                            continue;
                        if (rec.connection) {
                            try {
                                newUsers += rec.connection.channel.members.size - 1;
                                newChannels++;
                            } catch (ex) {}
                        }
                    }
                }

                var topic = config.stats.topic;
                if (newChannels)
                    topic += " Currently recording " + newUsers + " users in " + newChannels + " voice channels.";
                if (users != newUsers || channels != newChannels) {
                    channel.setTopic(topic);
                    users = newUsers;
                    channels = newChannels;
                }
                return topic;
            } catch (ex) {
                return ex;
            }
        }
        recordingEvents.on("start", ()=>{updateTopic();});
        recordingEvents.on("stop", updateTopic);

        // And a command to get the full stats
        var statsCp = null;
        commands["stats"] = function(msg, cmd) {
            if (cc.dead)
                return;

            if (!msg.guild || msg.guild.id !== config.stats.guild || statsCp)
                return;

            var statsOut = "";
            statsCp = cp.fork("./stats.js", [config.log], {
                stdio: ["ignore", "pipe", process.stderr, "ipc"]
            });
            statsCp.on("exit", ()=>{
                statsCp = null;
            });
            statsCp.stdout.on("data", (chunk) => {
                statsOut += chunk.toString("utf8");
            });
            statsCp.stdout.on("end", () => {
                msg.reply("\n" + statsOut);
            });
        }
    })();
}

// Association of users with arrays autorecord guild+channels
var autoU2GC = {};

// And guilds to user+channel
var autoG2UC = {};

// Use server roles to give rewards
if (config.rewards) (function() {
    // Journal of blesses
    var blessJournalF = null;

    // And the journal of autorecord changes
    var autoJournalF = null;

    // Resolve a user's rewards by their role
    function resolveRewards(member) {
        var rr = config.rewards.roles;
        var mrewards = {};

        member.roles.forEach((role) => {
            var rn = role.name.toLowerCase();
            if (rn in rr) {
                var roler = rr[rn];
                for (var rid in roler) {
                    if (rid !== "limits") mrewards[rid] = roler[rid];
                }
                if (roler.limits) {
                    if (!mrewards.limits) mrewards.limits = {record: config.limits.record, download: config.limits.download};
                    if (roler.limits.record > mrewards.limits.record)
                        mrewards.limits.record = roler.limits.record;
                    if (roler.limits.download > mrewards.limits.download)
                        mrewards.limits.download = roler.limits.download;
                }
            }
        });

        if (Object.keys(mrewards).length)
            rewards[member.id] = mrewards;
        else
            delete rewards[member.id];
        return mrewards;
    }

    // Remove a bless
    function removeBless(uid) {
        if (uid in blessU2G) {
            var gid = blessU2G[uid];
            var step = {u:uid};
            delete blessU2G[uid];
            delete blessG2U[gid];
            if (!cc.dead && blessJournalF)
                blessJournalF.write("," + JSON.stringify(step) + "\n");
        }
    }

    // Add a bless
    function addBless(uid, gid) {
        if (uid in blessU2G)
            removeBless(uid);

        var step = {u:uid, g:gid};
        blessU2G[uid] = gid;
        blessG2U[gid] = uid;
        if (!cc.dead && blessJournalF)
            blessJournalF.write("," + JSON.stringify(step) + "\n");
    }

    // Resolve blesses from U2G into G2U, asserting that the relevant uids actually have bless powers
    function resolveBlesses() {
        blessG2U = {};
        Object.keys(blessU2G).forEach((uid) => {
            var f = features(uid);
            if (f.bless)
                blessG2U[blessU2G[uid]] = uid;
            else
                delete blessU2G[uid];
        });
    }

    // Remove a user's autorecord
    function removeAutorecord(uid, gid) {
        if (uid in autoU2GC) {
            var gcs = autoU2GC[uid];
            for (var gci = 0; gci < gcs.length; gci++) {
                var gc = gcs[gci];
                if (gc.g !== gid) continue;

                // Found the one to remove
                gcs.splice(gci, 1);

                var step = {u:uid, g:gid};
                if (gcs.length === 0)
                    delete autoU2GC[uid];
                delete autoG2UC[gid];
                if (!cc.dead && autoJournalF)
                    autoJournalF.write("," + JSON.stringify(step) + "\n");

                return;
            }
        }
    }

    // Add an autorecord for a user
    function addAutorecord(uid, gid, cid, tids) {
        removeAutorecord(uid, gid);
        var step = {u:uid, g:gid, c:cid};
        if (tids)
            step.t = tids;
        if (!(uid in autoU2GC)) autoU2GC[uid] = [];
        autoU2GC[uid].push(step);
        autoG2UC[gid] = step;
        if (!cc.dead && autoJournalF)
            autoJournalF.write("," + JSON.stringify(step) + "\n");
    }

    // Resolve autorecords from U2GC into G2UC, asserting that the relevant uids actually have auto powers
    function resolveAutos() {
        autoG2UC = {};
        Object.keys(autoU2GC).forEach((uid) => {
            var f = features(uid);
            if (f.auto) {
                var gcs = autoU2GC[uid];
                for (var gci = 0; gci < gcs.length; gci++) {
                    var gc = gcs[gci];
                    autoG2UC[gc.g] = gc;
                }
            } else {
                delete autoU2GC[uid];
            }
        });
    }

    // Get our initial rewards on connection
    client.on("ready", () => {
        var rr = config.rewards.roles;
        var guild = client.guilds.get(config.rewards.guild);
        if (!guild) return;
        guild.fetchMembers().then((guild) => {
            guild.roles.forEach((role) => {
                var rn = role.name.toLowerCase();
                if (rn in rr)
                    role.members.forEach(resolveRewards);
            });

            // Get our bless status
            if (cu.accessSyncer("craig-bless.json")) {
                try {
                    var journal = JSON.parse("["+fs.readFileSync("craig-bless.json", "utf8")+"]");
                    blessU2G = journal[0];
                    for (var ji = 1; ji < journal.length; ji++) {
                        var step = journal[ji];
                        if ("g" in step)
                            blessU2G[step.u] = step.g;
                        else
                            delete blessU2G[step.u];
                    }
                } catch (ex) {}
            }
            resolveBlesses();
            blessJournalF = fs.createWriteStream("craig-bless.json", "utf8");
            blessJournalF.write(JSON.stringify(blessU2G) + "\n");


            // And get our auto status
            if (cu.accessSyncer("craig-auto.json")) {
                try {
                    var journal = JSON.parse("["+fs.readFileSync("craig-auto.json", "utf8")+"]");
                    autoU2GC = journal[0];
                    for (var ji = 1; ji < journal.length; ji++) {
                        var step = journal[ji];
                        if ("c" in step)
                            addAuto(step.u, step.g, step.c, step.t);
                        else
                            removeAuto(step.u, step.g);
                    }
                } catch (ex) {}
            }
            resolveAutos();
            autoJournalF = fs.createWriteStream("craig-auto.json", "utf8");
            autoJournalF.write(JSON.stringify(autoU2GC) + "\n");
        });
    });

    // Reresolve a member when their roles change
    client.on("guildMemberUpdate", (from, to) => {
        if (to.guild.id !== config.rewards.guild) return;
        if (from.roles === to.roles) return;
        var r = resolveRewards(to);
        if (!r.bless && to.id in blessU2G)
            removeBless(to.id);
    });

    // And a command to bless a guild
    commands["bless"] = function(msg, cmd) {
        if (cc.dead) return;

        // Only makes sense in a guild
        if (!msg.guild) return;

        var f = features(msg.author.id);
        if (!f.bless) {
            reply(msg, false, cmd[1], "You do not have permission to bless servers.");
            return;
        }

        addBless(msg.author.id, msg.guild.id);
        reply(msg, false, cmd[1], "This server is now blessed. All recordings in this server have your added features.");
    }

    commands["unbless"] = function(msg, cmd) {
        if (cc.dead) return;

        if (!(msg.author.id in blessU2G)) {
            reply(msg, false, cmd[1], "But you haven't blessed a server!");
        } else {
            removeBless(msg.author.id);
            reply(msg, false, cmd[1], "Server unblessed.");
        }
    }

    const mention = /^<@!?([0-9]*)>[ \t,]*(.*)$/;

    // And a command to autorecord a channel
    commands["autorecord"] = function(msg, cmd) {
        if (cc.dead) return;
        if (!msg.guild) return;
        var cname = cmd[3].toLowerCase();

        var f = features(msg.author.id);
        if (!f.auto) {
            reply(msg, false, cmd[1], "You do not have permission to set up automatic recordings.");
            return;
        }

        if (cname === "off") {
            if (msg.author.id in autoU2GC) {
                var gcs = autoU2GC[msg.author.id];
                for (var gci = 0; gci < gcs.length; gci++) {
                    var gc = gcs[gci];
                    if (gc.g === msg.guild.id) {
                        removeAutorecord(msg.author.id, gc.g);
                        reply(msg, false, cmd[1], "Autorecord disabled.");
                        return;
                    }
                }
            }

            reply(msg, false, cmd[1], "But you don't have an autorecord set on this server!");

        } else {
            // Look for triggers first
            var triggers = {};
            var t, tc = 0;
            while ((t = mention.exec(cname)) !== null) {
                // Has a trigger
                triggers[t[1]] = true;
                cname = t[2];
                tc++;
            }
            if (tc === 0) triggers = undefined;

            var channel = findChannel(msg, msg.guild, cname);
            if (channel === null) {
                reply(msg, false, cmd[1], "What channel?");
                return;
            }

            addAutorecord(msg.author.id, msg.guild.id, channel.id, triggers);
            reply(msg, false, cmd[1], "I will now automatically record " + channel.name + ". Please make sure you can receive DMs from me; I will NOT send autorecord links publicly!");
        }
    }

    // Watch for autorecord opportunities
    client.on("voiceStateUpdate", (from, to) => {
        if (from.voiceChannel === to.voiceChannel) return;
        var guild = to.guild;
        var guildId = guild.id;
        if (!(guild.id in autoG2UC)) return;
        var uc = autoG2UC[guildId];
        var voiceChannel = from.voiceChannel || to.voiceChannel;
        var channelId = voiceChannel.id;
        if (!voiceChannel || uc.c !== channelId) return;
        var triggers = uc.t;

        // Something has happened on a voice channel we're watching for autorecording
        var recording = false, shouldRecord = false;
        if (guildId in activeRecordings &&
            channelId in activeRecordings[guildId])
            recording = true;
        voiceChannel.members.some((member) => {
            if ((triggers && triggers[member.id]) ||
                (!triggers && !member.user.bot)) {
                shouldRecord = true;
                return true;
            }
            return false;
        });

        // Should we start or stop a recording?
        if (recording !== shouldRecord) {
            // OK, make sure we have everything we need
            guild.fetchMember(uc.u).then((member) => {
                var msg = {
                    author: member.user,
                    member: member,
                    channel: member,
                    guild: guild,
                    reply: (msg) => {
                        return member.send(msg);
                    }
                };
                var cmd = shouldRecord ? "join" : "leave";
                log("Auto-record " + cmd + ": " + nameId(voiceChannel) + "@" + nameId(guild) + " requested by " + nameId(member));
                commands[cmd](msg, ["", null, cmd, voiceChannel.name]);
            });
        }
    });
})();
