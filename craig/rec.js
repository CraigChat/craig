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
 * Recording! Y'know, Craig's only feature. This file has support for recording
 * sessions, recording commands, and other recording-related functionality.
 */

const cp = require("child_process");
const fs = require("fs");
const stream = require("stream");
const https = require("https");
const ws = require("ws");

const ogg = require("./ogg.js");
const djsopus = require("@discordjs/opus");
const opus = new djsopus.OpusEncoder(48000);

const request = require("request");

const cc = require("./client.js");
const config = cc.config;
const client = cc.client;
const clients = cc.clients;
const logex = cc.logex;
const nameId = cc.nameId;

const cl = require("./locale.js");
const l = cl.l;

const cu = require("./utils.js");
const reply = cu.reply;

const cdb = require("./db.js");
const db = cdb.db;
const log = cdb.log;

const ccmds = require("./commands.js");
const commands = ccmds.commands;
const slashCommands = ccmds.slashCommands;

const cf = require("./features.js");

const cb = require("./backup.js");

const ecp = require("./ennuicastr-protocol.js");

/* A single silent packet, as an Ogg Opus file, which we can send periodically
 * as a ping */
const silentOggOpus = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x88, 0x23, 0x54, 0x9b, 0x00,
    0x00, 0x00, 0x00, 0x8e, 0xb3, 0x1d, 0x4a, 0x01, 0x13, 0x4f, 0x70, 0x75,
    0x73, 0x48, 0x65, 0x61, 0x64, 0x01, 0x01, 0x38, 0x01, 0x80, 0xbb, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x4f, 0x67, 0x67, 0x53, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x88, 0x23, 0x54, 0x9b, 0x01, 0x00,
    0x00, 0x00, 0x44, 0x96, 0xd6, 0x2f, 0x01, 0x0c, 0x4f, 0x70, 0x75, 0x73,
    0x54, 0x61, 0x67, 0x73, 0x00, 0x00, 0x00, 0x00, 0x4f, 0x67, 0x67, 0x53,
    0x00, 0x04, 0x18, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x88, 0x23,
    0x54, 0x9b, 0x02, 0x00, 0x00, 0x00, 0x3d, 0xa8, 0x9a, 0x9b, 0x01, 0x03,
    0xf8, 0xff, 0xfe]);

/* Active recordings by guild, channel
 *
 * SHARDS:
 * The shard manager has ALL active recordings, with fake connections. All
 * shards have only the recordings active for them.
 */
const activeRecordings = {};

/* Rate limits by guild. To prevent abuse or bugs, when recordings unexpectedly
 * disconnect, the next recording cannot start until some timeout expires. This
 * timeout increases exponentially until a recording is successful or the bot
 * resets normally.
 *
 * rateLimit[guild] = {
 *   lastDelay: (delay in seconds after last recording ended)
 *   nextAllowed: (next time in ms when a recording will be allowed)
 *   pending: (true if that next recording is pending)
 * }
 */
const rateLimit = {};

/* Active recordings by ID */
const arID = {};

/* The https and websocket servers, once they've been established */
var hs = null;
var wss = null;

const emptyBuf = Buffer.alloc(0);

// Our query to decide whether to run a Drive upload
const driveStmt = db.prepare("SELECT * FROM drive WHERE id=@id");

// Fetch a rate limit
function getRateLimit(gid) {
    if (!(gid in rateLimit))
        return null;
    return rateLimit[gid];
}

// Update or reset a rate limit
function updateRateLimit(gid, reset) {
    if (reset) {
        if (gid in rateLimit)
            delete rateLimit[gid];

    } else {
        if (!(gid in rateLimit)) {
            rateLimit[gid] = {
                lastDelay: 5,
                nextAllowed: 0,
                pending: false
            };
        }
        var rl = rateLimit[gid];
        rl.lastDelay *= 2;
        if (rl.lastDelay > 120)
            rl.lastDelay = 120;
        rl.nextAllowed = Date.now() + rl.lastDelay * 1000;

    }
}


