const fs = require("fs");
const sqlite3 = require("better-sqlite3");
const db = new sqlite3("craig.db");
db.pragma("journal_mode = WAL");

/*
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

// craig-auto -> auto
const autoLog = JSON.parse("[" + fs.readFileSync("craig-auto.json", "utf8") + "]");
const auto = autoLog[0];
for (var i = 1; i < autoLog.length; i++) {
    var step = autoLog[i];
    if ("t" in step) {
        if (!(step.u in auto))
            auto[step.u] = [];
        auto[step.u].push(step);
    } else {
        if (!(step.u in auto))
            auto[step.u] = [];
        var ua = auto[step.u];
        for (var ui = 0; ui < ua.length; ui++) {
            var e = ua[ui];
            if (e.g === step.g && e.c === step.c) {
                ua.splice(ui, 1);
                break;
            }
        }
    }
}

const autoStmt = db.prepare("INSERT INTO auto (uid, gid, cid, tids) VALUES (@uid, @gid, @cid, @tids)");
for (var uid in auto) {
    auto[uid].forEach((el) => {
        var tids = [];
        for (var tid in el.t)
            tids.push(tid);
        tids = tids.join(",");
        autoStmt.run({
            uid: el.u,
            gid: el.g,
            cid: el.c,
            tids: tids
        });
    });
}

// craig-bans -> bans
const banLog = JSON.parse("[" + fs.readFileSync("craig-bans.json", "utf8") + "]");
const bans = banLog[0];
for (var i = 1; i < banLog.length; i++) {
    var step = banLog[i];
    if ("u" in step) {
        bans[step.i] = step.u;
    } else {
        delete bans[step.i];
    }
}

const banStmt = db.prepare("INSERT INTO bans (id, name) VALUES (@id, @name)");
for (var id in bans) {
    banStmt.run({id:id, name:bans[id]});
}

// craig-bless -> blessings
const blessLog = JSON.parse("[" + fs.readFileSync("craig-bless.json", "utf8") + "]");
const blessings = blessLog[0];
for (var i = 1; i < blessLog.length; i++) {
    var step = blessLog[i];
    if ("g" in step) {
        blessings[step.u] = step.g;
    } else {
        delete blessings[step.u];
    }
}

const blessStmt = db.prepare("INSERT INTO blessings (uid, gid) VALUES (@uid, @gid)");
for (var uid in blessings) {
    blessStmt.run({uid:uid, gid:blessings[uid]});
}
*/

// *-credentials.json -> drive
const credFiles = fs.readdirSync("/home/yahweasel/craig-drive");
const credFileRE = /^([0-9]*)-credentials\.json$/;
credFiles.forEach((credFile) => {
    var cp = credFileRE.exec(credFile);
    if (cp === null) return;
    db.prepare("INSERT INTO drive (id, data) VALUES (?, ?)").run(cp[1], fs.readFileSync("/home/yahweasel/craig-drive/" + credFile));
});
