#!/usr/bin/env node
// Reports exported symbols under src/ that are referenced nowhere outside the file that
// declares them (a *.test.ts import counts as an outside reference; a plain usage within the
// declaring file does not), and CSS classes under src/ that are referenced nowhere outside the
// stylesheet that declares them. Such an export should lose its `export` keyword, and such a
// class should be deleted — CLAUDE.md's "Automate over repeating" rule for keeping the exported
// and styled surface from growing back silently.
//
// No dependency beyond Node's standard library, per CLAUDE.md's "Minimal dependency surface".

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(import.meta.dirname, '..', 'src');

const EXPORT_DECL = /^export\s+(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(const|function|class|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;
const EXPORT_DEFAULT = /^export\s+default\b/;

function listSourceFiles(dir, extensionPattern) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(full, extensionPattern));
    } else if (extensionPattern.test(entry)) {
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

// Class names come only from selector text, never property values or comments — a plain
// `[^{}]+` scan otherwise turns `/* .foo */` or `content: '.5rem'`-style values into fake
// selectors, since it has no idea which side of a `{` it's looking at.
function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

const CLASS_TOKEN = /\.([A-Za-z_-][A-Za-z0-9_-]*)/g;

function findCssClasses(file, text) {
  const found = [];
  const withoutComments = stripCssComments(text);
  const selectorBlocks = withoutComments.match(/[^{}]+(?=\{)/g) ?? [];
  for (const selector of selectorBlocks) {
    for (const match of selector.matchAll(CLASS_TOKEN)) {
      found.push({ file, name: match[1] });
    }
  }
  return found;
}

// A class built from a dynamic prefix (`` `${classPrefix}__svg` ``) never appears verbatim
// anywhere, so the plain word-boundary check below always calls it dead. Treat a class as used
// if its BEM element/modifier suffix (the part from the last `__` or `--` on) shows up right
// after a template-literal interpolation close, e.g. `` }__svg` `` or `` }--left` ``.
function referencedAsTemplateSuffix(name, declaringFile, files, contents) {
  const lastSeparator = Math.max(name.lastIndexOf('__'), name.lastIndexOf('--'));
  if (lastSeparator <= 0) return false;
  const suffix = name.slice(lastSeparator);
  const suffixPattern = new RegExp(`\\}${suffix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}[\`"']`);
  for (const file of files) {
    if (file === declaringFile) continue;
    if (suffixPattern.test(contents.get(file))) return true;
  }
  return false;
}

function referencedOutsideOwnFile(name, declaringFile, files, contents) {
  const wordPattern = new RegExp(`\\b${name}\\b`);
  for (const file of files) {
    if (file === declaringFile) continue;
    if (wordPattern.test(contents.get(file))) return true;
  }
  return false;
}

const tsFiles = listSourceFiles(SRC_ROOT, /\.(ts|tsx)$/);
const cssFiles = listSourceFiles(SRC_ROOT, /\.css$/);
const allFiles = [...tsFiles, ...cssFiles];
const contents = new Map(allFiles.map((file) => [file, readFileSync(file, 'utf8')]));

const allExports = tsFiles.flatMap((file) => findExports(file, contents.get(file)));
const deadExports = allExports.filter(
  ({ name, file }) => !referencedOutsideOwnFile(name, file, allFiles, contents),
);

const allClasses = cssFiles.flatMap((file) => findCssClasses(file, contents.get(file)));
const deadClasses = allClasses.filter(
  ({ name, file }) =>
    !referencedOutsideOwnFile(name, file, allFiles, contents) &&
    !referencedAsTemplateSuffix(name, file, allFiles, contents),
);

if (deadExports.length === 0 && deadClasses.length === 0) {
  console.log(
    `dead-exports: checked ${allExports.length} exports across ${tsFiles.length} files and ` +
      `${allClasses.length} CSS classes across ${cssFiles.length} files, none dead.`,
  );
  process.exit(0);
}

if (deadExports.length > 0) {
  console.error(`dead-exports: ${deadExports.length} export(s) referenced nowhere outside their declaring file:\n`);
  for (const { file, name } of deadExports) {
    console.error(`  ${name}  (${relative(process.cwd(), file)})`);
  }
  console.error('\nRemove `export` from these (or delete them if truly unused) — see CLAUDE.md.');
}

if (deadClasses.length > 0) {
  if (deadExports.length > 0) console.error('');
  console.error(`dead-exports: ${deadClasses.length} CSS class(es) referenced nowhere outside their declaring stylesheet:\n`);
  for (const { file, name } of deadClasses) {
    console.error(`  .${name}  (${relative(process.cwd(), file)})`);
  }
  console.error('\nDelete these rules, or fix the reference if the class is actually used.');
}

process.exit(1);