// Our recording session proper
function session(msgOrInteraction, prefix, rec) {
    var connection = rec.connection;
    var limits = rec.limits;
    var id = rec.id;
    var client = rec.client;
    var lang = rec.lang;
    var sizeLimit = config.hardLimit;
    var monWs = null;

    function sReply(dm, pubtext, privtext) {
        reply(msgOrInteraction, dm, prefix, pubtext, privtext);
    }

    var receiver;
    if (connection.createReceiver) {
        // discord.js
        receiver = connection.createReceiver();
    } else {
        // Eris
        connection.stopPlaying();
        receiver = connection.receive("opus");
    }

    // Ping the websocket to make sure it stays alive
    connection.ws.alive = true;
    connection.ws.on("pong", function() {
        this.alive = true;
    });
    const pingInterval = setInterval(() => {
        if (!connection.ws || !connection.ws.alive) {
            connection.disconnect();
        } else {
            connection.ws.alive = false;
            connection.ws.ping();

            /* Periodically play silence to make sure the voice connection
             * stays alive */
            var oggStream = new stream.Readable();
            try {
                connection.play(oggStream, {format: "ogg"});
            } catch (ex) {
                logex(ex);
            }
            oggStream.push(silentOggOpus);
            oggStream.push(null);
        }
    }, 30000);

    // Leave if the recording goes over their limit
    const partTimeout = setTimeout(() => {
        log("rec-term",
            "Time limit",
            {uid: rec.uid, vc: connection.channel, rid: id});
        sReply(true, l("timelimit", lang));
        rec.disconnected = true;
        connection.disconnect();
    }, limits.record * 60*60*1000);

    // Log it
    try {
        log("rec-start",
            nameId(connection.channel) + "@" + nameId(connection.channel.guild) + " with ID " + id,
            {uid: rec.uid, vc: connection.channel, rid: id});
    } catch(ex) {
        logex(ex);
    }
    cc.recordingEvents.emit("start", rec);

    // Send the recording message
    setTimeout(()=>{
        var nowRec = "data/nowrecording.opus";
        fs.access(nowRec, fs.constants.R_OK, (err) => {
            try {
                if (!err)
                    connection.play("data/nowrecording.opus", {format: "ogg"});
            } catch (ex) {
                logex(ex);
            }
        });
    }, 200);

    // Active users, by ID
    var users = {};

    // Active web users, by username#web
    var webUsers = {};

    // Active ping connections, simply so we can close them when we're done with them
    var webPingers = {};

    // Track numbers for each active user
    var userTrackNos = {};

    // Packet numbers for each active user
    var userPacketNos = {};

    // Recent packets, before they've been flushed, for each active non-web user
    var userRecentPackets = {};

    // Have we warned about this user's data being corrupt?
    var corruptWarn = {};

    // Our current track number
    var trackNo = 1;

    // Information for the note stream
    var noteStreamOn = false;
    var noteStreamNo = 65536;
    var notePacketNo = 0;

    // Set up our recording OGG header and data file
    var startTime = process.hrtime();
    var recFileBase = "rec/" + id + ".ogg";

    // The amount of data I've recorded
    var size = 0;

    // Keep track and disconnect if we seem unused
    var lastSize = 0;
    var usedMinutes = 0;
    var unusedMinutes = 0;
    var warned = false;
    const useInterval = setInterval(() => {
        if (size != lastSize) {
            lastSize = size;
            usedMinutes++;
            unusedMinutes = 0;
        } else {
            unusedMinutes++;
            if (usedMinutes === 0) {
                // No recording at all!
                var msg = l("silence1", lang);
                if (!rec.noSilenceDisconnect)
                    msg += " " + l("disconnecting", lang);
                msg += " " + l("silence2", lang, config.longUrl);
                if (rec.noSilenceDisconnect) {
                    sReply(true, msg);
                    usedMinutes++; // Just to make this warning not resound
                } else {
                    log("rec-term", "No data",
                        {uid: rec.uid, vc: connection.channel, rid: id});
                    sReply(true, msg);
                    rec.disconnected = true;
                    connection.disconnect();
                    return;
                }
            } else if (unusedMinutes === 5 && !warned) {
                var msg = l("silence5min", lang);
                sReply(true, msg);
                sReply(false, msg);
                warned = true;
            }
        }
    }, 60000);

    // And show by glowing whether we're used or not
    var lastTime = [0, 0];
    let shouldSpeak = false;
    const feedbackInterval = setInterval(() => {
        var curTime = process.hrtime(startTime);
        var diff = ((curTime[0]-lastTime[0])*10+(curTime[1]-lastTime[1])/100000000);
        if (diff > 10) {
            // It's been at least a second since we heard anything
            if (shouldSpeak) {
                connection.setSpeaking(0);
                shouldSpeak = false;
            }
        }
    }, 1000);

    // Set up our recording streams
    var recFHStream = [
        fs.createWriteStream(recFileBase + ".header1"),
        fs.createWriteStream(recFileBase + ".header2")
    ];
    var recFStream = fs.createWriteStream(recFileBase + ".data");
    var recFUStream = fs.createWriteStream(recFileBase + ".users");
    recFUStream.write("\"0\":{}\n");

    // And our ogg encoders
    var hitHardLimit = false;
    function write(stream, granulePos, streamNo, packetNo, chunk, flags) {
        size += chunk.length;
        if (sizeLimit && size >= sizeLimit) {
            if (!hitHardLimit) {
                hitHardLimit = true;
                log("rec-term", "Size limit",
                    {uid: rec.uid, vc: connection.channel, rid: id});
                sReply(true, l("sizelimit", lang));
                rec.disconnected = true;
                connection.disconnect();
            }
        } else {
            try {
                stream.write(granulePos, streamNo, packetNo, chunk, flags);
            } catch (ex) {}
        }
    }
    var recOggHStream = [ new ogg.OggEncoder(recFHStream[0]), new ogg.OggEncoder(recFHStream[1]) ];
    var recOggStream = new ogg.OggEncoder(recFStream);
    var recOgg2Stream;

    // Function to encode a single Opus chunk to the ogg file
    function encodeChunk(user, oggStream, streamNo, packetNo, chunk) {
        var chunkGranule = chunk.time;

        if (chunk.length > 4 && chunk[0] === 0xBE && chunk[1] === 0xDE) {
            // There's an RTP header extension here. Strip it.
            var rtpHLen = chunk.readUInt16BE(2);
            var off = 4;

            for (var rhs = 0; rhs < rtpHLen && off < chunk.length; rhs++) {
                var subLen = (chunk[off]&0xF)+2;
                off += subLen;
            }
            while (off < chunk.length && chunk[off] === 0)
                off++;
            if (off >= chunk.length)
                off = chunk.length;

            chunk = chunk.slice(off);
        }

        // Occasionally check that it's valid Opus data
        if (packetNo % 50 === 49) {
            try {
                opus.decode(chunk, 960);
            } catch (ex) {
                if (!corruptWarn[user.id]) {
                    sReply(true, l("corrupt", lang, user.username, user.discriminator));
                    corruptWarn[user.id] = true;
                }
            }
        }

        // Write out the chunk itself
        write(oggStream, chunkGranule, streamNo, packetNo, chunk);
        // Then the timestamp for reference
        write(oggStream, chunk.timestamp?chunk.timestamp:0, streamNo, packetNo+1, emptyBuf);
    }

    // Function to flush one or more packets from a user's recent queue
    function flush(user, oggStream, streamNo, queue, ct) {
        var packetNo = userPacketNos[user.id];
        for (var i = 0; i < ct; i++) {
            var chunk = queue.shift();
            try {
                encodeChunk(user, oggStream, streamNo, packetNo, chunk);
                packetNo += 2;
            } catch (ex) {
                logex(ex);
            }
        }
        userPacketNos[user.id] = packetNo;
    }

    // And receiver for the actual data
    function onReceive(user, chunk) {
        // By default, chunk.time is the receipt time
        var chunkTime = process.hrtime(startTime);
        chunk.time = chunkTime[0] * 48000 + ~~(chunkTime[1] / 20833.333);

        // Show that we're receiving
        // FIXME discord now only sets speaking when you actually send something, this may never work anymore
        lastTime = chunkTime;
        if (!shouldSpeak) {
            connection.setSpeaking(1);
            shouldSpeak = true;
        }

        // Make sure we're prepared for this user
        var userTrackNo, userRecents;
        if (!(user.id in users)) {
            users[user.id] = user;
            userTrackNo = trackNo++;
            userTrackNos[user.id] = userTrackNo;
            userPacketNos[user.id] = 2;
            userRecents = userRecentPackets[user.id] = [];

            // Announce them
            monConnect(userTrackNo, user.username + "#" + user.discriminator);

            // Put a valid Opus header at the beginning
            try {
                write(recOggHStream[0], 0, userTrackNo, 0, cu.opusHeader[0], ogg.BOS);
                write(recOggHStream[1], 0, userTrackNo, 1, cu.opusHeader[1]);
            } catch (ex) {
                logex(ex);
            }

            // Remember this user's name
            if (user.unknown) {
                // Need to fetch it first
                try {
                    connection.channel.guild.fetchAllMembers();
                    setTimeout(() => {
                        var member;
                        try {
                            member = connection.channel.guild.members.get(user.id);
                        } catch (ex) {}
                        if (member)
                            withName(member.user);
                        else
                            withName(user);
                    }, 5000);
                } catch (ex) {
                    withName(user);
                }
            } else {
                withName(user);
            }

            function withName(user) {
                // Remember this user's avatar
                var userData = {id: user.id, name: user.username, discrim: user.discriminator};
                var url;
                if (user.dynamicAvatarURL) {
                    url = user.dynamicAvatarURL("png", 2048);
                } else {
                    url = user.avatarURL;
                }
                if (url) {
                    request.get({url:url, encoding:null}, (err, resp, body) => {
                        if (!err)
                            userData.avatar = "data:image/png;base64," + body.toString("base64");
                        try {
                            recFUStream.write(",\"" + userTrackNo + "\":" + JSON.stringify(userData) + "\n");
                        } catch (ex) {
                            logex(ex);
                        }
                    });
                } else {
                    try {
                        recFUStream.write(",\"" + userTrackNo + "\":" + JSON.stringify(userData) + "\n");
                    } catch (ex) {
                        logex(ex);
                    }
                }
            }

        } else {
            userTrackNo = userTrackNos[user.id];
            userRecents = userRecentPackets[user.id];

        }

        // Add it to the list
        if (userRecents.length > 0) {
            var last = userRecents[userRecents.length-1];
            userRecents.push(chunk);
            if (last.timestamp > chunk.timestamp) {
                // Received out of order!
                userRecents.sort((a, b) => { return a.timestamp - b.timestamp; });

                /* Note that due to this reordering, the granule position in
                 * the output ogg file will actually be decreasing! This is
                 * fine for us, as all ogg files are preprocessed by
                 * oggstender, which corrects such discrepancies anyway. */
            }
        } else {
            userRecents.push(chunk);
        }

        // If the list is getting long, flush it
        if (userRecents.length >= 16)
            flush(user, recOggStream, userTrackNo, userRecents, 1);

        // And inform the monitor
        if (userRecents.monTimeout) {
            clearTimeout(userRecents.monTimeout);
        } else {
            monSpeakOn(userTrackNo);
        }
        userRecents.monTimeout = setTimeout(function() {
            monSpeakOff(userTrackNo);
            userRecents.monTimeout = null;
        }, 2000);
    }
    receiver.on("opus", onReceive);
    receiver.on("data", (chunk, userId, timestamp) => {
        chunk = Buffer.from(chunk);
        chunk.timestamp = timestamp;
        var user = client.users.get(userId);
        if (!user) {
            user = connection.channel.guild.members.get(userId);
            if (user) {
                user = user.user;
            } else if (userId === client.user.id) {
                // Just confusing reflection, ignore it
                return;
            } else {
                user = {id: userId, username: "Unknown", discriminator: "0000", unknown: true};
                if (userId === undefined) {
                    // Weird data, write it out to the extra file
                    try {
                        if (!recOgg2Stream)
                            recOgg2Stream = new ogg.OggEncoder(fs.createWriteStream(recFileBase + ".data2"));
                        var chunkTime = process.hrtime(startTime);
                        chunk.time = chunkTime[0] * 48000 + ~~(chunkTime[1] / 20833.333);
                        encodeChunk(user, recOgg2Stream, 0, 0, chunk);
                    } catch (ex) {
                        logex(ex);
                    }
                    return;
                }
            }
        }
        return onReceive(user, chunk);
    });

    // Support for receiving notes
    rec.note = function(note) {
        try {
            var chunk;
            if (notePacketNo === 0) {
                chunk = Buffer.from("STREAMNOTE");
                write(recOggHStream[0], 0, noteStreamNo, 0, chunk, ogg.BOS);
                notePacketNo++;
            }
            var chunkTime = process.hrtime(startTime);
            var chunkGranule = chunkTime[0] * 48000 + ~~(chunkTime[1] / 20833.333);
            chunk = Buffer.from("NOTE" + note);
            write(recOggStream, chunkGranule, noteStreamNo, notePacketNo++, chunk);
            return true;
        } catch (ex) {
            console.error(ex);
            return false;
        }
    }

    // Support for receiving web data
    rec.onweb = function(ws, msg) {
        var p = ecp.parts.login;

        var flags = msg.readUInt32LE(p.flags);
        var ctype = flags & ecp.flags.connectionTypeMask;
        var dtype = flags & ecp.flags.dataTypeMask;

        // First check the login message itself
        var givenKey = msg.readUInt32LE(p.key);
        if (ctype === ecp.flags.connectionType.monitor) {
            // Monitor requires the normal key
            if (givenKey !== rec.accessKey)
                return ws.close();
        } else {
            // All others have their own key
            if (givenKey !== rec.ennuiKey)
                return ws.close();
        }

        // If it's invalid, reject it outright
        if (dtype !== ecp.flags.dataType.opus &&
            !rec.features.ecflac)
            return ws.close();
        if ((flags & ecp.flags.features.continuous) &&
            !rec.features.eccontinuous)
            return ws.close();

        // We switch to a web size limit, depending on which features are enabled
        if (dtype !== ecp.flags.dataType.opus || (flags & ecp.flags.features.continuous))
            sizeLimit = config.hardLimitWeb;
        else
            sizeLimit = Math.max(sizeLimit, config.hardLimitWebOpus);

        // Switch based on what kind of connection it is
        if (ctype === ecp.flags.connectionType.data) {
            // It's a data connection
            webDataConnection(ws, msg, dtype, flags);

        } else if (ctype === ecp.flags.connectionType.ping) {
            // It's just a ping connection
            webPingConnection(ws);

        } else if (ctype === ecp.flags.connectionType.monitor) {
            // Separate monitor connection
            webMonitorConnection(ws);

        } else {
            return ws.close();

        }

        // And acknowledge them
        var op = ecp.parts.ack;
        var ret = Buffer.alloc(op.length);
        ret.writeUInt32LE(ecp.ids.ack, 0);
        ret.writeUInt32LE(ecp.ids.login, op.ackd);
        ws.send(ret);
    };

    // Handle data from web connections
    function webDataConnection(ws, msg, dtype, flags) {
        var continuous = !!(flags & ecp.flags.features.continuous);

        // Firstly we need to find if the user is already connected, and rename them if so
        var username = "_";
        try {
            username = msg.toString("utf8", ecp.parts.login.nick).substring(0, 32);
        } catch (ex) {}

        var wu = username + "#web";

        var user = webUsers[wu];
        if (user && (user.connected || user.dtype !== dtype || user.continuous !== continuous)) {
            // Try another track
            var i;
            for (i = 2; i < 16; i++) {
                wu = username + " (" + i + ")#web";
                user = webUsers[wu];
                if (!user || (!user.connected && user.dtype === dtype && user.continuous === continuous))
                    break;
            }
            if (i === 16) {
                // No free tracks, nothing we can do!
                return ws.close();
            }

            username = username + " (" + i + ")";
            wu = username + "#web";
        }

        var userTrackNo;
        if (!user) {
            /* Initialize this user's data (FIXME: partially duplicated from
             * the Discord version) */
            var userData = {id: wu, name: username, discrim: "web", dtype};
            userTrackNo = trackNo++;
            userTrackNos[wu] = userTrackNo;
            userPacketNos[wu] = userPacketNo = 0;

            // Put a valid Opus header at the beginning if we're Opus
            if (dtype === ecp.flags.dataType.opus) {
                try {
                    write(recOggHStream[0], 0, userTrackNo, 0, continuous?cu.opusHeaderMonoVAD:cu.opusHeaderMono[0], ogg.BOS);
                    write(recOggHStream[1], 0, userTrackNo, 1, cu.opusHeaderMono[1]);
                } catch (ex) {
                    logex(ex);
                }
            }

            // Write their username etc to the recording data
            recFUStream.write(",\"" + userTrackNo + "\":" + JSON.stringify(userData) + "\n");

            webUsers[wu] = user = {
                connected: true,
                data: userData,
                dtype, continuous, ws
            };

        } else {
            userTrackNo = userTrackNos[wu];
            user.connected = true;
            user.ws = ws;

        }

        // Send them their own ID
        var p = ecp.parts.info;
        var msg = Buffer.alloc(p.length);
        msg.writeUInt32LE(ecp.ids.info, 0);
        msg.writeUInt32LE(ecp.info.id, p.key);
        msg.writeUInt32LE(userTrackNo, p.value);
        ws.send(msg);

        // Send them the "mode" (Craig is always recording)
        var msg = Buffer.alloc(p.length);
        msg.writeUInt32LE(ecp.ids.info, 0);
        msg.writeUInt32LE(ecp.info.mode, p.key);
        msg.writeUInt32LE(ecp.mode.rec, p.value);
        ws.send(msg);

        // And send them the start time (which is always near 0)
        var msg = Buffer.alloc(p.length + 4);
        msg.writeUInt32LE(ecp.ids.info, 0);
        msg.writeUInt32LE(ecp.info.startTime, p.key);
        msg.writeDoubleLE(1, p.value);
        ws.send(msg);

        // Announce them
        sReply(true, "", "User " + JSON.stringify(username) + " has connected via EnnuiCastr.");
        monConnect(userTrackNo, username + "#web");

        // Now accept their actual data
        ws.on("message", (msg) => {
            msg = Buffer.from(msg);
            if (msg.length < 4)
                return ws.close();

            var cmd = msg.readUInt32LE(0);

            switch (cmd) {
                case ecp.ids.info:
                    // FIXME: We're counting on the fact that only FLAC sends info right now
                    var p = ecp.parts.info;
                    if (msg.length != p.length)
                        return ws.close();

                    var key = msg.readUInt32LE(p.key);
                    var value = msg.readUInt32LE(p.value);
                    if (key === ecp.info.sampleRate) {
                        // Now we can write our header
                        write(recOggHStream[0], 0, userTrackNo, 0,
                            (value===44100) ?
                                (continuous?cu.flacHeader44kVAD:cu.flacHeader44k) :
                                (continuous?cu.flacHeader48kVAD:cu.flacHeader48k),
                            ogg.BOS);
                        write(recOggHStream[1], 0, userTrackNo, 1, cu.flacTags);
                    }
                    break;

                case ecp.ids.data:
                    var p = ecp.parts.data;
                    if (msg.length < p.length)
                        return ws.close();

                    var granulePos = msg.readUIntLE(p.granulePos, 6);

                    // Calculate our "correct" time to make sure it's not unacceptably far off
                    var arrivalTime = process.hrtime(startTime);
                    arrivalTime = arrivalTime[0] * 48000 + ~~(arrivalTime[1] / 20833.333);

                    if (granulePos < arrivalTime - 30*48000 || granulePos > arrivalTime + 30*48000)
                        granulePos = arrivalTime;

                    // Accept the data
                    var data = msg.slice(p.length);
                    write(recOggStream, granulePos, userTrackNo, userPacketNos[wu]++, data);

                    // And inform the monitor
                    if (monWs) {
                        // Determine if it's silence
                        var silence = false;
                        if (continuous && data.length) {
                            silence = !data.readUInt8(0);
                        } else if (dtype === ecp.flags.dataType.flac) {
                            silence = (data.length < 16);
                        } else {
                            silence = (data.length < 8);
                        }
                        monSpeak(userTrackNo, !silence);
                    }
                    break;

                case ecp.ids.error:
                    // A client error occurred. Log it.
                    try {
                        log("ennuicastr-error", msg.toString("utf8", 4));
                    } catch (ex) {}
                    break;

                default:
                    // No other commands are accepted
                    return ws.close();
            }
        });

        ws.on("close", () => {
            user.connected = false;

            // Announce their disconnection
            if (!disconnected)
                sReply(true, "", "EnnuiCastr user " + JSON.stringify(username) + " has disconnected.");
            monDisconnect(userTrackNo, username + "#web");

        });
    }

    // Handle data from ping connections
    function webPingConnection(ws) {
        // We need to index these simply so that we can close them when we're done
        var wpid;
        do {
            wpid = ~~(Math.random() * 1000000000);
        } while (wpid in webPingers);
        webPingers[wpid] = ws;

        // Now accept commands
        ws.on("message", (msg) => {
            msg = Buffer.from(msg);
            if (msg.length < 4)
                return ws.close();

            var cmd = msg.readUInt32LE(0);

            switch (cmd) {
                case ecp.ids.ping:
                    var p = ecp.parts.ping;
                    if (msg.length !== p.length)
                        return ws.close();

                    // Pong with our current time
                    var op = ecp.parts.pong;
                    var ret = Buffer.alloc(op.length);
                    ret.writeUInt32LE(ecp.ids.pong, 0);
                    msg.copy(ret, op.clientTime, p.clientTime);
                    var tm = process.hrtime(startTime);
                    ret.writeDoubleLE(tm[0]*1000 + (tm[1]/1000000), op.serverTime);
                    ws.send(ret);
                    break;

                default:
                    // No other commands accepted
                    return ws.close();
            }
        });

        ws.on("close", () => {
            delete webPingers[wpid];
        });
    }

    // Our monitor handler
    function webMonitorConnection(ws) {
        if (monWs) {
            // There's already a monitor!
            monWs.close();
        }

        // Acknowledge them
        var op = ecp.parts.ack;
        var ret = Buffer.alloc(op.length);
        ret.writeUInt32LE(ecp.ids.ack, 0);
        ret.writeUInt32LE(ecp.ids.login, op.ackd);
        ws.send(ret);

        monWs = ws;

        // Send info for all current clients
        for (var u in users) {
            var user = users[u];
            monConnect(userTrackNos[u], user.username + "#" + user.discriminator);
        }

        for (var wu in webUsers) {
            var user = webUsers[wu].data;
            monConnect(userTrackNos[wu], user.name + "#web");
        }

        ws.on("message", (msg) => {
            // We should never receive messages from the monitor
            return ws.close();
        });

        ws.on("close", () => {
            monWs = null;
        });
    }

    // Inform the monitor (if any) of a user's connection
    function monConnect(idx, nick) {
        monConDis(idx, nick, true);
    }

    // Inform the monitor (if any) of a user's disconnection
    function monDisconnect(idx, nick) {
        monConDis(idx, nick, false);
    }

    // General monitor connection/disconnection
    function monConDis(idx, nick, con) {
        if (!monWs) return;
        var p = ecp.parts.user;
        var nickBuf = Buffer.from(nick, "utf8");
        var buf = Buffer.alloc(p.length + nickBuf.length);
        buf.writeUInt32LE(ecp.ids.user, 0);
        buf.writeUInt32LE(idx, p.index);
        buf.writeUInt32LE(con?1:0, p.status);
        nickBuf.copy(buf, p.nick);
        try {
            monWs.send(buf);
        } catch (ex) {}
    }

    // Inform the monitor that a user is speaking
    function monSpeakOn(idx) {
        monSpeak(idx, true);
    }

    // Inform the monitor that a user has stopped speaking
    function monSpeakOff(idx) {
        monSpeak(idx, false);
    }

    // General speech/stop informer
    function monSpeak(idx, on) {
        if (!monWs) return;
        var p = ecp.parts.speech;
        var buf = Buffer.alloc(p.length);
        buf.writeUInt32LE(ecp.ids.speech, 0);
        buf.writeUInt32LE((idx<<1)|(on?1:0), p.indexStatus);
        try {
            monWs.send(buf);
        } catch (ex) {}
    }

    // When we're disconnected from the channel...
    var disconnected = false;
    function onDisconnect() {
        if (disconnected)
            return;
        disconnected = true;

        // Close any web connections
        for (var wu in webUsers) {
            try {
                var user = webUsers[wu];
                if (user.connected)
                    user.ws.close();
            } catch (ex) {
                logex(ex);
            }
        }
        rec.onweb = null;

        // And web ping connections
        for (var wpid in webPingers) {
            try {
                webPingers[wpid].close();
            } catch (ex) {
                logex(ex);
            }
        }

        // And the monitor
        if (monWs) {
            try {
                monWs.close();
            } catch (ex) {
                logex(ex);
            }
            monWs = null;
        }

        // Flush any remaining data
        for (var uid in userRecentPackets) {
            var user = users[uid];
            var userTrackNo = userTrackNos[uid];
            var userRecents = userRecentPackets[uid];
            flush(user, recOggStream, userTrackNo, userRecents, userRecents.length);
        }

        if (!rec.disconnected) {
            // Not an intentional disconnect
            try {
                log("rec-term",
                    "Unexpected disconnection",
                    {uid: rec.uid, vc: connection.channel, rid: id});
            } catch (ex) {
                logex(ex);
            }
            try {
                sReply(true, l("unexpecteddc", lang));
            } catch (ex) {
                logex(ex);
            }
            rec.disconnected = true;
            updateRateLimit(rec.gid, false);

        } else {
            updateRateLimit(rec.gid, true);

        }

        // Log it
        try {
            log("rec-stop",
                nameId(connection.channel) + "@" + nameId(connection.channel.guild) + " with ID " + id,
                {uid: rec.uid, vc: connection.channel, rid: id});
        } catch (ex) {
            logex(ex);
        }
        cc.recordingEvents.emit("stop", rec);

        // Close the output files
        recOggHStream[0].end();
        recOggHStream[1].end();
        recOggStream.end();
        if (recOgg2Stream) recOgg2Stream.end();
        recFUStream.end();

        // Delete our timers
        clearInterval(pingInterval);
        clearTimeout(partTimeout);
        clearInterval(useInterval);
        clearInterval(feedbackInterval);

        // Destroy the receiver (unnecessary)
        try {
            receiver.destroy();
        } catch (ex) {}

        // Start post-recording processing if the user has any postproc
        if (driveStmt.get({id:rec.uid})) {
            cp.spawn("./postrec.js", [
                rec.uid+"",
                rec.id+"",
                JSON.stringify(rec.features),
                JSON.stringify(rec.info)
            ], {
                stdio: "ignore"
            });
        }

        // And callback
        rec.close();
    }
    connection.on("disconnect", onDisconnect);
    connection.on("error", onDisconnect);

    const failedToDecrypt = /Failed to decrypt/;
    connection.on("warn", (warning) => {
        if (rec.disconnected)
            return;
        try {
            if (failedToDecrypt.test(warning)) {
                // Ignored
            } else {
                log("vc-warn",
                    nameId(connection.channel) + "@" + nameId(connection.channel.guild) + " with ID " + id + ": " + warning,
                    {uid: rec.uid, vc: connection.channel, rid: id});
            }
        } catch (ex) {
            logex(ex);
        }
    });
}

