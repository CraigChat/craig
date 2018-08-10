<!doctype html>
<html>
<body>
<?PHP
/*
 * Copyright (c) 2018 Yahweasel
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
require("locale.php");
$enkeys = array_keys($l["en"]);
sort($enkeys);
foreach ($locales as $cl) {
    if ($cl === "en") continue;
    include "locale/$cl.php";
    $missing = [];
    foreach ($enkeys as $key) {
        if (preg_match('/-updated$/', $key)) {
            if (!isset($l[$cl][$key]) || $l[$cl][$key] < $l["en"][$key]) {
                array_push($missing, str_replace("-updated", "", $key));
                array_push($missing, $key);
            }
        } else {
            if (!isset($l[$cl][$key]))
                array_push($missing, $key);
        }
    }
    if (sizeof($missing)) {
        print "$cl:<br/><pre>";
        foreach ($missing as $key)
            print "    \"$key\" => " . json_encode($l["en"][$key]) . ",\n";
        print "</pre><br/><br/>";
    }
}
?>
</body>
</html>
