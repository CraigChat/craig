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

const EventEmitter = require("events");
const fs = require("fs");
const Discord = require("discord.js");

const clientOptions = {fetchAllMembers: false, apiRequestMethod: "sequential"};

const client = new Discord.Client(clientOptions);
const clients = [client]; // For secondary connections
const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
const defaultConfig = require("./default-config.js");

for (var ck in defaultConfig)
    if (!(ck in config))
        config[ck] = defaultConfig[ck];

// Log in
client.login(config.token).catch(()=>{});

// If there are secondary Craigs, log them in
for (var si = 0; si < config.secondary.length; si++) {
    clients.push(new Discord.Client(clientOptions));
    clients[si+1].login(config.secondary[si].token).catch(()=>{});
}

// Our list of command handlers
const commands = {};

// An event emitter for whenever we start or stop any recording
class RecordingEvent extends EventEmitter {}
const recordingEvents = new RecordingEvent();

// Our command regex changes to match our user ID
var craigCommand = /^(:craig:|<:craig:[0-9]*>)[, ]*([^ ]*) ?(.*)$/;
client.on("ready", () => {
    log("Logged in as " + client.user.username);
    craigCommand = new RegExp("^(:craig:|<:craig:[0-9]*>|<@!?" + client.user.id + ">)[, ]*([^ ]*) ?(.*)$");
    if ("url" in config)
        client.user.setPresence({game: {name: config.url, type: 0}}).catch(()=>{});
});

// Special commands from the owner
function ownerCommand(msg, cmd) {
    if (cc.dead)
        return;

    var op = cmd[2].toLowerCase();

    try {
        log("Owner command: " + nameId(msg.author) + ": " + msg.content);
    } catch (ex) {}

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
    } catch (ex) {}

    // Keep this guild alive
    try {
        gms.guildRefresh(msg.guild);
    } catch (ex) {}

    var op = cmd[2].toLowerCase();

    var fun = commands[op];
    if (!fun)
        return;

    fun(msg, cmd);
}
client.on("message", onMessage);

module.exports = {client, clients, config, recordingEvents, commands, dead: false};