// Join a voice channel
async function safeJoin(channel, err) {
    try {
        const reciever = await channel.join({ opusOnly:true });
        reciever.on("error", (ex) => {
            try {
                guild.client.voice.connections.delete(guild.id);
            } catch (noex) {}
            if (err) err(ex);
        });
        return reciever;
    } catch (e) {
        err(e)
    }
}

// Join is the only command in Craig with arguments, and to avoid clash, they're janky
const argPart = /^-([A-Za-z0-9]+) *(.*)$/;

// The recording indicator
const recIndicator = / *\!?\[RECORDING\] */g;

// Start recording
async function joinChannel(user, guild, channel, noSilenceDisconnect, { msg, interaction, lang, auto, cmd } = {}) {
    if (interaction) await interaction.defer();

    // Since errors are optional, we have a general error responder
    function error(dm, text) {
        if (!auto) reply(interaction || msg, dm, cmd ? cmd[1] : null, text);
    }

    var userId = user.id;
    var guildId = guild.id;
    var channelId = channel.id;
    if (!(guildId in activeRecordings))
        activeRecordings[guildId] = {};

    // If the user is a bot, features and such come from the server owner
    if (user.bot) {
        var owner = client.users.get(guild.ownerID);
        if (owner) {
            user = owner;
            userId = owner.id;
        }
    }

    // Figure out the recording features for this user
    var f = await cf.features(userId, guildId);
    if (f.limits.record === 0) {
        reply(interaction || msg, false, cmd[1], "Sorry, but this bot is only for patrons. Please use Craig ( https://craig.chat/ )");
        return;
    }

    // Choose the right client
    var takenClients = {};
    var chosenClient = null;
    var chosenClientNum = -1;
    for (var oChannelId in activeRecordings[guildId]) {
        var recording = activeRecordings[guildId][oChannelId];
        takenClients[recording.clientNum] = true;
    }
    for (var ci = 0; ci < clients.length && ci <= f.limits.secondary; ci++) {
        if (takenClients[ci]) continue;
        chosenClient = clients[ci];
        chosenClientNum = ci;
        break;
    }

    // Translate the guild and channel to the secondary client
    if (chosenClient && chosenClient !== client) {
        guild = chosenClient.guilds.get(guildId);
        if (guild)
            channel = guild.channels.get(channelId);
    }

    // Joinable can crash if the voiceConnection is in a weird state
    var joinable = true;
    try {
        if (channel)
            joinable = channel.joinable;
    } catch (ex) {
        // Work around the most insane discord.js bug yet
        try {
            var fguild = chosenClient.guilds.get(guild.id);
            if (fguild) {
                guild = fguild;
                var fchannel = guild.channels.get(channel.id);
                if (fchannel)
                    channel = fchannel;
                channel.guild = guild; // Unbelievably, we can do this!
            }
            joinable = channel.joinable;
        } catch (ex) {
            logex(ex);
        }
    }

    // Choose the right action
    if (channelId in activeRecordings[guildId]) {
        var rec = activeRecordings[guildId][channelId];
        error(true, l("already", lang, config.dlUrl, rec.id, rec.accessKey));

    } else if (!chosenClient) {
        error(false, l("nomore", lang));

    } else if (!guild) {
        error(false, l("onemore", lang, config.secondary[chosenClientNum-1].invite));

    } else if (!channel) {
        error(false, l("broperms", lang));

    } else if (!joinable) {
        error(false, l("noperms", lang));

    } else {
        // Make a random ID for it
        var id, infoWS, recFileBase;
        while (true) {
            id = ~~(Math.random() * 1000000000);
            recFileBase = "rec/" + id + ".ogg";
            try {
                fs.accessSync(recFileBase + ".info");
                // ID existed
                continue;
            } catch (ex) {
                // ID did not exist
            }
            try {
                infoWS = fs.createWriteStream(recFileBase + ".info", {flags:"wx"});
                break;
            } catch (ex) {
                // ID existed
            }
        }

        // Make the access keys for it
        var accessKey = ~~(Math.random() * 1000000000);
        var ennuiKey = ~~(Math.random() * 1000000000);
        var deleteKey = ~~(Math.random() * 1000000000);

        // Set up the info
        var info = {
            format: 1,
            key: accessKey,
            "delete": deleteKey,
            guild: nameId(guild),
            guildExtra: {
                name: guild.name,
                id: guild.id,
                icon: guild.dynamicIconURL('png', 256)
            },
            channel: nameId(channel),
            channelExtra: {
                name: channel.name,
                id: channel.id,
                type: channel.type
            },
            requester: interaction ? (user.username + "#" + user.discriminator) : (msg.author.username + "#" + msg.author.discriminator),
            requesterExtra: {
                username: (interaction ? user : msg.author).username,
                discriminator: (interaction ? user : msg.author).discriminator,
                avatar: (interaction ? user : msg.author).dynamicAvatarURL('png', 256)
            },
            requesterId: interaction ? userId : msg.author.id,
            startTime: new Date().toISOString(),
            expiresAfter: f.limits.download,
            features: f
        };
        delete info.features.limits;
        if (!interaction && user !== msg.author) {
            info.user = user.username + "#" + user.discriminator;
            info.userId = userId;
            info.userExtra = {
                username: user.username,
                discriminator: user.discriminator,
                avatar: user.dynamicAvatarURL('png', 256)
            };
        }

        // Write out the info
        infoWS.write(JSON.stringify(info));
        infoWS.end();

        // Make sure the files get destroyed
        try {
            var atcp = cp.spawn("at", ["now + " + f.limits.download + " hours"],
                    {"stdio": ["pipe", 1, 2]});
            atcp.stdin.write("rm -f " + recFileBase + ".header1 " +
                    recFileBase + ".header2 " + recFileBase + ".data " +
                    recFileBase + ".data2 " +
                    recFileBase + ".info " + recFileBase + ".users\n");
            atcp.stdin.end();
        } catch (ex) {
            logex(ex);
        }

        // We have a nick per the specific client
        var configNick = config.nick;
        if (chosenClient !== client)
            configNick = config.secondary[chosenClientNum-1].nick;

        // Or we may have a local nick
        var localNick = undefined;
        try {
            localNick = guild.members.get(chosenClient.user.id).nick;
        } catch (ex) {
            logex(ex);
        }

        var closed = false;
        function close() {
            if (closed)
                return;
            closed = true;

            // Now get rid of it
            delete activeRecordings[guildId][channelId];
            if (Object.keys(activeRecordings[guildId]).length === 0) {
                delete activeRecordings[guildId];
            }
            delete arID[id];

            // Rename the bot in this guild
            /*
            NOTE: For the time being, just keep ![RECORDING] in the name, to avoid being rate limited
            var fixNick = undefined;
            try {
                fixNick = guild.members.get(chosenClient.user.id).nick;
                fixNick = fixNick.replace(recIndicator, "");
            } catch (ex) {}
            if (!fixNick) fixNick = configNick;
            try {
                guild.editNickname(fixNick).catch(logex);
            } catch (ex) {
                logex(ex);
            }
            */

            // Try to reset our voice connection nonsense by joining a different channel
            /*
            var diffChannel = channel;
            guild.channels.some((maybeChannel) => {
                if (maybeChannel === channel)
                    return false;

                var joinable = false;
                try {
                    joinable = maybeChannel.joinable;
                } catch (ex) {}
                if (!joinable)
                    return false;

                diffChannel = maybeChannel;
                return true;
            });
            function leave() {
                setTimeout(()=>{
                    try {
                        diffChannel.leave();
                    } catch (ex) {}
                }, 1000);
            }
            safeJoin(diffChannel, leave).then(leave).catch(leave);
            */

            // FIXME it rejoins to leave?
            // function leave() {
            //     setTimeout(()=>{
            //         try {
            //             channel.leave();
            //         } catch (ex) {}
            //     }, 1000);
            // }
            // safeJoin(channel, leave).then(leave).catch(leave);
            channel.leave();
        }

        var rec = {
            uid: userId,
            gid: guild.id,
            cid: channel.id,
            features: f,
            info: info,
            connection: null,
            id: id,
            accessKey: accessKey,
            ennuiKey: ennuiKey,
            lang: lang,
            client: chosenClient,
            clientNum: chosenClientNum,
            limits: f.limits,
            disconnected: false,
            close: close
        };
        activeRecordings[guildId][channelId] = rec;
        arID[id] = rec;

        if (noSilenceDisconnect)
            rec.noSilenceDisconnect = true;

        // If we have voice channel issue, do our best to rectify them
        var hadJoinError = false;
        function onJoinError(ex) {
            if (!hadJoinError) {
                error(false, l("joinfail", lang) + " " + ex);
                logex(ex);
                hadJoinError = true;
            }
            close();
        }

        // Rename ourself to indicate that we're recording
        var recNick;
        try {
            // Using '!' to sort early
            if (localNick) {
                if (localNick.indexOf("[RECORDING]") !== -1)
                    recNick = localNick;
                else
                    recNick = ("![RECORDING] " + localNick).substr(0, 32);
            } else {
                recNick = "![RECORDING] " + configNick;
            }
            let p = Promise.all([]);
            let nickTimeout = null;
            p.then(() => {
                if (recNick !== localNick) {
                    nickTimeout = setTimeout(function() {
                        error(false, l("nickslow", lang));
                        nickTimeout = null;
                    }, 30000);
                    return guild.editNickname(recNick);
                }

            }).then(() => {
                if (nickTimeout)
                    clearTimeout(nickTimeout);

                join();

            }).catch((err) => {
                log("rec-term",
                    "Lack nick change permission: " + JSON.stringify(err+""),
                    {uid: userId, vc: channel, rid: id});
                error(false, l("cannotnick", lang));
                rec.disconnected = true;
                close();
            });
        } catch (ex) {
            logex(ex);
        }

        // Join the channel
        function join() {
            // If we don't have a connection in 30 seconds, assume something went wrong
            setTimeout(()=>{
                if (!rec.connection) onJoinError(new Error("Timed out"));
            }, 30000);

            if (guild.voiceConnection) {
                // Disconnect the old (broken?) one first
                try {
                    guild.voiceConnection.disconnect();
                } catch (ex) {
                    logex(ex);
                }
                chosenClient.voiceConnections.delete(guild.id);
                setTimeout(join, 1000);
                return;
            }

            safeJoin(channel, onJoinError).then((connection) => {
                // Get a language hint
                var hint = cl.hint(channel, lang);

                // Tell them
                var rmsg = 
                    l("recording", lang,
                        f.limits.record+"",
                        f.limits.download+"",
                        channel.name+"",
                        ~~(f.limits.download/24)+"",
                        info.startTime) +
                    (hint?("\n\n"+hint):"") +
                    "\n\n" + l("downloadlink", lang, config.dlUrl, id+"", accessKey+"");

                if (hs && cf.otherFeatures[userId] && cf.otherFeatures[userId].ennuicastr) {
                    var url = config.ennuicastr + "?i=" + id.toString(36) +
                        "&k=" + ennuiKey.toString(36) +
                        "&p=" + hs.address().port.toString(36);
                    var mon = config.ennuicastr + "?i=" + id.toString(36) +
                        "&k=" + accessKey.toString(36) +
                        "&p=" + hs.address().port.toString(36) +
                        "&mon=1";
                    rmsg += "\n\n" + l("ennuicastrmon", lang, mon);
                    if (!f.eccontinuous && !f.ecflac) {
                        rmsg += "\n\n" + l("ennuicastrlink", lang, url);
                    } else {
                        // Give them a menu
                        var ecf = (f.eccontinuous?1:0) | (f.ecflac?ecp.flags.dataType.flac:0);
                        url += "&f=" + ecf.toString(36) + "&s=1";
                        rmsg += "\n\n" + l("ennuicastrmenu", lang, url);
                    }
                }

                reply(interaction || msg, true, cmd ? cmd[1] : null, rmsg,
                    l("deletelink", lang, config.dlUrl, id+"", accessKey+"", deleteKey+"") + "\n.");
                // TODO localize
                if (interaction) interaction.createMessage('Started recording.');

                rec.connection = connection;

                session(interaction || msg, cmd ? cmd[1] : null, rec);
            }).catch(onJoinError);
        }
    }
}
function cmdJoin(lang) { return async function(msg, cmd) {
    var guild = msg.guild;
    if (!guild)
        return;
    var cname = cmd[3].toLowerCase();
    var channel = null;

    // Not our job
    if (cc.dead) return;

    // Check for flags
    var noSilenceDisconnect = false;
    var auto = false;
    var parts;
    while (parts = argPart.exec(cname)) {
        var arg = parts[1];
        if (arg === "silence") {
            noSilenceDisconnect = true;
        } else if (arg === "auto") {
            auto = true;
        } else break;
        cname = parts[2];
    }

    // Check for rate limits
    var rl = getRateLimit(guild.id);
    if (rl) {
        if (rl.pending) {
            // Spam. Ignore.
            return;
        }

        var now = Date.now();
        if (rl.nextAllowed > now) {
            // Being rate limited. Pause.
            var wait = rl.nextAllowed - now;
            if (!auto)
                reply(msg, false, cmd[1], l("ratelimit", lang, ""+Math.ceil(wait / 1000)));
            rl.pending = true;
            await new Promise(res => setTimeout(res, wait));
            rl.pending = false;
        }
    }

    channel = cu.findChannel(msg, guild, cname);

    if (channel !== null) {
        await joinChannel(msg.author, msg.channel.guild, channel, noSilenceDisconnect, { msg, lang, auto, cmd });
    } else if (!cc.dead) {
        if (!auto)
            reply(msg, false, cmd[1], (cname==="") ? l("whatchannel", lang) : l("cantsee", lang));
    }

} }
cl.register(commands, "join", cmdJoin);
slashCommands['join'] = async function(interaction) {
    // fail intentionally I guess?
    if (cc.dead) return;
    let channel = interaction.data.resolved ? interaction.data.resolved.channels.values().next().value : null;
    if (channel === null) {
        if (interaction.member.voiceChannel) channel = interaction.member.voiceChannel;
        else return interaction.createMessage({
            content: l("whatchannel", 'en'),
            flags: 64
        });
    } else channel = interaction.channel.guild.channels.get(channel.id);

    // Check for rate limits
    var rl = getRateLimit(interaction.channel.guild.id);
    if (rl) {
        if (rl.pending) {
            interaction.createMessage({
                content: "You are recording too often!",
                flags: 64
            });
            return;
        }

        var now = Date.now();
        if (rl.nextAllowed > now) {
            // Being rate limited. Pause.
            var wait = rl.nextAllowed - now;
            interaction.createMessage({
                content: l("ratelimit", 'en', ""+Math.ceil(wait / 1000)),
                flags: 64
            });
            rl.pending = true;
            await new Promise(res => setTimeout(res, wait));
            rl.pending = false;
        }
    }

    return joinChannel(interaction.member.user, interaction.channel.guild, channel, false, { interaction });
}

