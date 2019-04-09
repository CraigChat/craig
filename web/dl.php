<?PHP
/*
 * Copyright (c) 2017-2019 Yahweasel
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

ob_start("ob_gzhandler");

if ($beta)
    $features = array();

/* We default to download, rather than local processing, on mobile devices and
 * for all patrons */
$defaultdl = ($iphone || $android || (isset($features["bless"]) && $features["bless"]));

// Local processing is in beta, so only suggest it in 20% of cases for now
if ($id%10 !== 4 && $id%10 !== 5)
    $defaultdl = true;

function secHead($nm) {
    print '<span class="big"><span class="lbl">' . $nm . '&nbsp;</span><span class="choices">';
}

function secTail() {
    print "</span></span><br/><br/>";
}

?>
<!doctype html>
<html>
    <head>
        <title>Craig Records!</title>
        <link rel="Shortcut Icon" href="/favicon.png" type="image/png" />
        <style type="text/css">
            body {
                background: #142329;
                color: #eee;
            }

            @media screen and (min-width: 50em) {
            body {
                font-size: 1.25em;
            }
            }

            a {
                color: #99e;
            }

            .flag {
                height: 1em;
                width: auto;
                vertical-align: middle;
                margin-bottom: 0.15em;
            }

            .js {
                display: none;
            }

            .para {
                font-size: 1.25em;
                margin: auto;
                max-width: 78rem;
            }

            .big {
                font-size: 1.25em;
            }

            .panel {
                margin: auto;
                display: table;
            }

            .lbl {
                display: block;
                text-align: center;
                vertical-align: middle;
            }

            .choices {
                display: block;
                text-align: center;
                vertical-align: middle;
                line-height: 4em;
            }

            /* 15em for label, 50em for buttons, *1.25*1.25 for big font size + 2em margins */
            @media screen and (min-width: 104em) {
            .lbl {
                display: inline-block;
                text-align: right;
                width: 23rem;
            }

            .choices {
                display: inline-block;
                text-align: left;
                width: 78rem;
            }
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
                min-height: 3.5em;
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
                height: 5em;
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
        <?PHP localeFlags("id=$id&amp;key=$key&amp;"); ?>

        <div class="para">
        <?PHP l("intro1"); print " "; l("intro2c"); print " "; l("intro2cbeta"); ?>
        <?PHP l("intro3"); print " $id"; ?>.
        <?PHP
            if ($info !== false && isset($info["startTime"]))
                print ls("starttime") . ": " . $info["startTime"] . ". ";
        ?>
        <span class="js">
        <a href="#" id="users"><?PHP l("users"); ?></a>
        <a href="#" id="duration"><?PHP l("duration"); ?></a>
        </span>
        </div><br/><br/>

        <div class="panel">
        <span id="loading" class="la-line-scale la-3x"><div></div><div></div><div></div><div></div><div></div></span>

<?PHP
secHead(ls("mtd"));
if (!$iphone && !$android)
    download(ls("audacity"), "flac", "aupzip");
if ($defaultdl)
    download("FLAC", "flac");
else
    ezel("FLAC *", 0);
ezel("wav *", 5);
if ($defaultdl)
    download("AAC (MPEG-4)", "aac");
else
    ezel("AAC (MPEG-4) *", 1);
if ($macosx)
    ezel("ALAC (Apple Lossless) *", 6);
if (isset($features["mp3"]) && $features["mp3"])
    download("MP3", "mp3");
secTail();

secHead(ls("stm"));
ezel("FLAC *", 0x30);
ezel("wav *", 0x35);
ezel("AAC (MPEG-4) *", 0x31);
ezel(ls("other") . " *", 0x230);
secTail();

if (isset($features["mix"]) && $features["mix"]) {
    secHead(ls("std"));
    download("FLAC", "flac", "mix");
    download("Ogg Vorbis", "vorbis", "mix");
    download("AAC (MPEG-4)", "aac", "mix");
    if (isset($features["mp3"]) && $features["mp3"])
        download("MP3", "mp3", "mix");
    secTail();
}
?>

        <span class="js">
        <button id="avatarsB"><?PHP l("avatars"); ?></button><br/><br/>

        <div id="avatars" style="display: none; margin: auto; max-width: 60em;">
<?PHP
l("download");
print ": <a href=\"?id=$id&amp;key=$key&amp;fetch=avatars\">PNG</a><br/><br/>";

if (isset($features["glowers"]) && $features["glowers"]) {
?>

            <h2><?PHP l("glowers"); ?>:</h2>

            <form method="POST" target="?">
                <?PHP
                    print "<input type=\"hidden\" name=\"id\" value=\"$id\" /><input type=\"hidden\" name=\"key\" value=\"$key\" />";
                ?>
                <input type="hidden" name="fetch" value="avatars" />

                <label for="aformat"><?PHP l("format"); ?></label>
                <select id="aformat" name="format">
                    <?PHP if ($windows) { ?>
                    <option value="movsfx">MOV (QuickTime Animation, Windows extractor)</option>
                    <option value="movpngsfx">MOV (PNG, Windows extractor)</option>
                    <?PHP } ?>
                    <?PHP if ($macosx && !$iphone) {?>
                    <option value="movsfxm">MOV (QuickTime Animation, Mac OS X extractor)</option>
                    <option value="movpngsfxm">MOV (PNG, Mac OS X extractor)</option>
                    <?PHP } ?>
                    <?PHP if ($unix && !$android) {?>
                    <option value="movsfxu">MOV (QuickTime Animation, Unix extractor)</option>
                    <option value="movpngsfxu">MOV (PNG, Unix extractor)</option>
                    <?PHP } ?>
                    <option value="mkvh264">MKV (MPEG-4)</option>
                    <option value="webmvp8">WebM (VP8)</option>
                </select><br/><br/>

                <input id="atrans" name="transparent" type="checkbox" checked />
                <label for="atrans"><?PHP l("transparent"); ?></label><br/>
                (<?PHP
                    l("transnote1");
                    if ($windows)
                        l("transnotesfx");
                    if ($macosx && !$iphone)
                        print str_replace("RunMe.bat", "RunMe.command", ls("transnotewin"));
                    if ($unix && !$android)
                        print str_replace("RunMe.bat", "RunMe.sh", ls("transnotewin"));
                    l("transnote2");
                ?>)<br/><br/>

                <label for="abg" style="display: inline-block; text-align: right; min-width: 10em"><?PHP l("bgc"); ?>:</label>
                <input id="abg" name="bg" value="#000000" /><br/><br/>

                <label for="afg" style="display: inline-block; text-align: right; min-width: 10em"><?PHP l("fgc"); ?>:</label>
                <input id="afg" name="fg" value="#008000" /><br/><br/>

                <?PHP print "<input type=\"submit\" value=\"" . ls("download") . "\" />"; ?>
            </form>
<?PHP
}
?>
        </div><br/><br/>

        <button id="otherFormatsB"><?PHP l("otherformats"); ?></button><br/><br/>
        </span>

        <div id="otherFormats">
            <?PHP
            // The download-vs-local-prop opposite of above
            secHead(ls("mtd"));
            if ($defaultdl) {
                ezel("FLAC *", 0);
                ezel("AAC (MPEG-4) *", 1);
            } else {
                download("FLAC", "flac");
                download("AAC (MPEG-4)", "aac");
            }
            ezel(ls("other") . " *", 0x200);
            secTail();

            // Other available formats, download only
            secHead(ls("otherformats") . ":");
            download("Ogg FLAC", "oggflac");
            download("HE-AAC", "heaac");
            download("Opus", "opus");
            download("Ogg Vorbis", "vorbis");
            download("ADPCM wav", "adpcm");
            download("8-bit wav", "wav8");
            secTail();

            // Leveled download
            secHead(ls("mtld"));
            if (!$iphone && !$android)
                download(ls("audacity"), "flac", "aupzip", "&amp;dynaudnorm");
            download("FLAC", "flac", "zip", "&amp;dynaudnorm");
            ezel("wav *", 0x25);
            download("AAC (MPEG-4)", "aac", "zip", "&amp;dynaudnorm");
            if (isset($features["mp3"]) && $features["mp3"])
                download("MP3", "mp3", "zip", "&amp;dynaudnorm");
            secTail();

            // Binary local processing tool
            if ($windows || ($macosx && !$iphone) || ($unix && !$android) || $beta) {
                secHead(ls("lp"));
                if ($windows) download(ls("winapp"), "powersfx", "exe");
                if ($macosx) download(ls("macosxapp"), "powersfxm");
                if ($unix) download(ls("unixscript"), "powersfxu");
                secTail();
            }
            ?>

        </div><br/><br/>

<?PHP
download(ls("raw"), "raw");
?>
        (<?PHP l("rawnote"); ?>),
<?PHP
download("info.json", "info");
?>
        </div>

        <script type="text/javascript"><!--
<?PHP
print "craigBase=\"?id=" . $id . "&key=" . $key . "\";\n";
print "craigLocale={";
foreach (array("users", "duration", "nomp3", "nowav", "downloading", "notracks", "complete") as $lstr) {
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

                xhr.open("GET", craigBase + "&ready&r=" + Math.random(), true);
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
                        setTimeout(completeDownload, 5000);
                    }
                };
                xhr.open("GET", craigBase + "&ready&r=" + Math.random(), true);
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
                xhr.open("GET", craigBase + "&ready=nb&r=" + Math.random(), true);
                xhr.send();
            }
            initCheck();

            document.querySelectorAll(".js").forEach(function(e){e.style.display="inline";});
            gid("otherFormats").style.display = "none";

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

            gid("avatarsB").onclick = function() {
                vis("avatars");
            }

            gid("otherFormatsB").onclick = function() {
                vis("otherFormats");
            }

            var usersB = gid("users");
            var usersX = null;
            usersB.onclick = function() {
                if (usersX) return;
                usersX = new XMLHttpRequest();
                usersX.onreadystatechange = function() {
                    if (usersX.readyState !== 4)
                        return;
                    var users = JSON.parse(usersX.responseText).join(", ");
                    usersB.innerText = craigLocale.users + ": " + users;
                    usersX = null;
                };
                usersX.open("GET", craigBase + "&users&r=" + Math.random(), true);
                usersX.send();
            }

            var durationB = gid("duration");
            var durationX = null;
            durationB.onclick = function() {
                if (durationX) return;
                durationX = new XMLHttpRequest();
                durationX.onreadystatechange = function() {
                    if (durationX.readyState !== 4)
                        return;
                    var dur = JSON.parse(durationX.responseText);
                    if (dur && dur.duration) {
                        var durH = ~~(dur.duration/3600);
                        var durM = ~~((dur.duration%3600)/60);
                        var durS = ~~(dur.duration%60);
                        var durT = "";
                        if (durH)
                            durT += durH + ":";
                        if (durM || durH)
                            durT += ((durM<10)?"0":"") + durM + ":";
                        durT += ((durS<10)?"0":"") + durS;
                        if (!durH && !durM)
                            durT += "s";
                        durationB.innerText = craigLocale.duration + ": " + durT;
                    }
                    durationX = null;
                };
                durationX.open("GET", craigBase + "&duration&r=" + Math.random(), true);
                durationX.send();
            }
        })();
        --></script>
    </body>
</html>
<?PHP ob_end_flush(); ?>
