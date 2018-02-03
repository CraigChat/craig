/* This is not an example config file, it is the default configuration. Put
 * your configuration in config.json. */

module.exports = {
    // "token": "...", // The bot's Discord token

    "nick": "Craig",
    // "url": "https://craig.chat", // Only used in presence
    "longUrl": "https://craig.chat/home/",
    "dlUrl": "https://craig.horse/",

    // Record disk size limit, in bytes
    "hardLimit": 536870912,

    // Max time to spend unused in a guild before leaving it, in milliseconds
    "guildMembershipTimeout": 604800000,

    // Secondary connections (each must have a token, nick and invite URL)
    "secondary": [],

    // Important servers. List of server IDs
    "importantServers": [],

    // Time limits
    "limits" = {"record": 6, "download": 48}
};
