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

const fs = require("fs");
const EventEmitter = require("events");

const cc = require("./client.js");
const client = cc.client;
const config = cc.config;
const logex = cc.logex;

const cdb = require("./db.js");
const db = cdb.db;
const commands = require("./commands.js").commands;

const cu = require("./utils.js");
const reply = cu.reply;

const cl = require("./locale.js");
const l = cl.l;

const gms = require("./gms.js");

/* SHARDING NOTE:
 * Every shard will have identical copies of all of these data structures.
 */

// An event emitter for when we've loaded our rewards
class RewardsEvent extends EventEmitter {}
const rewardsEvents = new RewardsEvent();

// A map user ID -> rewards
var rewards = {}; // NOTE: Ref can change!
var defaultFeatures = {"limits": config.limits};

// A map user ID -> other features (right now, just EnnuiCastr)
var otherFeatures = {};

// A map of users with rewards -> blessed guilds. Vice-versa is in gms.
var blessU2G = {};
const blessG2U = gms.blessG2U;

// Get the features for a given user
function features(id, gid) {
    // Do they have their own rewards?
    var r = rewards[id];
    if (r && r.limits) return r;

    // Are they in a blessed guild?
    if (gid && gid in blessG2U) {
        r = rewards[blessG2U[gid]];
        if (r && r.limits) return r;
    }

    return defaultFeatures;
}

// Use server roles to give rewards
if (config.rewards) (function() {
    // Bless statements
    const blessStmt = db.prepare("INSERT OR REPLACE INTO blessings (uid, gid) VALUES (@uid, @gid)");
    const unblessStmt = db.prepare("DELETE FROM blessings WHERE uid=@uid AND gid=@gid");

    // Add a reward to a user
    function addRewards(uid, rew) {
        rewards[uid] = rew;
        if (client.shard)
            client.shard.send({t:"addRewards", from:client.shard.id, u:uid, r:rew});
    }

    cc.shardCommands["addRewards"] = function(shard, msg) {
        rewards[msg.u] = msg.r;
        cc.sm.broadcast(msg);
    }

    cc.processCommands["addRewards"] = function(msg) {
        rewards[msg.u] = msg.r;
    }

    // Delete a reward from a user
    function deleteRewards(uid) {
        delete rewards[uid];
        if (client.shard)
            client.shard.send({t:"deleteRewards", from:client.shard.id, u:uid});
    }

    cc.shardCommands["deleteRewards"] = function(shard, msg) {
        delete rewards[msg.u];
        cc.sm.broadcast(msg);
    }

    cc.processCommands["deleteRewards"] = function(msg) {
        delete rewards[msg.u];
    }

    if (cc.sm) {
        cc.sm.on("launch", (shard) => {
            for (var uid in rewards)
                shard.send({t:"addRewards", u:uid, r:rewards[uid]});
        });
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

        if (Object.keys(mrewards).length)
            addRewards(member.id, mrewards);
        else
            deleteRewards(member.id);
        return mrewards;
    }

    // Remove a bless
    function removeBlessLocal(uid) {
        if (uid in blessU2G) {
            var gid = blessU2G[uid];
            delete blessU2G[uid];
            delete blessG2U[gid];
            if (!cc.dead && cc.master)
                cdb.dbRun(unblessStmt, {uid:uid, gid:gid});
        }
    }

    function removeBless(uid) {
        removeBlessLocal(uid);
        if (client.shard)
            client.shard.send({t:"removeBless", from:config.shard.id, u:uid});
    }

    cc.shardCommands["removeBless"] = function(shard, msg) {
        removeBlessLocal(msg.u);
        cc.sm.broadcast(msg);
    }

    cc.processCommands["removeBless"] = function(msg) {
        removeBlessLocal(msg.u);
    }

    // Add a bless
    function addBlessLocal(uid, gid) {
        if (uid in blessU2G)
            removeBlessLocal(uid);

        blessU2G[uid] = gid;
        blessG2U[gid] = uid;
        if (!cc.dead && cc.master)
            cdb.dbRun(blessStmt, {uid,gid});
    }

    function addBless(uid, gid) {
        addBlessLocal(uid, gid);
        if (client.shard)
            client.shard.send({t:"addBless", from:client.shard.id, u:uid, g:gid});
    }


    cc.shardCommands["addBless"] = function(shard, msg) {
        addBlessLocal(msg.u, msg.g);
        cc.sm.broadcast(msg);
    }

    cc.processCommands["addBless"] = function(msg) {
        addBlessLocal(msg.u, msg.g);
    }

    if (cc.sm) {
        cc.sm.on("launch", (shard) => {
            // Add all the blesses to the new shard
            for (var uid in blessU2G)
                shard.send({t:"addBless", u:uid, g:blessU2G[uid]});
        });
    }

    // Resolve blesses from U2G into G2U, asserting that the relevant uids actually have bless powers
    function resolveBlesses() {
        Object.keys(blessU2G).forEach((uid) => {
            var f = features(uid);
            if (f.bless)
                blessG2U[blessU2G[uid]] = uid;
            else
                delete blessU2G[uid];
        });
    }

    // Get our initial rewards on connection
    var rewardsInited = false;
    function initRewards() {
        if (rewardsInited) return;
        rewardsInited = true;

        var rr = config.rewards.roles;
        var guild = client.guilds.get(config.rewards.guild);
        if (!guild) return;
        guild.fetchMembers().then((guild) => {
            guild.roles.forEach((role) => {
                if (typeof role === "string")
                    role = guild.roles.get(role);
                var rn = role.name.toLowerCase();
                if (rn in rr)
                    role.members.forEach(resolveRewards);
            });

            // Get our bless status
            db.prepare("SELECT * FROM blessings").all().forEach((row) => {
                blessU2G[row.uid] = row.gid;
            });
            resolveBlesses();

            // Send our blesses along
            if (client.shard) {
                for (var uid in blessU2G)
                    client.shard.send({t:"addBless", from:client.shard.id, u:uid, g:blessU2G[uid]});
            }

            rewardsEvents.emit("ready");
        });
    }
    if (client) {
        client.on("ready", initRewards);
        client.on("shardReady", initRewards);
    }

    // Reresolve a member when their roles change
    if (client) client.on("guildMemberUpdate", (guild, to, from) => {
        if (guild.id !== config.rewards.guild) return;
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
    if (config.ennuicastr)
        cl.register(commands, "ennuicastr", cmdEnnuicastr);
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
commands["features"] = function(msg, cmd) {
    if (cc.dead) return;

    var f = features(msg.author.id);
    var gf = features(msg.author.id, msg.guild ? msg.guild.id : undefined);

    var ret = featuresToStr(f, false, "For you");
    if (gf !== f)
        ret += "\n" + featuresToStr(gf, true, "For this server");
   
    reply(msg, false, false, ret);
}

module.exports = {rewardsEvents, defaultFeatures, features, otherFeatures};
