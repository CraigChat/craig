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

ob_start("ob_gzhandler");

// You must install the Google Drive API with Composer
require_once "vendor/autoload.php";

require "../locale.php";

$db = new SQLite3("/home/yahweasel/craig/craig.db");
$db->exec("PRAGMA journal_mode=WAL;");

$formats = array(
    "flac" => "FLAC",
    "aup" => "Audacity",
    "aac" => "AAC (MPEG-4)",
    "vorbis" => "Ogg Vorbis",
    "powersfx" => "Local processing tool (Windows)",
    "powersfxu" => "Local processing tool (Unix)",
    "powersfxm" => "Local processing tool (Mac OS X)"
);
$formatNms = array_keys($formats);

$discordConfig = json_decode(file_get_contents("/home/yahweasel/craig-drive/discord_client_secret.json"), true);
$discordBase = "https://discordapp.com/api/v6";
$discordAuthURL = "https://discordapp.com/api/oauth2/authorize?client_id=272937604339466240&redirect_uri=https%3A%2F%2Fcraig.chat%2Fdrive%2F%3Fauth%3Ddiscord&response_type=code&scope=identify";

function goodCurl($url) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_USERAGENT, "Craig (https://craig.chat/, 0.0)");
    return $ch;
}

$gclient = new Google_Client();
$gclient->setApplicationName("Craig");
//$gclient->setScopes([Google_Service_Drive::DRIVE_FILE, Google_Service_Drive::DRIVE_METADATA_READONLY]);
$gclient->setScopes([Google_Service_Drive::DRIVE_FILE]);
$gclient->setAuthConfig("/home/yahweasel/craig-drive/client_secret.json");
$gclient->setAccessType("offline");
$gclient->setApprovalPrompt("force");
$gclientAuth = false;
$gclientAuthURL = $gclient->createAuthUrl();
$gdrive = false;

// Log in to Google Drive, if applicable
function gdriveGetClient($code = false, $logoff = false) {
    global $gclient, $gdrive, $discordID, $db;

    // Load previously authorized credentials, if available
    $accessToken = false;

    if ($logoff) {
        $db->exec("DELETE FROM drive WHERE id='$discordID';");
        return;
    }

    if ($code !== false) {
        // Exchange authorization code for an access token.
        $accessToken = $gclient->fetchAccessTokenWithAuthCode($code);
        if (isset($accessToken["access_token"])) {
            // Store the credentials
            $db->exec("INSERT OR REPLACE INTO drive (id, data) VALUES ('$discordID', '" . SQLite3::escapeString(json_encode($accessToken)) . "');");
        } else {
            $accessToken = false;
        }

    }

    if ($accessToken === false) {
        // Try loading it from the DB
        $res = $db->query("SELECT * FROM drive WHERE id='$discordID';");
        $row = $res->fetchArray();
        if ($row !== false) {
            $accessToken = json_decode($row["data"], true);
        }
    }

    // Set the access token
    try {
        $gclient->setAccessToken($accessToken);
    } catch (Exception $ex) {
        $db->exec("DELETE FROM drive WHERE id='$discordID';");
        return;
    }

    // Refresh the token if it's expired.
    if ($gclient->isAccessTokenExpired()) {
        try {
            $gclient->fetchAccessTokenWithRefreshToken($gclient->getRefreshToken());
        } catch (Exception $ex) {
            $db->exec("DELETE FROM drive WHERE id='$discordID';");
            return;
        }
        $db->exec("INSERT OR REPLACE INTO drive (id, data) VALUES ('$discordID', '" . SQLite3::escapeString(json_encode($gclient->getAccessToken())) . "');");
    }

    $gdrive = true;
}

session_start();

// Load any existing authentication
$discord = false;
if (isset($_SESSION["discordtoken"]))
    $discord = $_SESSION["discordtoken"];

if (isset($_REQUEST["auth"]) && isset($_REQUEST["code"])) {
    if ($_REQUEST["auth"] === "discord") {
        $code = $_REQUEST["code"];
        $ch = goodCurl("https://discordapp.com/api/oauth2/token");
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query(array(
            "client_id" => $discordConfig["client_id"],
            "client_secret" => $discordConfig["client_secret"],
            "grant_type" => "authorization_code",
            "code" => $code,
            "redirect_uri" => "https://craig.chat/drive/?auth=discord"
        )));
        $discordTokenJSON = curl_exec($ch);
        if ($discordTokenJSON !== false) {
            // FIXME if it is false...
            $discordToken = json_decode($discordTokenJSON, true);
            if (isset($discordToken["access_token"])) {
                $discord = $discordToken["access_token"];
                $_SESSION["discordtoken"] = $discord;
                /* We don't worry about the refresh token, since we just need
                 * the identity once */
            }
        }

    } else if ($_REQUEST["auth"] === "drive") {
        $gclientAuth = true;

    }

}

