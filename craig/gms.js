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

const cdb = require("./db.js");
const db = cdb.db;

// Guild membership status is kept temporarily here, but the canonical copy is in the database
var guildMembershipStatus = {};
db.prepare("SELECT * FROM guildMembershipStatus").all().forEach((row) => {
    guildMembershipStatus[row.id] = row.refreshed;
});

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

const guildRefreshStmt = db.prepare("INSERT OR REPLACE INTO guildMembershipStatus (id, refreshed) VALUES (@id, @refreshed);");
function guildRefresh(guild) {
    if (cc.dead) return;
    var step = {id: guild.id, refreshed: (new Date().getTime())};
    guildMembershipStatus[step.id] = step.refreshed;
    cdb.dbRun(guildRefreshStmt, step);
}

var guildDelete;
if (cc.master) {
    guildDelete = function(guild) {
        if (cc.dead) return;
        guildLeave(guild);
        delete guildMembershipStatus[guild.id];
        cdb.deleteGuild(guild.id);
    }

    if (sm) {
        cc.shardCommands["guildDelete"] = function(shard, msg) {
            guildDelete({id:msg.g});
        }
    }

} else {
    guildDelete = function(guild) {
        guildLeave(guild);
        delete guildMembershipStatus[guild.id];
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
            report(client.user.id, client.guilds.size);
        } else {
            // Need to get the id and combined size of all shards
            sm.fetchClientValues("user.id").then((results) => {
                var id = results[0];
                sm.fetchClientValues("guilds.size").then((results) => {
                    var size = 0;
                    results.forEach((r) => { size += r; });
                    report(id, size);
                }).catch(logex);
            }).catch(logex);
        }

        function report(id, size) {
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
                        path: "/api/bots/" + id + "/stats",
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

module.exports = {blessG2U, guildRefresh, guildDelete, importantServers};
