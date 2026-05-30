import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanProject } from '../src/scanner/projectScanner.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'minimal-project');

describe('projectScanner', () => {
  it('scans fixture project and produces health report fields', async () => {
    const { scan, projectMap } = await scanProject(FIXTURE);

    expect(scan.name).toBe('minimal-project');
    expect(scan.fileCount).toBeGreaterThan(0);
    expect(scan.healthScore).toBeGreaterThanOrEqual(0);
    expect(scan.healthScore).toBeLessThanOrEqual(100);
    expect(scan.stack.languages).toContain('TypeScript');
    expect(scan.frameworks.frameworks).toContain('Express');
    expect(projectMap.files.length).toBe(scan.fileCount);
    expect(projectMap.stats.fileCount).toBe(scan.fileCount);
  });

  it('does not index .env files', async () => {
    const { projectMap } = await scanProject(FIXTURE);
    const envFiles = projectMap.files.filter((f) => f.path.includes('.env'));
    expect(envFiles.length).toBe(0);
  });
});