// Stop recording
function cmdLeave(lang) { return function(msg, cmd) {
    var guild = msg.guild;
    if (!msg.guild)
        return;
    var cname = cmd[3].toLowerCase();

    var channel = cu.findChannel(msg, guild, cname);

    if (channel !== null) {
        var guild = msg.guild;
        var guildId = guild.id;
        var channelId = channel.id;
        if (!(guildId in activeRecordings) ||
            !(channelId in activeRecordings[guildId])) {
            /* Maybe we can just ignore the channel name and leave whatever
             * channel we're in? */
            if (cname === "" && (guildId in activeRecordings)) {
                var rid = Object.keys(activeRecordings[guildId])[0];
                if (rid) {
                    channel = guild.channels.get(rid);
                    channelId = rid;
                }
            }
        }
        if (guildId in activeRecordings &&
            channelId in activeRecordings[guildId]) {
            try {
                var rec = activeRecordings[guildId][channelId];
                if (rec.connection) {
                    rec.disconnected = true;
                    rec.connection.disconnect();
                }
            } catch (ex) {
                logex(ex);
            }

        } else if (!cc.dead) {
            reply(msg, false, cmd[1], l("notrecording", lang));
        }

    } else if (!cc.dead) {
        reply(msg, false, cmd[1], l("whatchannel", lang));

    }

} }
cl.register(commands, "leave", cmdLeave);
slashCommands['leave'] = function(interaction) {
    const guild = interaction.channel.guild;
    const guildId = guild.id;
    let channel = interaction.data.resolved ? interaction.data.resolved.channels.values().next().value : null;
    if (channel === null && interaction.member.voiceChannel) channel = interaction.member.voiceChannel;
    else if (channel !== null) channel = interaction.channel.guild.channels.get(channel.id);

    // Use the first active recording if no channel was selected
    if (!interaction.data.resolved && guildId in activeRecordings && (!channel || !(channel.id in activeRecordings[guildId]))) {
        var rid = Object.keys(activeRecordings[guildId])[0];
        if (rid) channel = guild.channels.get(rid);
    }

    
    if (channel === null)
        return interaction.createMessage({
            content: l("whatchannel", 'en'),
            flags: 64
        });
    const channelId = channel.id;

    // Actually leave
    if (guildId in activeRecordings &&
        channelId in activeRecordings[guildId]) {
        try {
            var rec = activeRecordings[guildId][channelId];
            if (rec.connection) {
                rec.disconnected = true;
                rec.connection.disconnect();
            }
        } catch (ex) {
            logex(ex);
        }
        // TODO localize
        interaction.createMessage(`Stopped recording in ${channel.name}.`)
    } else if (!cc.dead) {
        interaction.createMessage(l("notrecording", 'en'));
    }
}

