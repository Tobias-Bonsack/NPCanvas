#!/usr/bin/env node
// Tripwire, not a style rule (see CLAUDE.md § Comment budget): catches the aggregate
// comment-line ratio creeping back up, one file at a time. It does not judge whether any
// single comment is justified — that judgement is the writing session's, per CLAUDE.md.
//
// No dependency beyond Node's standard library, per CLAUDE.md § Dependencies.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(import.meta.dirname, '..', 'src');
const THRESHOLD = 0.15;

// A file under this many lines is cheap to read regardless of its comment fraction — one
// justified paragraph on a short file can legitimately clear 15% without the file being a
// reading-cost problem. Below this floor a file is still measured and printed, just not gated.
const SIZE_FLOOR = 100;

// Density here is structural (the comment *is* the content) or the file is the project's
// specification / its only hand-written validation, where CLAUDE.md itself asks for one line
// of rationale per field, version, or rejection branch. Each entry: relative path -> reason.
const EXCEPTIONS = new Map([
  ['assert-never.ts', 'four lines of code, three of them the assertion message'],
  ['capture/display-media.d.ts', 'a .d.ts augmentation — the comment is the content'],
  ['storage/file-system-access.d.ts', 'a .d.ts augmentation — the comment is the content'],
  ['vite-env.d.ts', 'a one-line triple-slash reference — the comment is the content'],
  ['project/types.ts', 'the project specification — one line of rationale per field/version'],
  ['project/data-file.ts', 'the only hand-written validation — one line per rejection branch'],
  ['capture/GlyphSet.tsx', 'names every self-correction and undo-coalescing rule the learner depends on'],
  ['capture/capture-to-dialogue.ts', 'the capture-to-document boundary — each branch has a non-obvious reason'],
  ['capture/GlyphLearner.tsx', 'names the three distinct cancel/keep contracts its callers rely on'],
  ['capture/capture-watch.ts', 'the only concurrent writer — nearly every line names a race a reader could reintroduce'],
]);

function listSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

function countCommentLines(text) {
  return text.split('\n').filter((line) => /^\s*(\/\/|\/\*|\*)/.test(line)).length;
}

const files = listSourceFiles(SRC_ROOT).sort();
const rows = files.map((file) => {
  const text = readFileSync(file, 'utf8');
  const total = text.split('\n').length;
  const comment = countCommentLines(text);
  const relPath = relative(SRC_ROOT, file).replaceAll('\\', '/');
  return { file, relPath, total, comment, ratio: comment / total };
});

const totalLines = rows.reduce((sum, row) => sum + row.total, 0);
const totalComment = rows.reduce((sum, row) => sum + row.comment, 0);

const sorted = [...rows].sort((a, b) => b.ratio - a.ratio);
console.log('ratio   comment/total  file');
for (const row of sorted) {
  console.log(`${(row.ratio * 100).toFixed(1).padStart(5)}%  ${`${row.comment}/${row.total}`.padStart(11)}  ${row.relPath}`);
}
console.log(`\nsrc/ total: ${totalComment}/${totalLines} = ${((totalComment / totalLines) * 100).toFixed(1)}%`);

const failures = rows.filter(
  (row) => row.total >= SIZE_FLOOR && row.ratio > THRESHOLD && !EXCEPTIONS.has(row.relPath),
);

if (failures.length === 0) {
  console.log(`\ncomment-budget: all files at or under ${THRESHOLD * 100}% (or under ${SIZE_FLOOR} lines, or excepted).`);
  process.exit(0);
}

console.error(`\ncomment-budget: ${failures.length} file(s) over ${THRESHOLD * 100}%:\n`);
for (const row of failures) {
  console.error(`  ${(row.ratio * 100).toFixed(1)}%  ${row.relPath}`);
}
console.error('\nTrim per CLAUDE.md § Comment budget, or add a one-line reason to EXCEPTIONS in this script.');
process.exit(1);
