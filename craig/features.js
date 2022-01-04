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
 * Support for per-user/per-guild features.
 */

const cc = require("./client.js");
const client = cc.client;
const config = cc.config;

const cdb = require("./db.js");
const db = cdb.db;
const ccmds = require("./commands.js");
const commands = ccmds.commands;
const slashCommands = ccmds.slashCommands;

const cu = require("./utils.js");
const reply = cu.reply;

const cl = require("./locale.js");
const l = cl.l;

// DB commands
const getRewards = db.prepare("SELECT * FROM rewards WHERE uid=@uid;");
const putRewards = db.prepare("INSERT OR REPLACE INTO rewards (uid, rewards) VALUES (@uid, @rewards);");
const delRewards = db.prepare("DELETE FROM rewards WHERE uid=@uid;");
const delAllRewards = db.prepare("DELETE FROM rewards;");
const getBlessUID = db.prepare("SELECT * FROM blessings WHERE uid=@uid;");
const getBlessGID = db.prepare("SELECT * FROM blessings WHERE gid=@gid;");
const putBless = db.prepare("INSERT OR REPLACE INTO blessings (uid, gid) VALUES (@uid, @gid);");
const delBlessUID = db.prepare("DELETE FROM blessings WHERE uid=@uid;");
const delBlessGID = db.prepare("DELETE FROM blessings WHERE gid=@gid;");

// Default features
var defaultFeatures = config.defaultFeatures || {"limits": config.limits};

// Non-reward-based features
var otherFeatures = {};

// Get the features for a given user
async function features(id, gid) {
    // Do they have their own rewards?
    var r = await fetchRewards(id);
    if (r && r.limits) return r;

    // Are they in a blessed guild?
    if (gid) {
        var bu = await cdb.dbGet(getBlessGID, {gid});
        if (bu) {
            r = await fetchRewards(bu.uid);
            if (r && r.limits) return r;
        }
    }

    return defaultFeatures;
}

var fetchRewards = async function() { return null; }

// Set slash command responses for when these commands aren't set later
slashCommands["bless"] = async function(interaction) {
    if (cc.dead) return;
    interaction.createMessage({
        content: "This instance has no rewards to handle blessings.",
        flags: 64
    });
}
slashCommands["unbless"] = async function(interaction) {
    if (cc.dead) return;
    interaction.createMessage({
        content: "This instance has no rewards to handle blessings.",
        flags: 64
    });
}
slashCommands["webapp"] = async function(interaction) {
    if (cc.dead) return;
    interaction.createMessage({
        content: "This instance has no rewards to handle the webapp.",
        flags: 64
    });
}

