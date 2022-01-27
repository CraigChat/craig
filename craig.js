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
 * This is the main entry point. Its purpose is mainly to load all the
 * actually-important modules.
 */

const cp = require("child_process");

const cc = require("./craig/client.js");
const client = cc.client;
const config = cc.config;
const logex = cc.logex;
const recordingEvents = cc.recordingEvents;

const cu = require("./craig/utils.js");
const reply = cu.reply;

const cdb = require("./craig/db.js");
const log = cdb.log;

const ccmds = require("./craig/commands.js");
const commands = ccmds.commands;

// Behavior modules
const cr = require("./craig/rec.js");
const activeRecordings = cr.activeRecordings;
const ca = require("./craig/auto.js");
const cb = require("./craig/backup.js");

// Not used directly, but handy for eval
const gms = require("./craig/gms.js");
const cf = require("./craig/features.js");

process.on("unhandledRejection", (ex) => {
    logex(ex, "Unhandled promise rejection");
});

process.on("uncaughtException", (ex) => {
    logex(ex, "Uncaught exception");
});

// "Safely" eval something, explicitly in this context
function safeEval(cmd) {
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
        return "\n```\n" + stringify(x).replace("```", "` ` `") + "\n```\n";
    }

    res = ex = undefined;
    try {
        res = eval(cmd);
    } catch (ex2) {
        ex = ex2;
    }

    ret = "";
    if (ex) {
        ex = ex+"";
        ret += "Exception: " + quote(ex) + "\n";
    }
    ret += "Result: " + quote(res);

    return ret;
}
// "Safely" eval something, explicitly in this context
function evalFmt(res, ex) {
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
        return "\n```\n" + stringify(x).replace("```", "` ` `") + "\n```\n";
    }

    let ret = "";
    if (ex) {
        ex = ex+"";
        ret += "Exception: " + quote(ex) + "\n";
    }
    ret += "Result: " + quote(res);

    return ret;
}
if (client) client.safeEval = safeEval;

const evalTarget = /^@([a-zA-Z0-9]*)[ \t]*(.*)/;

function managerEval(cmd) {
    return new Promise((res, rej) => {
        process.send({t: "managerEval", cmd});

        function receiver(msg) {
            if (msg._mEval === cmd) {
                if (msg._error) rej(msg._error);
                else res(msg._result)
            } else process.once("message", receiver);
        }
        process.once("message", receiver);
    });
}

function onShardEval(cmd, id) {
    return new Promise((res, rej) => {
        process.send({t: "toShardEval", cmd, id});

        function receiver(msg) {
            if (msg.t === "toShardEvalRes" && msg.cmd === cmd) {
                if (msg._error) rej(msg._error);
                else res(msg._result)
            } else process.once("message", receiver);
        }
        process.once("message", receiver);
    });
}

function splitEval(msg, text) {
    const msgs = cu.splitMessage(text);
    msgs.map((m) => reply(msg, true, null, "", m))
}

// An eval command for the owner, explicitly in this context
ccmds.ownerCommands["eval"] = async function(msg, cmd) {
    let ecmd = cmd[3];
    let sid = null;
    if (/^shard:\d+\s/.test(cmd[3])) {
        const match = cmd[3].match(/^shard:(\d+)\s/);
        sid = parseInt(match[1]);
        ecmd = ecmd.slice(match[0].length);
    }
    if (sid) {
        try {
            let res = await onShardEval(ecmd, sid);
            splitEval(msg, evalFmt(res));
        } catch (ex) {
            splitEval(msg, evalFmt(null, ex));
        }
    } else {
        var ret = safeEval(ecmd);
        splitEval(msg, ret);
    }
}

// An eval command for the owner, explicitly in this context
ccmds.ownerCommands["meval"] = async function(msg, cmd) {
    var ecmd = cmd[3];
    try {
        let res = await managerEval(ecmd);
        splitEval(msg, evalFmt(res));
    } catch (ex) {
        splitEval(msg, evalFmt(null, ex));
    }
}

// An eval command for the sharding manager
cc.shardCommands["eval"] = function(shard, msg) {
    var ret = safeEval(msg.c);
    shard.send({t:"evalRes", u:msg.u, r:ret});
}

// And the response from host eval
cc.processCommands["evalRes"] = function(msg) {
    var user = client.users.get(msg.u);
    if (!user) return;
    var pmsg = cu.pseudoMessage(user);
    reply(pmsg, true, null, "", msg.r);
}

/* There's no compelling reason for stats to be here, but there's no compelling
 * reason for it to be anywhere else either. */

// Use a server topic to show stats
if (config.stats) {
    (function(){
        var channel = null;
        
        if (client) client.on("ready", ()=>{
            try {
                channel = client.guilds.get(config.stats.guild).channels.get(config.stats.channel);

                // Allow topics from the shard master
                cc.processCommands["statsTopic"] = function(msg) {
                    try {
                        if (channel.edit)
                            channel.edit({topic:msg.v}).catch(logex);
                        else
                            channel.setTopic(msg.v).catch(logex);
                    } catch (ex) {
                        logex(ex);
                    }
                }
            } catch (ex) {
            }
        });

        var users = -1;
        var channels = -1;
        function updateTopic(stoppedRec) {
            if (cc.dead)
                return;

            try {
                var newUsers = 0;
                var newChannels = 0;

                for (var gid in activeRecordings) {
                    var g = activeRecordings[gid];
                    for (var cid in g) {
                        var rec = g[cid];
                        if (rec === stoppedRec)
                            continue;
                        if (rec.connection) {
                            try {
                                newUsers += rec.connection.channel.members.size - 1;
                                newChannels++;
                            } catch (ex) {}
                        }
                    }
                }

                var topic = config.stats.topic;
                if (newChannels)
                    topic += " Currently recording " + newUsers + " users in " + newChannels + " voice channels.";
                if (users != newUsers || channels != newChannels) {
                    if (cc.sm)
                        cc.sm.broadcast({t:"statsTopic", v:topic});
                    else if (channel)
                        channel.setTopic(topic);
                    users = newUsers;
                    channels = newChannels;
                }
                return topic;
            } catch (ex) {
                return ex;
            }
        }
        if (cc.master) {
            recordingEvents.on("start", ()=>{updateTopic();});
            recordingEvents.on("stop", updateTopic);
        }

        // And a command to get the full stats
        var statsCp = null;
        commands["stats"] = function(msg, cmd) {
            if (cc.dead)
                return;

            if (!msg.guild || msg.guild.id !== config.stats.guild || statsCp)
                return;

            var statsOut = "";
            statsCp = cp.fork("./stats.js", [], {
                stdio: ["ignore", "pipe", process.stderr, "ipc"]
            });
            statsCp.on("exit", ()=>{
                statsCp = null;
            });
            statsCp.stdout.on("data", (chunk) => {
                statsOut += chunk.toString("utf8");
            });
            statsCp.stdout.on("end", () => {
                msg.reply("\n" + statsOut);
            });
        }
    })();
}

