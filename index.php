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

$base = "/home/yahweasel/craig/rec";

// No ID => Send them to homepage
if (!isset($_REQUEST["id"])) {
    header("Location: /home/");
    die();
}
$id = intval($_REQUEST["id"]);

// Make sure the recording exists
if (!file_exists("$base/$id.ogg.header1") ||
    !file_exists("$base/$id.ogg.header2") ||
    !file_exists("$base/$id.ogg.data") ||
    !file_exists("$base/$id.ogg.key") ||
    !file_exists("$base/$id.ogg.delete"))
    die("Invalid ID.");

// Check the key
if (!isset($_REQUEST["key"]))
    die("Invalid ID.");
$key = intval($_REQUEST["key"]);
$corrKey = intval(file_get_contents("$base/$id.ogg.key"));
if ($key !== $corrKey)
    die("Invalid ID.");

// Function to present a download link
function download($title, $format="flac", $container="zip", $then=", ") {
    global $id, $key;
    print "<a href=\"?id=$id&amp;key=$key";
    if ($format === "raw") {
        print "&amp;fetch=raw";
    } else {
        print "&amp;fetch=cooked";
        if ($format !== "flac")
            print "&amp;format=$format";
        if ($container !== "zip")
            print "&amp;container=$container";
    }
    print "\">$title</a>$then";
}

