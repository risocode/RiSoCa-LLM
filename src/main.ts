#!/usr/bin/env node
import { runCli } from './cli/commands.js';

runCli(process.argv).catch((err) => {
  console.error('[error]', err instanceof Error ? err.message : err);
  process.exit(1);
});
