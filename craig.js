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
const ogg = require("./craig/ogg.js");

const cc = require("./craig/client.js");
const client = cc.client;
const clients = cc.clients;
const config = cc.config;
const log = cc.log;
const logex = cc.logex;
const recordingEvents = cc.recordingEvents;
const nameId = cc.nameId;

const cu = require("./craig/utils.js");
const reply = cu.reply;

const commands = require("./craig/commands.js").commands;

const gms = require("./craig/gms.js");

const cf = require("./craig/features.js");

require("./craig/rec.js");
require("./craig/auto.js");

process.on("unhandledRejection", (ex) => {
    logex(ex, "Unhandled promise rejection");
});

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