// Stop all recordings
commands["stop"] = function(msg, cmd) {
    var guild = msg.guild;
    if (!guild)
        return;
    var guildId = guild.id;
    if (guildId in activeRecordings) {
        for (var channelId in activeRecordings[guildId]) {
            try {
                var rec = activeRecordings[guildId][channelId];
                if (rec.connection) {
                    rec.disconnected = true;
                    rec.connection.disconnect();
                }
            } catch (ex) {
                logex(ex);
            }
        }
    } else if (!cc.dead) {
        reply(msg, false, cmd[1], "But I haven't started!");
    }

}
slashCommands["stop"] = function(interaction) {
    const guildId = interaction.channel.guild.id;
    if (guildId in activeRecordings) {
        for (var channelId in activeRecordings[guildId]) {
            try {
                var rec = activeRecordings[guildId][channelId];
                if (rec.connection) {
                    rec.disconnected = true;
                    rec.connection.disconnect();
                }
            } catch (ex) {
                logex(ex);
            }
        }
        interaction.createMessage('Stopped all active recordings.');
    } else if (!cc.dead) {
        interaction.createMessage("But I haven't started!");
    }
}

// Take notes
function cmdNote(lang) { return function(msg, cmd) {
    var guild = msg.guild;
    if (!guild)
        return;
    var guildId = guild.id;
    if (guildId in activeRecordings) {
        for (var channelId in activeRecordings[guildId]) {
            try {
                var rec = activeRecordings[guildId][channelId];
                let noted = rec.note(cmd[3]);
                if (noted) reply(msg, false, cmd[1], l("noted", lang));
            } catch (ex) {}
        }
    }
} }
cl.register(commands, "note", cmdNote);
slashCommands["note"] = function(interaction) {
    const note = interaction.data.options[0].value;
    const guildId = interaction.channel.guild.id;
    if (guildId in activeRecordings) {
        for (var channelId in activeRecordings[guildId]) {
            try {
                var rec = activeRecordings[guildId][channelId];
                let noted = rec.note(note);
                interaction.createMessage(noted ? l("noted", 'en') : 'Failed to note that!');
            } catch (ex) {
                interaction.createMessage('Failed to note that!');
            }
        }
    }
}

