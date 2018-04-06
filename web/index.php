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

// Figure out the locale
$locale = "en";
$locales = array("en", "pt", "de", "fr", "it");
$l = array();

$notrust = "/[^A-Za-z0-9_-]/";
if (isset($_REQUEST["locale"])) {
    $locale = preg_replace($notrust, "_", $_REQUEST["locale"]);
    setcookie("CRAIG_LOCALE", $locale);
} else if (isset($_COOKIE["CRAIG_LOCALE"])) {
    $locale = preg_replace($notrust, "_", $_COOKIE["CRAIG_LOCALE"]);
} else if (isset($_SERVER["HTTP_ACCEPT_LANGUAGE"])) {
    $locale = locale_accept_from_http($_SERVER["HTTP_ACCEPT_LANGUAGE"]);
} else {
    $locale = "en";
}
$locale = locale_lookup($locales, $locale, false, "en");

// Load in the locale
require("locale/en.php");
if ($locale !== "en")
    require("locale/$locale.php");

// Locale handling functions
function ls($key) {
    global $locale;
    global $l;
    if (isset($l[$locale][$key]))
        return $l[$locale][$key];
    else
        return $l["en"][$key];
}
function l($key) {
    print ls($key);
}

// Function to present a download link
function download($title, $format="flac", $container="zip") {
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
    print "\">$title</a> ";
}

// Present them their options
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

} else if ($_REQUEST["fetch"] === "cooked") {
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
        if ($_REQUEST["container"] === "ogg") {
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
    header("Content-disposition: attachment; filename=$id.$ext");
    header("Content-type: $mime");
    ob_flush();
    flush();
    passthru("/home/yahweasel/craig/cook.sh $id $format $container");

} else if ($_REQUEST["fetch"] === "avatars") {
    $format = "png";
    if (isset($_REQUEST["format"]) && isset($features["glowers"]) && $features["glowers"]) {
        if ($_REQUEST["format"] === "mkvh264" ||
            $_REQUEST["format"] === "webmvp8" ||
            $_REQUEST["format"] === "movsfx" ||
            $_REQUEST["format"] === "movsfxm" ||
            $_REQUEST["format"] === "movsfxu")
            $format = $_REQUEST["format"];
    }
    $container = "zip";
    $ext = "$format.zip";
    $mime = "application/zip";
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
    passthru("/home/yahweasel/craig/cook/avatars.sh $id $format $container $transparent $bg $fg");

} else if (isset($_REQUEST["fetch"])) {
    header("Content-disposition: attachment; filename=$id.ogg");
    header("Content-type: audio/ogg");
    readfile("$base/$id.ogg.header1");
    readfile("$base/$id.ogg.header2");
    readfile("$base/$id.ogg.data");

} else {
    include("dl.php");

}
?>
