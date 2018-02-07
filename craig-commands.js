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

const cc = require("./craig-client.js");
const config = cc.config;
const client = cc.client;
const log = cc.log;
const logex = cc.logex;
const nameId = cc.nameId;

const gms = require("./craig-gms.js");

// Our list of command handlers
const commands = {};

// Our command regex changes to match our user ID
var craigCommand = /^(:craig:|<:craig:[0-9]*>)[, ]*([^ ]*) ?(.*)$/;
client.on("ready", () => {
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
    if (member.roles.some((role) => { return role.name.toLowerCase() === "craig"; }))
        return true;

    // Not for you!
    return false;
}

// Special commands from the owner
function ownerCommand(msg, cmd) {
    if (cc.dead)
        return;

    var op = cmd[2].toLowerCase();

    try {
        log("Owner command: " + nameId(msg.author) + ": " + msg.content);
    } catch (ex) {
        logex(ex);
    }

    if (op === "graceful-restart") {
        reply(msg, false, cmd[1], "Restarting!");
        gracefulRestart();

    } else if (op === "eval") {
        var ex, res, ret;

        function stringify(x) {
            var r = "(unprintable)";
            try {
                r = JSON.stringify(x);
                if (typeof r !== "string")
                    throw new Exception();
            } catch (ex) {
                try {
                    r = x+"";
                } catch (ex) {}
            }
            return r;
        }

        function quote(x) {
            return "```" + stringify(x).replace("```", "` ` `") + "```";
        }

        res = ex = undefined;
        try {
            res = eval(cmd[3]);
        } catch (ex2) {
            ex = ex2;
        }

        ret = "";
        if (ex) {
            ex = ex+"";
            ret += "Exception: " + quote(ex) + "\n";
        }
        ret += "Result: " + quote(res);

        reply(msg, true, null, "", ret);

    } else {
        reply(msg, false, cmd[1], "Huh?");

    }
}

// Our message receiver and command handler
function onMessage(msg) {
    // We don't care if it's not a command
    var cmd = msg.content.match(craigCommand);
    if (cmd === null) return;

    // Is this from our glorious leader?
    if (msg.channel.type === "dm" && msg.author.id && msg.author.id === config.owner) {
        ownerCommand(msg, cmd);
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
client.on("message", onMessage);

module.exports = {commands};
