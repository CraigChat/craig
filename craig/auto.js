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

// SHARDING: All of these data structures except for autoCur are shared amongst all shards.

// Association of users with arrays autorecord guild+channels
var autoU2GC = {};

// Association guild -> channel -> users/triggers
var autoG2C2U = {};

/* Map of currently active autorecordings. guild -> channel ->
   {
       to: result of setTimeout,
       retries: number of retries left,
       isAuto: true if any current recording was actually automatic
   }
*/
var autoCur = {};

// Use server roles to give rewards
if (config.rewards) (function() {
    // And the journal of autorecord changes
    var autoJournalF = null;

    // Remove a user's autorecord, for a specific channel or all channels
    function removeAutorecordLocal(uid, gid, cid) {
        // Remove it in one direction
        if (uid in autoU2GC) {
            var gcs = autoU2GC[uid];
            for (var gci = 0; gci < gcs.length; gci++) {
                var gc = gcs[gci];
                if (gc.g !== gid) continue;
                if (cid && gc.c !== cid) continue;

                // Found one to remove
                gcs.splice(gci, 1);
                if (gcs.length === 0)
                    delete autoU2GC[uid];
                gci--;

                var step = {u:uid, g:gid, c:cid};
                if (!cc.dead && autoJournalF)
                    autoJournalF.write("," + JSON.stringify(step) + "\n");
            }
        }

        // Then the other
        if (gid in autoG2C2U) {
            var c2u = autoG2C2U[gid];
            for (var ccid in c2u) {
                if (cid && ccid !== cid) continue;
                var us = c2u[ccid];
                for (var ui = 0; ui < us.length; ui++) {
                    var u = us[ui];
                    if (u.u !== uid) continue;

                    // Found one to remove
                    us.splice(ui, 1);
                    if (us.length === 0) {
                        delete c2u[ccid];
                        if (Object.keys(c2u).length === 0)
                            delete autoG2C2U[gid];
                    }
                    ui--;
                }
            }
        }
    }

    function removeAutorecord(uid, gid, cid) {
        removeAutorecordLocal(uid, gid, cid);
        if (client.shard)
            client.shard.send({t:"removeAutorecord", from:client.shard.id, u:uid, g:gid, c:cid});
    }

    cc.shardCommands["removeAutorecord"] = function(shard, msg) {
        removeAutorecordLocal(msg.u, msg.g, msg.c);
        cc.sm.broadcast(msg);
    }

    cc.processCommands["removeAutorecord"] = function(msg) {
        removeAutorecordLocal(msg.u, msg.g, msg.c);
    }

    // Add an autorecord for a user
    function addAutorecordLocal(uid, gid, cid, tids) {
        removeAutorecordLocal(uid, gid, cid);
        var i = {u:uid, g:gid, c:cid};
        var step = {u:uid, g:gid, c:cid, t:{}};
        if (tids) {
            i.t = tids;
            step.t = tids;
        }
        if (!(uid in autoU2GC)) autoU2GC[uid] = [];
        if (!(gid in autoG2C2U)) autoG2C2U[gid] = {};
        if (!(cid in autoG2C2U[gid])) autoG2C2U[gid][cid] = [];
        autoU2GC[uid].push(i);
        autoG2C2U[gid][cid].push(i);
        if (!cc.dead && autoJournalF)
            autoJournalF.write("," + JSON.stringify(step) + "\n");
    }

    function addAutorecord(uid, gid, cid, tids) {
        if (tids && Object.keys(tids).length === 0)
            tids = undefined;
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

    // Resolve autorecords from U2GC into G2C2U, asserting that the relevant uids actually have auto powers
    function resolveAutos() {
        autoG2C2U = {};
        Object.keys(autoU2GC).forEach((uid) => {
            var f = cf.features(uid);
            if (f.auto) {
                var gcs = autoU2GC[uid];
                for (var gci = 0; gci < gcs.length; gci++) {
                    var gc = gcs[gci];
                    if (!(gc.g in autoG2C2U)) autoG2C2U[gc.g] = {};
                    if (!(gc.c in autoG2C2U[gc.g])) autoG2C2U[gc.g][gc.c] = [];
                    autoG2C2U[gc.g][gc.c].push(gc);
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
                var lines = fs.readFileSync("craig-auto.json", "utf8").split("\n");
                try {
                    autoU2GC = JSON.parse(lines[0]);
                } catch (ex) {
                    logex(ex);
                }
                for (var li = 1; li < lines.length; li++) {
                    try {
                        var step = JSON.parse("[0" + lines[li] + "]")[1];
                        if (!step) continue;
                        if ("t" in step)
                            addAutorecord(step.u, step.g, step.c, step.t);
                        else
                            removeAutorecord(step.u, step.g, step.c);
                    } catch (ex) {
                        logex(ex);
                    }
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
                        g:gc.g, c:gc.c, tids:(gc.t?gc.t:undefined)
                    });
                });
            }
        }
    });

    const subcmdRE = /^([A-Za-z]*)[ \t,]*(.*)$/;
    const mention = /^<@!?([0-9]*)>[ \t,]*(.*)$/;

    // And a command to set up autorecording
    commands["autorecord"] = function(msg, cmd) {
        if (cc.dead) return;
        if (!msg.guild) return;
        var subcmd = cmd[3].match(subcmdRE);
        if (!subcmd) return;
        var cname = subcmd[2].toLowerCase();
        subcmd = subcmd[1].toLowerCase();

        var f = cf.features(msg.author.id);
        if (!f.auto) {
            reply(msg, false, cmd[1], "You do not have permission to set up automatic recordings.");
            return;
        }

        switch (subcmd) {
            case "":
            case "help":
                reply(msg, false, cmd[1], 
                    "\nUse:\n\n" +
                    "> `:craig:, autorecord on [triggers] [channel name]`\n" +
                    "To activate autorecording on a given channel. Triggers must be @mentions.\n\n" +
                    "> `:craig:, autorecord off [channel name]`\n" +
                    "To deactivate autorecording. Give no channel name to deactivate all autorecordings on this server.\n\n" +
                    "> `:craig:, autorecord info`\n" +
                    "To list your current autorecordings on this server.\n");
                break;

            case "on":
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
                break;

            case "off":
                // Check if it's a specific channel
                var channel;
                if (cname !== "") {
                    channel = cu.findChannel(msg, msg.guild, cname);
                    if (channel === null) {
                        reply(msg, false, cmd[1], "What channel?");
                        return;
                    }
                }

                removeAutorecord(msg.author.id, msg.guild.id, channel?channel.id:undefined);
                reply(msg, false, cmd[1], "Autorecord disabled.");
                break;

            case "info":
                var info = "";
                if (msg.author.id in autoU2GC) {
                    var gcs = autoU2GC[msg.author.id];
                    for (var gci = 0; gci < gcs.length; gci++) {
                        var gc = gcs[gci];
                        if (gc.g !== msg.guild.id) continue;
                        var channel = msg.guild.channels.get(gc.c);
                        if (!channel) channel = {name:gc.c};
                        info += "\n" + channel.name;
                        if (gc.t)
                            info += " (specific triggers)";
                    }
                }
                if (info === "")
                    reply(msg, false, cmd[1], "You have no autorecords enabled.");
                else
                    reply(msg, false, cmd[1], "\nI am autorecording the following channels:" + info + "\n");
                break;
        }
    }

    // Watch for autorecord opportunities
    function voiceStateUpdate(to, from) {
        if (!from || !to) return;
        if (from.voiceChannel === to.voiceChannel) return;
        var guild = to.guild;
        var guildId = guild.id;
        if (!(guildId in autoG2C2U)) return;
        var c2u = autoG2C2U[guildId];
        var voiceChannel = from.voiceChannel || to.voiceChannel;
        var channelId = voiceChannel.id;
        if (!voiceChannel || !(channelId in c2u)) return;
        var us = c2u[channelId];

        if (guildId in autoCur && channelId in autoCur[guildId]) {
            var ac = autoCur[guildId][channelId];
            if (ac.to) {
                // Just bump the retries
                ac.retries = 5;
                return;
            }
        }

        updateAutorecord(guild, voiceChannel, us);
    }

    // Update autorecord state
    function updateAutorecord(guild, voiceChannel, us) {
        var guildId = guild.id;
        var channelId = voiceChannel.id;
        var u;

        // Something has happened on a voice channel we're watching for autorecording
        var recording = false, shouldRecord = false;
        if (guildId in cr.activeRecordings &&
            channelId in cr.activeRecordings[guildId])
            recording = true;
        voiceChannel.members.some((member) => {
            for (var ui = 0; ui < us.length; ui++) {
                u = us[ui];
                var triggers = u.t;
                if ((triggers && triggers[member.id]) ||
                    (!triggers && !member.user.bot)) {
                    shouldRecord = true;
                    return true;
                }
            }
            return false;
        });
        if (!u) return;

        // Check if we're already recording
        var ac;
        if (guildId in autoCur && channelId in autoCur[guildId])
            ac = autoCur[guildId][channelId];
        else
            ac = {to: null, retries: 5, isAuto: false};

        if (shouldRecord || (recording && !ac.isAuto)) {
            // We should be recording
            if (!(guildId in autoCur))
                autoCur[guildId] = {};
            autoCur[guildId][channelId] = ac;
            shouldRecord = true;

        } else if (!shouldRecord) {
            if (ac.isAuto) {
                if (!recording) {
                    // We're no longer recording, so this info is unnecessary
                    delete autoCur[guildId][channelId];
                    if (Object.keys(autoCur[guildId]).length === 0)
                        delete autoCur[guildId];
                }
            } else {
                // None of our business!
                shouldRecord = recording;

            }

        }

        // Should we start or stop a recording?
        if (recording !== shouldRecord) {
            ac.isAuto = true;

            // OK, make sure we have everything we need
            guild.fetchMember(u.u).then((member) => {
                if (!member) return;
                var msg = {
                    author: member.user,
                    member: member,
                    channel: member,
                    guild: guild,
                    reply: (msg) => {
                        try {
                            return member.send(msg);
                        } catch (ex) {
                            logex(ex);
                            return new Promise(()=>{});
                        }
                    }
                };

                log("Auto-record " + (shouldRecord?"join":"leave") + ": " +
                    nameId(voiceChannel) + "@" + nameId(guild) +
                    " requested by " + nameId(member));

                // Retry after 10 seconds to avoid spamming retries when things change quickly
                if (ac.retries > 0) {
                    ac.retries--;
                    ac.to = setTimeout(() => {
                        ac.to = null;
                        updateAutorecord(guild, voiceChannel, us);
                    }, 10000);
                }

                if (shouldRecord) {
                    commands["join"](msg, ["", null, "join", "-silence -auto " + voiceChannel.name]);
                } else {
                    commands["leave"](msg, ["", null, "leave", voiceChannel.name]);
                }
            });
        }
    }

    if (client) {
        client.on("voiceChannelJoin", (member, channel) => {
            voiceStateUpdate(member, {id: member.id, guild: member.guild});
        });
        client.on("voiceChannelLeave", (member, channel) => {
            voiceStateUpdate(member, {id: member.id, guild: member.guild, voiceChannelID: channel.id, voiceChannel: channel});
        });
        client.on("voiceChannelSwitch", (member, toChannel, fromChannel) => {
            voiceStateUpdate({id: member.id, guild: member.guild}, {id: member.id, guild: member.guild, voiceChannelID: fromChannel.id, voiceChannel: fromChannel});
            voiceStateUpdate(member, {id: member.id, guild: member.guild});
        });
    }
})();

module.exports = {get autoU2GC() { return autoU2GC; }};
