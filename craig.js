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
const cshared = require("./craig-shared.js");

const client = new Discord.Client();
const clients = [client]; // For secondary connections
const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
const nameId = cshared.nameId;

if (!("nick" in config))
    config.nick = "Craig";
if (!("hardLimit" in config))
    config.hardLimit = 536870912;
if (!("guildMembershipTimeout" in config))
    config.guildMembershipTimeout = 604800000;
if (!("secondary" in config))
    config.secondary = [];

function accessSyncer(file) {
    try {
        fs.accessSync(file);
    } catch (ex) {
        return false;
    }
    return true;
}

// Our guild membership status
var guildMembershipStatus = {};
if (accessSyncer("craig-guild-membership-status.json")) {
    var journal = JSON.parse("["+fs.readFileSync("craig-guild-membership-status.json", "utf8")+"]");
    guildMembershipStatus = journal[0];
    for (var ji = 1; ji < journal.length; ji++) {
        var step = journal[ji];
        if ("v" in step)
            guildMembershipStatus[step.k] = step.v;
        else
            delete guildMembershipStatus[step.k];
    }
}
var guildMembershipStatusF = fs.createWriteStream("craig-guild-membership-status.json", "utf8");
guildMembershipStatusF.write(JSON.stringify(guildMembershipStatus) + "\n");

function guildRefresh(guild) {
    var step = {"k": guild.id, "v": (new Date().getTime())};
    guildMembershipStatus[step.k] = step.v;
    guildMembershipStatusF.write("," + JSON.stringify(step) + "\n");
}

// If there are secondary Craigs, log them in
for (var si = 0; si < config.secondary.length; si++) {
    clients.push(new Discord.Client());
    clients[si+1].login(config.secondary[si].token);
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
        msg.author.send(privtext).catch((err) => {
            reply(msg, false, prefix, "I can't send you direct messages. " + pubtext);
        });
        return;
    }

    // Try to send it by conventional means
    msg.reply((prefix ? (prefix + " <(") : "") +
              pubtext +
              (prefix ? ")" : "")).catch((err) => {

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
        reply(msg, false, cmd[1], "Restarting!");

        // Start a new craig
        var ccp = cp.spawn(
            process.argv[0], ["craig.js"],
            {"stdio": "inherit", "detached": true});
        ccp.on("exit", (code) => {
            process.exit(code ? code : 1);
        });

        // Stop responding to input
        dead = true;

    } else {
        reply(msg, false, cmd[1], "Huh?");

    }
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

    // Keep this guild alive
    try {
        guildRefresh(msg.guild);
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

                            // Spawn off the child process
                            var ccp = cp.fork("./craig-rec.js");
                            activeRecordings[guildId][channelId] = {
                                "id": id, "accessKey": accessKey,
                                "clientNum": chosenClientNum,
                                "cp": ccp
                            };

                            try {
                                ccp.send({"type": "config", "config": config});
                                if (chosenClient !== client)
                                    ccp.send({"type": "client", "config": config.secondary[chosenClientNum-1]});
                                ccp.send({"type": "record", "record":
                                    {"guild": msg.guild.id,
                                     "channel": channel.id,
                                     "id": id,
                                     "accessKey": accessKey,
                                     "deleteKey": deleteKey}});
                            } catch (ex) {}

                            ccp.on("message", (cmsg) => {
                                switch (cmsg.type) {
                                    case "log":
                                        log(cmsg.line);
                                        break;

                                    case "reply":
                                        reply(msg, cmsg.dm, cmd[1], cmsg.pubtext, cmsg.privtext);
                                        break;
                                }
                            });

                            ccp.on("disconnect", () => {
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
                                var reNick = config.nick;
                                if (chosenClient !== client)
                                    reNick = config.secondary[chosenClientNum-1].nick;
                                try {
                                    guild.members.get(chosenClient.user.id).setNickname(reNick).catch(() => {});
                                } catch (ex) {}
                            });

                        } else {
                            reply(msg, false, cmd[1], "I don't have permission to join that channel!");

                        }

                    }

                } else {
                    if (guildId in activeRecordings &&
                        channelId in activeRecordings[guildId]) {
                        try {
                            activeRecordings[guildId][channelId].cp.send({"type": "stop"});
                        } catch (ex) {}
                    } else {
                        reply(msg, false, cmd[1], "But I'm not recording that channel!");
                    }

                }
            }

            return true;
        });

        if (!found)
            reply(msg, false, cmd[1], "What channel?");

    } else if (op === "stop") {
        var guildId = msg.guild.id;
        if (guildId in activeRecordings) {
            for (var channelId in activeRecordings[guildId]) {
                try {
                    activeRecordings[guildId][channelId].cp.send({"type": "stop"});
                } catch (ex) {}
            }
        } else {
            reply(msg, false, cmd[1], "But I haven't started!");
        }

    } else if (op === "help" || op === "commands" || op === "hello") {
        reply(msg, false, cmd[1],
            "Hello! I'm Craig! I'm a multi-track voice channel recorder. For more information, see http://craigrecords.yahweasel.com/home/ ");

    }
});

client.on("voiceStateUpdate", (from, to) => {
    try {
        if (from.id === client.user.id) {
            if (from.voiceChannelID != to.voiceChannelID) {
                // We do not tolerate being moved
                to.guild.voiceConnection.disconnect();
            }

/*
        } else if (to.guild.voiceConnection) {
            if (from.voiceChannelID === to.guild.voiceConnection.channel.id &&
                to.voiceChannelID !== from.voiceChannelID) {
                // Somebody left, see if it's empty aside from us
                if (!to.guild.voiceConnection.channel.members.some((member) => { return member.id !== client.user.id; })) {
                    // I'm alone! Heck with this!
                    to.guild.voiceConnection.disconnect();
                }
            }
*/

        }
    } catch (err) {}
});

client.login(config.token);
client.on("disconnect", () => {
    setTimeout(() => {
        if (client.status !== 0)
            client.login(config.token);
    }, 10000);
});

// Check our guild membership status occasionally
setInterval(() => {
    for (var ci = 0; ci < clients.length; ci++) {
        var client = clients[ci];
        client.guilds.every((guild) => {
            if (!(guild.id in guildMembershipStatus))
                guildRefresh(guild);

            if (guildMembershipStatus[guild.id] + config.guildMembershipTimeout < (new Date().getTime())) {
                // Time's up!
                for (var sci = 0; sci < clients.length; sci++)
                    clients[sci].guilds.every((sGuild) => {
                        if (sGuild.id === guild.id)
                            sGuild.leave().catch(() => {});
                        return true;
                    });

                var step = {"k": guild.id};
                delete guildMembershipStatus[guild.id];
                guildMembershipStatusF.write("," + JSON.stringify(step) + "\n");
            }

            return true;
        });
    }
}, 3600000);
