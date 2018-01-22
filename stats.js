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
const fs = require("fs");

var log = fs.readFileSync(process.argv[2], "utf8");
var lines = log.split("\n");
var events = [];
var recordings = {};
var stats = {
    totalRecordings: 0,
    totalTime: 0,
    maxSimultaneous: 0
};
for (var li = 0; li < lines.length; li++) {
    var line = lines[li];
    if (line.match(/^....-..-..T..:..:...[0-9]*Z:/)) {
        // It's a log line
        var m = line.match(/(.*): Started.*with ID ([0-9]*)/);
        if (m && m[2]) {
            // Started recording
            var rec = {
                id: m[2],
                start: new Date(m[1]),
                end: null,
                endEvent: -1
            };

            rec.startEvent = events.length;
            events.push({event: "start", rec: rec});
            recordings[m[2]] = rec;
            continue;
        }

        m = line.match(/(.*): Finished.*with ID ([0-9]*)/);
        if (m && m[2]) {
            // Stopped recording
            var rec = recordings[m[2]];
            if (!rec) continue;

            rec.end = new Date(m[1]);
            rec.endEvent = events.length;
            events.push({event: "end", rec: rec});
            delete recordings[m[2]];
            continue;
        }
    }
}

var curSimultaneous = 0;
for (var ei = 0; ei < events.length; ei++) {
    var ev = events[ei];
    var rec = ev.rec;
    if (ev.event === "start") {
        // Starting a recording
        if (rec.endEvent < 0) continue;

        stats.totalRecordings++;

        curSimultaneous++;
        if (curSimultaneous > stats.maxSimultaneous)
            stats.maxSimultaneous = curSimultaneous;

    } else if (ev.event === "end") {
        // Ending a recording
        var length = rec.end - rec.start;
        stats.totalTime += length/1000;

        curSimultaneous--;

    }
}

console.log("Total recordings:\t" + stats.totalRecordings);
console.log("Total recording time:");
var tm = stats.totalTime;
var days = Math.floor(tm / 86400);
tm -= days * 86400;
var hours = Math.floor(tm / 3600);
tm -= hours * 3600;
var minutes = Math.floor(tm / 60);
tm -= minutes * 60;
tm = Math.floor(tm);
console.log("\t" + days + " days");
console.log("\t" + hours + " hours");
console.log("\t" + minutes + " minutes");
console.log("\t" + tm + " seconds");
console.log("Max simultaneous:\t" + stats.maxSimultaneous);
