<?PHP
/*
 * Copyright (c) 2017, 2018 Yahweasel
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

if (!isset($id))
    die();

?>
<!doctype html>
<html>
    <head>
        <title>Craig Records!</title>
        <style type="text/css">
            body {
                background: #142329;
                color: #eee;
            }

            a {
                color: #99e;
            }

            .js {
                display: none;
            }

            .big {
                font-size: 1.5em;
            }

            button {
                font-size: 1em;
                background-color: #00eeee;
                font-weight: bold;
                padding: 0.25em;
                border-radius: 0.5em;
                box-shadow: 0 0 0 2px #333333;
                color: #000000;
            }

            button:disabled {
                color: #808080;
            }

            .big button, .local button {
                display: inline-block;
                width: 10em;
                min-height: 3em;
                vertical-align: middle;
                text-align: center;
            }

            .big button:disabled {
                background-color: #d1eeee;
            }

            .local button {
                background-color: #ff9999;
            }

            .local button:disabled {
                background-color: #ffe6e6;
            }

            .lbl {
                display: inline-block;
                text-align: right;
                width: 320px;
            }

            /*!
             * Load Awesome v1.1.0 (http://github.danielcardoso.net/load-awesome/)
             * Copyright 2015 Daniel Cardoso <@DanielCardoso>
             * Licensed under MIT
             */
            .la-line-scale,
            .la-line-scale > div {
                position: relative;
                -webkit-box-sizing: border-box;
                   -moz-box-sizing: border-box;
                        box-sizing: border-box;
            }
            .la-line-scale {
                display: block;
                visibility: hidden;
                margin: auto;
                height: 0px;
                overflow: visible;
                color: #fff;
            }
            .la-line-scale.la-dark {
                color: #333;
            }
            .la-line-scale > div {
                display: inline-block;
                float: none;
                background-color: currentColor;
                border: 0 solid currentColor;
            }
            .la-line-scale {
                width: 40px;
            }
            .la-line-scale > div {
                width: 4px;
                height: 32px;
                margin: 2px;
                margin-top: 0;
                margin-bottom: 0;
                border: 1px solid black;
                -webkit-animation: line-scale 1.2s infinite ease;
                   -moz-animation: line-scale 1.2s infinite ease;
                     -o-animation: line-scale 1.2s infinite ease;
                        animation: line-scale 1.2s infinite ease;
            }
            .la-line-scale > div:nth-child(1) {
                -webkit-animation-delay: -1.2s;
                   -moz-animation-delay: -1.2s;
                     -o-animation-delay: -1.2s;
                        animation-delay: -1.2s;
            }
            .la-line-scale > div:nth-child(2) {
                -webkit-animation-delay: -1.1s;
                   -moz-animation-delay: -1.1s;
                     -o-animation-delay: -1.1s;
                        animation-delay: -1.1s;
            }
            .la-line-scale > div:nth-child(3) {
                -webkit-animation-delay: -1s;
                   -moz-animation-delay: -1s;
                     -o-animation-delay: -1s;
                        animation-delay: -1s;
            }
            .la-line-scale > div:nth-child(4) {
                -webkit-animation-delay: -.9s;
                   -moz-animation-delay: -.9s;
                     -o-animation-delay: -.9s;
                        animation-delay: -.9s;
            }
            .la-line-scale > div:nth-child(5) {
                -webkit-animation-delay: -.8s;
                   -moz-animation-delay: -.8s;
                     -o-animation-delay: -.8s;
                        animation-delay: -.8s;
            }
            .la-line-scale.la-3x {
                width: 24em;
            }
            .la-line-scale.la-3x > div {
                width: 4em;
                height: 4.5em;
                margin: 0.25em;
                margin-top: 0;
                margin-bottom: 0;
            }
            /*
             * Animation
             */
            @-webkit-keyframes line-scale {
                0%,
                40%,
                100% {
                    -webkit-transform: scaleY(.4);
                            transform: scaleY(.4);
                }
                20% {
                    -webkit-transform: scaleY(1);
                            transform: scaleY(1);
                }
            }
            @-moz-keyframes line-scale {
                0%,
                40%,
                100% {
                    -webkit-transform: scaleY(.4);
                       -moz-transform: scaleY(.4);
                            transform: scaleY(.4);
                }
                20% {
                    -webkit-transform: scaleY(1);
                       -moz-transform: scaleY(1);
                            transform: scaleY(1);
                }
            }
            @-o-keyframes line-scale {
                0%,
                40%,
                100% {
                    -webkit-transform: scaleY(.4);
                         -o-transform: scaleY(.4);
                            transform: scaleY(.4);
                }
                20% {
                    -webkit-transform: scaleY(1);
                         -o-transform: scaleY(1);
                            transform: scaleY(1);
                }
            }
            @keyframes line-scale {
                0%,
                40%,
                100% {
                    -webkit-transform: scaleY(.4);
                       -moz-transform: scaleY(.4);
                         -o-transform: scaleY(.4);
                            transform: scaleY(.4);
                }
                20% {
                    -webkit-transform: scaleY(1);
                       -moz-transform: scaleY(1);
                         -o-transform: scaleY(1);
                            transform: scaleY(1);
                }
            }
            /* END of Load Awesome CSS */
        </style>
    </head>
    <body>
        <div style="text-align: right">
