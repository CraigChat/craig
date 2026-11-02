// Replaces this process with one app from services.cjs, so the app gets Docker's signals directly.
const services = require('./services.cjs');

const name = process.argv[2];
const service = Object.hasOwn(services, name) ? services[name] : null;
if (!service) {
  console.error(`Unknown service "${name}". Expected one of: migrate, ${Object.keys(services).join(', ')}`);
  process.exit(1);
}

process.chdir(`/opt/craig/${name}`);
process.execve(process.execPath, [process.execPath, service.script], { ...process.env, ...service.env });
