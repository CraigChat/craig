#!/usr/bin/env node
const fs = require("fs");
var inp = "";
try {
    inp = fs.readFileSync(process.argv[2]+".ogg.users", "utf8");
} catch (ex) {}
var users = {};
try {
    users = JSON.parse("{" + inp + "}");
} catch (ex) {
    // Old-style, just an array
    try {
        users = JSON.parse("[" + inp + "]");
    } catch (ex) {}
}
var n = parseInt(process.argv[3], 10);
var val = users[n] ? users[n] : "";
if (process.argv[4]) {
    var param = process.argv[4];
    val = val[param] ? val[param] : "";
} else if (typeof val === "object") {
    val = val.name + "#" + val.discrim;
    val = val.replace(/[^a-zA-Z0-9]/g, "_");
}
if (process.argv[5] === "datauri" && val.startsWith("data:"))
    val = Buffer.from(val.split(",")[1], "base64");
process.stdout.write(val);
process.stdout.end();
process.stdout.on("finish", () => {
    process.exit((val==="")?1:0);
});
