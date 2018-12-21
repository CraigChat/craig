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
 * Utility functions that had nowhere better to go.
 */

const fs = require("fs");

const cc = require("./client.js");
const config = cc.config;
const log = cc.log;
const logex = cc.logex;
const nameId = cc.nameId;

const cb = (config.backup && !config.backup.master) ? require("./backup.js") : null;

// accessSync with a less stupid UI
function accessSyncer(file) {
    try {
        fs.accessSync(file);
    } catch (ex) {
        return false;
    }
    return true;
}

// A precomputed Opus header, made by node-opus 
const opusHeader = [
    Buffer.from([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 0x01, 0x02,
        0x00, 0x0f, 0x80, 0xbb, 0x00, 0x00, 0x00, 0x00, 0x00]),
    Buffer.from([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73, 0x09, 0x00,
        0x00, 0x00, 0x6e, 0x6f, 0x64, 0x65, 0x2d, 0x6f, 0x70, 0x75, 0x73, 0x00,
        0x00, 0x00, 0x00, 0xff])
];

// A precompiled mono Opus header, made for EnnuiCastr
const opusHeaderMono = [
    Buffer.from([0x4F, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 0x01, 0x01,
        0x38, 0x01, 0x80, 0xBB, 0x00, 0x00, 0x00, 0x00, 0x00]),
    Buffer.from([0x4F, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73, 0x0A, 0x00,
        0x00, 0x00, 0x65, 0x6E, 0x6E, 0x75, 0x69, 0x63, 0x61, 0x73, 0x74,
        0x72])
];

const isMention = /^\s*<?@/;

// Function to respond to a message by any means necessary
function reply(msg, dm, prefix, pubtext, privtext) {
    if (prefix === "") prefix = null;

    function doReply() {
        if (dm) {
            // Try to send the message privately
            if (typeof privtext === "undefined")
                privtext = pubtext;
            else if (pubtext !== "")
                privtext = pubtext + "\n\n" + privtext;
            log("Reply to " + nameId(msg.author) + ": " + JSON.stringify(privtext));

            function rereply() {
                if (pubtext !== "")
                    reply(msg, false, prefix, "I can't send you direct messages. " + pubtext);
            }
            try {
                msg.author.send(privtext).catch(rereply);
            } catch (ex) {
                rereply();
            }
            return;
        }

        // Try to send it by conventional means
        log("Public reply to " + nameId(msg.author) + ": " + JSON.stringify(pubtext));
        msg.reply((prefix ? (prefix + " <(") : "") +
                  pubtext +
                  (prefix ? ")" : "")).catch((err) => {

        log("Failed to reply to " + nameId(msg.author));

        // If this wasn't a guild message, nothing to be done
        var guild = msg.guild;
        if (!guild)
            return;

        // We can't get a message to them properly, so kill any active recording
        try {
            guild.voiceConnection.disconnect();
        } catch (ex) {}

        // And give ourself a name indicating error
        setTimeout(() => {
            try {
                guild.editNickname("ERROR CANNOT SEND MESSAGES").catch(() => {});
            } catch (ex) {
                logex(ex);
            }
        }, 2000);

        });
    }

    // Normal reply
    if (!cb) {
        doReply();
        return;
    }

    /* The backup bot should only respond to public commands if they were
     * directed specifically at the backup bot */
    if (isMention.test(msg.content)) {
        doReply();
        return;
    }
    if (!dm)
        return;

    var text = privtext ? (pubtext + "\n\n" + privtext) : pubtext;
    log("Proxy reply to " + nameId(msg.author) + ": " + JSON.stringify(text));

    // Reply after a short delay to make sure the main message comes first
    setTimeout(() => {
        cb.reply(msg.author.id, text, doReply);
    }, 1000);
}

// Find a voice channel matching the given name
function findChannel(msg, guild, cname) {
    var channel = null;

    guild.channels.some((schannel) => {
        if (schannel.type !== "voice" && schannel.type !== 2)
            return false;

        if (schannel.name.toLowerCase() === cname ||
            (cname === "" && msg.member.voiceChannel === schannel)) {
            channel = schannel;
            return true;

        } else if (channel === null && schannel.name.toLowerCase().startsWith(cname)) {
            channel = schannel;

        }

        return false;
    });

    return channel;
}

// Create a false message sufficient for replying
function pseudoMessage(member, guild) {
    return {
        author: member.user?member.user:member,
        member: member,
        channel: member,
        guild: guild,
        reply: (msg) => {
            return member.send(msg);
        }
    };
}

module.exports = {accessSyncer, opusHeader, opusHeaderMono, reply, findChannel, pseudoMessage};