// Checks for catastrophic recording errors
clients.forEach((client) => {
    if (!client) return;

    function voiceChannelSwitch(member, toChannel, fromChannel) {
        try {
            if (member.id === client.user.id) {
                var guildId = fromChannel.guild.id;
                var channelId = fromChannel.id;
                if (guildId in activeRecordings &&
                    channelId in activeRecordings[guildId] &&
                    activeRecordings[guildId][channelId].connection &&
                    toChannel.id !== channelId) {
                    // We do not tolerate being moved
                    log("rec-term",
                        "Moved to a different channel",
                        {gid: guildId, vcid: channelId, rid: activeRecordings[guildId][channelId].id});
                    member.guild.voiceConnection.disconnect();
                }
            }
        } catch (ex) {
            logex(ex);
        }
    }
    client.on("voiceChannelSwitch", voiceChannelSwitch);
    client.on("voiceChannelLeave", (member, channel) => {
        voiceChannelSwitch(member, null, channel);
    });

    client.on("guildUpdate", (to, from) => {
        try {
            if (from.region !== to.region &&
                to.voiceConnection) {
                // The server has moved regions. This breaks recording.
                log("rec-term",
                    "Moved to a different voice region",
                    {vc: to.voiceConnection.channel});
                to.voiceConnection.disconnect();
            }
        } catch (ex) {
            logex(ex);
        }
    });

    client.on("guildMemberUpdate", (guild, to, from) => {
        try {
            if (to.id === client.user.id &&
                guild.voiceConnection &&
                (!to.nick || to.nick.indexOf("[RECORDING]") === -1)) {
                // Make sure this isn't just a transient state
                if (guild.id in activeRecordings &&
                    guild.voiceConnection.channel.id in activeRecordings[guild.id]) {
                    // They attempted to hide the fact that Craig is recording. Not acceptable.
                    log("rec-term",
                        "Nick changed wrongly",
                        {vc: guild.voiceConnection.channel, rid: activeRecordings[guild.id][guild.voiceConnection.channel.id].id});
                    to.guild.voiceConnection.disconnect();
                }
            }
        } catch (ex) {
            logex(ex);
        }
    });
});

