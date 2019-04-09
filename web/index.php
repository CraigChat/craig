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
$ennuizel = "https://c.ennuicastr.com/ennuizel/";

// No ID => Send them to homepage
if (!isset($_REQUEST["id"])) {
    header("Location: /home/");
    die();
}
$id = intval($_REQUEST["id"]);

// Make sure the recording exists
if (!file_exists("$base/$id.ogg.header1") ||
    !file_exists("$base/$id.ogg.header2") ||
    !file_exists("$base/$id.ogg.data"))
    die("Invalid ID.");

// Get the info
$info = false;
if (file_exists("$base/$id.ogg.info"))
    $info = json_decode(file_get_contents("$base/$id.ogg.info"), true);

// Check the key
if (!isset($_REQUEST["key"]))
    die("Invalid ID.");
$key = intval($_REQUEST["key"]);
if ($info !== false)
    $corrKey = $info["key"];
else if (file_exists("$base/$id.ogg.key"))
    $corrKey = intval(file_get_contents("$base/$id.ogg.key"));
else
    $corrKey = false;
if ($key !== $corrKey)
    die("Invalid ID.");

// Check the features
if ($info !== false && isset($info["features"]))
    $features = $info["features"];
else if (file_exists("$base/$id.ogg.features"))
    $features = json_decode(file_get_contents("$base/$id.ogg.features"), true);
else
    $features = array();

// Check if they're on Windows
$windows = false;
if ((stripos($_SERVER["HTTP_USER_AGENT"], "win") !== false || isset($_REQUEST["windows"])) &&
    !isset($_REQUEST["nowindows"]))
    $windows = true;

// Check if they're on OS X
$macosx = false;
if ((stripos($_SERVER["HTTP_USER_AGENT"], "mac os x") !== false || isset($_REQUEST["macosx"])) &&
    !isset($_REQUEST["nomacosx"]))
    $macosx = true;
$iphone = false;
if ((stripos($_SERVER["HTTP_USER_AGENT"], "iphone") !== false || isset($_REQUEST["iphone"])) &&
    !isset($_REQUEST["noiphone"]))
    $iphone = true;

// Check if they're on a common Unixen
$unix = false;
if ((stripos($_SERVER["HTTP_USER_AGENT"], "linux") !== false ||
     stripos($_SERVER["HTTP_USER_AGENT"], "bsd") !== false ||
     isset($_REQUEST["unix"])) &&
    !isset($_REQUEST["nounix"]))
    $unix = true;
$android = false;
if ((stripos($_SERVER["HTTP_USER_AGENT"], "android") !== false || isset($_REQUEST["android"])) &&
    !isset($_REQUEST["noandroid"]))
    $android = true;

// Check if they're asking for beta features
$beta = isset($_REQUEST["beta"]);

require("locale.php");

// Function to present a download link
function download($title, $format="flac", $container="zip", $flags="") {
    global $id, $key;
    print "<a href=\"?id=$id&amp;key=$key";
    if ($format === "raw" || $format === "info") {
        print "&amp;fetch=$format";
    } else {
        print "&amp;fetch=cooked";
        if ($format !== "flac")
            print "&amp;format=$format";
        if ($container !== "zip")
            print "&amp;container=$container";
        print "$flags";
    }
    print "\">$title</a> ";
}

// Function to present an Ennuizel link
function ezel($title, $w) {
    global $id, $key, $locale, $ennuizel;
    $ids = base_convert($id, 10, 36);
    $keys = base_convert($key, 10, 36);

    print "<span class=\"local js\"><a href=\"" .
        $ennuizel . "?i=$ids&amp;k=$keys";
        
    if ($w !== false)
        print "&amp;w=" . base_convert($w, 10, 36);

    if ($locale !== "en")
        print "&amp;lang=$locale";

    print "\">$title</a></span> ";
}