// Present them their options
if (!isset($_REQUEST["fetch"]) && !isset($_REQUEST["delete"])) {
?>
<!doctype html><html><head><title>Craig Records!</title></head><body>
ID: <?PHP print $id; ?><br/><br/>

Download:
<?PHP
    download("FLAC", "flac");
    download("Ogg (Vorbis)", "vorbis");
    download("AAC", "aac", "zip", "");
?>
<br/><br/><br/><br/>

<script type="text/javascript"><!--
<?PHP
readfile("convert.js");
print "craigRaw=\"?id=" . $id . "&key=" . $key . "&fetch=raw\";\n";
print "craigOgg=\"?id=" . $id . "&key=" . $key . "&fetch=cooked&format=copy&container=ogg\";\n";
?>

(function() {
    function dce(t) { return document.createElement(t); }
    function a(e,c) { e.appendChild(c); }
    function bb() { a(other,dce("br")); a(other,dce("br")); }

    var other = dce("div");
    other.style.display = "none";

    var raw = dce("a");
    raw.href = craigRaw;
    raw.innerText = "Raw";
    var rawExpl = dce("span");
    rawExpl.innerText = " (Note: Almost no audio editors will support this raw file)";
    a(other,raw);
    a(other,rawExpl);
    bb();

    var expl = dce("div");
    expl.innerText = "If you choose one of the following formats, it will be processed on your computer, in your browser. This requires a recent browser and some patience.";
    a(other,expl);
    bb();

    var format = dce("select");
    format.id = "format";
    function af(f,v) {
        var opt = dce("option");
        opt.innerText = f;
        opt.value = v;
        a(format,opt);
    }
    af("FLAC", "flac,flac");
    af("Ogg (Vorbis)", "ogg,vorbis");
    af("M4A (MP4 audio)", "mp4,aac");
    af("MP3 (MPEG-1)", "mp3,mp3");
    af("Multi-track MKV", "matroska,flac");

    format.onchange = function() {
        if (format.value === "mp3,mp3") {
            ludditeBox.style.display = "block";
        } else {
            ludditeBox.style.display = "none";
        }
    }

    var formatL = dce("label");
    formatL.innerText = "Format: ";
    formatL.htmlFor = "format";

    a(other,formatL);
    a(other,format);
    bb();

    var mix = dce("input");
    mix.id = "mix";
    mix.type = "checkbox";
    mix.checked = true;

    var mixL = dce("label");
    mixL.innerText = "Mix into single track (defeating Craig's entire purpose)";
    mixL.htmlFor = "mix";

    a(other,mix);
    a(other,mixL);
    bb();

    var ludditeBox = dce("div");
    ludditeBox.style.display = "none";

    var luddite = dce("input");
    luddite.id = "luddite";
    luddite.type = "checkbox";

    var ludditeL = dce("label");
    ludditeL.innerText = "I am a luddite. I chose MP3 because I am ignorant, and I am unwilling to spend even a moment learning what the Hell I'm doing. I acknowledge that if I complain about the MP3 file this tool produces, or the abusiveness of this message, I will be banned. I am an imbecile, and I choose this option as a joyous expression of my own stupidity.";
    ludditeL.htmlFor = "luddite";

    a(ludditeBox,luddite);
    a(ludditeBox,ludditeL);
    a(ludditeBox,dce("br"));
    a(ludditeBox,dce("br"));
    a(other,ludditeBox);

    var cb = dce("button");
    cb.innerText = "Convert";
    cb.disabled = false;
    cb.onclick = function() {
        if (format.value === "mp3,mp3" && !luddite.checked) {
            status.innerText = "You must agree to the MP3 terms before performing an MP3 conversion.";
            return;
        }

        cb.disabled = true;

        var f = format.value.split(",");
        var opts = {
            mix: mix.checked,
            callback: function(){cb.disabled = false;}
        };
        if (f[0] === "matroska") {
            opts.mix = false;
            opts.multitrack = true;
        }
        craigFfmpeg(craigOgg, f[0], f[1], opts);
    }

    a(other,cb);
    bb();

    var status = dce("div");
    status.id = "ffmstatus";
    status.style.backgroundColor = "#CCCCCC";
    status.style.color = "#000000";
    a(other,status);

    var out = dce("ul");
    out.id = "ffmoutput";
    a(other,out);
    bb();

    var info = dce("span");
    info.style.fontSize = "0.9em";
    info.innerHTML = "These formats are provided by <a href=\"http://ffmpeg.org\">ffmpeg</a>, <a href=\"http://opus-codec.org/downloads/\">Opus</a> and <a href=\"http://lame.sourceforge.net/\">LAME</a>, by way of <a href=\"https://github.com/Kagami/ffmpeg.js\">ffmpeg.js</a>. <a href=\"ffmpeg-js-license.txt\">License</a> and <a href=\"ffmpeg-js-craig.tar.xz\">source</a>.";
    a(other,info);

    var show = dce("button");
    show.innerText = "Other formats";
    show.onclick = function() {
        switch (other.style.display) {
            case "none":
                other.style.display = "block";
                break;

            default:
                other.style.display = "none";
        }
    };

    a(document.body,show);
    a(document.body,dce("br"));
    a(document.body,dce("br"));

    a(document.body,other);
})();
//-->
</script>

</body></html>
<?PHP

} else if (isset($_REQUEST["delete"])) {
    $deleteKey = intval($_REQUEST["delete"]);
    $corrDeleteKey = intval(file_get_contents("$base/$id.ogg.delete"));
    if ($deleteKey !== $corrDeleteKey) {
        die("Invalid ID.");
    }

    if (!isset($_REQUEST["sure"])) {
?>
<!doctype html><html><head><title>Craig Records!</title></head><body>
This will DELETE recording <?PHP print $id; ?>! Are you sure?<br/><br/>
<a href="?id=<?PHP print $id; ?>&amp;key=<?PHP print $key; ?>&amp;delete=<?PHP print $deleteKey; ?>&amp;sure=yes">Yes</a><br/><br/>
<a href="?id=<?PHP print $id; ?>&amp;key=<?PHP print $key; ?>">No</a>
</body></html>
<?PHP

    } else {
        // Delete it!
        unlink("$base/$id.ogg.header1");
        unlink("$base/$id.ogg.header2");
        unlink("$base/$id.ogg.data");
        unlink("$base/$id.ogg.delete");
        // We do NOT delete the key, so that it's not replaced before it times out naturally
        die("Deleted!");
    }

} else if ($_REQUEST["fetch"] === "cooked") {
    $format = "flac";
    if (isset($_REQUEST["format"])) {
        if ($_REQUEST["format"] === "copy" ||
            $_REQUEST["format"] === "aac" ||
            $_REQUEST["format"] === "vorbis" ||
            $_REQUEST["format"] === "ra")
            $format = $_REQUEST["format"];
    }
    $container="zip";
    $ext="$format.zip";
    $mime="application/zip";
    if (isset($_REQUEST["container"])) {
        if ($_REQUEST["container"] === "ogg") {
            $container = "ogg";
            $ext = "ogg";
            $mime = "audio/ogg";
        } else if ($_REQUEST["container"] === "matroska") {
            $container = "matroska";
            $ext = "mkv";
            $mime = "video/x-matroska";
        }
    }
    header("Content-disposition: attachment; filename=$id.$ext");
    header("Content-type: $mime");
    ob_flush();
    flush();
    passthru("/home/yahweasel/craig/cook.sh $id $format $container");

} else {
    header("Content-disposition: attachment; filename=$id.ogg");
    header("Content-type: audio/ogg");
    readfile("$base/$id.ogg.header1");
    readfile("$base/$id.ogg.header2");
    readfile("$base/$id.ogg.data");

}
?>