// Inform the shard manager when recordings start or end
if (!cc.master) {
    cc.recordingEvents.on("start", (rec) => {
        var size = 1;
        try {
            size = rec.connection.channel.members.size;
            client.shard.send({
                t:"startRecording",
                g:rec.gid, c:rec.cid,
                r: {
                    id: rec.id,
                    accessKey: rec.accessKey,
                    guild: rec.gid,
                    channel: rec.cid,
                    size: size,
                    user: rec.info.userId || rec.info.requesterId
                }
            });
        } catch (ex) {
            logex(ex);
        }
    });

    cc.recordingEvents.on("stop", (rec) => {
        try {
            client.shard.send({t:"stopRecording", g:rec.gid, c:rec.cid});
        } catch (ex) {
            logex(ex);
        }
    });
}

// Get our currect active recordings from the launcher
if (process.channel)
    client.once('ready', () => process.send({ t:"requestActiveRecordings", guilds: Array.from(client.guilds.keys()) }));
cc.processCommands["activeRecordings"] = async function(msg) {
    let dcedGuilds = {};
    let erroredDMs = {};
    for (let ar of msg.activeRecordings) {
        if (!client.guilds.get(ar.guild)) return;
        if (!dcedGuilds[ar.guild]) {
            client.closeVoiceConnection(ar.guild);
            dcedGuilds[ar.guild] = true;
        }

        process.send({ t: "stopRecording", g: ar.guild, c: ar.channel });
        if (ar.user && !erroredDMs[ar.user]) {
            try {
                const dm = await client.getDMChannel(ar.user);
                await dm.createMessage(`:warning: The recording (\`${ar.id}\`) in <#${ar.channel}> has abruptly stopped, possibly due to the bot being briefly disconnected or a restart has occurred.\n**Please create a new recording using \`/join\`**, your previous recording will still be accessible.`)
            } catch (e) {
                erroredDMs[ar.user] = true;
                logex('gr-dm-fail', e);
            }
        }
    }
}

