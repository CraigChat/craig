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

const commands = require("./commands.js").commands;

const cu = require("./utils.js");
const reply = cu.reply;

const gms = require("./gms.js");

// An event emitter for when we've loaded our rewards
class RewardsEvent extends EventEmitter {}
const rewardsEvents = new RewardsEvent();

// A map user ID -> rewards
var rewards = {};
var defaultFeatures = {"limits": config.limits};

// A map of users with rewards -> blessed guilds. Vice-versa is in gms.
var blessU2G = {};
const blessG2U = gms.blessG2U;

// Get the features for a given user
function features(id, gid) {
    // Do they have their own rewards?
    var r = rewards[id];
    if (r) return r;

    // Are they in a blessed guild?
    if (gid && gid in blessG2U) {
        r = rewards[blessG2U[gid]];
        if (r) return r;
    }

    return defaultFeatures;
}

// Use server roles to give rewards
if (config.rewards) (function() {
    // Journal of blesses
    var blessJournalF = null;

    // Resolve a user's rewards by their role
    function resolveRewards(member) {
        var rr = config.rewards.roles;
        var mrewards = {};

        member.roles.forEach((role) => {
            var rn = role.name.toLowerCase();
            if (rn in rr) {
                var roler = rr[rn];
                for (var rid in roler) {
                    if (rid !== "limits") mrewards[rid] = roler[rid];
                }
                if (roler.limits) {
                    if (!mrewards.limits) mrewards.limits = {record: config.limits.record, download: config.limits.download};
                    if (roler.limits.record > mrewards.limits.record)
                        mrewards.limits.record = roler.limits.record;
                    if (roler.limits.download > mrewards.limits.download)
                        mrewards.limits.download = roler.limits.download;
                }
            }
        });

        if (Object.keys(mrewards).length)
            rewards[member.id] = mrewards;
        else
            delete rewards[member.id];
        return mrewards;
    }

    // Remove a bless
    function removeBless(uid) {
        if (uid in blessU2G) {
            var gid = blessU2G[uid];
            var step = {u:uid};
            delete blessU2G[uid];
            delete blessG2U[gid];
            if (!cc.dead && blessJournalF)
                blessJournalF.write("," + JSON.stringify(step) + "\n");
        }
    }

    // Add a bless
    function addBless(uid, gid) {
        if (uid in blessU2G)
            removeBless(uid);

        var step = {u:uid, g:gid};
        blessU2G[uid] = gid;
        blessG2U[gid] = uid;
        if (!cc.dead && blessJournalF)
            blessJournalF.write("," + JSON.stringify(step) + "\n");
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
    if (client) client.on("ready", () => {
        var rr = config.rewards.roles;
        var guild = client.guilds.get(config.rewards.guild);
        if (!guild) return;
        guild.fetchMembers().then((guild) => {
            guild.roles.forEach((role) => {
                var rn = role.name.toLowerCase();
                if (rn in rr)
                    role.members.forEach(resolveRewards);
            });

            // Get our bless status
            if (cu.accessSyncer("craig-bless.json")) {
                try {
                    var journal = JSON.parse("["+fs.readFileSync("craig-bless.json", "utf8")+"]");
                    blessU2G = journal[0];
                    for (var ji = 1; ji < journal.length; ji++) {
                        var step = journal[ji];
                        if ("g" in step)
                            blessU2G[step.u] = step.g;
                        else
                            delete blessU2G[step.u];
                    }
                } catch (ex) {
                    logex(ex);
                }
            }
            resolveBlesses();
            blessJournalF = fs.createWriteStream("craig-bless.json", "utf8");
            blessJournalF.write(JSON.stringify(blessU2G) + "\n");

            rewardsEvents.emit("ready");
        });
    });

    // Reresolve a member when their roles change
    if (client) client.on("guildMemberUpdate", (from, to) => {
        if (to.guild.id !== config.rewards.guild) return;
        if (from.roles === to.roles) return;
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

// Turn features into a string
function featuresToStr(f, guild, prefix) {
    var ret = "\n";
    if (f === defaultFeatures)
        ret += "Default features:";
    else
        ret += prefix + ":";
    ret += "\nRecording time limit: " + f.limits.record + " hours" +
           "\nDownload time limit: " + f.limits.download + " hours";

    if (f.mix)
        ret += "\nYou may download auto-leveled mixed audio.";
    if (f.auto)
        ret += "\nYou may autorecord channels.";
    if (f.bless && !guild)
        ret += "\nYou may bless servers.";
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

module.exports = {rewardsEvents, defaultFeatures, features};