<?PHP
foreach ($locales as $la) {
    if ($la !== "en")
        print " | ";
    print "<a href=\"?id=$id&amp;key=$key&amp;locale=$la\">$la</a>";
}
?>
        </div>

        <div style="margin: auto; max-width: 50em;">
        <?PHP l("intro1"); ?>
        <span class="js"><?PHP l("intro2"); ?></span>
        <?PHP l("intro3"); print " $id"; ?>
        </div><br/><br/>

        <div style="margin: auto; display: table;">
        <span id="loading" class="la-line-scale la-3x"><div></div><div></div><div></div><div></div><div></div></span>

        <span class="big">
        <span class="lbl"><?PHP l("mtd"); ?>&nbsp;</span>
<?PHP
download("FLAC", "flac");
download("Ogg Vorbis", "vorbis");
download("AAC (MPEG-4)", "aac");
if (isset($features["mp3"]) && $features["mp3"])
    download("MP3", "mp3");
?>
        </span><br/><br/>

<?PHP
if (isset($features["mix"]) && $features["mix"]) {
?>
        <span class="big">
        <span class="lbl"><?PHP l("std"); ?></span>
<?PHP
download("FLAC", "flac", "mix");
download("Ogg Vorbis", "vorbis", "mix");
download("AAC (MPEG-4)", "aac", "mix");
if (isset($features["mp3"]) && $features["mp3"])
    download("MP3", "mp3", "mix");
?>
        </span><br/><br/>
<?PHP
}
?>
        
        <span class="local js">
        <span class="lbl"><?PHP l("mtp"); ?>&nbsp;</span>
        <button id="mflac">FLAC</button>
        <button id="mm4a">M4A (MPEG-4)</button>
        <button id="mmp3">MP3 (MPEG-1)</button>
        <button id="mwav">wav (<?PHP l("uncomp"); ?>)</button>
        </span><br/><br/>

        <span class="local js">
        <span class="lbl"><?PHP l("stm"); ?>&nbsp;</span>
        <button id="sflac">FLAC</button>
        <button id="sm4a">M4A (MPEG-4)</button>
        <button id="smp3">MP3 (MPEG-1)</button>
        <button id="swav">wav (<?PHP l("uncomp"); ?>)</button>
        </span><br/><br/><br/><br/>

        <button id="localProcessingB" class="js"><?PHP l("local"); ?></button><br/><br/>

        <div id="localProcessing" style="display: none; margin: auto; max-width: 60em;">
            <label for="format"><?PHP l("format"); ?></label>
            <select id="format">
                <option value="flac,flac">FLAC</option>
                <option value="mp4,aac">M4A (MPEG-4)</option>
                <option value="mp3,mp3">MP3 (MPEG-1)</option>
                <option value="wav,pcm_s16le">wav (<?PHP l("uncomp"); ?>)</option>
            </select><br/><br/>

            <input id="mix" type="checkbox" checked />
            <label for="mix"><?PHP l("mix"); ?></label><br/><br/>

            <span id="ludditeBox" style="display: none">
                <input id="luddite" type="checkbox" />
                <label for="luddite"><?PHP l("luddite"); ?></label><br/><br/>
            </span>

            <span id="wavBox" style="display: none">
                <input id="wav" type="checkbox" />
                <label for="wav"><?PHP l("wav"); ?></label><br/><br/>
            </span>

            <button id="convert"><?PHP l("begin"); ?></button><br/><br/>

            <div id="ffmstatus" style="background-color: #cccccc; color: #000000; padding: 0.5em;"></div>

            <ul id="ffmoutput"></ul><br/><br/>

            These formats are provided by
            <a href="http://ffmpeg.org">ffmpeg</a>,
            <a href="http://opus-codec.org/downloads/">Opus</a> and
            <a href="http://lame.sourceforge.net/">LAME</a>, by way of
            <a href="https://github.com/Kagami/ffmpeg.js">ffmpeg.js</a>.
            <a href="ffmpeg-js-license.txt">License</a> and
            <a href="ffmpeg-js-craig.tar.xz">source</a>.
        </div><br/><br/>

        <button id="avatarsB" class="j2"><?PHP l("avatars"); ?></button><br/><br/>

        <div id="avatars" style="display: none; margin: auto; max-width: 60em;">
