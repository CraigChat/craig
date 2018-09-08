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
 * Support for backup Craig (Giarc)
 */

const cc = require("./client.js");
const config = cc.config;
const logex = cc.logex;

const cd = require("./db.js");

const backupPort = 57341;

if (!config.backup) return; // No backup at all!

// If we're the backup master, only one shard should handle this
if (config.backup.master) {
    if (!cc.client) return;
    if ("SHARD_ID" in process.env) {
        if (process.env["SHARD_ID"] !== "0") return;
    }
}

const fs = require("fs");
const tls = require("tls");

const cu = require("./utils.js");
const reply = cu.reply;

if (config.backup.master) {
    const sockets = new Set();

    // We are the master, so create a TLS server
    const server = tls.createServer({
        key: fs.readFileSync(config.backup.key),
        cert: fs.readFileSync(config.backup.cert),
        requestCert: true,
        rejectUnauthorized: true,
        ca: [ fs.readFileSync(config.backup.remote) ]
    }, (socket) => {
        var data = "";

        sockets.add(socket);

        socket.on("close", () => {
            sockets.delete(socket);
        });

        function send(cmd, data) {
            socket.write(JSON.stringify({c:cmd, d:data}) + "\n");
        }

        function fail(id) {
            send("fail", {i:id});
        }

        function ack(id) {
            send("ack", {i:id});
        }

        socket.on("data", (chunk) => {
            data += chunk;
            var lines = data.split("\n");
            data = lines.pop();
            lines.forEach((line) => {
                var cmd;
                try {
                    cmd = JSON.parse(line);
                } catch (ex) {
                    logex(ex);
                    return;
                }
                switch (cmd.c) {
                    case "reply":
                        // Send a reply
                        cc.client.getDMChannel(cmd.d.u).then((dm) => {
                            dm.createMessage("[BACKUP]\n\n" + cmd.d.t).then(() => {
                                ack(cmd.d.i);
                            }).catch(() => {
                                fail(cmd.d.i);
                            });
                        }).catch(() => {
                            fail(cmd.d.i);
                        });
                        break;

                    case "db":
                        // Send our database
                        send("db", cd.dbDump);
                        break;
                }
            });
        });
    });

    // Start the server
    function startServer() {
        server.listen(backupPort);
    }

    server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
            // Just try again
            setTimeout(() => {
                if (!cc.dead)
                    startServer();
            }, 5000);
        }
    });

    startServer();

    // When the server resets, we stop listening
    function stop() {
        try {
            server.close();
        } catch (ex) {}
        sockets.forEach((socket) => {
            try {
                socket.end();
            } catch (ex) {}
        });
    }

    module.exports = {stop};

} else {
    // We're the backup
    var data = "";
    var replies = {};
    var gotDB = false;

    var socket = null;
    var closed = false;

    // Send a message to the host
    function send(cmd, data) {
        if (!socket) return;
        socket.write(JSON.stringify({c:cmd, d:data}) + "\n");
    }

    // Send a reply via the host
    function reply(id, text, fail) {
        if (!socket || socket.destroyed) {
            fail();
            return;
        }

        // Choose an id for this reply
        var rid = ~~(Math.random() * 1000000000);
        while (rid in replies)
            rid = ~~(Math.random() * 1000000000);
        var rep = replies[rid] = {};

        // If our attempt to reply via the host succeeds, no timeout
        rep.ack = function() {
            if (this.timeout)
                clearTimeout(this.timeout);
            delete replies[rid];
        }

        // If our attempt to reply fails, do it locally
        rep.fail = function() {
            this.ack();
            fail();
        }

        // Set a ten-second timeout to succeed
        rep.timeout = setTimeout(rep.fail.bind(rep), 10000);

        // Now send it
        try {
            send("reply", {i:rid, u:id, t: text});
        } catch (ex) {
            logex(ex);
            fail();
        }
    }

    function connect() {
        socket = tls.connect({
            host: config.backup.host,
            port: backupPort,
            rejectUnauthorized: true,
            ca: [ fs.readFileSync(config.backup.remote) ],
            key: fs.readFileSync(config.backup.key),
            cert: fs.readFileSync(config.backup.cert)
        }, () => {
            // We just connected. If we're the first shard and we haven't yet, request the DB dump
            if (!gotDB && (!("SHARD_ID" in process.env) || process.env["SHARD_ID"] === "0"))
                send("db", 0);
        });
    
        socket.on("close", (ex) => {
            socket = null;
            setTimeout(() => {
                if (!cc.dead)
                    connect();
            }, 5000);
        });

        socket.on("error", () => {});

        // Data from the server
        socket.on("data", (chunk) => {
            data += chunk;
            var lines = data.split("\n");
            data = lines.pop();
            lines.forEach((line) => {
                var cmd;
                try {
                    cmd = JSON.parse(line);
                } catch (ex) {
                    logex(ex);
                    return;
                }
                switch (cmd.c) {
                    case "ack":
                        // Successful reply
                        if (cmd.d.i in replies)
                            replies[cmd.d.i].ack();
                        break;
    
                    case "fail":
                        // Failed to reply
                        if (cmd.d.i in replies)
                            replies[cmd.d.i].fail();
                        break;

                    case "db":
                        // Database backup
                        cd.loadDB(cmd.d);
                        gotDB = true;
                        break;
                }
            });
        });
    }

    connect();

    // Stop the backup connection when we're quitting
    function stop() {
        if (socket) socket.end();
    }

    module.exports = {stop, reply};

}
