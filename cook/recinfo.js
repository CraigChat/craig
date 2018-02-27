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
process.stdout.write(JSON.stringify(info) + "\n");
