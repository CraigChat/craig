const { RequestHandler, DiscordHTTPError, DiscordRESTError } = require("eris");
const HTTPS = require("https");
const MultipartData = require("eris/lib/util/MultipartData");
const Zlib = require("zlib");
const SQLite = require("better-sqlite3");

function dbRun(stmt, args) {
    while (true) {
        try {
            return stmt.run(args);
        } catch (ex) {}
    }
}

function dbGet(stmt, args) {
    while (true) {
        try {
            return stmt.get(args);
        } catch (ex) {}
    }
}

class ShardedRequestHandler extends RequestHandler {
    constructor(client, options) {
        super(client, options);

        let la = client.options.httpRequestOptions.localAddress;
        let db = this.db = new SQLite("rate-limits" + (la?"-"+la:"") + ".db");
        db.exec("PRAGMA journal_mode=WAL;");
        db.exec(`
                CREATE TABLE IF NOT EXISTS rate_limits (
                    bucket TEXT PRIMARY KEY,
                    counter INTEGER,
                    remaining INTEGER,
                    reset REAL
                    );
                CREATE TABLE IF NOT EXISTS buckets (
                    route TEXT PRIMARY KEY,
                    bucket TEXT
                    );
                `);

        this.dbRateLimitFetch = db.prepare("SELECT * FROM rate_limits WHERE bucket=@BUCKET;");
        this.dbRateLimitInit = db.prepare("INSERT OR IGNORE INTO rate_limits (bucket, counter, remaining, reset) VALUES (@BUCKET, 0, 0, @RESET);");
        this.dbRateLimitUpdate = db.prepare("UPDATE rate_limits SET counter=counter+1, remaining=@REMAINING, reset=@RESET WHERE bucket=@BUCKET;");
        this.dbRateLimitTake = db.prepare(`
                UPDATE rate_limits SET counter=@COUNTER+1, remaining=@REMAINING, reset=@RESET
                WHERE bucket=@BUCKET AND counter=@COUNTER;`);
        this.dbRateLimitDrop = db.prepare("DELETE FROM rate_limits WHERE bucket=@BUCKET;");
        this.dbBucketFetch = db.prepare("SELECT * FROM buckets WHERE route=@ROUTE;");
        this.dbBucketUpdate = db.prepare("INSERT OR REPLACE INTO buckets (route, bucket) VALUES (@ROUTE, @BUCKET);");
    }