<?PHP
l("download");
print " <a href=\"?id=$id&amp;key=$key&amp;fetch=avatars\">PNG</a><br/><br/>";

if (isset($features["glowers"]) && $features["glowers"]) {
?>

            <h2>Glowers:</h2>

            <form method="POST" target="?">
                <?PHP
                    print "<input type=\"hidden\" name=\"id\" value=\"$id\" /><input type=\"hidden\" name=\"key\" value=\"$key\" />";
                ?>
                <input type="hidden" name="fetch" value="avatars" />

                <label for="aformat"><?PHP l("format"); ?></label>
                <select id="aformat" name="format">
                    <option value="mkvh264">MKV (MPEG-4)</option>
                    <option value="webmvp8">WebM (VP8)</option>
                </select><br/><br/>

                <input id="atrans" name="transparent" type="checkbox" checked />
                <label for="atrans">Transparent background</label><br/>
                (Note: WebM supports transparency, but most video editors do
                not support WebM. MPEG-4 does not support transparency, so if
                MKV is selected, a static PNG image and MKV representing the
                alpha (transparency) channel will be sent. Most video editors
                can be instructed to use one file for color and another file
                for alpha/transparency.)<br/><br/>

                <label for="abg" style="display: inline-block; text-align: right; min-width: 10em">Background color:</label>
                <input id="abg" name="bg" value="#000000" /><br/><br/>

                <label for="afg" style="display: inline-block; text-align: right; min-width: 10em">Glow color:</label>
                <input id="afg" name="fg" value="#008000" /><br/><br/>

                <input type="submit" value="Download" />
            </form>
<?PHP
}
?>
        </div><br/><br/>

<?PHP
download(ls("raw"), "raw");
?>
        (<?PHP l("rawnote"); ?>)
        </div>

        <script type="text/javascript"><!--
