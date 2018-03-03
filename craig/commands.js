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
const log = cc.log;
const logex = cc.logex;
const nameId = cc.nameId;

const cu = require("./utils.js");
const reply = cu.reply;

const gms = require("./gms.js");

// Our list of command handlers
const commands = {};

// Special command handlers for owner commands
const ownerCommands = {};

// Our command regex changes to match our user ID
var craigCommand = /^(:craig:|<:craig:[0-9]*>)[, ]*([^ ]*) ?(.*)$/;
if (client) client.on("ready", () => {
    log("Logged in as " + client.user.username);
    craigCommand = new RegExp("^(:craig:|<:craig:[0-9]*>|<@!?" + client.user.id + ">)[, ]*([^ ]*) ?(.*)$");
    if ("url" in config)
        client.user.setPresence({game: {name: config.url, type: 0}}).catch(logex);
});

// Only admins and those with the Craig role are authorized to use Craig
function userIsAuthorized(member) {
    if (!member) return false;

    // Guild owners are always allowed
    if (member.hasPermission("MANAGE_GUILD"))
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

// The one command covered here
commands["help"] = commands["commands"] = commands["hello"] = commands["info"] = function(msg, cmd) {
    if (cc.dead) return;
    reply(msg, false, cmd[1],
        "Hello! I'm Craig! I'm a multi-track voice channel recorder. For more information, see " + config.longUrl + " ");
}

module.exports = {commands, ownerCommands};