    /**
    * Make an API request
    * @arg {String} method Uppercase HTTP method
    * @arg {String} url URL of the endpoint
    * @arg {Boolean} [auth] Whether to add the Authorization header and token or not
    * @arg {Object} [body] Request payload
    * @arg {Object} [file] File object
    * @arg {Buffer} file.file A buffer containing file data
    * @arg {String} file.name What to name the file
    * @returns {Promise<Object>} Resolves with the returned JSON data
    */
    request(method, url, auth, body, file, _route, short) {
        const route = _route || this.routefy(url, method);

        const _stackHolder = {}; // Preserve async stack
        Error.captureStackTrace(_stackHolder);

        return new Promise((resolve, reject) => {
            let attempts = 0;

            const actualCall = () => {
                const headers = {
                    "User-Agent": this.userAgent,
                    "Accept-Encoding": "gzip,deflate"
                };
                let data;
                let finalURL = url;

                try {
                    if(auth) {
                        headers.Authorization = this._client._token;
                    }
                    if(body && body.reason) { // Audit log reason sniping
                        let unencodedReason = body.reason;
                        if(this.options.decodeReasons) {
                            try {
                                if(unencodedReason.includes("%") && !unencodedReason.includes(" ")) {
                                    unencodedReason = decodeURIComponent(unencodedReason);
                                }
                            } catch(err) {
                                this._client.emit("error", err);
                            }
                        }
                        headers["X-Audit-Log-Reason"] = encodeURIComponent(unencodedReason);
                        if((method !== "PUT" || !url.includes("/bans")) && (method !== "POST" || !url.includes("/prune"))) {
                            delete body.reason;
                        } else {
                            body.reason = unencodedReason;
                        }
                    }
                    if(file) {
                        if(Array.isArray(file)) {
                            data = new MultipartData();
                            headers["Content-Type"] = "multipart/form-data; boundary=" + data.boundary;
                            file.forEach(function(f) {
                                if(!f.file) {
                                    return;
                                }
                                data.attach(f.name, f.file, f.name);
                            });
                            if(body) {
                                data.attach("payload_json", body);
                            }
                            data = data.finish();
                        } else if(file.file) {
                            data = new MultipartData();
                            headers["Content-Type"] = "multipart/form-data; boundary=" + data.boundary;
                            data.attach("file", file.file, file.name);
                            if(body) {
                                if(method === "POST" && url.endsWith("/stickers")) {
                                    for(const key in body) {
                                        data.attach(key, body[key]);
                                    }
                                } else {
                                    data.attach("payload_json", body);
                                }
                            }
                            data = data.finish();
                        } else {
                            throw new Error("Invalid file object");
                        }
                    } else if(body) {
                        if(method === "GET" || method === "DELETE") {
                            let qs = "";
                            Object.keys(body).forEach(function(key) {
                                if(body[key] != undefined) {
                                    if(Array.isArray(body[key])) {
                                        body[key].forEach(function(val) {
                                            qs += `&${encodeURIComponent(key)}=${encodeURIComponent(val)}`;
                                        });
                                    } else {
                                        qs += `&${encodeURIComponent(key)}=${encodeURIComponent(body[key])}`;
                                    }
                                }
                            });
                            finalURL += "?" + qs.substring(1);
                        } else {
                            // Replacer function serializes bigints to strings, the format Discord uses
                            data = JSON.stringify(body, (k, v) => typeof v === "bigint" ? v.toString() : v);
                            headers["Content-Type"] = "application/json";
                        }
                    }
                } catch(err) {
                    reject(err);
                    return;
                }

                let req;
                try {
                    req = HTTPS.request({
                        method: method,
                        host: this.options.domain,
                        path: this.options.baseURL + finalURL,
                        headers: headers,
                        agent: this.options.agent
                    });
                } catch(err) {
                    cb();
                    reject(err);
                    return;
                }

                let reqError;

                req.once("abort", () => {
                    reqError = reqError || new Error(`Request aborted by client on ${method} ${url}`);
                    reqError.req = req;
                    reject(reqError);
                }).once("error", (err) => {
                    reqError = err;
                    req.abort();
                });

                let latency = Date.now();

                req.once("response", (resp) => {
                    latency = Date.now() - latency;
                    if(!this.options.disableLatencyCompensation) {
                        this.latencyRef.raw.push(latency);
                        this.latencyRef.latency = this.latencyRef.latency - ~~(this.latencyRef.raw.shift() / 10) + ~~(latency / 10);
                    }

                    if(this._client.listeners("rawREST").length) {
                        /**
                         * Fired when the Client's RequestHandler receives a response
                         * @event Client#rawREST
                         * @prop {Object} [request] The data for the request.
                         * @prop {Boolean} request.auth True if the request required an authorization token
                         * @prop {Object} [request.body] The request payload
                         * @prop {Object} [request.file] The file object sent in the request
                         * @prop {Buffer} request.file.file A buffer containing file data
                         * @prop {String} request.file.name The name of the file
                         * @prop {Number} request.latency The HTTP response latency
                         * @prop {String} request.method Uppercase HTTP method
                         * @prop {IncomingMessage} request.resp The HTTP response to the request
                         * @prop {String} request.route The calculated ratelimiting route for the request
                         * @prop {Boolean} request.short Whether or not the request was prioritized in its ratelimiting queue
                         * @prop {String} request.url URL of the endpoint
                         */
                        this._client.emit("rawREST", {method, url, auth, body, file, route, short, resp, latency});
                    }

                    const headerNow = Date.parse(resp.headers["date"]);
                    if(this.latencyRef.lastTimeOffsetCheck < Date.now() - 5000) {
                        const timeOffset = headerNow + 500 - (this.latencyRef.lastTimeOffsetCheck = Date.now());
                        if(this.latencyRef.timeOffset - this.latencyRef.latency >= this.options.latencyThreshold && timeOffset - this.latencyRef.latency >= this.options.latencyThreshold) {
                            this._client.emit("warn", new Error(`Your clock is ${this.latencyRef.timeOffset}ms behind Discord's server clock. Please check your connection and system time.`));
                        }
                        this.latencyRef.timeOffset = this.latencyRef.timeOffset - ~~(this.latencyRef.timeOffsets.shift() / 10) + ~~(timeOffset / 10);
                        this.latencyRef.timeOffsets.push(timeOffset);
                    }

                    resp.once("aborted", () => {
                        reqError = reqError || new Error(`Request aborted by server on ${method} ${url}`);
                        reqError.req = req;
                        reject(reqError);
                    });

                    let response = "";

                    let _respStream = resp;
                    if(resp.headers["content-encoding"]) {
                        if(resp.headers["content-encoding"].includes("gzip")) {
                            _respStream = resp.pipe(Zlib.createGunzip());
                        } else if(resp.headers["content-encoding"].includes("deflate")) {
                            _respStream = resp.pipe(Zlib.createInflate());
                        }
                    }

                    _respStream.on("data", (str) => {
                        response += str;
                    }).on("error", (err) => {
                        reqError = err;
                        req.abort();
                    }).once("end", () => {
                        const now = Date.now();

                        if(method !== "GET" && resp.headers["x-ratelimit-remaining"] == undefined) {
                            this._client.emit("debug", `Missing ratelimit headers\n`
                                + `${resp.statusCode} ${resp.headers["content-type"]}: ${method} ${route} | ${resp.headers["cf-ray"]}\n`
                                + "content-type = " + "\n"
                                + "x-ratelimit-remaining = " + resp.headers["x-ratelimit-remaining"] + "\n"
                                + "x-ratelimit-limit = " + resp.headers["x-ratelimit-limit"] + "\n"
                                + "x-ratelimit-reset = " + resp.headers["x-ratelimit-reset"] + "\n"
                                + "x-ratelimit-global = " + resp.headers["x-ratelimit-global"]);
                        }

                        let rateLimit = {
                            "ROUTE": route,
                            "BUCKET": (resp.headers["x-ratelimit-bucket"] || route),
                            "REMAINING": +(resp.headers["x-ratelimit-remaining"] || 0),
                            "LIMIT": +(resp.headers["x-ratelimit-limit"] || 1),
                            "RESET": now + (+(resp.headers["x-ratelimit-reset-after"] || 0.25) * 1000)
                        };

                        if (rateLimit.BUCKET !== route)
                            dbRun(this.dbRateLimitDrop, {BUCKET: route});

                        const retryAfter = parseInt(resp.headers["x-ratelimit-reset-after"] || resp.headers["retry-after"]) * 1000;
                        if(retryAfter >= 0) {
                            if(resp.headers["x-ratelimit-global"]) {
                                let globalRL = {
                                    BUCKET: "global",
                                    REMAINING: 0,
                                    RESET: now + retryAfter
                                };
                                dbRun(this.dbRateLimitInit, globalRL);
                                dbRun(this.dbRateLimitUpdate, globalRL);
                                waitForRateLimit().then(() => {
                                    this.request(method, url, auth, body, file, route, true).then(resolve).catch(reject);
                                });
                            } else {
                                //this.ratelimits[route].reset = Math.max(+resp.headers["x-ratelimit-reset"] * 1000 - (this.options.disableLatencyCompensation ? 0 : this.latencyRef.timeOffset), now);
                            }
                        }

                        dbRun(this.dbBucketUpdate, rateLimit);
                        dbRun(this.dbRateLimitInit, rateLimit);
                        dbRun(this.dbRateLimitUpdate, rateLimit);

                        if(resp.statusCode !== 429) {
                            const content = typeof body === "object" ? `${body.content} ` : "";
                            this._client.emit("debug", `${content}${now} ${route} ${resp.statusCode}: ${latency}ms (${this.latencyRef.latency}ms avg)`);
                        }

                        if(resp.statusCode >= 300) {
                            if(resp.statusCode === 429) {
                                const content = typeof body === "object" ? `${body.content} ` : "";
                                this._client.emit("debug", `${resp.headers["x-ratelimit-global"] ? "Global" : "Unexpected"} 429 (╯°□°）╯︵ ┻━┻: ${response}\n${content} ${now} ${route} ${resp.statusCode}: ${latency}ms (${this.latencyRef.latency}ms avg)`);
                                if(retryAfter) {
                                    setTimeout(() => {
                                        waitForRateLimit().then(() => {
                                            this.request(method, url, auth, body, file, route, true).then(resolve).catch(reject);
                                        });
                                    }, retryAfter);
                                    return;
                                } else {
                                    waitForRateLimit().then(() => {
                                        this.request(method, url, auth, body, file, route, true).then(resolve).catch(reject);
                                    });
                                    return;
                                }
                            } else if(resp.statusCode === 502 && ++attempts < 4) {
                                this._client.emit("debug", "A wild 502 appeared! Thanks CloudFlare!");
                                setTimeout(() => {
                                    this.request(method, url, auth, body, file, route, true).then(resolve).catch(reject);
                                }, Math.floor(Math.random() * 1900 + 100));
                                return;
                            }

                            if(response.length > 0) {
                                if(resp.headers["content-type"] === "application/json") {
                                    try {
                                        response = JSON.parse(response);
                                    } catch(err) {
                                        reject(err);
                                        return;
                                    }
                                }
                            }

                            let {stack} = _stackHolder;
                            if(stack.startsWith("Error\n")) {
                                stack = stack.substring(6);
                            }
                            let err;
                            if(response.code) {
                                err = new DiscordRESTError(req, resp, response, stack);
                            } else {
                                err = new DiscordHTTPError(req, resp, response, stack);
                            }
                            reject(err);
                            return;
                        }

                        if(response.length > 0) {
                            if(resp.headers["content-type"] === "application/json") {
                                try {
                                    response = JSON.parse(response);
                                } catch(err) {
                                    reject(err);
                                    return;
                                }
                            }
                        }

                        resolve(response);
                    });
                });

                req.setTimeout(this.options.requestTimeout, () => {
                    reqError = new Error(`Request timed out (>${this.options.requestTimeout}ms) on ${method} ${url}`);
                    req.abort();
                });

                if(Array.isArray(data)) {
                    for(const chunk of data) {
                        req.write(chunk);
                    }
                    req.end();
                } else {
                    req.end(data);
                }
            };

            let self = this;
            async function waitForRateLimit() {
                let bucketRow = dbGet(self.dbBucketFetch, {ROUTE: route});
                let bucket = bucketRow ? bucketRow.bucket : route;

                while (true) {
                    let now = Date.now();

                    // Check for a global limit
                    let globalLimit = dbGet(self.dbRateLimitFetch, {BUCKET: "global"});
                    if (globalLimit && globalLimit.reset > now) {
                        // Wait for global reset
                        await new Promise(res => {
                            setTimeout(res, globalLimit.reset - now);
                        });
                        continue;
                    }

                    // Then check for a local limit
                    dbRun(self.dbRateLimitInit, {BUCKET: bucket, RESET: now});
                    let rateLimitRow = dbGet(self.dbRateLimitFetch, {BUCKET: bucket});
                    if (!rateLimitRow) break;

                    if (rateLimitRow.remaining === 0 && rateLimitRow.reset > now) {
                        // Need to wait for the reset
                        await new Promise(res => {
                            setTimeout(res, rateLimitRow.reset - now);
                        });
                        continue;
                    }

                    // There's either remaining slots or it's been reset, so try to claim it
                    let next = {
                        BUCKET: bucket,
                        COUNTER: rateLimitRow.counter,
                        NEXT_COUNTER: ~~(rateLimitRow.counter+1)
                    };
                    if (rateLimitRow.remaining) {
                        next.REMAINING = rateLimitRow.remaining - 1;
                        next.RESET = rateLimitRow.reset;
                    } else {
                        next.REMAINING = 0;
                        next.RESET = now + 250;
                    }
                    let res = dbRun(self.dbRateLimitTake, next);
                    if (!res.changes) {
                        // Somebody else got here first
                        continue;
                    }

                    break;
                }
            }

            waitForRateLimit().then(actualCall);
        });
    }
}

module.exports = ShardedRequestHandler;