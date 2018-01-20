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
const Discord = require("discord.js");
const ogg = require("./craig-ogg.js");

const clientOptions = {fetchAllMembers: false, apiRequestMethod: "sequential"};

const client = new Discord.Client(clientOptions);
const clients = [client]; // For secondary connections
const config = JSON.parse(fs.readFileSync("config.json", "utf8"));

if (!("nick" in config))
    config.nick = "Craig";
if (!("hardLimit" in config))
    config.hardLimit = 536870912;
if (!("guildMembershipTimeout" in config))
    config.guildMembershipTimeout = 604800000;
if (!("secondary" in config))
    config.secondary = [];
if (!("importantServers" in config))
    config.importantServers = [];

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

// Our guild membership status
var guildMembershipStatus = {};
if (accessSyncer("craig-guild-membership-status.json")) {
    try {
        var journal = JSON.parse("["+fs.readFileSync("craig-guild-membership-status.json", "utf8")+"]");
        guildMembershipStatus = journal[0];
        for (var ji = 1; ji < journal.length; ji++) {
            var step = journal[ji];
            if ("v" in step)
                guildMembershipStatus[step.k] = step.v;
            else
                delete guildMembershipStatus[step.k];
        }
    } catch (ex) {}
}
var guildMembershipStatusF = fs.createWriteStream("craig-guild-membership-status.json", "utf8");
guildMembershipStatusF.write(JSON.stringify(guildMembershipStatus) + "\n");

function guildRefresh(guild) {
    if (dead) return;
    var step = {"k": guild.id, "v": (new Date().getTime())};
    guildMembershipStatus[step.k] = step.v;
    guildMembershipStatusF.write("," + JSON.stringify(step) + "\n");
}

// Log in
client.login(config.token).catch(()=>{});

// If there are secondary Craigs, log them in
for (var si = 0; si < config.secondary.length; si++) {
    clients.push(new Discord.Client(clientOptions));
    clients[si+1].login(config.secondary[si].token).catch(()=>{});
}

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

// Active recordings by guild, channel
var activeRecordings = {};

// Function to respond to a message by any means necessary
function reply(msg, dm, prefix, pubtext, privtext) {
    if (dm) {
        // Try to send the message privately
        if (typeof privtext === "undefined")
            privtext = pubtext;
        else
            privtext = pubtext + "\n\n" + privtext;
        log("Reply to " + nameId(msg.author) + ": " + privtext);

        function rereply() {
            reply(msg, false, prefix, "I can't send you direct messages. " + pubtext);
        }
        try {
            msg.author.send(privtext).catch(rereply);
        } catch (ex) {
            rereply();
        }
        return;
    }

    // Try to send it by conventional means
    log("Public reply to " + nameId(msg.author) + ": " + pubtext);
    msg.reply((prefix ? (prefix + " <(") : "") +
              pubtext +
              (prefix ? ")" : "")).catch((err) => {

    log("Failed to reply to " + nameId(msg.author));

    // If this wasn't a guild message, nothing to be done
    var guild = msg.guild;
    if (!guild)
        return;

    /* We can't get a message to them properly, so try to get a message out
     * that we're stimied */
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

    try {
        // Give ourself a name indicating error
        guild.members.get(client.user.id).setNickname("ERROR CANNOT SEND MESSAGES").catch(() => {});
    } catch (ex) {}

    });
}

