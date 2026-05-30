import { RECOMMENDED_NODE_MAJOR, assertSqliteReady } from './sqliteHealth.js';

export function runPreflightChecks(argv: string[] = process.argv): void {
  checkNodeVersion();
  assertSqliteReady(argv);
}

function checkNodeVersion(): void {
  const major = Number(process.versions.node.split('.')[0]);
  if (Number.isNaN(major) || major < RECOMMENDED_NODE_MAJOR) {
    console.error(
      `[error] Node.js ${RECOMMENDED_NODE_MAJOR}+ is required. Current: ${process.version}`,
    );
    console.error('[error] Install Node 22 LTS and run: npm install');
    console.error('[error] See .nvmrc and docs/setup.md');
    process.exit(1);
  }

  if (major !== RECOMMENDED_NODE_MAJOR) {
    console.warn(
      `[warn] Node ${process.version} detected (ABI ${process.versions.modules}). Recommended: Node 22 LTS (.nvmrc).`,
    );
    console.warn('[warn] After switching Node versions, run: npm run rebuild:native');
  }
}
