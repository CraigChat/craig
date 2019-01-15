/*
 * Copyright (c) 2017-2019 Yahweasel
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
const logex = cc.logex;
const nameId = cc.nameId;

const cdb = require("./db.js");
const log = cdb.log;

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

// The header we use for continuous data with inline VAD data
/* FORMAT:
 * Bytes 0-5: ECVADD (magic word)
 * Bytes 6-7: Length of remaining VAD header data (always 3)
 * Byte 8: Version (0)
 * Byte 9: Number of VAD levels (3)
 * Byte 10: >= this value is considered speaking (1)
 */
const vadHeader =
    Buffer.from([0x45, 0x43, 0x56, 0x41, 0x44, 0x44, 0x03, 0x00, 0x00, 0x03,
        0x01]);

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
const opusHeaderMonoVAD = Buffer.concat([vadHeader, opusHeaderMono[0]]);

// A precompiled FLAC header, modified from one made by flac
const flacHeader48k =
    Buffer.from([0x7F, 0x46, 0x4C, 0x41, 0x43, 0x01, 0x00, 0x00, 0x03, 0x66,
        0x4C, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22, 0x03, 0xC0, 0x03, 0xC0, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x0B, 0xB8, 0x01, 0x70, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00]);
const flacHeader48kVAD = Buffer.concat([vadHeader, flacHeader48k]);

// A precompiled FLAC header for 44.1k
const flacHeader44k =
    Buffer.from([0x7F, 0x46, 0x4C, 0x41, 0x43, 0x01, 0x00, 0x00, 0x03, 0x66,
        0x4C, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22, 0x03, 0x72, 0x03, 0x72, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x0A, 0xC4, 0x41, 0x70, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00]);
const flacHeader44kVAD = Buffer.concat([vadHeader, flacHeader44k]);

// FLAC tags to say we're ennuicastr
const flacTags =
    Buffer.from([0x04, 0x00, 0x00, 0x41, 0x0A, 0x00, 0x00, 0x00, 0x65, 0x6E,
        0x6E, 0x75, 0x69, 0x63, 0x61, 0x73, 0x74, 0x72]);


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
            log("reply",
                "To " + nameId(msg.author) + ": " + JSON.stringify(privtext),
                {u: msg.author});

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
        log("reply",
            "Public to " + nameId(msg.author) + ": " + JSON.stringify(pubtext),
            {u: msg.author, tc: msg.channel});
        msg.reply((prefix ? (prefix + " <(") : "") +
                  pubtext +
                  (prefix ? ")" : "")).catch((err) => {

        log("reply-fail",
            nameId(msg.author),
            {u: msg.author});

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
    log("reply-proxy",
        "To " + nameId(msg.author) + ": " + JSON.stringify(text),
        {u:msg.author});

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

module.exports = {
    accessSyncer,
    vadHeader, opusHeader, opusHeaderMono, opusHeaderMonoVAD, flacHeader48k,
    flacHeader48kVAD, flacHeader44k, flacHeader44kVAD, flacTags,
    reply, findChannel, pseudoMessage
};
