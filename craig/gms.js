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

const fs = require("fs");

const cc = require("./client.js");
const logex = cc.logex;

const cu = require("./utils.js");

const clients = cc.clients;

// Our guild membership status
var guildMembershipStatus = {};
if (cu.accessSyncer("craig-guild-membership-status.json")) {
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
    } catch (ex) {
        logex(ex);
    }
}
var guildMembershipStatusF = fs.createWriteStream("craig-guild-membership-status.json", "utf8");
guildMembershipStatusF.write(JSON.stringify(guildMembershipStatus) + "\n");

function guildRefresh(guild) {
    if (cc.dead) return;
    var step = {"k": guild.id, "v": (new Date().getTime())};
    guildMembershipStatus[step.k] = step.v;
    guildMembershipStatusF.write("," + JSON.stringify(step) + "\n");
}

function guildDelete(guild) {
    if (cc.dead) return;
    var step = {"k": guild.id};
    delete guildMembershipStatus[step.k];
    guildMembershipStatusF.write("," + JSON.stringify(step) + "\n");
}

// Check/report our guild membership status every hour
setInterval(() => {
    var client;

    if (cc.dead)
        return;

    for (var ci = 0; ci < clients.length; ci++) {
        client = clients[ci];
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
                for (var sci = 0; sci < clients.length; sci++) {
                    var g = clients[sci].guilds.get(guild.id);
                    if (g)
                        g.leave().catch(logex);
                }

                guildDelete(guild);
            }
        });
    }
}, 3600000);

module.exports = {guildMembershipStatus, guildRefresh, guildDelete};