// Get the Discord user
$discordID = false;
if ($discord !== false) {
    if (isset($_SESSION["id-$discord"])) {
        $discordID = $_SESSION["id-$discord"];
    } else {
        $ch = goodCurl("$discordBase/users/@me");
        curl_setopt($ch, CURLOPT_HTTPHEADER, array("Authorization: Bearer $discord"));
        $discordUserJSON = curl_exec($ch);
        if ($discordUserJSON !== false) {
            $discordUser = json_decode($discordUserJSON, true);
            if (isset($discordUser["id"])) {
                $discordID = preg_replace("/[^0-9]/", "_", $discordUser["id"]);
                $_SESSION["id-$discord"] = $discordID;
            }
        }
    }
}

// Finish our Drive login if applicable
if ($discordID)
    gdriveGetClient($gclientAuth ? $_REQUEST["code"] : false);

// And log out of anything
if (isset($_REQUEST["logoff"])) {
    // Always log off of Drive
    gdriveGetClient(false, true);
    $gdrive = false;

    // If we requested it, also log out of Discord
    if ($_REQUEST["logoff"] === "discord") {
        unset($_SESSION["discord"]);
        $discord = $discordID = false;
    }
}

// If they asked to change our format, do so
if ($discord && $gdrive && isset($_REQUEST["format"])) {
    // Make sure it's a legal format
    $format = "flac";
    $container = "zip";
    $maybeFormat = $_REQUEST["format"];
    foreach ($formatNms as $formatNm) {
        if ($maybeFormat === $formatNm)
            $format = $formatNm;
    }

    if ($format === "aup") {
        $format = "flac";
        $container = "aupzip";
    }

    if ($format === "powersfx") {
        $container = "exe";
    }

    // And update it in the DB
    $db->exec("UPDATE drive SET format = '$format', container = '$container' WHERE id='$discordID';");
}

// If we're fully logged in, get our format
$format = "flac";
$container = "zip";
if ($discord && $gdrive) {
    $res = $db->query("SELECT * FROM drive WHERE id='$discordID';");
    $row = $res->fetchArray();
    if ($row !== false) {
        $format = $row["format"];
        if ($format === null)
            $format = "flac";
        $container = $row["container"];
        if ($container === null)
            $container = "zip";
    }

    if ($container === "aupzip")
        $format = "aup";
}
?>
<!doctype html>
<html>
    <head>
        <title>Craig Records! Google Drive integration</title>
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

            .para {
                font-size: 1.25em;
                margin: auto;
                max-width: 78rem;
            }
        </style>
    </head>
    <body>
        <?PHP localeFlags(); ?>

        <div class="para">
        <?PHP print ls("ddesc") . " <a href=\"/home/privacy.php\">" . ls("dprivacy") . "</a>"; ?><br/><br/>

        <?PHP
            if ($discord === false) {
                print "<a href=\"" . htmlspecialchars($discordAuthURL) . "\">" . ls("dili") . "</a>";
            } else {
                print "<a href=\"?logoff=discord\">" . ls("dilo") . "</a><br/><br/>";

                if (!$gdrive) {
                    print "<a href=\"" . htmlspecialchars($gclientAuthURL) . "\">" . ls("drli") . "</a>";
                } else {
                    print "<a href=\"?logoff=gdrive\">" . ls("drlo") . "</a><br/><br/>";

                    l("ddone");
                    print "<br/><br/>";

                    print '<form action="." method="GET">';
                    print ls("format") . ' <select name="format" onchange="this.form.submit()">';
                    foreach ($formats as $formatNm => $formatDesc)
                        print "<option value=\"$formatNm\"" . (($format===$formatNm)?" selected":"") . ">$formatDesc</option>\n";
                    print "</select>\n</form>\n";
                }
            }
        ?><br/><br/>

        <a href="/home/"><?PHP l("back"); ?></a>

        </div>
    </body>
</html>
<?PHP ob_end_flush(); ?>
