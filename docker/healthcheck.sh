#!/bin/sh
set -eu

pm2 jlist | node -e '
const fs = require("node:fs");
const processes = JSON.parse(fs.readFileSync(0, "utf8"));
const expected = new Set(["Craig Bot", "Kitchen", "Ferret", "Ennuizel Streamer", "Craig Dashboard", "Craig Tasks"]);
for (const proc of processes) {
  if (expected.has(proc.name) && proc.pm2_env?.status === "online") expected.delete(proc.name);
}
if (expected.size) {
  console.error(`PM2 processes not online: ${[...expected].join(", ")}`);
  process.exit(1);
}
'

node <<'NODE'
const checks = [
  ['kitchen', 'http://127.0.0.1:9000/health'],
  ['ferret', 'http://127.0.0.1:9100/api/health'],
  ['ennuizel-streamer', 'http://127.0.0.1:9001/health'],
  ['dashboard', 'http://127.0.0.1:9200/api/health']
];

async function main() {
  const timeout = 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    for (const [name, url] of checks) {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        console.error(`${name} healthcheck failed with ${response.status}`);
        process.exit(1);
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
