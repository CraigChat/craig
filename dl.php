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
            }

            .big button, .local button {
                display: inline-block;
                width: 10em;
                min-height: 3em;
                vertical-align: middle;
                text-align: center;
                color: #000000;
            }

            .local button {
                background-color: #ff9999;
            }

            .lbl {
                display: inline-block;
                text-align: right;
                width: 320px;
            }
        </style>
    </head>
    <body>
        <div style="text-align: right">
<?PHP
foreach ($locales as $locale) {
    if ($locale !== "en")
        print " | ";
    print "<a href=\"?id=$id&amp;key=$key&amp;locale=$locale\">$locale</a>";
}
?>
        </div>

        <div style="margin: auto; max-width: 50em;">
        <?PHP l("intro1"); ?>
        <span class="js"><?PHP l("intro2"); ?></span>
        <?PHP l("intro3"); print " $id"; ?>
        </div><br/><br/>

        <div style="margin: auto; display: table;">
        <span class="big">
        <span class="lbl"><?PHP l("mtd"); ?>&nbsp;</span>
<?PHP
download("FLAC", "flac");
download("Ogg Vorbis", "vorbis");
download("AAC (MPEG-4)", "aac");
?>
        </span><br/><br/>
        
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

            <ul id="ffmoutput"></ul>
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
print "craigLocale={";
foreach (array("nomp3", "nowav", "downloading", "notracks", "complete") as $lstr) {
    print "\"$lstr\":\"" . ls($lstr) . "\",";
}
print "0:0};\n";
?>
        (function() {
            function gid(id) {
                return document.getElementById(id);
            }

            function replaceA(a) {
                var b = document.createElement("button");
                b.innerHTML = a.innerHTML;
                b.onclick = function() {
                    window.location = a.href;
                };
                a.parentElement.replaceChild(b, a);
            }
            document.querySelectorAll(".big a").forEach(replaceA);

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
