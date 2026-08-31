#!/usr/bin/env node
// Tripwire, not a style rule (see M21's own goal): catches src/ growing back past what this
// milestone cut it to, one top-level directory at a time. It does not judge whether any single
// line is justified — only that the aggregate stays inside room for one ordinary feature
// milestone before the next one has to argue for more.
//
// No dependency beyond Node's standard library, per CLAUDE.md § Dependencies.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC_ROOT = join(import.meta.dirname, '..', 'src');

// Each ceiling is the directory's line count once M21 landed, plus headroom for one ordinary
// feature milestone in that area — enough that a normal feature does not trip the check, not so
// much that two milestones in a row could land unnoticed. `map` and `capture` get the largest
// headroom: they are the two busiest directories and the ones most likely to host the next
// feature. `(root)` is the handful of files directly under src/, not in any feature directory.
const CEILINGS = new Map([
  ['map', { ceiling: 8000, note: '~770 lines of headroom — the busiest directory' }],
  ['capture', { ceiling: 7900, note: '~750 lines of headroom — the other busiest directory' }],
  ['project', { ceiling: 5800, note: '~540 lines of headroom — the schema and reducer' }],
  ['insights', { ceiling: 3900, note: '~430 lines of headroom' }],
  ['cinema', { ceiling: 3200, note: "M22's new feature directory — room for the whole milestone" }],
  ['dialogue', { ceiling: 2700, note: '~390 lines of headroom' }],
  ['app', { ceiling: 1850, note: '~280 lines of headroom — mostly shell chrome' }],
  ['storage', { ceiling: 1300, note: '~200 lines of headroom' }],
  ['quest', { ceiling: 1250, note: '~210 lines of headroom' }],
  ['media', { ceiling: 850, note: '~160 lines of headroom' }],
  ['search', { ceiling: 700, note: '~150 lines of headroom' }],
  ['dialogue-row', { ceiling: 450, note: '~140 lines of headroom — one shared row/picker' }],
  ['settings', { ceiling: 400, note: '~130 lines of headroom' }],
  ['(root)', { ceiling: 1100, note: '~170 lines of headroom — files with no feature directory' }],
]);

// The sum of the ceilings above, checked separately so a reader sees the milestone's own
// promise (src/ stays well under its pre-M21 size) rather than only per-directory numbers.
const TOTAL_CEILING = 39400;

function listSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx|css)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function countLines(text) {
  // A trailing newline must not count as an extra line — every file here ends with one.
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
}

function topLevelDir(file) {
  const rel = relative(SRC_ROOT, file);
  const first = rel.split(sep)[0];
  return first === rel ? '(root)' : first;
}

const files = listSourceFiles(SRC_ROOT);
const byDir = new Map();
for (const file of files) {
  const dir = topLevelDir(file);
  const lines = countLines(readFileSync(file, 'utf8'));
  const row = byDir.get(dir) ?? { lines: 0, files: 0 };
  row.lines += lines;
  row.files += 1;
  byDir.set(dir, row);
}

const totalLines = [...byDir.values()].reduce((sum, row) => sum + row.lines, 0);
const totalFiles = [...byDir.values()].reduce((sum, row) => sum + row.files, 0);

const sorted = [...byDir.entries()].sort((a, b) => b[1].lines - a[1].lines);
console.log('lines   files  dir');
for (const [dir, row] of sorted) {
  console.log(`${String(row.lines).padStart(5)}  ${String(row.files).padStart(5)}  ${dir}`);
}
console.log(`\nsrc/ total: ${totalLines} lines, ${totalFiles} files`);

const failures = [];
for (const [dir, row] of sorted) {
  const budget = CEILINGS.get(dir);
  if (budget !== undefined && row.lines > budget.ceiling) {
    failures.push(`  ${dir}: ${row.lines} lines, ceiling ${budget.ceiling}`);
  }
}
if (totalLines > TOTAL_CEILING) {
  failures.push(`  (total): ${totalLines} lines, ceiling ${TOTAL_CEILING}`);
}

if (failures.length === 0) {
  console.log('\nline-budget: every directory and the total are within their ceilings.');
  process.exit(0);
}

console.error(`\nline-budget: ${failures.length} ceiling(s) exceeded:\n`);
for (const failure of failures) console.error(failure);
process.exit(1);
