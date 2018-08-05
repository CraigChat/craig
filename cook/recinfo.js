#!/usr/bin/env node
const fs = require("fs");
var infoInp = "{}";
try {
    infoInp = fs.readFileSync(process.argv[2]+".ogg.info", "utf8");
} catch (ex) {}
var userInp = "";
try {
    userInp = fs.readFileSync(process.argv[2]+".ogg.users", "utf8");
} catch (ex) {}
var info = JSON.parse(infoInp);
var users = {};
try {
    users = JSON.parse("{" + userInp + "}");
} catch (ex) {}
delete users[0];
for (var k in users)
    delete users[k].avatar;
info.tracks = users;
delete info.key;
delete info["delete"];
delete info.features;
if (process.argv[3] === "text") {
    process.stdout.write(
        "Guild:\t\t" + info.guild + "\r\n" +
        "Channel:\t" + info.channel + "\r\n" +
        "Requester:\t" + info.requester + "\r\n" +
        "Start time:\t" + info.startTime + "\r\n" +
        "Tracks:\r\n");
    for (var ui = 1; users[ui]; ui++)
        process.stdout.write("\t" + users[ui].name + "#" + users[ui].discrim + "\r\n");
} else {
    process.stdout.write(JSON.stringify(info) + "\n");
}