// Use server roles to give rewards
if (config.rewards) (function() {
    // Fetch rewards for this user from the appropriate shard
    var fetchRewardsWait = {};
    fetchRewards = async function(uid) {
        // 1: Try to just get it
        var ret = await cdb.dbGet(getRewards, {uid});
        if (ret) return JSON.parse(ret.rewards);

        // 2: Check if we're the right client
        var guild = client.guilds.get(config.rewards.guild);
        if (guild) {
            // Look for this user
            await guild.fetchMembers({userIDs: [uid]});
            var member = guild.members.get(uid);
            if (!member) {
                // No member, no rewards!
                addRewards(uid, null);
                return null;
            }

            // Resolve the rewards
            var r = resolveRewards(member);
            if (Object.keys(r).length === 0)
                r = null;

            // And add it to the DB and notify
            addRewards(uid, r);
            return r;
        }

        // 3: We're not the right client, so ask around
        if (client.shard) {
            var p = new Promise(res => {
                fetchRewardsWait[uid] = res;
            });
            client.shard.send({t:"fetchRewards", from:client.shard.id, u:uid});
            await p;

            ret = await cdb.dbGet(getRewards, {uid});
            if (ret)
                return JSON.parse(ret.rewards);
            return null;
        }

        return null;
    }

    cc.shardCommands["fetchRewards"] = function(shard, msg) {
        cc.sm.broadcast(msg);
    }

    cc.processCommands["fetchRewards"] = function(msg) {
        if (client.guilds.has(config.rewards.guild))
            fetchRewards(msg.u);
    }

    // Add a reward to a user and tell everyone else we did so
    async function addRewards(uid, rew) {
        await cdb.dbRun(putRewards, {uid, rewards: JSON.stringify(rew)});
        if (client.shard)
            client.shard.send({t:"fetchedRewards", from:client.shard.id, u:uid});
    }

    cc.shardCommands["fetchedRewards"] = function(shard, msg) {
        cc.sm.broadcast(msg);
    }

    cc.processCommands["fetchedRewards"] = function(msg) {
        if (msg.u in fetchRewardsWait) {
            var res = fetchRewardsWait[msg.u];
            delete fetchRewardsWait[msg.u];
            res();
        }
    }

    // Resolve a user's rewards by their role
    function resolveRewards(member) {
        var rr = config.rewards.roles;
        var mrewards = {};

        member.roles.forEach((role) => {
            if (typeof role === "string")
                role = member.guild.roles.get(role);
            var rn = role.name.toLowerCase();
            if (rn in rr) {
                var roler = rr[rn];
                for (var rid in roler) {
                    if (rid !== "limits") mrewards[rid] = roler[rid];
                }
                if (roler.limits) {
                    if (!mrewards.limits) mrewards.limits = {};
                    ["record", "download", "secondary"].forEach((lim) => {
                        if (!mrewards.limits[lim]) mrewards.limits[lim] = 0;
                        if (roler.limits[lim] > mrewards.limits[lim])
                            mrewards.limits[lim] = roler.limits[lim];
                        if (!mrewards.limits[lim]) mrewards.limits[lim] = config.limits[lim];
                    });
                }
            }
        });
        return mrewards;
    }

    // Remove a bless
    function removeBless(uid) {
        cdb.dbRun(delBlessUID, {uid});
    }

    // Add a bless
    async function addBless(uid, gid) {
        await cdb.dbRun(delBlessUID, {uid});
        await cdb.dbRun(delBlessGID, {gid});
        await cdb.dbRun(putBless, {uid, gid});
    }

    /* Initialize by deleting rewards once the corrent client is connected, so
     * we use real information */
    var rewardsInited = false;
    function initRewards() {
        if (rewardsInited) return;
        rewardsInited = true;

        if (!client.guilds.get(config.rewards.guild))
            return;
        cdb.dbRun(delAllRewards);
    }
    if (client) {
        client.on("ready", initRewards);
        client.on("shardReady", initRewards);
    }

    // Reresolve a member when their roles change
    if (client) client.on("guildMemberUpdate", (guild, to, from) => {
        if (guild.id !== config.rewards.guild) return;
        var r = resolveRewards(to);
        if (Object.keys(r).length === 0)
            r = null;

        // And add it to the DB and notify
        addRewards(to.id, r);
    });

    // And a command to bless a guild
    commands["bless"] = async function(msg, cmd) {
        if (cc.dead) return;

        // Only makes sense in a guild
        if (!msg.guild) return;

        var f = await features(msg.author.id);
        if (!f.bless) {
            reply(msg, false, cmd[1], "You do not have permission to bless servers.");
            return;
        }

        addBless(msg.author.id, msg.guild.id);
        reply(msg, false, cmd[1], "This server is now blessed. All recordings in this server have your added features.");
    }

    slashCommands["bless"] = async function(interaction) {
        if (cc.dead) return;

        var f = await features(interaction.member.user.id);
        if (!f.bless) {
            interaction.createMessage({
                content: "You do not have permission to bless servers.",
                flags: 64
            });
            return;
        }

        addBless(interaction.member.user.id, interaction.channel.guild.id);
        interaction.createMessage({
            content: "This server is now blessed. All recordings in this server have your added features.",
            flags: 64
        });
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

    slashCommands["unbless"] = async function(interaction) {
        if (cc.dead) return;

        if (!(interaction.member.user.id in blessU2G)) {
            interaction.createMessage({
                content: "But you haven't blessed a server!",
                flags: 64
            });
        } else {
            removeBless(interaction.member.user.id);
            interaction.createMessage({
                content: "Server unblessed.",
                flags: 64
            });
        }
    }
})();

// Support for other features
(function() {
    // Insertion or removal of EnnuiCastr support
    const ennuicastrOnStmt = db.prepare("INSERT OR REPLACE INTO ennuicastr (uid) VALUES (@uid)");
    const ennuicastrOffStmt = db.prepare("DELETE FROM ennuicastr WHERE uid=@uid");

    // Enable EnnuiCastr for a user
    function ecEnable(uid) {
        otherFeatures[uid] = {ennuicastr: true};
        if (client.shard)
            client.shard.send({t:"ecEnable", from:client.shard.id, u:uid});
    }

    cc.shardCommands["ecEnable"] = function(shard, msg) {
        otherFeatures[msg.u] = {ennuicastr: true};
        cc.sm.broadcast(msg);
    }

    cc.processCommands["ecEnable"] = function(msg) {
        otherFeatures[msg.u] = {ennuicastr: true};
    }

    // Disable EnnuiCastr for a user
    function ecDisable(uid) {
        delete otherFeatures[uid];
        if (client.shard)
            client.shard.send({t:"ecDisable", from:client.shard.id, u:uid});
    }

    cc.shardCommands["ecDisable"] = function(shard, msg) {
        delete otherFeatures[msg.u];
        cc.sm.broadcast(msg);
    }

    cc.processCommands["ecDisable"] = function(msg) {
        delete otherFeatures[msg.u];
    }

    if (cc.sm) {
        cc.sm.on("launch", (shard) => {
            for (var uid in otherFeatures) {
                if (otherFeatures[uid].ennuicastr)
                    shard.send({t:"ecEnable", u:uid});
            }
        });
    }

    // Get our initial other features on connection
    var ennuicastrInited = false;
    function initEnnuicastr() {
        if (ennuicastrInited) return;
        ennuicastrInited = true;

        db.prepare("SELECT * FROM ennuicastr").all().forEach((row) => {
            otherFeatures[row.uid] = {ennuicastr: true};
        });
    }
    if (client) {
        client.on("ready", initEnnuicastr);
        client.on("shardReady", initEnnuicastr);
    }

    // A command to enable or disable EnnuiCastr use
    function cmdEnnuicastr(lang) { return function(msg, cmd) {
        if (cc.dead) return;
        var uid = msg.author.id;
        var lon = l("on", lang);
        var loff = l("off", lang);

        switch (cmd[3].toLowerCase()) {
            case "on":
            case lon:
                cdb.dbRun(ennuicastrOnStmt, {uid});
                ecEnable(uid);
                reply(msg, false, cmd[1], l("ecenable", lang));
                break;

            case "off":
            case loff:
                cdb.dbRun(ennuicastrOffStmt, {uid});
                ecDisable(uid);
                reply(msg, false, cmd[1], l("ecdisable", lang));
                break;

            default:
                if (otherFeatures[uid] && otherFeatures[uid].ennuicastr)
                    reply(msg, false, cmd[1], l("ecenabled", lang));
                else
                    reply(msg, false, cmd[1], l("ecdisabled", lang));
        }
    } }
    if (config.ennuicastr) {
        cl.register(commands, "ennuicastr", cmdEnnuicastr);
        slashCommands["webapp"] = function(interaction) {
            if (cc.dead) return;
            var uid = interaction.member.user.id;

            const subcommand = interaction.data.options[0];
            switch (subcommand.name) {
                case "on":
                    cdb.dbRun(ennuicastrOnStmt, {uid});
                    ecEnable(uid);
                    interaction.createMessage({
                        content: l("ecenable", 'en'),
                        flags: 64
                    });
                    break;
    
                case "off":
                    cdb.dbRun(ennuicastrOffStmt, {uid});
                    ecDisable(uid);
                    interaction.createMessage({
                        content: l("ecdisable", 'en'),
                        flags: 64
                    });
                    break;

                default:
                    interaction.createMessage({
                        content: l(otherFeatures[uid] && otherFeatures[uid].ennuicastr ? "ecenabled" : "ecdisabled", 'en'),
                        flags: 64
                    });
            }
        }
    }
})();

// Turn features into a string
function featuresToStr(f, guild, prefix) {
    var ret = "\n";
    if (f === defaultFeatures)
        ret += "Default features:";
    else
        ret += prefix + ":";
    ret += "\nRecording time limit: " + f.limits.record + " hours" +
           "\nDownload time limit: " + f.limits.download + " hours" +
           "\nMaximum channels: " + (f.limits.secondary+1);

    if (f.mix)
        ret += "\nYou may download auto-leveled mixed audio.";
    if (f.auto)
        ret += "\nYou may autorecord channels.";
    if (f.glowers)
        ret += "\nYou may download avatar glowers.";
    if (f.bless && !guild)
        ret += "\nYou may bless servers.";
    if (f.eccontinuous)
        ret += "\nYou may use continuous mode in EnnuiCastr.";
    if (f.ecflac)
        ret += "\nYou may record FLAC with EnnuiCastr.";
    if (f.mp3)
        ret += "\nYou may download MP3.";

    return ret;
}

// Tell the user their features
commands["features"] = async function(msg, cmd) {
    if (cc.dead) return;

    var f = await features(msg.author.id);
    var gf = await features(msg.author.id, msg.guild ? msg.guild.id : undefined);

    var ret = featuresToStr(f, false, "For you");
    if (gf !== f)
        ret += "\n" + featuresToStr(gf, true, "For this server");

    reply(msg, false, false, ret);
}

slashCommands["features"] = async function(interaction) {
    if (cc.dead) return;

    var f = await features(interaction.member.user.id);
    var gf = await features(interaction.member.user.id, interaction.channel.guild ? interaction.channel.guild.id : undefined);

    var ret = featuresToStr(f, false, "For you");
    if (gf !== f)
        ret += "\n" + featuresToStr(gf, true, "For this server");

    interaction.createMessage({
        content: ret,
        flags: 64
    });
}


module.exports = {defaultFeatures, features, otherFeatures};
