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

const schema = fs.readFileSync("craig/db.schema", "utf8");

// Initialize it if necessary
schema.split(";").forEach((x) => {
    x = x.trim();
    if (x === "") return;
    db.prepare(x).run();
});

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

module.exports = {db, deleteGuild, dbDump, loadDB};