// Perform an action based on the request
if (isset($_REQUEST["delete"])) {
    $deleteKey = intval($_REQUEST["delete"]);
    if ($info !== false)
        $corrDeleteKey = $info["delete"];
    else if (file_exists("$base/$id.ogg.delete"))
        $corrDeleteKey = intval(file_get_contents("$base/$id.ogg.delete"));
    else
        $corrDeleteKey = false;
    if ($deleteKey !== $corrDeleteKey) {
        die("Invalid ID.");
    }

    if (!isset($_REQUEST["sure"])) {
        include("delete.php");

    } else {
        // Delete it!
        @unlink("$base/$id.ogg.header1");
        @unlink("$base/$id.ogg.header2");
        @unlink("$base/$id.ogg.data");
        @unlink("$base/$id.ogg.delete");
        @unlink("$base/$id.ogg.features");
        // We do NOT delete the key, so that it's not replaced before it times out naturally
        die(ls("deleted"));
    }

} else if (isset($_REQUEST["ready"])) {
    // The file is shared-locked while still being downloaded
    $ready = true;
    $fp = fopen("$base/$id.ogg.data", "r+");
    if ($fp !== false) {
        for ($i = 0; $i < 30; $i++) {
            $ready = flock($fp, LOCK_EX|LOCK_NB);
            flock($fp, LOCK_UN);
            if ($ready || $_REQUEST["ready"] === "nb") break;
            sleep(1);
        }
        fclose($fp);
    }

    header("Content-type: application/json");
    print "{\"ready\":".($ready?"true":"false")."}";

} else if (isset($_REQUEST["duration"])) {
    header("Content-type: application/json");
    print "{\"duration\":";
    passthru("/home/yahweasel/craig/cook/duration.sh $id");
    print "}";

} else if (isset($_REQUEST["users"])) {
    header("Content-type: application/json");
    print "[";
    if (file_exists("$base/$id.ogg.users")) {
        $users = json_decode("{".file_get_contents("$base/$id.ogg.users")."}", true);
        for ($ui = 1;; $ui++) {
            if (!isset($users[$ui])) break;
            if ($ui !== 1) print ",";
            print json_encode($users[$ui]["name"]);
        }
    }
    print "]";

} else if (isset($_REQUEST["fetch"]) && $_REQUEST["fetch"] === "cooked") {
    // Don't allow multiple downloads
    $fp = fopen("$base/$id.ogg.data", "r+");
    if ($fp !== false) {
        $ready = flock($fp, LOCK_EX|LOCK_NB);
        flock($fp, LOCK_UN);
        fclose($fp);
        if (!$ready) {
            http_response_code(429);
            die("Too many requests");
        }
    }

    $format = "flac";
    if (isset($_REQUEST["format"])) {
        $rf = $_REQUEST["format"];
        if ($rf === "copy" ||
            $rf === "oggflac" ||
            $rf === "vorbis" ||
            $rf === "aac" ||
            $rf === "heaac" ||
            $rf === "adpcm" ||
            $rf === "wav8" ||
            $rf === "opus" ||
            $rf === "wavsfx" ||
            $rf === "wavsfxm" ||
            $rf === "wavsfxu" ||
            $rf === "powersfx" ||
            $rf === "powersfxm" ||
            $rf === "powersfxu" ||
            $rf === "ra")
            $format = $rf;
        else if ($rf === "mp3" &&
                 isset($features["mp3"]) &&
                 $features["mp3"])
            $format = "mp3";
    }
    $container="zip";
    $ext="$format.zip";
    $mime="application/zip";
    if (isset($_REQUEST["container"])) {
        if ($_REQUEST["container"] === "aupzip") {
            $container = "aupzip";
            $ext = "aup.zip";
        } else if ($_REQUEST["container"] === "ogg") {
            $container = "ogg";
            $ext = "ogg";
            $mime = "audio/ogg";
        } else if ($_REQUEST["container"] === "matroska") {
            $container = "matroska";
            $ext = "mkv";
            $mime = "video/x-matroska";
        } else if ($_REQUEST["container"] === "exe") {
            // (Windows self-extractor)
            $container = "exe";
            $ext = "exe";
            $mime = "application/vnd.microsoft.portable-executable";
        } else if ($_REQUEST["container"] === "mix" &&
                   isset($features["mix"]) &&
                   $features["mix"]) {
            $container = "mix";
            $ext = $format;
            if ($format === "vorbis") $ext = "ogg";
            $mime = "application/octet-stream";
        }
    }
    $exflags = "";
    if (isset($_REQUEST["dynaudnorm"]))
        $exflags .= " dynaudnorm";
    header("Content-disposition: attachment; filename=$id.$ext");
    header("Content-type: $mime");
    ob_flush();
    flush();
    passthru("/usr/bin/timeout 7200 /home/yahweasel/craig/cook.sh $id $format $container$exflags");

} else if (isset($_REQUEST["fetch"]) && $_REQUEST["fetch"] === "avatars") {
    $format = "png";
    $container = "zip";
    $ext = "$format.zip";
    $mime = "application/zip";

    if (isset($_REQUEST["format"]) && isset($features["glowers"]) && $features["glowers"]) {
        if ($_REQUEST["format"] === "mkvh264" ||
            $_REQUEST["format"] === "webmvp8" ||
            $_REQUEST["format"] === "movsfx" ||
            $_REQUEST["format"] === "movsfxm" ||
            $_REQUEST["format"] === "movsfxu" ||
            $_REQUEST["format"] === "movpngsfx" ||
            $_REQUEST["format"] === "movpngsfxm" ||
            $_REQUEST["format"] === "movpngsfxu")
            $format = $_REQUEST["format"];

        if ((isset($_REQUEST["container"]) && $_REQUEST["container"] === "exe") ||
            (!isset($_REQUEST["container"]) && ($format === "movsfx" || $format === "movpngsfx"))) {
            $container = "exe";
            $ext = ($format==="movpngsfx")?"movpng.exe":"mov.exe";
            $mime = "application/vnd.microsoft.portable-executable";
        }
    }

    $transparent = (isset($_REQUEST["transparent"])?1:0);
    $bg = "000000";
    if (isset($_REQUEST["bg"]))
        $bg = substr(preg_replace("/[^0-9A-Fa-f]/", "", $_REQUEST["bg"]), 0, 6);
    $fg = "008000";
    if (isset($_REQUEST["fg"]))
        $fg = substr(preg_replace("/[^0-9A-Fa-f]/", "", $_REQUEST["fg"]), 0, 6);
    header("Content-disposition: attachment; filename=$id.$ext");
    header("Content-type: $mime");
    ob_flush();
    flush();
    passthru("/usr/bin/timeout 7200 /home/yahweasel/craig/cook/avatars.sh $id $format $container $transparent $bg $fg");

} else if (isset($_REQUEST["fetch"]) && $_REQUEST["fetch"] == "info") {
    header("Content-type: application/json");
    passthru("/home/yahweasel/craig/cook/info.sh $id");

} else if (isset($_REQUEST["fetch"]) && $_REQUEST["fetch"] == "infotxt") {
    header("Content-disposition: attachment; filename=$id-info.txt");
    header("Content-type: text/plain");
    passthru("/home/yahweasel/craig/cook/infotxt.sh $id");

} else if (isset($_REQUEST["fetch"])) {
    header("Content-disposition: attachment; filename=$id.ogg");
    header("Content-type: audio/ogg");
    readfile("$base/$id.ogg.header1");
    readfile("$base/$id.ogg.header2");
    readfile("$base/$id.ogg.data");

} else if (isset($_REQUEST["localecheck"])) {
    include("locale-check.php");

} else {
    include("dl.php");

}
?>
