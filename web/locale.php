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

// Figure out the locale
$locale = "en";
$locales = array("en", "pt", "de", "fr", "it", "ja", "nl");
$l = array();

$flags = array(
    "en" => ["us", "uk"],
    "pt" => ["br", "pt"],
    "de" => ["de"],
    "fr" => ["fr"],
    "it" => ["it"],
    "ja" => ["ja"],
    "nl" => ["nl"]
);

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

function localeFlags($urlargs = "") {
    global $locales;
    global $locale;
    global $flags;

    print '<div style="text-align: right">';
    foreach ($locales as $la) {
        if ($la !== "en")
            print " | ";
        if ($locale === $la) print "•";
        print "<a href=\"?$urlargs" . "locale=$la\">";
        if (isset($flags[$la])) {
            $fs = $flags[$la];
            foreach ($fs as $i=>$f)
                print "<img src=\"data:image/png;base64," .
                    base64_encode(file_get_contents(__DIR__ . "/home/images/flags/$f.png")) .
                    "\" alt=\"$la\" class=\"flag\" />";
        } else {
            print "$la";
        }
        print "</a>";
    }
    print "</div>";
}
?>
