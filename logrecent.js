#!/usr/bin/env node
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
 * Simple script to select recent log lines.
 */
const sqlite3 = require("better-sqlite3");
const db = new sqlite3("log.db");
db.pragma("journal_mode = WAL");

var when;
if (process.argv[2] === "all") {
    when = "";
} else {
    when = " WHERE time >= datetime('now', '-" + (process.argv[2]?process.argv[2]:"7 days") + "')";
}

const stmt = db.prepare("SELECT * FROM log" + when + " ORDER BY time ASC");

for (var row of stmt.iterate()) {
    var line = row.time + " " + row.type;
    ["u", "g", "tc", "vc", "r"].forEach((id) => {
        if (row[id+"id"])
            line += " (" + id + row[id+"id"] + ")";
    });
    line += ": " + row.details;
    process.stdout.write(line+"\n");
}