// Our recording session proper
function session(msg, prefix, rec) {
    var connection = rec.connection;
    var id = rec.id;
    var client = rec.client;
    var nick = rec.nick;

    function sReply(dm, pubtext, privtext) {
        reply(msg, dm, prefix, pubtext, privtext);
    }

    var receiver = connection.createReceiver();
    const partTimeout = setTimeout(() => {
        sReply(true, "Sorry, but you've hit the recording time limit. Recording stopped.");
        rec.disconnected = true;
        connection.disconnect();
    }, 1000*60*60*6);

    // Rename ourself to indicate that we're recording
    try {
        connection.channel.guild.members.get(client.user.id).setNickname(nick + " [RECORDING]").catch((err) => {
            sReply(true, "I do not have permission to change my nickname on this server. I will not record without this permission.");
            rec.disconnected = true;
            connection.disconnect();
        });
    } catch (ex) {}

    // Log it
    try {
        log("Started recording " + nameId(connection.channel) + "@" + nameId(connection.channel.guild) + " with ID " + id);
    } catch(ex) {}

    // Our input Opus streams by user
    var userOpusStreams = {};

    // Track numbers for each active user
    var userTrackNos = {};

    // Packet numbers for each active user
    var userPacketNos = {};

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

    // And our ogg encoders
    var size = 0;
    function write(stream, granulePos, streamNo, packetNo, chunk, flags) {
        size += chunk.length;
        if (config.hardLimit && size >= config.hardLimit) {
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
    function encodeChunk(oggStream, streamNo, packetNo, chunk) {
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
                write(recOggHStream[0], 0, userTrackNo, 0, opusHeader[0], ogg.BOS);
                write(recOggHStream[1], 0, userTrackNo, 0, opusHeader[1]);
            } catch (ex) {}
        } else {
            userTrackNo = userTrackNos[user.id];
            packetNo = userPacketNos[user.id];
        }

        try {
            encodeChunk(recOggStream, userTrackNo, packetNo++, chunk);
            userPacketNos[user.id] = packetNo;
        } catch (ex) {}

        opusStream.on("data", (chunk) => {
            try {
                encodeChunk(recOggStream, userTrackNo, packetNo++, chunk);
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

        // Close the output files
        recOggHStream[0].end();
        recOggHStream[1].end();
        recOggStream.end();

        // Delete our leave timeout
        clearTimeout(partTimeout);

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
    // Start a new craig
    var ccp = cp.spawn(
        process.argv[0], ["craig.js"],
        {"stdio": "inherit", "detached": true});
    ccp.on("exit", (code) => {
        process.exit(code ? code : 1);
    });

    // Stop responding to input
    dead = true;
}

// Special commands from the owner
function ownerCommand(msg, cmd) {
    if (dead)
        return;

    var op = cmd[2].toLowerCase();

    try {
        log("Owner command: " + nameId(msg.author) + ": " + msg.content);
    } catch (ex) {}

    if (op === "graceful-restart") {
        reply(msg, false, cmd[1], "Restarting!");
        gracefulRestart();

    } else if (op === "eval") {
        var ex, res, ret;

        function stringify(x) {
            var r = "(unprintable)";
            try {
                r = JSON.stringify(x);
                if (typeof r !== "string")
                    throw new Exception();
            } catch (ex) {
                try {
                    r = x+"";
                } catch (ex) {}
            }
            return r;
        }

        function quote(x) {
            return "```" + stringify(x).replace("```", "` ` `") + "```";
        }

        res = ex = undefined;
        try {
            res = eval(cmd[3]);
        } catch (ex2) {
            ex = ex2;
        }

        ret = "";
        if (ex) {
            ex = ex+"";
            ret += "Exception: " + quote(ex) + "\n";
        }
        ret += "Result: " + quote(res);

        reply(msg, true, null, "", ret);

    } else {
        reply(msg, false, cmd[1], "Huh?");

    }
}

// Our message receiver and command handler
client.on("message", (msg) => {
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

    // Keep this guild alive
    try {
        guildRefresh(msg.guild);
    } catch (ex) {}

    var op = cmd[2].toLowerCase();
    if (op === "join" || op === "record" || op === "rec" ||
        op === "leave" || op === "part") {
        var cname = cmd[3].toLowerCase();
        var channel = null;
        if (!msg.guild)
            return;

        if (dead && (op === "join" || op === "record" || op === "rec")) {
            // Not our job
            return;
        }

        msg.guild.channels.some((schannel) => {
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

        if (channel !== null) {
            var guild = msg.guild;
            var guildId = guild.id;
            var channelId = channel.id;
            if (op === "join" || op === "record" || op === "rec") {
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
                    guild = null;
                    chosenClient.guilds.some((cGuild) => {
                            if (cGuild.id === guildId) {
                            guild = cGuild;
                            return true;
                            }
                            return false;
                            });
                    if (guild) {
                        channel = null;
                        guild.channels.some((cChannel) => {
                                if (cChannel.id === channelId) {
                                channel = cChannel;
                                return true;
                                }
                                return false;
                                });
                    }
                }

                // Choose the right action
                if (channelId in activeRecordings[guildId]) {
                    var rec = activeRecordings[guildId][channelId];
                    reply(msg, true, cmd[1],
                            "I'm already recording that channel: https://craigrecords.yahweasel.com/?id=" +
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

                } else {
                    if (channel.joinable) {
                        // Make a random ID for it
                        var id;
                        do {
                            id = ~~(Math.random() * 1000000000);
                        } while (accessSyncer("rec/" + id + ".ogg.key"));
                        var recFileBase = "rec/" + id + ".ogg";

                        // Make an access key for it
                        var accessKey = ~~(Math.random() * 1000000000);
                        fs.writeFileSync(recFileBase + ".key", ""+accessKey, "utf8");

                        // Make a deletion key for it
                        var deleteKey = ~~(Math.random() * 1000000000);
                        fs.writeFileSync(recFileBase + ".delete", ""+deleteKey, "utf8");

                        // Make sure they get destroyed
                        var atcp = cp.spawn("at", ["now + 48 hours"],
                                {"stdio": ["pipe", 1, 2]});
                        atcp.stdin.write("rm -f " + recFileBase + ".header1 " +
                                recFileBase + ".header2 " + recFileBase + ".data " +
                                recFileBase + ".key " + recFileBase + ".delete\n");
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

                            /* The only way to reliably make sure we leave
                             * the channel is to join it, then leave it */
                            channel.join()
                                .then(() => { channel.leave(); })
                                .catch(() => {});

                            // Now get rid of it
                            delete activeRecordings[guildId][channelId];
                            if (Object.keys(activeRecordings[guildId]).length === 0) {
                                delete activeRecordings[guildId];
                            }

                            // Rename the bot in this guild
                            try {
                                guild.members.get(chosenClient.user.id).setNickname(reNick).catch(() => {});
                            } catch (ex) {}
                        }

                        var rec = {
                            connection: null,
                            id: id,
                            accessKey: accessKey,
                            client: chosenClient,
                            clientNum: chosenClientNum,
                            nick: reNick,
                            disconnected: false,
                            close: close
                        };
                        activeRecordings[guildId][channelId] = rec;

                        // Join the channel
                        channel.join().then((connection) => {
                            // Tell them
                            reply(msg, true, cmd[1],
                                "Recording! I will record up to six hours. Recordings are deleted automatically after 48 hours from the start of recording. The audio can be downloaded even while I'm still recording.\n\n" +
                                "Download link: https://craigrecords.yahweasel.com/?id=" + id + "&key=" + accessKey,
                                "To delete: https://craigrecords.yahweasel.com/?id=" + id + "&key=" + accessKey + "&delete=" + deleteKey + "\n.");

                            rec.connection = connection;

                            session(msg, cmd[1], rec);
                        }).catch((ex) => {
                            reply(msg, false, cmd[1], "Failed to join! " + ex);
                            close();
                        });

                    } else {
                        reply(msg, false, cmd[1], "I don't have permission to join that channel!");

                    }

                }

            } else {
                if (guildId in activeRecordings &&
                        channelId in activeRecordings[guildId]) {
                    try {
                        var rec = activeRecordings[guildId][channelId];
                        if (rec.connection) {
                            rec.disconnected = true;
                            rec.connection.disconnect();
                        }
                    } catch (ex) {}
                } else {
                    if (!dead)
                        reply(msg, false, cmd[1], "But I'm not recording that channel!");
                }

            }

        } else if (!dead) {
            reply(msg, false, cmd[1], "What channel?");

        }

    } else if (op === "stop") {
        var guildId = msg.guild.id;
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
        } else if (!dead) {
            reply(msg, false, cmd[1], "But I haven't started!");
        }

    } else if (!dead && (op === "help" || op === "commands" || op === "hello")) {
        reply(msg, false, cmd[1],
            "Hello! I'm Craig! I'm a multi-track voice channel recorder. For more information, see http://craigrecords.yahweasel.com/home/ ");

    }
});

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
                    to.guild.voiceConnection.disconnect();
                }
            }
        } catch (err) {}
    });

    client.on("guildUpdate", (from, to) => {
        try {
            if (from.region !== to.region) {
                // The server has moved regions. This breaks recording.
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

// Keep track of "important" servers
var importantServers = {};
(function() {
    for (var ii = 0; ii < config.importantServers.length; ii++)
        importantServers[config.importantServers[ii]] = true;
})();

// Check/report our guild membership status every hour
var lastServerCount = 0;
setInterval(() => {
    var client;

    if (dead)
        return;

    for (var ci = 0; ci < clients.length; ci++) {
        client = clients[ci];
        client.guilds.every((guild) => {
            if (!(guild.id in guildMembershipStatus)) {
                guildRefresh(guild);
                return true;
            }

            if (guildMembershipStatus[guild.id] + config.guildMembershipTimeout < (new Date().getTime())) {
                if (guild.id in importantServers) {
                    guildRefresh(guild);
                    return true;
                }

                // Time's up!
                for (var sci = 0; sci < clients.length; sci++) {
                    var g = clients[sci].guilds.get(guild.id);
                    if (g)
                        g.leave().catch(()=>{});
                }

                var step = {"k": guild.id};
                delete guildMembershipStatus[guild.id];
                guildMembershipStatusF.write("," + JSON.stringify(step) + "\n");
            }

            return true;
        });
    }

    if (config.discordbotstoken) {
        // Report to discordbots.org
        client = clients[0];
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
