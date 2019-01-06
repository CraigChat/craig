/*
 * Copyright (c) 2018 Yahweasel
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

/*
 * Craig: A multi-track voice channel recording bot for Discord.
 *
 * Interface with Craig's database
 */

const fs = require("fs");
const sqlite3 = require("better-sqlite3");
const db = new sqlite3("craig.db");
db.pragma("journal_mode = WAL");

const asqlite3 = require("sqlite3"); // Yes, we use both
const logdb = new asqlite3.Database("log.db");
logdb.run("PRAGMA journal_mode = WAL");

const schema = fs.readFileSync("craig/db.schema", "utf8");
const lschema = fs.readFileSync("craig/logdb.schema", "utf8");

// Initialize it if necessary
schema.split(";").forEach((x) => {
    x = x.trim();
    if (x === "") return;
    db.prepare(x).run();
});

logdb.exec(lschema);

// A runner for DB transactions with retry
function dbRun(stmt, vals) {
    if (typeof vals === "undefined") vals = {};
    var retries = 30;
    function retry() {
        try {
            stmt.run(vals);
        } catch (ex) {
            if (--retries <= 0) {
                // :(
                console.error(ex);
            } else {
                setTimeout(retry, 1000);
            }
        }
    }
    retry();
}

// A runner for log transactions with retry
function logRun(stmt, vals) {
    if (typeof vals === "undefined") vals = {};
    var retries = 30;
    function retry() {
        stmt.run(vals, function(err) {
            if (!err) return;
            if (--retries <= 0) {
                // :(
                console.error(ex);
            } else {
                setTimeout(retry, 1000);
            }
        });
    }
    retry();
}

// Prepare the guild deletion statements
const deleteSqls = [
    "DELETE FROM guildMembershipStatus WHERE id=?",
    "DELETE FROM auto WHERE gid=?",
    "DELETE FROM blessings WHERE gid=?",
    "DELETE FROM prefixes WHERE id=?"
];
const deleteStmts = deleteSqls.map((x) => {
    return db.prepare(x);
});

// Completely delete a guild
function deleteGuild(id) {
    deleteStmts.forEach((x) => {
        x.run(id);
    });
}

// Dump the entire database except for guild membership status and Drive connection
function dumpDB() {
    var tables = ["auto", "bans", "blessings", "prefixes"];
    var dump = [];

    function quote(v) {
        if (typeof v === "number")
            return ""+v;
        if (v === null)
            return "NULL";
        return "'" + (""+v).replace("'", "''") + "'";
    }

    tables.forEach((table) => {
        dump.push("DELETE FROM " + table);
        var stmt = db.prepare("SELECT * FROM " + table);
        stmt.all().forEach((row) => {
            var cols = Object.keys(row);

            var line = "INSERT INTO " + table + " (" +
                cols.join(",") + ") VALUES (" +
                cols.map((col)=>quote(row[col])).join(",") + ")";
            dump.push(line);
        });
    });

    return dump;
}

const dbDump = dumpDB();

// Load a database dump
function loadDB(dump) {
    db.transaction(dump).run();
}

// Our logging statement
const logStmt = logdb.prepare(
    "INSERT INTO log (time, type, uid, gid, tcid, vcid, rid, details) VALUES " +
    "(strftime('%Y-%m-%d %H:%M:%f', @time), @type, @uid, @gid, @tcid, @vcid, cast(@rid as integer), @details)");

// And function
function log(type, details, extra) {
    var vals = {
        "@time": new Date().toISOString(),
        "@type": type,
        "@details": details
    };
    if (typeof extra === "undefined") extra = {};

    // Convenience conversions
    if (extra.u)
        extra.uid = extra.u.id;
    if (extra.tc) {
        extra.gid = extra.tc.guild ? extra.tc.guild.id : null;
        extra.tcid = extra.tc.id;
    }
    if (extra.vc) {
        extra.gid = extra.vc.guild ? extra.vc.guild.id : null;
        extra.vcid = extra.vc.id;
    }

    ["uid", "gid", "tcid", "vcid", "rid"].forEach((key) => {
        if (key in extra)
            vals["@"+key] = extra[key];
        else
            vals["@"+key] = null;
    });
    logRun(logStmt, vals);
}

module.exports = {db, logdb, dbRun, deleteGuild, dbDump, loadDB, log};
