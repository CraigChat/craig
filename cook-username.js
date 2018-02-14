#!/usr/bin/env node
const fs = require("fs");
var users = [];
try {
    users = JSON.parse("[" + fs.readFileSync(process.argv[2]+".ogg.users") + "]");
} catch (ex) {}
var n = parseInt(process.argv[3], 10);
var user = users[n] ? users[n] : "";
process.stdout.write(user.replace(/[^a-zA-Z0-9]/, "_"));
