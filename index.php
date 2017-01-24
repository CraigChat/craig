<?PHP
$base = "/home/yahweasel/craig/rec";

if (!isset($_REQUEST["id"])) {
    header("Location: /home/");
    die();
}
$id = intval($_REQUEST["id"]);

if (!file_exists("$base/$id.ogg.header1") ||
    !file_exists("$base/$id.ogg.header2") ||
    !file_exists("$base/$id.ogg.data"))
    die("Invalid ID.");

if (!isset($_REQUEST["fetch"])) {
?>
<!doctype html><html><head><title>Craig Records!</title></head><body>
ID: <?PHP print $id; ?><br/>
Download: <a href="?id=<?PHP print $id; ?>&fetch=cooked">processed</a>, <a href="?id=<?PHP print $id; ?>&fetch=raw">raw</a><br/>
Note: Most audio editors will NOT support the raw version. Heck, some won't support the processed version.
</body></html>
<?PHP
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
