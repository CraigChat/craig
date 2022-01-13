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

const cc = require("./client.js");
const config = cc.config;
const client = cc.client;
const logex = cc.logex;
const nameId = cc.nameId;

const cl = require("./locale.js");
const l = cl.l;

const cu = require("./utils.js");
const reply = cu.reply;

const cdb = require("./db.js")
const db = cdb.db;
const log = cdb.log;

const gms = require("./gms.js");

// Our list of command handlers
const commands = {};
const slashCommands = {};

// Special command handlers for owner commands
const ownerCommands = {};

// Banned users
let banned = {};
const banStmt = db.prepare("INSERT OR REPLACE INTO bans (id, name) VALUES (@id, @name)");
const unbanStmt = db.prepare("DELETE FROM bans WHERE id=@id");

function isOwner(uid) {
    if (Array.isArray(config.owner)) return config.owner.includes(uid);
    return config.owner === uid;
}

if (cc.master) {
    // Get our bans
    db.prepare("SELECT * FROM bans").all().forEach((row) => {
        banned[row.id] = row.u;
    });

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
    if (cc.master)
        cdb.dbRun(banStmt, {id:id, name:user});
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
    if (cc.master)
        cdb.dbRun(unbanStmt, {id});
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
const genericCommand = /^()[, ]*([^ ]*) ?(.*)$/i;
if (client) client.on("ready", () => {
    craigCommand = new RegExp("^(:craig:|<:craig:[0-9]*>|<@!?" + client.user.id + ">)[, ]*([^ ]*) ?(.*)$", "i");
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

// Prefixes per server
const prefixes = {};
db.prepare("SELECT * FROM prefixes").all().forEach((row) => {
    prefixes[row.id] = row.prefix;
});

// Our message receiver and command handler
function onMessage(msg) {
    var cmd = null;

    // Does this match the custom prefix?
    if (msg.guild && msg.guild.id in prefixes) {
        var prefix = prefixes[msg.guild.id];
        if (msg.content.slice(0, prefix.length) === prefix)
            cmd = msg.content.slice(prefix.length).match(genericCommand);
    }
    
    // Try the true prefix
    if (cmd === null)
        cmd = msg.content.match(craigCommand);

    // If it's not a command, who cares
    if (cmd === null) return;

    // Is this from our glorious leader?
    if (msg.author.id && isOwner(msg.author.id)) {
        if (cc.dead) return;
        try {
            log("owner-command",
                nameId(msg.author) + ": " + msg.content,
                {uid: msg.author.id});
        } catch (ex) {
            logex(ex);
        }

        // If there is no name, assume its a DM and set the createMessage function
        if (!msg.channel.name) msg.channel.createMessage = function () {
            const args = arguments;
            const user = this;
            return new Promise((res, rej) => {
                user.getDMChannel().then((channel) => {
                    channel.createMessage.apply(channel, args).then(res).catch(rej);
                }).catch(rej);
            });
        }

        let fun = ownerCommands[cmd[2].toLowerCase()];
        if (fun) return fun(msg, cmd);
    }

    // Ignore it if it's from an unauthorized user
    if (!userIsAuthorized(msg.member)) return;

    // Log it
    try {
        log("command",
            nameId(msg.member) + "@" + (msg.channel.name ? nameId(msg.channel) : msg.channel.id) + "@" + (msg.channel.guild ? nameId(msg.channel.guild) : msg.guildID || 'UNKNOWN') + ": " + msg.content,
            {
                uid: msg.member.id,
                gid: msg.channel.guild ? msg.channel.guild.id : msg.guildID || 'UNKNOWN',
                tcid: msg.channel.id
            });
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

// The interaction handler
async function onInteraction(interaction) {
    if (interaction.type === 1) return interaction.pong();

    // Tell off users if used in DMs
    if (!interaction.member || !interaction.guildID)
        return interaction.createMessage({
            content: "You can't use Craig slash commands in direct messages!",
            flags: 64
        });

    // Ignore it if it's from an unauthorized user
    if (!userIsAuthorized(interaction.member))
        return interaction.createMessage({
            content: "You don't have the permission to use Craig!",
            flags: 64
        });

    // Log it
    try {
        log("slashcommand",
            nameId(interaction.member) + "@" + nameId(interaction.channel) + "@" + nameId(interaction.channel.guild) + ": ",
            {
                uid: interaction.member.id,
                gid: interaction.channel.guild.id,
                tcid: interaction.channel.id
            });
    } catch (ex) {
        logex(ex);
    }

    // Keep this guild alive
    try {
        gms.guildRefresh(interaction.channel.guild);
    } catch (ex) {
        logex(ex);
    }

    // Add a timestamp to the interaction to know when to defer/send or not
    interaction._time = Date.now();

    if (slashCommands[interaction.data.name])
        return slashCommands[interaction.data.name](interaction);

    interaction.createMessage({
        content: "This command has no handler.",
        flags: 64
    });
}
if (client) client.on("interactionCreate", onInteraction);

// Ban command interface
function cmdBanUnban(isBan, msg, cmd) {
    // Only the owner can ban
    if (!isOwner(msg.member.id)) return;

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

        if (isOwner(bui)) continue;

        if (isBan) {
            ban(bid, buser);
            if (!cc.dead)
                reply(msg, false, cmd[1], "User <@" + bid + "> has been banned.");
        } else {
            unban(bid);
            if (!cc.dead)
                reply(msg, false, cmd[1], "User <@" + bid + "> has been unbanned.");
        }
    }
}

commands["ban"] = function(msg, cmd) { cmdBanUnban(true, msg, cmd); }
commands["unban"] = function(msg, cmd) { cmdBanUnban(false, msg, cmd); }

// Prefix command interface
const prefixStmt = db.prepare("INSERT OR REPLACE INTO prefixes (id, prefix) VALUES (@id, @prefix)");
const unprefixStmt = db.prepare("DELETE FROM prefixes WHERE id=@id");
function cmdPrefixUnprefix(isPrefix, lang, msg, cmd) {
    // You can only set or unset a prefix if you have administrator privileges
    if (!msg.member || !msg.member.permission.has("manageGuild"))
        return;

    var gid = msg.guild.id;

    if (isPrefix) {
        if (cmd[3] === "") {
            if (!cc.dead) {
                if (gid in prefixes)
                    reply(msg, false, cmd[1], l("prefixis", lang, prefixes[gid]));
                else
                    reply(msg, false, cmd[1], l("noprefix", lang));
            }
        } else {
            prefixes[gid] = cmd[3];
            if (!cc.dead) {
                cdb.dbRun(prefixStmt, {id:gid, prefix:cmd[3]});
                reply(msg, false, cmd[1], l("prefixset", lang));
            }
        }

    } else {
        delete prefixes[gid];
        if (!cc.dead) {
            cdb.dbRun(unprefixStmt, {id:gid});
            reply(msg, false, cmd[1], l("prefixunset", lang));
        }

    }
}

function cmdPrefix(lang) { return function(msg, cmd) { cmdPrefixUnprefix(true, lang, msg, cmd); } }
function cmdUnprefix(lang) { return function(msg, cmd) { cmdPrefixUnprefix(false, lang, msg, cmd); } }
cl.register(commands, "prefix", cmdPrefix);
cl.register(commands, "unprefix", cmdUnprefix);

// The help command is covered here as there's nowhere better for it
function cmdHelp(lang) { return function(msg, cmd) {
    if (cc.dead) return;
    reply(msg, false, cmd[1], l("help", lang, config.longUrl));
} }
cl.register(commands, "help", cmdHelp);
slashCommands["info"] = async function(interaction) {
    if (cc.dead) return;
    interaction.createMessage({
        content: l("help", 'en', config.longUrl),
        flags: 64
    });
}

module.exports = {commands, slashCommands, ownerCommands, banned};
