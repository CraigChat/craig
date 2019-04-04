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

var Ennuizel = (function(ez) {
    var libav;

    if (!ez.plugins) ez.plugins = [];

    // Some info we can get before Ennuizel starts
    var url = new URL(window.location);
    var params = new URLSearchParams(url.search);
    var idS = params.get("i");
    var id = Number.parseInt(idS, 36);
    var keyS = params.get("k");
    var key = Number.parseInt(keyS, 36);
    var wizardOptsS = params.get("w");
    var wizardOpts = Number.parseInt(wizardOptsS, 36);

    // Set to true if we've been asked to use the wizard automatically
    var autoWizard = false;

    // Our supported formats, as a subset of the export formats, named by codec
    var formats = ["flac", "aac", "libvorbis", "libopus", "wavpack", "pcm_s16le"];

    // We don't want the ID and key to actually be in the URL
    url.search = "";
    window.history.pushState({}, "Ennuizel", url.toString());

    // Global state info
    var msgbuf = [];
    var rdbuf = new Uint8Array(0);
    var wsUrl = (url.protocol==="http"?"ws":"wss") + "://" + url.hostname + ":34181";
    var sock;

    var report = document.createElement("div");
    document.body.appendChild(report);

    // Are we still in the JSON (info) bit?
    var inJSON = true;

    // Once we have the JSON, the info
    var info = null;

    // Are we currently handling data?
    var handling = false;
    var error = false;

    // The current track serial number
    var curTrackNo = null;

    // Set when we're done downloading
    var eos = false;

    // Handler to send a packet (or null for EOF) to Ennuizel
    var packet = null;

    // At startup, just choose our mode
    function start() {
        libav = LibAV;

        // Create our wizard before anything else
        wizardAdd();

        // Validate
        if (idS === null || keyS === null) {
            // No ID or key, just go to Ennuizel
            return Promise.resolve(true);
        }

        // Get our wizard options, one way or another
        wizardConvertOpts();

        if (wizardOptsS === null || wizardOpts.ask) {
            // None were provided, or we were asked to ask, so ask
            return mainMode().then(function(mode) {
                if (mode === "wizard") {
                    autoWizard = true;
                    return wizardDialog().then(function(opts) {
                        if (opts)
                            wizardOpts = opts;
                        else
                            autoWizard = false;
                        ez.skipRendering = autoWizard;
                        return downloader();
                    });
                } else if (mode === "downloader") {
                    return downloader();
                } else {
                    return true;
                }
            });

        } else {
            // Don't need to ask for opts
            return mainMode().then(function(mode) {
                if (mode === "wizard") {
                    autoWizard = true;
                    ez.skipRendering = true;
                    return downloader();
                } else if (mode === "downloader") {
                    return downloader();
                } else {
                    return true;
                }
            });

        }
    }
    ez.plugins.push(start);

    // In our "main" mode, we ask whether to use the wizard or not, or just bail out entirely
    function mainMode() {
        ez.modalDialog.innerHTML = "";

        ez.mke(ez.modalDialog, "div", {text: "THIS SERVICE IS IN BETA. If you have any problems, please go back and choose a different format. In particular, on mobile devices, this is likely to be unusable for very long recordings or recordings with many participants.\n\nThis tool will download, process, and export your audio. Click \"Auto\" to do all of that in automatic mode, \"Edit\" if you'd like to perform other editing, or \"Cancel\" otherwise.\n\n"});
        var cancel = ez.mke(ez.modalDialog, "button", {text: "Cancel"});
        ez.mke(ez.modalDialog, "span", {text: "  "});
        var edit = ez.mke(ez.modalDialog, "button", {text: "Edit"});
        ez.mke(ez.modalDialog, "span", {text: "  "});
        var auto = ez.mke(ez.modalDialog, "button", {text: "Auto"});

        ez.modalToggle(true);
        auto.focus();

        return new Promise(function(res, rej) {
            cancel.onclick = function() {
                res("cancel");
            };
            edit.onclick = function() {
                res("downloader");
            };
            auto.onclick = function() {
                res("wizard");
            };

        }).then(function(mode) {
            if (mode === "downloader")
                return ez.warn("After downloading and performing any editing you wish, you may click \"Wizard\" to continue automatic processing.").then(function() { return mode; });
            return mode;

        }).catch(ez.error);
    }

    function downloader() {
        var pid = "" + id;

        // Find the project ID
        return ez.startup(false).then(function() {
            return ez.dbGlobal.getItem("projects");
        }).then(function(projects) {
            projects = projects || [];
            if (projects.includes(pid)) {
                // They've already imported this!
                ez.modalDialog.innerHTML = "";
                ez.mke(ez.modalDialog, "div", {text: "The requested ID already exists. You may have already downloaded it. If so, I can load the existing project, which you may have modified after downloading.\n\n"});
                var load = ez.mke(ez.modalDialog, "button", {text: "Load the existing project"});
                ez.mke(ez.modalDialog, "span", {text: "  "});
                var del = ez.mke(ez.modalDialog, "button", {text: "Delete the existing project"});
                ez.modalToggle(true);
                load.focus();

                return new Promise(function(res) {
                    load.onclick = function() { res("load"); };
                    del.onclick = function() { res("delete"); };
                });
            }

            return "new";

        }).then(function(action) {
            if (action === "load") {
                // Bail out, just load the existing project
                ez.projectName = pid;
                return ez.loadProject().then(function() { return false; });
            }

            if (action === "delete") {
                // Delete the existing project and start fresh
                ez.projectName = pid;
                return ez.loadProject().then(ez.deleteProject).then(function() {
                    ez.projectName = pid;
                    return ez.createProject().then(connect);
                });
            }

            // Otherwise, we're just creating the project and starting the download
            ez.projectName = pid;
            return ez.createProject().then(connect);

        });
    }

    function connect() {
        // Now establish our WebSocket connection
        ez.modal("Connecting...");
        sock = new WebSocket(wsUrl);
        sock.binaryType = "arraybuffer";

        return new Promise(function(res, rej) {
            sock.onopen = res;
            sock.onerror = function(err) {
                rej(new Error(err));
            }

        }).then(function() {
            // Send our login request
            var loginbuf = new DataView(new ArrayBuffer(12));
            loginbuf.setUint32(0, 0x10, true);
            loginbuf.setUint32(4, id, true);
            loginbuf.setUint32(8, key, true);
            sock.send(loginbuf.buffer);

            return new Promise(function(res, rej) {
                sock.onmessage = res;
                sock.onclose = sock.onerror = function(err) {
                    rej(new Error(err));
                }
            });

        }).then(function(msg) {
            // The first message must be the login acknowledgement
            msg = new DataView(msg.data);
            if (msg.getUint32(0, true) !== 0 ||
                msg.getUint32(4, true) !== 0) {
                sock.close();
                throw new Error("Invalid ID or key.");
            }

            // From now on, messages are our primary data
            sock.onmessage = onmessage;
            sock.onclose = onclose;
            sock.onerror = function(err) {
                onclose();
                alert("Connection error! " + err);
            }

            ez.modal("Downloading...");

            return false;

        }).catch(function(err) {
            // At this level, just make sure we clean up
            return ez.deleteProject().then(function() {
                throw err;
            });
        });
    }

    // Our normal message receiver
    var total = 0;
    function onmessage(msg) {
        if (error) return;
        msg = new Uint8Array(msg.data);
        var msgid = new DataView(msg.buffer).getUint32(0, true);
        msg = msg.subarray(4);
        msgbuf.push([msgid, msg]);

        if (!handling)
            handle();
    }

    // Receiver when the socket is closed
    function onclose() {
        eos = true;
        if (!handling)
            handle();
    }

    // Data handler
    function handle() {
        handling = true;

        // Get a message from the queue and acknowledge it
        if (msgbuf.length > 0) {
            var msg = msgbuf.shift();
            var ack = new DataView(new ArrayBuffer(8));
            ack.setUint32(0, 0, true);
            ack.setUint32(4, msg[0], true);
            sock.send(ack.buffer);
            msg = msg[1];
            var c = new Uint8Array(rdbuf.length + msg.length);
            c.set(rdbuf, 0);
            c.set(msg, rdbuf.length);
            rdbuf = c;
        }

        // Are we still waiting for JSON data?
        if (inJSON) {
            // We're still in the JSON, so just look for its end
            for (var i = 0; i < rdbuf.length; i++)
                if (rdbuf[i] === 10) break;
            if (i === rdbuf.length) {
                handling = false;
                return;
            }

            // Good! Get the JSON out
            var json = "";
            for (var j = 0; j < i; j++)
                json += String.fromCharCode(rdbuf[j]);
            info = {};
            try {
                info = JSON.parse(json);
            } catch (ex) {}
            if (!("tracks" in info)) info.tracks = {};
            inJSON = false;

            // The rest is real data
            rdbuf = rdbuf.slice(i+1);
        }


        if (rdbuf.length === 0) {
            if (eos) {
                // We're done!
                return packet(null).then(function() {
                    if (autoWizard)
                        return wizard(wizardOpts);
                    ez.modalToggle(false);
                    handling = false;
                });
            } else {
                // Need more data
                handling = false;
                return;
            }
        }

        // Keep getting chunks so long as they're within the current track
        var p = Promise.all([]);
        var end = 0;
        while (true) {
            if (rdbuf.length - end < 27)
                break;

            if (new DataView(rdbuf.buffer).getUint32(end) !== 0x4F676753) {
                // Magic didn't match, not Ogg!
                handling = false;
                error = true;
                var err = "Invalid data!\n";
                if (end > 512)
                    err += Array.prototype.join.call(rdbuf.slice(end-512, end), ", ") + "\n";
                err += Array.prototype.join.call(rdbuf.slice(end, end+32), ", ") + "\n";
                alert(err);
                rdbuf = null;
                return;
            }

            // Figure out the length
            var segments = rdbuf[end+26];
            if (rdbuf.length - end < 27 + segments)
                break;
            var dataLength = 0;
            for (var i = 0; i < segments; i++)
                dataLength += rdbuf[end + 27 + i];
            var length = 27 + segments + dataLength;

            if (rdbuf.length - end < length)
                break;

            // Check the track number
            var pTrack = new DataView(rdbuf.buffer).getUint32(end + 14, true);
            if (pTrack !== curTrackNo) {
                if (end !== 0) {
                    // Send through the other data first
                    break;
                }

                // OK, starting here
                if (packet)
                    p = packet(null);
                curTrackNo = pTrack;

                // And start the new track
                p = p.then(function() {
                    var name;
                    if (pTrack in info.tracks) {
                        var track = info.tracks[pTrack];
                        name = pTrack + "-" + track.name + "#" + track.discrim;
                    } else {
                        name = "" + pTrack;
                    }
                    return newTrack(name);
                });
            }

            end += length;
        }

        if (end === 0) {
            if (msgbuf.length) {
                // Didn't get enough data, try to get more
                p.then(handle);
            } else {
                // Need to wait for more data
                handling = false;
            }
            return;
        }

        // Split it here
        var packetData = rdbuf.slice(0, end);
        rdbuf = rdbuf.slice(end);

        // Send this packet through
        p.then(function() {
            return packet(packetData);
        }).then(handle);
    }

    // Create a new track
    function newTrack(name) {
        ez.modal("Downloading " + name + "...");

        var data = new Uint8Array(0);

        // Stage 1: Wait for enough data to start the LibAV part
        // Stage 2: Normal data
        // Stage 3: EOF
        var eof = false;

        var fmt_ctx, stream, c, pkt, frame;

        // Packet handler for before we've started LibAV
        packet = function(chunk) {
            if (chunk !== null) {
                var c = new Uint8Array(data.length + chunk.length);
                c.set(data, 0);
                c.set(chunk, data.length);
                data = c;
            } else
                eof = true;

            // Collect data until we have 32K or EOF
            if (data.length >= 1024*1024 || eof) {
                // Now it's time to start libav. First make the device.
                return libav.mkreaderdev("dev.ogg").then(function() {
                    return libav.ff_reader_dev_send("dev.ogg", data);

                }).then(function() {
                    if (eof)
                        return libav.ff_reader_dev_send("dev.ogg", null);

                }).then(function() {
                    return libav.ff_init_demuxer_file("dev.ogg");

                }).then(function(ret) {
                    fmt_ctx = ret[0];
                    stream = ret[1][0];
                    return libav.ff_init_decoder(stream.codec_id);

                }).then(function(ret) {
                    c = ret[1];
                    pkt = ret[2];
                    frame = ret[3];

                    return trackData(name, eof, fmt_ctx, [0], [0], [c], [pkt], [frame]);
                });
            } else {
                return Promise.all([]);
            }
        };
    }

    // Normal track data handler
    function trackData(name, eof, fmt_ctx, idxs, durations, cs, pkts, frameptrs) {
        /* We need to create an intricate interaction between two promise
         * chains: The actual importing will call back either with 'again', or,
         * upon EOF, by finishing, while the downloader has its own stream of
         * events to create the data. */
        var data = new Uint8Array(0);

        var importPromise = ez.importTrackLibAV(
            name, fmt_ctx, idxs, durations, cs, pkts, frameptrs,
            {
                devfile: "dev.ogg",
                againCb: againCb,
                filter: "aresample=flags=res:min_comp=0.001:max_soft_comp=1000000:min_hard_comp=16:first_pts=0"
            }).then(function() {
            // Clean up
            return Promise.all([
                libav.ff_free_decoder(cs[0], pkts[0], frameptrs[0]),
                libav.avformat_close_input_js(fmt_ctx),
                libav.unlink("dev.ogg")
            ]);
        });

        var againRes, downPromise, downRes;

        downPromise = new Promise(function(res, rej) {
            downRes = res;
        });

        function againCb() {
            // Prepare to wait for more download
            var ret = new Promise(function(res, rej) {
                againRes = res;
            });

            // And ask for it
            downRes();

            return ret;
        }

        packet = function(chunk) {
            // Append it
            if (chunk !== null) {
                var c = new Uint8Array(data.length + chunk.length);
                c.set(data, 0);
                c.set(chunk, data.length);
                data = c;

                // Send it when we have a big chunk
                if (data.length < 1024*1024)
                    return Promise.all([]);
            }

            // Send the data we have
            var p = libav.ff_reader_dev_send("dev.ogg", data).then(function() {
                data = new Uint8Array(0);
                if (chunk === null)
                    return libav.ff_reader_dev_send("dev.ogg", null);

            }).then(function() {
                // Tell them we have more
                var waiter = new Promise(function(res, rej) {
                    downRes = res;
                });
                againRes();
                sent = 0;
                return waiter;

            });

            if (chunk === null) {
                // EOF
                return importPromise;
            } else {
                return p;
            }
        };

        if (eof) {
            return importPromise;
        } else {
            return downPromise;
        }
    }

    // Get an export format based on a codec name
    function getExportFormat(codec) {
        for (var i = 0; i < ez.exportFormats.length; i++) {
            var format = ez.exportFormats[i];
            if (format.codec === codec)
                return format;
        }
        return ez.exportFormats[0];
    }

    // Add our wizard to the menu
    function wizardAdd() {
        ez.menu.push({
            name: "Wizard",
            on: wizardMode
        });
        ez.showMenu();
    }

    // Convert wizard options from the URL fields into a displayable state
    function wizardConvertOpts() {
        if (wizardOpts === null)
            wizardOpts = 0;
        if (typeof wizardOpts === "object")
            return;

        var inOpts = wizardOpts;
        wizardOpts = {
            format: inOpts & 0xF,
            mix: !!(inOpts & 0x10),
            level: !!(inOpts & 0x20),
            keep: !!(inOpts & 0x100),
            ask: !!(inOpts & 0x200)
        };
    }

    // Our wizard mode
    function wizardMode() {
        return wizardDialog().then(function(opts) {
            if (opts)
                return wizard(opts);
        });
    }

    // The wizard dialog, without the actual wizard
    function wizardDialog() {
        // Get our default options into a displayable state
        wizardConvertOpts();

        // Display the menu
        ez.modalDialog.innerHTML = "";

        var form = ez.mke(ez.modalDialog, "div", {"class": "modalform"});

        ez.mke(form, "label", {text: "Format:", "class": "inputlabel", "for": "format"});
        var fmtSelect = ez.mke(form, "select", {id: "format"});
        for (var i = 0; i < formats.length; i++) {
            var format = getExportFormat(formats[i]);
            var opt = ez.mke(fmtSelect, "option", {text: format.name});
            opt.value = i;
            if (wizardOpts.format === i)
                opt.selected = true;
        }

        ez.mke(form, "div", {text: "\n\n"});

        var mix = ez.mke(form, "input", {id: "mix"});
        mix.type = "checkbox";
        mix.checked = wizardOpts.mix;
        ez.mke(form, "label", {text: " Mix into single track?", "for": "mix"});
        ez.mke(form, "br");

        var level = ez.mke(form, "input", {id: "level"});
        level.type = "checkbox";
        level.checked = wizardOpts.level;
        ez.mke(form, "label", {text: " Level volume?", "for": "level"});
        ez.mke(form, "br");

        var keep = ez.mke(form, "input", {id: "keep"});
        keep.type = "checkbox";
        keep.checked = wizardOpts.keep;
        ez.mke(form, "label", {text: " Keep intermediate project files?", "for": "keep"});

        ez.mke(ez.modalDialog, "div", {text: "\n\n"});

        var cancel = ez.mke(ez.modalDialog, "button", {text: "Cancel"});
        ez.mke(ez.modalDialog, "span", {text: "  "});
        var ok = ez.mke(ez.modalDialog, "button", {text: "Go"});

        ez.modalToggle(true);
        ok.focus();

        return new Promise(function(res, rej) {
            cancel.onclick = function() {
                res(null);
            };
            ok.onclick = function() {
                // Gather our options
                res({
                    format: fmtSelect.value,
                    mix: mix.checked,
                    level: level.checked,
                    keep: keep.checked
                });
            };
        }).then(function(opts) {
            ez.modal();
            return opts;
        });
    }

    // The actual wizard proper
    function wizard(opts) {
        var p = Promise.all([]);

        if (opts.mix) {
            // Start by mixing
            p = p.then(function() {
                if (opts.level)
                    return ez.mix({fin: "dynaudnorm", fout: "dynaudnorm", keep: true});
                else
                    return ez.mix({keep: true});
            }).then(function(mix) {
                ez.selectNone();
                ez.selectTrack(mix.id, true);

            });

        } else if (opts.level) {
            // We need to level but didn't mix
            p = p.then(function() {
                return ez.applyLibAVFilter({params: [{}]}, ["dynaudnorm"]);
            });

        }

        // Now do the actual export
        p = p.then(function() {
            var format = getExportFormat(formats[opts.format]);
            return ez.exportProject(""+id, format);
        });

        // Then possibly delete the project
        if (!opts.keep)
            p = p.then(ez.deleteProject);

        // Finally, tell them we're done
        p = p.then(function() {
            var msg = "Done! You may now close this page.";
            if (opts.keep)
                return ez.warn(msg);
            else
                ez.modal(msg);
        });

        return p;
    }

    return ez;
})(typeof Ennuizel === "object" ? Ennuizel : {});
