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

const backupPort = 57341;

if (!config.backup) return; // No backup at all!

// Only one shard should handle this
if (!cc.client) return;
if ("SHARD_ID" in process.env) {
    if (process.env["SHARD_ID"] !== "0") return;
}

const fs = require("fs");
const tls = require("tls");

const cu = require("./utils.js");
const reply = cu.reply;

if (config.backup.master) {
    // We are the master, so create a TLS server
    const server = tls.createServer({
        key: fs.readFileSync(config.backup.key),
        cert: fs.readFileSync(config.backup.cert),
        requestCert: true,
        rejectUnauthorized: true,
        ca: [ fs.readFileSync(config.backup.remote) ]
    }, (socket) => {
        var data = "";

        function send(cmd, data) {
            console.error("SENDING " + cmd);
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
                console.error("RECEIVED " + line);
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
                        var to = cc.client.users.get(cmd.d.u);
                        if (!to) {
                            fail(cmd.d.i);
                            return;
                        }
                        to.send("[BACKUP]\n\n" + cmd.d.t).then(() => {
                            ack(cmd.d.i);
                        }).catch(() => {
                            fail(cmd.d.i);
                        });
                        break;
                }
            });
        });
    });

    // FIXME: Any previous instance will already have this port!
    server.listen(backupPort, () => {});

} else {
    // We're the backup
    // ...

}
