const cp = require("child_process");
const fs = require("fs");
const Discord = require("discord.js");
const client = new Discord.Client();

function newConnection(connection) {
    const receiver = connection.createReceiver();
    var userStreams = {};
    var userProcs = {};

    receiver.on('opus', (user, chunk) => {
        if (user in userStreams) return;

        if (!(user in userProcs)) {
            userProcs[user] = cp.spawn("ffmpeg", [
                "-fflags", "nobuffer", "-probesize", "32", "-packetsize", "1", "-blocksize", "4",
                "-ar", "48000", "-ac", "1", "-f", "s32le", "-i", "-",
                "-af", "asetpts=(RTCTIME - RTCSTART) / (TB * 1000000)",
                "-c:a", "flac",
                connection.channel.name + "." + user.username + "." + user.id + "." + (new Date().toISOString()) + ".mkv"],
                {stdio: ["pipe", 1, 2]});
        }
        var ffmpeg = userProcs[user];
        //var ffmpeg = {stdin: fs.createWriteStream("test.pcm")};

        var stream = userStreams[user] = receiver.createPCMStream(user);

        function closeHandler() {
            delete userStreams[user];
        }

        stream.on("data", (chunk) => {
            try {
                ffmpeg.stdin.write(chunk);
            } catch(ex) {
            }
        });
        stream.on("end", closeHandler);
    });
}

client.on('ready', () => {
    console.log(`Logged in as ${client.user.username}!`);
    client.guilds.every((guild) => {
        guild.channels.every((channel) =>{
            if (channel.type !== "voice")
                return true;

            if (channel.name.substr(0, 2) != "C ")
                return true;

            channel.join().then(newConnection);
        });
        return true;
    });
});

client.on('message', msg => {
  if (msg.content === 'ping') {
    msg.reply('Pong!');
  }
});

client.login('MjcyOTM3NjA0MzM5NDY2MjQw.C2cQgg.KgqXiB_BJgdZmAuGY1_P837zwIU');
