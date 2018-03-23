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

(function() {
    var xhr = null, lastUrl = null;
    var resampler = "pan=FC|c0=c0,aresample=flags=res:min_comp=0.001:max_soft_comp=0.01:min_hard_comp=1:first_pts=0";

    var fileURLs = [];

    function convert(url, format, codec, options) {
        var ffm;
        var xhrReady = false, ffmReady = false;

        // Where we put our results
        var status = document.getElementById("ffmstatus");
        var output = document.getElementById("ffmoutput");

        // Information on the file
        var tracks = null, detectedTracks = null;
        var duration = 0;
        var trackRe = /^ *Stream #0:([0-9]*):/;
        var durationRe = /^ *Duration: 0*([0-9]*):0*([0-9]*):0*([0-9]*)\./;

        // And output formatting
        if (typeof options === "undefined")
            options = {};
        var ext = format;
        if (format === "mp4" && !options.multitrack)
            ext = "m4a";
        if (format === "mp4" && codec === "alac")
            format = "ipod"; // ffmpeg name for Appley slightly nonstandard MP4 files

        // Wait for the download to compelte
        function onreadystatechange(ev) {
            if (xhr.readyState === 4) {
                if (xhr.status !== 200) {
                    if (status)
                        status.innerText = (options.locale?options.locale.downfail:"Failed to download!");
                    return;
                }

                xhrReady = true;
                maybeReady();

            } else {
                var st = (options.locale?options.locale.downloading:"Downloading.");
                if (ev.loaded)
                    st += " " + ~~(ev.loaded/1024) + "KB";
                status.innerText = st;

            }
        }

        // Control for ffmpeg
        function onmessage(e) {
            var msg = e.data;
            switch (msg.type) {
                case "ready":
                    ffmReady = true;
                    maybeReady();
                    break;

                case "stdout":
                case "stderr":
                    if (status)
                        status.innerText = msg.data;
                    if (tracks === null) {
                        // Detect track count
                        var getTracks = trackRe.exec(msg.data);
                        if (getTracks !== null)
                            detectedTracks = ~~(getTracks[1]) + 1;
                        else {
                            var getDuration = durationRe.exec(msg.data);
                            if (getDuration !== null)
                                duration = getDuration[1]*3600 + getDuration[2]*60 + (+getDuration[3]) + 2;
                        }
                    }
                    break;

                case "done":
                    if (tracks === null) {
                        // Track detection
                        if (detectedTracks <= 0) {
                            if (status)
                                status.innerText = (options.locale?options.locale.notracks:"No tracks detected!");
                            return;
                        }
                        tracks = detectedTracks;
                        if (duration <= 0)
                            duration = 6*3600;
                        startWorker();

                    } else {
                        // Actual transcoding
                        for (var i = 0; i < msg.data.MEMFS.length; i++) {
                            var li = document.createElement("li");
                            var link = document.createElement("a");
                            var url = URL.createObjectURL(
                                new Blob([msg.data.MEMFS[i].data], {type: "application/octet-stream"})
                            );
                            fileURLs.push(url);
                            link.href = url;
                            link.download = msg.data.MEMFS[i].name;
                            link.innerText = msg.data.MEMFS[i].name;
                            li.appendChild(link);
                            if (output)
                                output.appendChild(li);
                        }
                        if (status)
                            status.innerText = (options.locale?options.locale.complete:"Processing complete.");

                        ffm.terminate();

                        if (options.callback)
                            options.callback();

                    }
                    break;
            }
        }

        // Function to start if everything is ready
        function maybeReady() {
            if (xhrReady && ffmReady) {
                if (tracks === null) {
                    // We don't know how many tracks we have. Figure it out.
                    ffm.postMessage({
                        type: "run",
                        MEMFS: [{name: "in.ogg", data: xhr.response}],
                        arguments: [
                            "-f", "ogg",
                            "-codec", "libopus",
                            "-i", "in.ogg"
                        ]
                    });

                } else {
                    // We know how many tracks, so make a command
                    var args = [
                        "-f", "ogg",
                        "-codec", "libopus",
                        "-i", "in.ogg"
                    ];

                    if (options.mix) {
                        if (tracks > 1) {
                            /* Because ffmpeg tries to read synchronously, we need
                             * to open the input once for every track. Otherwise,
                             * it will get stuck when one track ends. */
                            var inargs = args.slice(0);
                            for (var ti = 1; ti < tracks; ti++)
                                args.push.apply(args, inargs);
                            var filter = "";
                            for (var ti = 0; ti < tracks; ti++)
                                filter += "[" + ti + ":" + ti + "]" + resampler + ",apad,atrim=0:" + duration + ",aformat=channel_layouts=mono[aud" + ti + "];";
                            for (var ti = 0; ti < tracks; ti++)
                                filter += "[aud" + ti + "]";
                            filter += "amerge=" + tracks + "[aud]";
                            args.push(
                                "-filter_complex", filter,
                                "-map", "[aud]",
                                "-ac", "1",
                                "-f", format,
                                "-c:a", codec,
                                "craig." + ext
                            );

                        } else {
                            args.push(
                                "-af", resampler,
                                "-ac", "1",
                                "-f", format,
                                "-c:a", codec,
                                "craig." + ext
                            );

                        }

                    } else if (options.multitrack) {
                        args.push(
                            "-map", "0",
                            "-af", resampler,
                            "-f", format,
                            "-c:a", codec,
                            "craig." + ext
                        );

                    } else {
                        for (var ti = 0; ti < tracks; ti++) {
                            args.push(
                                "-map", "0:" + ti,
                                "-af", resampler,
                                "-f", format,
                                "-c:a", codec,
                                (ti+1) + "." + ext
                            );
                        }

                    }

                    // And run it
                    ffm.postMessage({
                        type: "run",
                        MEMFS: [{name: "in.ogg", data: xhr.response}],
                        arguments: args
                    });

                }
            }
        }

        // Start a fresh web worker
        function startWorker() {
            if (ffm)
                ffm.terminate();
            ffmReady = false;
            ffm = new Worker("ffmpeg-worker-craig.js");
            ffm.onmessage = onmessage;
        }

        // Fetch the data
        if (xhr === null || lastUrl !== url) {
            xhr = new XMLHttpRequest();
            xhr.responseType = "arraybuffer";
            xhr.open("GET", url + "&target=" + format + "." + codec + "." + (options.mix?"s":"m"));
            xhr.onreadystatechange = onreadystatechange;
            xhr.onprogress = onreadystatechange;
            xhr.send();
            lastUrl = url;
        } else {
            xhr.onreadystatechange = onreadystatechange;
            xhr.onprogress = onreadystatechange;
            onreadystatechange({});
        }

        // Start the worker
        startWorker();

        // And delete any now-obsolete files
        for (var fi = 0; fi < fileURLs.length; fi++)
            URL.revokeObjectURL(fileURLs[fi]);
        fileURLs = [];
        if (output)
            output.innerHTML = "";
    }
    window.craigFfmpeg = convert;
})();
