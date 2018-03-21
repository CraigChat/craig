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
 * Support for command handling, from arbitrary users, the owner, and via IPC.
 */

const fs = require("fs");

const cc = require("./client.js");
const config = cc.config;
const client = cc.client;
const log = cc.log;
const logex = cc.logex;
const nameId = cc.nameId;

const cl = require("./locale.js");
const l = cl.l;

const cu = require("./utils.js");
const reply = cu.reply;

const gms = require("./gms.js");

// Our list of command handlers
const commands = {};

// Special command handlers for owner commands
const ownerCommands = {};

// Banned users
let banned = {};
var banJournalF = null;

if (cc.master) {
    // Get our bans
    if (cu.accessSyncer("craig-bans.json")) {
        try {
            var lines = fs.readFileSync("craig-bans.json", "utf8").split("\n");
            try {
                banned = JSON.parse(lines[0]);
            } catch (ex) {
                logex(ex);
            }
            for (var li = 1; li < lines.length; li++) {
                try {
                    var step = JSON.parse("[0" + lines[li] + "]")[1];
                    if (!step) continue;
                    if ("u" in step)
                        banned[step.i] = step.u;
                    else
                        delete banned[step.i];
                } catch (ex) {
                    logex(ex);
                }
            }
        } catch (ex) {
            logex(ex);
        }
    }
    banJournalF = fs.createWriteStream("craig-bans.json", "utf8");
    banJournalF.write(JSON.stringify(banned) + "\n");

    // Send to clients
    if (cc.sm) (function(){
        for (var id in banned)
            cc.sm.broadcast({t:"ban",i:id,u:banned[id]});

        cc.sm.on("launch", (shard) => {
            for (var id in banned)
                shard.send({t:"ban",i:id,u:banned[id]});
        });
    })();
}

// Functions to ban/unban
function banLocal(id, user) {
    banned[id] = user;
    if (banJournalF)
        banJournalF.write("," + JSON.stringify({"i":id,"u":user}) + "\n");
}

function ban(id, user) {
    banLocal(id, user);
    if (client.shard)
        client.shard.send({t:"ban", from:client.shard.id, i:id, u:user});
}

cc.shardCommands["ban"] = function(shard, msg) {
    banLocal(msg.i, msg.u);
    cc.sm.broadcast(msg);
}

cc.processCommands["ban"] = function(msg) {
    banLocal(msg.i, msg.u);
}

function unbanLocal(id) {
    delete banned[id];
    if (banJournalF)
        banJournalF.write("," + JSON.stringify({"i":id}) + "\n");
}

function unban(id) {
    unbanLocal(id);
    if (client.shard)
        client.shard.send({t:"unban", from:client.shard.id, i:id});
}

cc.shardCommands["unban"] = function(shard, msg) {
    unbanLocal(msg.i);
    cc.sm.broadcast(msg);
}

cc.processCommands["unban"] = function(msg) {
    unbanLocal(msg.i);
}

// Our command regex changes to match our user ID
var craigCommand = /^(:craig:|<:craig:[0-9]*>)[, ]*([^ ]*) ?(.*)$/i;
if (client) client.on("ready", () => {
    log("Logged in as " + client.user.username);
    craigCommand = new RegExp("^(:craig:|<:craig:[0-9]*>|<@!?" + client.user.id + ">)[, ]*([^ ]*) ?(.*)$", "i");
    if ("url" in config)
        client.editStatus("online", {name: config.url, type: 0});
});

// Only admins and those with the Craig role are authorized to use Craig
function userIsAuthorized(member) {
    if (!member) return false;

    // Banned users are, well, banned
    if (member.id in banned) return false;

    // Guild owners are always allowed
    if (member.permission.has("manageGuild"))
        return true;

    // Otherwise, they must be a member of the right role
    var haveRole = false;
    member.roles.forEach((role) => {
        if (!role.name)
            role = member.guild.roles.get(role);
        if (!role.name)
            return;
        if (role.name.toLowerCase() === "craig")
            haveRole = true;
    });
    if (haveRole)
        return true;

    // Not for you!
    return false;
}

// Our message receiver and command handler
function onMessage(msg) {
    // We don't care if it's not a command
    var cmd = msg.content.match(craigCommand);
    if (cmd === null) return;

    // Is this from our glorious leader?
    if ((msg.channel.type === "dm" || msg.channel.type === 1) &&
        msg.author.id && msg.author.id === config.owner) {
        if (cc.dead) return;
        try {
            log("Owner command: " + nameId(msg.author) + ": " + msg.content);
        } catch (ex) {
            logex(ex);
        }
        var fun = ownerCommands[cmd[2].toLowerCase()];
        if (fun) fun(msg, cmd);
        return;
    }

    // Ignore it if it's from an unauthorized user
    if (!userIsAuthorized(msg.member)) return;

    // Log it
    try {
        log("Command: " + nameId(msg.member) + "@" + nameId(msg.channel) + "@" + nameId(msg.channel.guild) + ": " + msg.content);
    } catch (ex) {
        logex(ex);
    }

    // Keep this guild alive
    try {
        gms.guildRefresh(msg.guild);
    } catch (ex) {
        logex(ex);
    }

    var op = cmd[2].toLowerCase();

    var fun = commands[op];
    if (!fun)
        return;

    fun(msg, cmd);
}
if (client) client.on("messageCreate", onMessage);

// Ban command interface
function cmdBanUnban(isBan, msg, cmd) {
    // Only the owner can ban
    if (msg.member.id !== config.owner) return;

    const mention = /^<@!?([0-9]*)> *(.*)/;
    var toban = cmd[3];

    while (true) {
        var bres;
        var bid, buser, bui;
        if (bres = mention.exec(toban)) {
            toban = bres[2];
            bid = bres[1];
        } else break;

        bui = client.users.get(bid);
        if (bui)
            buser = bui.username + "#" + bui.discriminator;
        else
            buser = "UNKNOWN";

        if (bui === config.owner) continue;

        if (isBan) {
            ban(bid, buser);
            reply(msg, false, cmd[1], "User <@" + bid + "> has been banned.");
        } else {
            unban(bid);
            reply(msg, false, cmd[1], "User <@" + bid + "> has been unbanned.");
        }
    }
}

commands["ban"] = function(msg, cmd) { cmdBanUnban(true, msg, cmd); }
commands["unban"] = function(msg, cmd) { cmdBanUnban(false, msg, cmd); }

// The help command is covered here as there's nowhere better for it
function cmdHelp(lang) { return function(msg, cmd) {
    if (cc.dead) return;
    reply(msg, false, cmd[1], l("help", lang, config.longUrl));
} }
cl.register(commands, "help", cmdHelp);

module.exports = {commands, ownerCommands, banned};
