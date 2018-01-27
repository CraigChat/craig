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
if (!isset($_REQUEST["fetch"]) && !isset($_REQUEST["delete"])) {
    include("dl.php");

} else if (isset($_REQUEST["delete"])) {
    $deleteKey = intval($_REQUEST["delete"]);
    $corrDeleteKey = intval(file_get_contents("$base/$id.ogg.delete"));
    if ($deleteKey !== $corrDeleteKey) {
        die("Invalid ID.");
    }

    if (!isset($_REQUEST["sure"])) {
        include("delete.php");

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
