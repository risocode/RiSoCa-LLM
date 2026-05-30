import { runPreflightChecks } from './utils/preflight.js';

runPreflightChecks();
console.log(`Preflight OK — Node ${process.version} (ABI ${process.versions.modules})`);
