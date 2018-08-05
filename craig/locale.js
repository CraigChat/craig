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

/*
 * Craig: A multi-track voice channel recording bot for Discord.
 *
 * Support for localization.
 */

const fs = require("fs");

const langs = ["en", "pt", "it", "ja", "nl"];
const locale = {};
const channelHints = {};
const regionHints = {};

langs.forEach((lang) => {
    const ll = JSON.parse(fs.readFileSync("locale/" + lang + ".json", "utf8"));
    locale[lang] = ll;
    if (lang !== "en") {
        if ("channels" in ll) {
            ll.channels.forEach((ch) => {
                if (!(ch in channelHints)) channelHints[ch] = [];
                channelHints[ch].push(lang);
            });
        }
        if ("regions" in ll) {
            ll.regions.forEach((rg) => {
                if (!(rg in regionHints)) regionHints[rg] = [];
                regionHints[rg].push(lang);
            });
        }
    }
});

// Localize a string
function localize(string, lang) {
    var ret;
    var ll = locale[lang];
    if (string in ll)
        ret = ll[string];
    else
        ret = locale.en[string];
    if (!ret) return "(MISSING STRING)";

    for (var i = 2; i < arguments.length; i++) {
        const re = new RegExp("%" + (i-1), "g");
        ret = ret.replace(re, arguments[i]);
    }

    return ret;
}

// Register commands for every locale
function register(commands, metaname, handler) {
    metaname = "cmd:" + metaname;
    langs.forEach((lang) => {
        var l = locale[lang];
        if (metaname in l) {
            var lhandler = handler(lang);
            l[metaname].forEach((cmd) => {
                if (!(cmd in commands))
                    commands[cmd] = lhandler;
            });
        }
    });
}

// Give a language hint based on the channel
function hint(channel, lang) {
    var maybeLangs = [];
    var hinted = {};

    var channelHint = channelHints[channel.name.toLowerCase()];
    if (channelHint)
        maybeLangs = maybeLangs.concat(channelHint);

    var regionHint = regionHints[channel.guild.region];
    if (regionHint)
        maybeLangs = maybeLangs.concat(regionHint);

    if (maybeLangs.length === 0) return null;

    // Get the hint for each language
    var ret = "";
    maybeLangs.forEach((hlang) => {
        if (hlang === lang) return;
        if (hlang in hinted) return;
        hinted[hlang] = true;
        if (!locale[hlang].hint) return;
        if (ret.length) ret += "\n\n";
        ret += locale[hlang].hint;
    });
    if (!ret.length) return null;

    return ret;
}

module.exports = {
    l: localize,
    register,
    hint
};
