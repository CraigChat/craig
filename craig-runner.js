#!/usr/bin/env node
const cp = require("child_process");

var craig = null;

function launch(activeRecordings) {
    var me = craig = cp.fork("./craig.js", [], {
        stdio: ["ignore", "inherit", "inherit", "ipc"]
    });

    me.on("message", (val) => {
        if (typeof val !== "object")
            return;
        switch (val.t) {
            case "gracefulRestart":
                launch(val.activeRecordings);
                break;
            case "requestActiveRecordings":
                me.send({t: "activeRecordings", "activeRecordings": activeRecordings});
                break;
            case "gracelessRestart":
                process.exit(0);
                break;
        }
    });

    function relaunch() {
        if (me === craig) {
            craig = null;
            setTimeout(() => { launch(); }, 10000);
        }
    }

    me.on("error", relaunch);
    me.on("exit", relaunch);
}

launch({});
