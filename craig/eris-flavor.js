/*
 * Copyright (c) 2018 Yahweasel
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
 * Bully and browbeat Eris into tasting more like discord.js
 */

const Eris = require("eris");

const odp = Object.defineProperty;

function odf(obj, nm, val) {
    odp(obj, nm, {value: val, writable: false});
}

function odg(obj, nm, val) {
    odp(obj, nm, {get: val});
}

(function (cp) {
    odf(cp, "fetchUser", function (id) {
        const client = this;
        return new Promise((res, rej) => {
            var user = client.users.get(id);
            if (user)
                res(user);
            else
                rej(new Error("User not found"));
        });
    });
    odf(cp, "login", function(){
        const client = this;

        if (!this.flavorTwiddled) {
            this.flavorTwiddled = true;

            // Adjust the callbacks
            this.flavorOn = this.on;
            this.on = function (ev, handler) {
                switch (ev) {
                    case "message":
                        return this.flavorOn("messageCreate", handler);

                    case "voiceStateUpdate":
                        this.flavorOn(ev, (to, from) => {
                            return handler(from, to);
                        });
                        this.flavorOn("voiceChannelJoin", (member, channel) => {
                            var from = {
                                id: member.id,
                                guild: member.guild
                            };
                            return handler(from, member);
                        });
                        this.flavorOn("voiceChannelLeave", (member, channel) => {
                            var from = {
                                id: member.id,
                                guild: member.guild,
                                voiceChannelID: channel.id,
                                voiceChannel: channel
                            };
                            return handler(from, member);
                        });
                        this.flavorOn("voiceChannelSwitch", (member, toChannel, fromChannel) => {
                            var from = {
                                id: member.id,
                                guild: member.guild,
                                voiceChannelID: fromChannel.id,
                                voiceChannel: fromChannel
                            };
                            return handler(from, member);
                        });
                        return this;

                    case "guildMemberUpdate":
                        return this.flavorOn(ev, (guild, to, from) => {
                            if (!from) return;
                            from.id = to.id;
                            from.guild = guild;
                            from.nickname = from.nick;
                            return handler(from, to);
                        });

                    case "guildUpdate":
                        return this.flavorOn(ev, (to, from) => {
                            return handler(from, to);
                        });

                    default:
                        return this.flavorOn(ev, handler);
                }
            };

            // And handle ShardingManager eval requests
            process.on("message", (msg) => {
                if (msg._eval) {
                    var res;
                    try {
                        res = (function () {
                            return eval(msg._eval);
                        }).call(client);
                    } catch (ex) {
                        res = ex;
                    }
                    process.send({_eval: msg._eval, _result: res});

                } else if (msg._fetchProp) {
                    var res;
                    try {
                        res = (function () {
                            return eval("this." + msg._fetchProp);
                        }).call(client);
                    } catch (ex) {
                        res = ex;
                    }
                    process.send({_fetchProp: msg._fetchProp, _result: res});

                }
            });
        }
        return this.connect();
    });
    odg(cp, "shard", function(){
        var ret;
        if (this.flavorSavedShard) {
            ret = this.flavorSavedShardRef;
        } else {
            if ("SHARD_ID" in process.env)
                this.shards.forEach((val)=>{ret=val;});
            this.flavorSavedShard = true;
            this.flavorSavedShardRef = ret;
        }
        return ret;
    });
})(Eris.Client.prototype);

Eris.Collection.prototype.some = Eris.Collection.prototype.find;

odf(Eris.ExtendedUser.prototype, "setPresence", function (stat) {
    this._client.editStatus(stat.status, stat.game);
    return new Promise((res, rej) => { res(); });
});

(function (egp) {
    odf(egp, "fetchMember", function (id) {
        const guild = this;
        var member = this.members.get(id);
        if (member)
            return new Promise((res)=>{res(member);});
        return new Promise((res, rej) => {
            this.fetchMembers().then(() => {res(guild.members.get(id));}).catch(rej);
        });
    });
    odf(egp, "fetchMembers", function () {
        // There's no good way to simulate this
        const guild = this;
        this.fetchAllMembers();
        return new Promise((res, rej) => {
            setTimeout(()=>{res(guild);}, 1000);
        });
    });
    // .voiceConnection does exist, but has caching issues
    odg(egp, "voiceConnection", function(){return this.shard.client.voiceConnections.get(this.id);});
})(Eris.Guild.prototype);

(function (emp) {
    odf(emp, "hasPermission", function (perm) {
        perm = perm.toLowerCase().replace(/_[a-z]/g, (c)=>{return c[1].toUpperCase();});
        return this.permission.has(perm);
    });
    odg(emp, "nickname", function(){return this.nick;});
    odf(emp, "setNickname", function (nick) {
        if (this.id === this.guild.shard.client.user.id)
            return this.guild.editNickname(nick);
        else
            return this.edit({nick});
    });
    odg(emp, "voiceChannel", function(){return this.voiceState.channelID?(this.guild.channels.get(this.voiceState.channelID)):undefined;});
})(Eris.Member.prototype);

odg(Eris.Message.prototype, "guild", function(){return this.channel.guild;});
odf(Eris.Message.prototype, "reply", function(content){return this.channel.send(this.author.mention + ", " + content);});

Eris.PrivateChannel.prototype.send = Eris.PrivateChannel.prototype.createMessage;

odg(Eris.Role.prototype, "members", function () {
    const role = this;
    return this.guild.members.filter((member) => {
        return member.roles.includes(role.id);
    });
});

(function (esp) {
    odf(esp, "send", function(){return process.send.apply(process, arguments);});
    odf(esp, "broadcastEval", function (cmd) {
        return new Promise((res, rej) => {
            process.send({"_sEval": cmd});

            function receiver(msg) {
                if (msg._sEval === cmd)
                    res(msg._result);
                else
                    process.once("message", receiver);
            }
            process.once("message", receiver);
        });
    });
})(Eris.Shard.prototype);

Eris.TextChannel.prototype.send = Eris.TextChannel.prototype.createMessage;

odf(Eris.User.prototype, "send", function () {
    const args = arguments;
    const user = this;
    return new Promise((res, rej) => {
        user.getDMChannel().then((channel) => {
            channel.createMessage.apply(channel, args).then(res).catch(rej);
        }).catch(rej);
    });
});

odg(Eris.VoiceChannel.prototype, "joinable", function(){return this.permissionsOf(this.guild.shard.client.user.id).has("voiceConnect");});
odg(Eris.VoiceChannel.prototype, "members", function(){return this.voiceMembers;});

odg(Eris.VoiceConnection.prototype, "channel", function () {
    var ret = this.flavorSavedChannel;
    if (!ret)
        ret = this.flavorSavedChannel = this.shard.client.guilds.get(this.id).channels.get(this.channelID);
    return ret;
});
