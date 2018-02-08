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
 * Guild membership status and automatic guild leaving when not in use.
 */

const fs = require("fs");
const https = require("https");

const cc = require("./client.js");
const config = cc.config;
const sm = cc.sm;
const client = cc.client;
const clients = cc.clients;
const logex = cc.logex;

const cu = require("./utils.js");

/* Our guild membership status
 *
 * SHARDING:
 * Shard manager has shared guild membership status and manages the status
 * journal; updates come from shards. The shard manager sets the original guild
 * membership status for all shards.
 */
var guildMembershipStatus = {};
if (cc.master) {
    if (cu.accessSyncer("craig-guild-membership-status.json")) {
        try {
            var lines = fs.readFileSync("craig-guild-membership-status.json", "utf8").split("\n");
            try {
                guidlMembershipStatus = JSON.parse(lines[0]);
            } catch (ex) {
                logex(ex);
            }
            for (var li = 1; li < lines.length; li++) {
                try {
                    var step = JSON.parse("[0" + lines[li] + "]")[1];
                    if ("v" in step)
                        guildMembershipStatus[step.k] = step.v;
                    else
                        delete guildMembershipStatus[step.k];
                } catch (ex) {
                    logex(ex);
                }
            }
        } catch (ex) {
            logex(ex);
        }
    }
    var guildMembershipStatusF = fs.createWriteStream("craig-guild-membership-status.json", "utf8");
    guildMembershipStatusF.write(JSON.stringify(guildMembershipStatus) + "\n");

    if (sm) {
        function sendGMS(shard) {
            shard.send({t:"guildMembershipStatus", s:guildMembershipStatus});
        }
        sm.on("launch", sendGMS);
        sm.shards.forEach(sendGMS);
    }

} else {
    cc.processCommands["guildMembershipStatus"] = function(msg) {
        /* We only have a single shared guildMembershipStatus object, so we
         * have to copy over */
        for (var g in msg.s)
            guildMembershipStatus[g] = msg.s[g];
    }

}

// We keep the list of blessed guilds here just so that we can keep them alive
var blessG2U = {};

// Leave this guild on all clients
function guildLeave(guild) {
    clients.forEach((client) => {
        if (!client) return;
        var g = client.guilds.get(guild.id);
        if (g)
            g.leave().catch(logex);
    });
}

var guildRefresh, guildDelete;

if (cc.master) {
    guildRefresh = function(guild) {
        if (cc.dead) return;
        var step = {"k": guild.id, "v": (new Date().getTime())};
        guildMembershipStatus[step.k] = step.v;
        guildMembershipStatusF.write("," + JSON.stringify(step) + "\n");
    }

    guildDelete = function(guild) {
        if (cc.dead) return;
        guildLeave(guild);
        var step = {"k": guild.id};
        delete guildMembershipStatus[step.k];
        guildMembershipStatusF.write("," + JSON.stringify(step) + "\n");
    }

    if (sm) {
        cc.shardCommands["guildRefresh"] = function(shard, msg) {
            guildRefresh({id:msg.g});
        }

        cc.shardCommands["guildDelete"] = function(shard, msg) {
            guildDelete({id:msg.g});
        }
    }

} else {
    guildRefresh = function(guild) {
        client.shard.send({t:"guildRefresh", g:guild.id});
    }

    guildDelete = function(guild) {
        guildLeave(guild);
        client.shard.send({t:"guildDelete", g:guild.id});
    }

}

// Keep track of "important" servers
const importantServers = {};
(function() {
    for (var ii = 0; ii < config.importantServers.length; ii++)
        importantServers[config.importantServers[ii]] = true;
})();

// Check/report our guild membership status every hour
function checkGMS() {
    var client;

    if (cc.dead)
        return;

    clients.forEach((client) => {
        if (!client) return;
        client.guilds.forEach((guild) => {
            if (!(guild.id in guildMembershipStatus)) {
                guildRefresh(guild);
                return;
            }

            if (guildMembershipStatus[guild.id] + config.guildMembershipTimeout < (new Date().getTime())) {
                if ((guild.id in importantServers) || (guild.id in blessG2U)) {
                    guildRefresh(guild);
                    return;
                }

                // Time's up!
                guildDelete(guild);
            }
        });
    });
}
setInterval(checkGMS, 3600000);

// Update our guild count every hour
var lastServerCount = 0;
function updateGuildCt() {
    if (cc.dead)
        return;

    if (config.discordbotstoken || config.botsdiscordpwtoken) {
        if (client) {
            report(client.guilds.size);
        } else {
            // Need to get the combined size of all shards
            sm.fetchClientValues("guilds.size").then((results) => {
                var size = 0;
                results.forEach((r) => { size += r; });
                report(size);
            }).catch(logex);
        }

        function report(size) {
            // Report to bot lists
            var curServerCount = size;
            if (lastServerCount === curServerCount)
                return;
            lastServerCount = curServerCount;
            var postData = JSON.stringify({
                server_count: curServerCount
            });

            var domains = {discordbotstoken: "discordbots.org", botsdiscordpwtoken: "bots.discord.pw"};
            for (var tname in domains) {
                var domain = domains[tname];
                var dtoken = config[tname];
                if (!dtoken) continue;

                try {
                    var req = https.request({
                        hostname: domain,
                        path: "/api/bots/" + client.user.id + "/stats",
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Content-Length": postData.length,
                            "Authorization": dtoken
                        }
                    }, () => {});
                    req.write(postData);
                    req.end();
                } catch(ex) {
                    logex(ex);
                }
            }
        }
    }
}
if (cc.master && (config.discordbotstoken || config.botsdiscordpwtoken))
    setInterval(updateGuildCt, 3600000);

module.exports = {guildMembershipStatus, blessG2U, guildRefresh, guildDelete, importantServers};
