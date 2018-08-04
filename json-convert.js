const fs = require("fs");
const sqlite3 = require("better-sqlite3");
const db = new sqlite3("craig.db");

// craig-guild-membership-status -> guildMembershipStatus
const gmsLog = JSON.parse("[" + fs.readFileSync("craig-guild-membership-status.json", "utf8") + "]");
const gms = gmsLog[0];
for (var i = 1; i < gmsLog.length; i++) {
    var step = gmsLog[i];
    if (!("v" in step))
        delete gms[step.k];
    else
        gms[step.k] = step.v;
}

const gmsStmt = db.prepare("INSERT INTO guildMembershipStatus (id, refreshed) VALUES (@id, @refreshed)");
for (var id in gms) {
    var r = gms[id];
    gmsStmt.run({id: id, refreshed: r});
}
