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
