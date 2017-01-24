<?PHP
$base = "/home/yahweasel/craig/rec";

if (!isset($_REQUEST["id"])) {
    header("Location: /home/");
    die();
}
$id = intval($_REQUEST["id"]);

if (!file_exists("$base/$id.ogg.header1") ||
    !file_exists("$base/$id.ogg.header2") ||
    !file_exists("$base/$id.ogg.data") ||
    !file_exists("$base/$id.ogg.delete"))
    die("Invalid ID.");

if (!isset($_REQUEST["fetch"]) && !isset($_REQUEST["delete"])) {
?>
<!doctype html><html><head><title>Craig Records!</title></head><body>
ID: <?PHP print $id; ?><br/><br/>
Download: <a href="?id=<?PHP print $id; ?>&amp;fetch=cooked">processed</a>, <a href="?id=<?PHP print $id; ?>&amp;fetch=raw">raw</a><br/><br/>
Note: Most audio editors will NOT correctly decode the raw version.
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
<a href="?id=<?PHP print $id; ?>&amp;delete=<?PHP print $deleteKey; ?>&amp;sure=yes">Yes</a><br/><br/>
<a href="?id=<?PHP print $id; ?>">No</a>
</body></html>
<?PHP

    } else {
        // Delete it!
        unlink("$base/$id.ogg.header1");
        unlink("$base/$id.ogg.header2");
        unlink("$base/$id.ogg.data");
        unlink("$base/$id.ogg.delete");
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
