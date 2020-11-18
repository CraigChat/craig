#!/usr/bin/env node
const njsp = require("nodejs-server-pages");
var root = {
    "default": "ws/default"
};
njsp.createWSServer({root});
