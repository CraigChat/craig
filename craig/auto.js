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
 * Support for auto-recording.
 */

const fs = require("fs");

const cc = require("./client.js");
const client = cc.client;
const config = cc.config;
const log = cc.log;
const logex = cc.logex;
const nameId = cc.nameId;

const cu = require("./utils.js");
const reply = cu.reply;

const commands = require("./commands.js").commands;

const cf = require("./features.js");
const cr = require("./rec.js");

// SHARDING: All of these data structures are shared amongst all shards.

// Association of users with arrays autorecord guild+channels
var autoU2GC = {};

// And guilds to user+channel
var autoG2UC = {};

// Use server roles to give rewards
if (config.rewards) (function() {
    // And the journal of autorecord changes
    var autoJournalF = null;

    // Remove a user's autorecord
    function removeAutorecordLocal(uid, gid) {
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

    function removeAutorecord(uid, gid) {
        removeAutorecordLocal(uid, gid);
        if (client.shard)
            client.shard.send({t:"removeAutorecord", from:client.shard.id, u:uid, g:gid});
    }

    cc.shardCommands["removeAutorecord"] = function(shard, msg) {
        removeAutorecordLocal(msg.u, msg.g);
        cc.sm.broadcast(msg);
    }

    cc.processCommands["removeAutorecord"] = function(msg) {
        removeAutorecordLocal(msg.u, msg.g);
    }

    // Add an autorecord for a user
    function addAutorecordLocal(uid, gid, cid, tids) {
        removeAutorecordLocal(uid, gid);
        var step = {u:uid, g:gid, c:cid};
        if (tids)
            step.t = tids;
        if (!(uid in autoU2GC)) autoU2GC[uid] = [];
        autoU2GC[uid].push(step);
        autoG2UC[gid] = step;
        if (!cc.dead && autoJournalF)
            autoJournalF.write("," + JSON.stringify(step) + "\n");
    }

    function addAutorecord(uid, gid, cid, tids) {
        addAutorecordLocal(uid, gid, cid, tids);
        if (client.shard)
            client.shard.send({t:"addAutorecord", from:client.shard.id, u:uid, g:gid, c:cid, tids:(tids?tids:false)});
    }

    cc.shardCommands["addAutorecord"] = function(shard, msg) {
        addAutorecordLocal(msg.u, msg.g, msg.c, msg.tids?msg.tids:undefined);
        cc.sm.broadcast(msg);
    }

    cc.processCommands["addAutorecord"] = function(msg) {
        addAutorecordLocal(msg.u, msg.g, msg.c, msg.tids?msg.tids:undefined);
    }

    if (cc.sm) {
        cc.sm.on("launch", (shard) => {
            for (var uid in autoU2GC) {
                var gcs = autoU2GC[uid];
                gcs.forEach((gc) => {
                    shard.send({
                        t:"addAutorecord",
                        u:uid,
                        g:gc.g, c:gc.c, tids:(gc.t?gc.t:false)
                    });
                });
            }
        });
    }

    // Resolve autorecords from U2GC into G2UC, asserting that the relevant uids actually have auto powers
    function resolveAutos() {
        autoG2UC = {};
        Object.keys(autoU2GC).forEach((uid) => {
            var f = cf.features(uid);
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

    // Load autorecords when we're ready (only fires on the shard with the rewards guild)
    cf.rewardsEvents.on("ready", () => {
        // Get our auto status
        if (cu.accessSyncer("craig-auto.json")) {
            try {
                var journal = JSON.parse("["+fs.readFileSync("craig-auto.json", "utf8")+"]");
                autoU2GC = journal[0];
                for (var ji = 1; ji < journal.length; ji++) {
                    var step = journal[ji];
                    if ("c" in step)
                        addAutorecord(step.u, step.g, step.c, step.t);
                    else
                        removeAutorecord(step.u, step.g);
                }
            } catch (ex) {
                logex(ex);
            }
        }
        resolveAutos();
        autoJournalF = fs.createWriteStream("craig-auto.json", "utf8");
        autoJournalF.write(JSON.stringify(autoU2GC) + "\n");

        // Send our autos along
        if (client.shard) {
            for (var uid in autoU2GC) {
                var gcs = autoU2GC[uid];
                gcs.forEach((gc) => {
                    client.shard.send({
                        t:"addAutorecord",
                        from:client.shard.id,
                        u:uid,
                        g:gc.g, c:gc.c, tids:(gc.t?gc.t:false)
                    });
                });
            }
        }
    });

    const mention = /^<@!?([0-9]*)>[ \t,]*(.*)$/;

    // And a command to autorecord a channel
    commands["autorecord"] = function(msg, cmd) {
        if (cc.dead) return;
        if (!msg.guild) return;
        var cname = cmd[3].toLowerCase();

        var f = cf.features(msg.author.id);
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

            var channel = cu.findChannel(msg, msg.guild, cname);
            if (channel === null) {
                reply(msg, false, cmd[1], "What channel?");
                return;
            }

            addAutorecord(msg.author.id, msg.guild.id, channel.id, triggers);
            reply(msg, false, cmd[1], "I will now automatically record " + channel.name + ". Please make sure you can receive DMs from me; I will NOT send autorecord links publicly!");
        }
    }

    // Watch for autorecord opportunities
    if (client) client.on("voiceStateUpdate", (from, to) => {
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
        if (guildId in cr.activeRecordings &&
            channelId in cr.activeRecordings[guildId])
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

module.exports = {get autoU2GC() { return autoU2GC; }};