/* If our shard disconnects, consider committing sudoku to get a fresh
 * connection * /
var dced = null;
if (cc.client) cc.client.on("shardDisconnect", (err) => {
    if (cc.dead) return; // Doesn't matter

    // Have we been recently disconnected, and do we have no active recordings?
    if (dced) {
        // Actually, it's not like the recordings would work anyway...
        //if (Object.keys(activeRecordings).length === 0) {
            // Yup. Goodbye, cruel world!
            process.exit(1);
        /*} else {
            log("shard-disconnected", "Cannot exit with active recordings");
        }* /
    } else {
        // Don't be TOO eager to die
        dced = setTimeout(function() {
            dced = null;
        }, 10*60*1000);
    }
}); */

/* Graceful restart. This doesn't REALLY belong in rec.js, but maintaining the
 * currently active recordings is the only complicated part of gracefully
 * restarting, so here it is. */
function gracefulRestart() {
    if (!cc.master) {
        // Not our job! We'll trust the shard manager to do the restarting
        client.shard.send({t:"gracefulRestart"});
        return;

    } else if (process.channel) {
        // Launched by launcher. Get the list of active recordings.
        var nar = {};
        for (var gid in activeRecordings) {
            var g = activeRecordings[gid];
            var ng = nar[gid] = {};
            for (var cid in g) {
                var c = g[cid];
                var size = 1;
                try {
                    size = c.connection.channel.members.size;
                } catch (ex) {}
                var nc = ng[cid] = {
                    id: c.id,
                    accessKey: c.accessKey,
                    size: size
                };
            }
        }

        // Let the runner spawn a new Craig
        process.send({"t": "gracefulRestart", "activeRecordings": nar});

        // And then exit when we're done
        function maybeQuit(rec) {
            for (var gid in activeRecordings) {
                var g = activeRecordings[gid];
                for (var cid in g) {
                    var c = g[cid];
                    if (c !== rec && c.connection)
                        return;
                }
            }

            // No recordings left, we're done
            if (cc.sm)
                cc.sm.broadcast({t:"exit"});
            setTimeout(() => {
                process.exit(0);
            }, 15000);
        }
        maybeQuit();
        cc.recordingEvents.on("stop", maybeQuit);

    } else {
        // Start a new craig
        var ccp = cp.spawn(
            process.argv[0], ["craig.js"],
            {"stdio": "inherit", "detached": true});
        ccp.on("exit", (code) => {
            process.exit(code ? code : 1);
        });

    }

    // Stop responding to input
    cc.dead = true;
    if (cb.stop) cb.stop();
    if (cc.sm) {
        // And make sure the shards do too
        cc.sm.broadcast({t:"term"});
    }
}

// Shard command for graceful restart
cc.shardCommands["gracefulRestart"] = gracefulRestart;

// Owner command for graceful restart
ccmds.ownerCommands["graceful-restart"] = function(msg, cmd) {
    msg.channel.send("Respawning all shards!").then(() => gracefulRestart());
}

ccmds.ownerCommands["restart-this"] = function(msg, cmd) {
    if (!process.env.SHARD_ID) return reply(msg, false, cmd[1], "This wasn't spawned with a shard manager...");
    msg.channel.send("Restarting this shard...").then(() => process.send({ t: "restartThis" }));
}

ccmds.ownerCommands["restart-one"] = function(msg, cmd) {
    if (!process.env.SHARD_ID) return reply(msg, false, cmd[1], "This wasn't spawned with a shard manager...");
    if (!cmd[3]) return reply(msg, false, cmd[1], "Please provide a shard ID");
    if (process.send) {
        msg.channel.send(`Restarting shard ${cmd[3]}...`).then(() => process.send({ t: "restartOne", id: parseInt(cmd[3]) }));
    } else {
        reply(msg, false, cmd[1], "Process.send is undefined...");
    }
}

ccmds.ownerCommands["shardinfo"] = function(msg, cmd) {
    if (!process.env.SHARD_ID) return reply(msg, false, cmd[1], "This wasn't spawned with a shard manager...");
    function format(seconds){
        function pad(s){
            return (s < 10 ? '0' : '') + s;
        }
        var hours = Math.floor(seconds / (60*60));
        var minutes = Math.floor(seconds % (60*60) / 60);
        var seconds = Math.floor(seconds % 60);
        
        return pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
    }
    client.shard.broadcastEval('let sir = { i: client.shard.id, s: client.shard.status, g: client.guilds.size, l: Number.isFinite(client.shard.latency) ? client.shard.latency : -1, u: process.uptime(), r: Object.keys(require("./rec.js").activeRecordings).length };sir').then((res) => {
        let list = `\`\`\`fix\n${res.map((r) => `${String(r.i) === process.env.SHARD_ID ? '>' : ' '} [${r.i}] ${r.s}, ${r.l} ms, ${r.g} guilds, ${r.r} active recs, uptime: ${format(r.u)}`).join('\n')}\n\`\`\``;
        const msgs = cu.splitMessage(list, { prepend: '```fix\n', append: '\n```', maxLength: 1900 });
        Promise.all(msgs.map((m) => m ? msg.channel.send(m) : Promise.resolve()))
            .then(() => {})
            .catch((ex) => msg.channel.send(`Failed to send shard info: ${ex}`));
    }).catch((e) => {
        msg.channel.send(`Failed to get values: ${e}`);
    });
}

// Terminus command
cc.processCommands["term"] = function(msg) {
    cc.dead = true;
    if (cb.stop) cb.stop();
}

// And exit command
cc.processCommands["exit"] = function(msg) {
    setTimeout(() => {
        process.exit(0);
    }, 30000);
}


// Start the EnnuiCastr server
function startEnnuiCastr() {
    var attempts = 0;
    var home = process.env.HOME; // FIXME: Make this path configurable
    var hst = https.createServer({
        cert: fs.readFileSync(home+"/cert/fullchain.pem", "utf8"),
        key: fs.readFileSync(home+"/cert/privkey.pem", "utf8")
    });

    hst.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
            // Try again
            if (attempts++ < 16)
                startHTTPS();
        }
    });

    hst.on("listening", startWS);

    // Start the HTTPS server
    function startHTTPS() { 
        hst.listen(36678 + ~~(Math.random()*1024));
    }

    startHTTPS();

    // Start the websocket server
    function startWS() {
        hs = hst;
        wss = new ws.Server({
            server: hs
        });

        wss.on("connection", (ws) => {
            // We must receive a login first
            ws.once("message", (msg) => {
                msg = Buffer.from(msg); // Just in case
                var p = ecp.parts.login;
                if (msg.length < p.length)
                    return ws.close();

                var cmd = msg.readUInt32LE(0);
                if (cmd !== ecp.ids.login)
                    return ws.close();

                // The ID is the only thing we check here
                var id = ""+msg.readUInt32LE(p.id);
                if (!(id in arID))
                    return ws.close();

                var cb = arID[id].onweb;
                if (!cb)
                    return ws.close();

                messageHandler = cb(ws, msg);
            });
        });
    }
}
if (config.ennuicastr)
    startEnnuiCastr();
// TODO: Ensure a safer way to do this without breaking the shards.
// Restart every so often so we can upgrade, reevaluate shards, etc
//if(cc.master)
//    var uptimeTimeout = setTimeout(() => { if (!cc.dead) gracefulRestart(); }, 4*24*60*60*1000);

module.exports = {activeRecordings, joinChannel, gracefulRestart};
