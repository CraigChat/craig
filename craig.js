const cp = require("child_process");
const fs = require("fs");
const Discord = require("discord.js");
const opus = require("node-opus");
const ogg = require("ogg");
const ogg_packet = require("ogg-packet");
const client = new Discord.Client();

function accessSyncer(file) {
    try {
        fs.accessSync(file);
    } catch (ex) {
        return false;
    }
    return true;
}

// Active recording IDs
var activeRecordings = {};

// Given a connection, our recording session proper
function newConnection(channelStr, connection, id) {
    const receiver = connection.createReceiver();

    // Our input Opus streams by user
    var userOpusStreams = {};

    // Our output streams by user
    var userOggStreams = {};

    // Our current track number
    var trackNo = 1;

    // Set up our recording OGG header and data file
    var startTime = process.hrtime();
    var recFileBase = "rec/" + id + ".ogg";
    try { fs.mkdirSync("rec"); } catch (ex) {}

    // Set up our recording streams
    var recFHStream = [
        fs.createWriteStream(recFileBase + ".header1"),
        fs.createWriteStream(recFileBase + ".header2")
    ];
    var recFStream = fs.createWriteStream(recFileBase + ".data");

    // Make sure they get destroyed
    var atcp = cp.spawn("at", ["now + 48 hours"],
        {"stdio": ["pipe", 1, 2]});
    atcp.stdin.write("rm -f " + recFileBase + ".header1 " + recFileBase + ".header2 " + recFileBase + ".data " + recFileBase + ".delete");
    atcp.stdin.end();

    // And our ogg encoders
    function mkEncoder(fstream, allow_b_o_s) {
        var encoder = new ogg.Encoder();
        encoder.on("data", (chunk) => {
            if (!allow_b_o_s) {
                /* Manually hack out b_o_s, assume (correctly) we'll never have
                 * inter-page chunks */
                chunk[5] &= 0xFD;
            }
            fstream.write(chunk);
        });
        encoder.on("end", () => { fstream.end(); });
        return encoder;
    }
    var recOggHStream = [ mkEncoder(recFHStream[0], true), mkEncoder(recFHStream[1]) ];
    var recOggStream = mkEncoder(recFStream);

    // Function to encode a single Opus chunk to the ogg file
    function encodeChunk(oggStream, chunk, packetNo) {
        var chunkTime = process.hrtime(startTime);
        var chunkGranule = chunkTime[0] * 48000 + ~~(chunkTime[1] / 20833.333);
        var oggPacket = new ogg_packet();
        oggPacket.packet = chunk;
        oggPacket.bytes = chunk.length;
        oggPacket.b_o_s = 0;
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
        var userOggStream;
        if (!(userStr in userOggStreams)) {
            var serialNo = trackNo++;
            var userOggHStream = [
                recOggHStream[0].stream(serialNo),
                recOggHStream[1].stream(serialNo)
            ];
            userOggStream = recOggStream.stream(serialNo);
            userOggStreams[userStr] = userOggStream;

            // Put a valid Opus header at the beginning
            var opusEncoder = new opus.Encoder(48000, 1, 480);
            opusEncoder.on("data", (chunk) => {
                if (!chunk.e_o_s) {
                    if (chunk.granulepos == 0)
                        userOggHStream[0].write(chunk);
                    else
                        userOggHStream[1].write(chunk);
                }
            });
            opusEncoder.on("end", () => {
                userOggHStream[0].flush(() => {
                    userOggHStream[0].end();
                });
                userOggHStream[1].flush(() => {
                    userOggHStream[1].end();
                });
            });
            opusEncoder.write(Buffer.alloc(480*2));
            opusEncoder.end();
        }
        userOggStream = userOggStreams[userStr];

        // And then receive the real data into the data stream
        var oggStream = userOggStreams[userStr];
        var packetNo = 2;

        // Give it some empty audio data to start it out
        var opusEncoder = new opus.OpusEncoder(48000);
        var oggPacket = new ogg_packet();
        oggPacket.packet = opusEncoder.encode(Buffer.alloc(480*2), 480);
        oggPacket.bytes = oggPacket.packet.length;
        oggPacket.b_o_s = 0;
        oggPacket.e_o_s = 0;
        oggPacket.granulepos = 0;
        oggPacket.packetno = packetNo++;
        oggStream.packetin(oggPacket);
        oggStream.flush(() => {});

        encodeChunk(userOggStream, chunk, packetNo++);

        opusStream.on("data", (chunk) => {
            encodeChunk(userOggStream, chunk, packetNo++);
        });
        opusStream.on("end", () => {
            delete userOpusStreams[userStr];
        });
    });

    // When we're disconnected from the channel...
    connection.on("disconnect", () => {
        // Close all our OGG streams
        for (var user in userOggStreams)
            userOggStreams[user].end();

        // And delete the active recording
        delete activeRecordings[channelStr];
    });
}

client.on('ready', () => {
    console.log(`Logged in as ${client.user.username}!`);
});

const craigCommand = /^(:craig:|<:craig:[0-9]*>),? *([^ ]*) (.*)$/;

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

client.on('message', (msg) => {
    // We don't care if it's not a command
    var cmd = msg.content.match(craigCommand);
    if (cmd === null) return;

    // Ignore it if it's from an unauthorized user
    if (!userIsAuthorized(msg.member)) return;

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
                    var channelStr = channel.name + "#" + channel.id;
                    if (channelStr in activeRecordings) {
                        msg.author.send("I'm already recording that channel: http://craigrecords.yahweasel.com/?id=" + activeRecordings[channelStr]);

                    } else {
                        channel.join().then((connection) => {
                            // Make a random ID for it
                            var id;
                            do {
                                id = ~~(Math.random() * 1000000000);
                            } while (accessSyncer("rec/" + id + ".ogg.header1"));

                            // Make a deletion key for it
                            var deleteKey = ~~(Math.random() * 10000000000);
                            fs.writeFileSync("rec/" + id + ".ogg.delete", ""+deleteKey, "utf8");

                            // Tell them
                            activeRecordings[channelStr] = id;
                            msg.author.send(
                                "Recording! http://craigrecords.yahweasel.com/?id=" + id + "\n\n" +
                                "To delete: http://craigrecords.yahweasel.com/?id=" + id + "&delete=" + deleteKey + "\n\n");

                            // Then start the connection
                            newConnection(channelStr, connection, id);

                        }).catch((err) => {
                            msg.reply(cmd[1] + " <(Failed to join! " + err + ")");
                        });

                    }

                } else {
                    channel.leave();

                }
            }

            return true;
        });

        if (!found)
            msg.reply(cmd[1] + " <(What channel?)");
    }
});

client.login(JSON.parse(fs.readFileSync("config.json", "utf8")).token);
