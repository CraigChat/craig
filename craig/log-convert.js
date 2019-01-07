#!/usr/bin/env node
/*
 * Copyright (c) 2019 Yahweasel
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
const fs = require("fs");
const sqlite3 = require("better-sqlite3");
const db = new sqlite3("log.db");
db.pragma("journal_mode = WAL");

const logStmt = db.prepare(
    "INSERT INTO log (time, type, uid, gid, tcid, vcid, rid, details) VALUES " +
    "(strftime('%Y-%m-%d %H:%M:%f', @time), @type, @uid, @gid, @tcid, @vcid, cast(@rid as integer), @details)");

var logF = fs.readFileSync(process.argv[2], "utf8");
var lines = logF.split("\n");
var ts;

function log(type, details, extra) {
    var vals = {
        "time": ts,
        "type": type,
        "details": details
    };
    if (typeof extra === "undefined") extra = {};

    ["uid", "gid", "tcid", "vcid"].forEach((key) => {
        if (key in extra)
            vals[key] = extra[key];
        else
            vals[key] = null;
    });
    if ("rid" in extra)
        vals["rid"] = +extra.rid;
    else
        vals["rid"] = null;

    function retry() {
        try {
            logStmt.run(vals);
            setImmediate(go);
        } catch (ex) {
            setTimeout(retry, 100);
        }
    }
    retry();
}

const tsl = /^(....-..-..T..:..:..\....Z): (.*)$/;

const command = /^Command: (.*#([0-9]+)@.*#([0-9]+)@.*#([0-9]+): .*)/;
const ownerCommand = /^Owner command: (.*#([0-9]+): .*)/;
const recStart = /^Started recording (.*#([0-9]+)@.*#([0-9]+) with ID ([0-9]+))$/;
const recStop = /^Finished recording (.*#([0-9]+)@.*#([0-9]+) with ID ([0-9]+))$/;
const recTerm = /^Terminating ([0-9]+): (.*)\.$/
const recTerm2 = /^Terminating recording: (.*)\.$/
const reply = /^Reply to (.*#([0-9]+): .*)/;
const replyPublic = /^Public reply to (.*#([0-9]+): .*)/;
const replyFail = /^Failed to reply to (.*#([0-9]+))$/;
const login = /^Logged in as .*/;
const unexpectedDc = /^Unexpected disconnect from (.*#([0-9]+)@.*#([0-9]+) with ID ([0-9]+))$/;
const exception = /^EXCEPTION: (.*)/;
const autorecordJoin = /^Auto-record join: (.*#([0-9]+)@.*#([0-9]+) requested by .*#([0-9]+))$/;
const autorecordLeave = /^Auto-record leave: (.*#([0-9]+)@.*#([0-9]+) requested by .*#([0-9]+))$/;
const vcWarn = /^VoiceConnection WARN in (.*#([0-9]+)@.*#([0-9]+) with ID ([0-9]+): .*)/
const disconnected = /^Disconnected!(.*)/;
const disconnectedShard = /^Disconnected \(shard\)!(.*)/;
const clientError = /^Client error!(.*)/;

const obsolete = /^Failed to reconnect to.*/;

var li = 0;
function go() {
    if (li >= lines.length) return;
    var line = lines[li];
    var res = tsl.exec(line);
    if (res === null) {
        li++;
        setImmediate(go);
        return;
    }
    ts = res[1];
    line = res[2];

    if (res = command.exec(line)) {
        log("command", res[1], {uid: res[2], tcid: res[3], gid: res[4]});
    } else if (res = ownerCommand.exec(line)) {
        log("owner-command", res[1], {uid: res[2]});
    } else if (res = recStart.exec(line)) {
        log("rec-start", res[1], {vcid: res[2], gid: res[3], rid: res[4]});
    } else if (res = recStop.exec(line)) {
        log("rec-stop", res[1], {vcid: res[2], gid: res[3], rid: res[4]});
    } else if (res = recTerm.exec(line)) {
        log("rec-term", res[2], {rid: res[1]});
    } else if (res = recTerm2.exec(line)) {
        log("rec-term", res[1]);
    } else if (res = reply.exec(line)) {
        log("reply", "To " + res[1], {uid: res[2]});
    } else if (res = replyPublic.exec(line)) {
        log("reply", "Public to " + res[1], {uid: res[2]});
    } else if (res = replyFail.exec(line)) {
        log("reply-fail", res[1], {uid: res[2]});
    } else if (res = login.exec(line)) {
        log("login", res[0]);
    } else if (res = unexpectedDc.exec(line)) {
        log("rec-term", "Unexpected disconnection", {vcid: res[2], gid: res[3], rid: res[4]});
    } else if (res = exception.exec(line)) {
        log("exception", res[1]);
    } else if (res = autorecordJoin.exec(line)) {
        log("autorecord-start", res[1], {vcid: res[2], gid: res[3], uid: res[4]});
    } else if (res = autorecordLeave.exec(line)) {
        log("autorecord-stop", res[1], {vcid: res[2], gid: res[3], uid: res[4]});
    } else if (res = vcWarn.exec(line)) {
        log("vc-warn", res[1], {vcid: res[2], gid: res[3], rid: res[4]});
    } else if (res = disconnected.exec(line)) {
        log("disconnected", res[1]);
    } else if (res = disconnectedShard.exec(line)) {
        log("shard-disconnected", res[1]);
    } else if (res = clientError.exec(line)) {
        log("client-error", res[1]);

    } else if (res = obsolete.exec(line)) {
        log("obsolete", res[0]);

    } else {
        console.error("Unsupported line: " + line);
        process.exit(1);
    }

    if ((li % 1000) === 0) process.stderr.write(li + "\r");
    li++;
}
go();
