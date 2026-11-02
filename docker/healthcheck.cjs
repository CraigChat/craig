// Usage: node healthcheck.cjs <service>. Exits non-zero if the service's health endpoint isn't OK.
const services = require('./services.cjs');

const name = process.argv[2];
const url = Object.hasOwn(services, name) ? services[name].healthUrl : null;
if (!url) {
  console.error(`Service "${name}" has no health endpoint`);
  process.exit(1);
}

fetch(url, { signal: AbortSignal.timeout(5000) })
  .then((response) => {
    if (!response.ok) {
      console.error(`${name} healthcheck failed with ${response.status}`);
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
