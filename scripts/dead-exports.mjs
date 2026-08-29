#!/usr/bin/env node
// Reports exported symbols under src/ that are referenced nowhere outside the file that
// declares them (a *.test.ts import counts as an outside reference; a plain usage within the
// declaring file does not). Such an export should lose its `export` keyword — CLAUDE.md's
// "Automate over repeating" rule for keeping the exported surface from growing back silently.
//
// No dependency beyond Node's standard library, per CLAUDE.md's "Minimal dependency surface".

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(import.meta.dirname, '..', 'src');

const EXPORT_DECL = /^export\s+(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(const|function|class|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;
const EXPORT_DEFAULT = /^export\s+default\b/;

function listSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function findExports(file, text) {
  const exported = [];
  const lines = text.split('\n');
  for (const line of lines) {
    if (EXPORT_DEFAULT.test(line)) continue; // default exports aren't matched by import name; exempt.
    const match = EXPORT_DECL.exec(line);
    if (match) {
      exported.push({ file, name: match[2] });
    }
  }
  return exported;
}

function referencedOutsideOwnFile(name, declaringFile, files, contents) {
  const wordPattern = new RegExp(`\\b${name}\\b`);
  for (const file of files) {
    if (file === declaringFile) continue;
    if (wordPattern.test(contents.get(file))) return true;
  }
  return false;
}

const files = listSourceFiles(SRC_ROOT);
const contents = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));

const allExports = files.flatMap((file) => findExports(file, contents.get(file)));

const dead = allExports.filter(
  ({ name, file }) => !referencedOutsideOwnFile(name, file, files, contents),
);

if (dead.length === 0) {
  console.log(`dead-exports: checked ${allExports.length} exports across ${files.length} files, none dead.`);
  process.exit(0);
}

console.error(`dead-exports: ${dead.length} export(s) referenced nowhere outside their declaring file:\n`);
for (const { file, name } of dead) {
  console.error(`  ${name}  (${relative(process.cwd(), file)})`);
}
console.error('\nRemove `export` from these (or delete them if truly unused) — see CLAUDE.md.');
process.exit(1);
