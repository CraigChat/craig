const cp = require("child_process");
const fs = require("fs");
const Discord = require("discord.js");
const client = new Discord.Client();

function newConnection(connection) {
    const receiver = connection.createReceiver();
    var userStreams = {};
    var userProcs = {};

    var recDir = "rec/" + connection.channel.name + "." + (new Date().toISOString());

    fs.mkdirSync("rec");
    fs.mkdirSync(recDir);

    receiver.on('opus', (user, chunk) => {
        if (user in userStreams) return;

        if (!(user in userProcs)) {
            userProcs[user] = cp.spawn("ffmpeg", [
                "-fflags", "nobuffer", "-probesize", "32", "-packetsize", "1", "-blocksize", "4",
                "-ar", "48000", "-ac", "1", "-f", "s32le", "-i", "-",
                "-af", "asetpts=(RTCTIME - RTCSTART) / (TB * 1000000)",
                "-c:a", "flac",
                recDir + "/" + user.username + "." + user.id + "." + (new Date().toISOString()) + ".mkv"],
                {stdio: ["pipe", 1, 2]});
        }
        var ffmpeg = userProcs[user];
        //var ffmpeg = {stdin: fs.createWriteStream("test.pcm")};

        var stream = userStreams[user] = receiver.createPCMStream(user);

        function endHandler() {
            delete userStreams[user];
        }

        stream.on("data", (chunk) => {
            try {
                ffmpeg.stdin.write(chunk);
            } catch(ex) {
            }
        });
        stream.on("end", () => {
            delete userStreams[user];
        });
    });

    connection.on("disconnect", () => {
        for (var user in userProcs) {
            var ffmpeg = userProcs[user];
            ffmpeg.stdin.end();
        }
    });
}

client.on('ready', () => {
    console.log(`Logged in as ${client.user.username}!`);
});

const craigCommand = /^(<:craig:[0-9]*> )([^ ]*) (.*)$/;

client.on('message', (msg) => {
    var cmd = msg.content.match(craigCommand);
    if (cmd === null) return;
    var op = cmd[2].toLowerCase();
    if (op === "join" || op === "leave" || op === "part") {
        var cname = cmd[3].toLowerCase();
        var found = false;
        if (!msg.guild)
            return;

        msg.guild.channels.every((channel) => {
            if (channel.type !== "voice")
                return true;

            if (channel.name.toLowerCase() === cname) {
                found = true;
                if (op === "join") {
                    channel.join().then(newConnection);
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
