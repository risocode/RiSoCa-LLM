import { execSync } from 'node:child_process';

const nodeVersion = process.version;
const abi = process.versions.modules;

console.log(`[risoca] Rebuilding native modules for Node ${nodeVersion} (ABI ${abi})...`);

try {
  execSync('npm rebuild better-sqlite3', {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  console.log('[risoca] Native modules rebuilt successfully.');
} catch {
  console.error('[risoca] Failed to rebuild better-sqlite3.');
  console.error('[risoca] Ensure build tools are installed, then run: npm run rebuild:native');
  process.exit(1);
}
