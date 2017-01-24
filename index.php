<?PHP
/*
 * Copyright (c) 2017 Yahweasel
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

// Present them their options
if (!isset($_REQUEST["fetch"]) && !isset($_REQUEST["delete"])) {
?>
<!doctype html><html><head><title>Craig Records!</title></head><body>
ID: <?PHP print $id; ?><br/><br/>

Download: <a href="?id=<?PHP print $id; ?>&amp;fetch=cooked">processed</a>, <a href="?id=<?PHP print $id; ?>&amp;fetch=raw">raw</a><br/><br/>

Note: Most audio editors will NOT correctly decode the raw version.<br/><br/>

Craig is restricted to six hours of recording in any recording session.
Recordings are deleted automatically after 48 hours from the <em>start</em> of
recording. Both the raw and processed audio can be downloaded even if Craig is
still recording at the time.
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
    header("Content-disposition: attachment; filename=$id.zip");
    header("Content-type: application/zip");
    passthru("/home/yahweasel/craig/cook.sh $id");

} else {
    header("Content-disposition: attachment; filename=$id.ogg");
    header("Content-type: audio/ogg");
    readfile("$base/$id.ogg.header1");
    readfile("$base/$id.ogg.header2");
    readfile("$base/$id.ogg.data");

}
?>
