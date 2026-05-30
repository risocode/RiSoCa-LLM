export function buildUnifiedDiff(before: string, after: string, filename: string): string {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');

  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const oldStart = prefix;
  const oldEnd = oldLines.length - suffix;
  const newStart = prefix;
  const newEnd = newLines.length - suffix;

  const oldCount = Math.max(oldEnd - oldStart, 0);
  const newCount = Math.max(newEnd - newStart, 0);
  const oldHunk = oldCount === 0 ? 0 : oldStart + 1;
  const newHunk = newCount === 0 ? 0 : newStart + 1;

  const header = [`--- a/${filename}`, `+++ b/${filename}`, `@@ -${oldHunk},${oldCount} +${newHunk},${newCount} @@`];
  const body: string[] = [];

  for (let i = oldStart; i < oldEnd; i++) {
    body.push(`-${oldLines[i] ?? ''}`);
  }
  for (let i = newStart; i < newEnd; i++) {
    body.push(`+${newLines[i] ?? ''}`);
  }

  if (body.length === 0) {
    body.push(' (no line changes)');
  }

  return [...header, ...body].join('\n');
}
