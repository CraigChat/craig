const fs = require("fs");
const Discord = require("discord.js");
const opus = require("node-opus");
const ogg = require("ogg");
const ogg_packet = require("ogg-packet");
const client = new Discord.Client();

function newConnection(connection) {
    const receiver = connection.createReceiver();
    var userOpusStreams = {};
    var userOggStreams = {};

    // Set up our recording OGG file
    var startTime = process.hrtime();
    var recFile = "rec/" + connection.channel.name + "." + (new Date().toISOString()) + ".ogg";
    try { fs.mkdirSync("rec"); } catch (ex) {}

    var recFStream = fs.createWriteStream(recFile);
    var recOggStream = new ogg.Encoder();
    recOggStream.on("data", (chunk) => {
        recFStream.write(chunk);
    });
    recOggStream.on("end", () => {
        recFStream.end();
    });

    // Function to encode a single Opus chunk to the ogg file
    function encodeChunk(oggStream, chunk, packetNo, b_o_s) {
        var chunkTime = process.hrtime(startTime);
        var chunkGranule = chunkTime[0] * 48000 + ~~(chunkTime[1] / 20833.333);
        var oggPacket = new ogg_packet();
        oggPacket.packet = chunk;
        oggPacket.bytes = chunk.length;
        oggPacket.b_o_s = b_o_s ? 1 : 0;
        oggPacket.e_o_s = 0;
        oggPacket.granulepos = chunkGranule;
        oggPacket.packetno = packetNo;
        oggStream.packetin(oggPacket);
        oggStream.flush(() => {});
    }

    // And receiver for the actual data
    receiver.on('opus', (user, chunk) => {
        var userStr = user.username + "#" + user.id;
        if (userStr in userOpusStreams) return;

        var opusStream = userOpusStreams[userStr] = receiver.createOpusStream(user);
        if (!(userStr in userOggStreams)) {
            userOggStreams[userStr] = recOggStream.stream();

            // Start with a valid Opus header
            var opusEncoder = new opus.Encoder(48000, 1, 960); // FIXME: Magic numbers
            opusEncoder.on("data", (chunk) => {
                userOggStreams[userStr].packetin(chunk);
            });
            opusEncoder.write(Buffer.alloc(480*4));
        }
        var oggStream = userOggStreams[userStr];
        var packetNo = 1;

        encodeChunk(oggStream, chunk, 0, true);

        opusStream.on("data", (chunk) => {
            encodeChunk(oggStream, chunk, packetNo++);
        });
        opusStream.on("end", () => {
            delete userOpusStreams[userStr];
        });
    });

    // When we're disconnected from the channel...
    connection.on("disconnect", () => {
        // Close all our OGG streams
        for (var user in userOggStreams) {
            userOggStreams[user].end();
        }

        // And close the overall OGG stream
        // ???
    });
}

client.on('ready', () => {
    console.log(`Logged in as ${client.user.username}!`);
});

const craigCommand = /^(:craig: |<:craig:[0-9]*> )([^ ]*) (.*)$/;

client.on('message', (msg) => {
    var cmd = msg.content.match(craigCommand);
    if (cmd === null) return;
    var op = cmd[2].toLowerCase();
    if (op === "join" || op === "record" || op === "rec" ||
        op === "leave" || op === "part") {
        var cname = cmd[3].toLowerCase();
        var found = false;
        if (!msg.guild)
            return;

        msg.guild.channels.every((channel) => {
            if (channel.type !== "voice")
                return true;

            if (channel.name.toLowerCase() === cname) {
                found = true;
                if (op === "join" || op === "record" || op === "rec") {
                    channel.join().then(newConnection).catch((err) => {
                        msg.reply(cmd[1] + "<(Failed to join! " + err + ")");
                    });
                } else {
                    channel.leave();
                }
            }
        });

        if (!found)
            msg.reply(cmd[1] + "<(What channel?)");
    }
});

client.login('MjcyOTM3NjA0MzM5NDY2MjQw.C2cQgg.KgqXiB_BJgdZmAuGY1_P837zwIU');