<?PHP
readfile("convert.js");
print "craigOgg=\"?id=" . $id . "&key=" . $key . "&fetch=cooked&format=copy&container=ogg\";\n";
print "craigReady=\"?id=" . $id . "&key=" . $key . "&ready\";\n";
print "craigLocale={";
foreach (array("nomp3", "nowav", "downloading", "notracks", "complete") as $lstr) {
    print "\"$lstr\":\"" . ls($lstr) . "\",";
}
print "0:0};\n";
?>
        (function() {
            if (typeof Worker === "undefined")
                return;

            function gid(id) {
                return document.getElementById(id);
            }

            function downloading(dling) {
                document.querySelectorAll(".big button").forEach(function(b) { b.disabled = dling; });
                var l = document.getElementById("loading");
                if (l) l.style.visibility = (dling?"visible":"hidden");
            }

            function initDownload(target) {
                downloading(true);

                // Wait for it to be ready
                var xhr = new XMLHttpRequest();
                xhr.onreadystatechange = function() {
                    if (xhr.readyState !== 4)
                        return;
                    var ready = JSON.parse(xhr.responseText);
                    if (ready && ready.ready) {
                        setTimeout(completeDownload, 5000);
                        window.location = target;
                    } else {
                        initDownload(target);
                    }
                };

                xhr.open("GET", craigReady, true);
                xhr.send();
            }

            function completeDownload() {
                var xhr = new XMLHttpRequest();
                xhr.onreadystatechange = function() {
                    if (xhr.readyState !== 4)
                        return;
                    var ready = JSON.parse(xhr.responseText);
                    if (ready && ready.ready) {
                        downloading(false);
                    } else {
                        completeDownload();
                    }
                };
                xhr.open("GET", craigReady, true);
                xhr.send();
            }

            function replaceA(a) {
                var b = document.createElement("button");
                b.innerHTML = a.innerHTML;
                b.onclick = function() {
                    document.querySelectorAll(".big button").forEach(function(b) {
                        b.disabled = true;
                    });
                    initDownload(a.href);
                };
                a.parentElement.replaceChild(b, a);
            }
            document.querySelectorAll(".big a").forEach(replaceA);

            function initCheck() {
                var xhr = new XMLHttpRequest();
                xhr.onreadystatechange = function() {
                    if (xhr.readyState !== 4)
                        return;
                    var ready = JSON.parse(xhr.responseText);
                    if (!ready || !ready.ready) {
                        downloading(true);
                        completeDownload();
                    }
                };
                xhr.open("GET", craigReady + "=nb", true);
                xhr.send();
            }
            initCheck();

            document.querySelectorAll(".js").forEach(function(e){e.style.display="inline";});

            function vis(id, setTo) {
                var l = gid(id);
                if (!l) return;
                if (!setTo) {
                    if (l.style.display === "none") {
                        setTo = "block";
                    } else {
                        setTo = "none";
                    }
                }
                l.style.display = setTo;
                if (setTo !== "none")
                    l.scrollIntoView();
            }

            gid("localProcessingB").onclick = function() {
                vis("localProcessing");
            }

            gid("avatarsB").onclick = function() {
                vis("avatars");
            }

            var format = gid("format");
            var cb = gid("convert");
            var mix = gid("mix");
            var ludditeBox = gid("ludditeBox");
            var luddite = gid("luddite");
            var wavBox = gid("wavBox");
            var wav = gid("wav");
            var status = gid("ffmstatus");

            luddite.checked = wav.checked = false;

            // Set up the form
            function formatChange() {
                ludditeBox.style.display = "none";
                wavBox.style.display = "none";
                if (format.value === "mp3,mp3") {
                    ludditeBox.style.display = "block";
                } else if (format.value === "wav,pcm_s16le") {
                    wavBox.style.display = "block";
                }
            }
            format.onchange = formatChange;

            function go() {
                if (format.value === "mp3,mp3" && !luddite.checked) {
                    status.innerText = "<?PHP l("nomp3"); ?>";
                    return;
                } else if (format.value === "wav,pcm_s16le" && !wav.checked) {
                    status.innerText = "<?PHP l("nowav"); ?>";
                    return;
                }

                cb.disabled = true;

                var f = format.value.split(",");
                var opts = {
                    locale: craigLocale,
                    mix: mix.checked,
                    callback: function(){cb.disabled = false;}
                };
                craigFfmpeg(craigOgg, f[0], f[1], opts);
            }
            cb.onclick = go;

            // And map all the buttons
            var bmap = {
                "flac": "flac,flac",
                "m4a": "mp4,aac",
                "mp3": "mp3,mp3",
                "wav": "wav,pcm_s16le"
            };

            function mapButton(id) {
                var b = gid(id);
                console.log(b);
                if (!b) return;
                var mixed = (id[0] === "s");
                var bformat = bmap[id.substr(1)];
                b.onclick = function() {
                    if (cb.disabled)
                        return;
                    format.value = bformat;
                    formatChange();
                    mix.checked = mixed;
                    vis("localProcessing", "block");
                    go();
                }
            }

            Object.keys(bmap).forEach(function(t){mapButton("m"+t);mapButton("s"+t);});
        })();
        --></script>
    </body>
</html>
