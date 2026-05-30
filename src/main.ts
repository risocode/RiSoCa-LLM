#!/usr/bin/env node

async function bootstrap(): Promise<void> {
  const argv = process.argv;
  const { runPreflightChecks } = await import('./utils/preflight.js');
  runPreflightChecks(argv);

  const { runCli } = await import('./cli/commands.js');
  await runCli(argv);
}

bootstrap().catch((err) => {
  console.error('[error]', err instanceof Error ? err.message : err);
  process.exit(1);
});
