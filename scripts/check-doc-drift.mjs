#!/usr/bin/env node
// Doc-drift check. Fails if "load-bearing" source files changed without
// any of README.md / CLAUDE.md / WORKSTREAMS.md being touched in the same range.
//
// Usage:
//   node scripts/check-doc-drift.mjs                  # check HEAD vs origin/main
//   node scripts/check-doc-drift.mjs <base> <head>    # custom range
//   node scripts/check-doc-drift.mjs --staged         # check currently-staged changes
//
// Bypass: set CHECK_DOC_DRIFT=skip in the environment, or pass --no-verify to git.
// Exits 0 = clean, 1 = drift detected.

import { execFileSync } from 'node:child_process';

const DOC_FILES = ['README.md', 'CLAUDE.md', 'WORKSTREAMS.md'];

// (sourceFilePath, requiredDocs[]). At least one of requiredDocs must also
// change. Use exact paths or simple `startsWith` prefixes ending in '/'.
const RULES = [
  { source: 'lib/pipeline/scoring.js',           requires: ['README.md', 'CLAUDE.md'] },
  { source: 'lib/pipeline/firecrawl-extract.js', requires: ['README.md', 'CLAUDE.md'] },
  { source: 'lib/types/lot.js',                  requires: ['CLAUDE.md', 'WORKSTREAMS.md'] },
  { source: 'lib/harness/',                      requires: ['README.md', 'CLAUDE.md'] },
  { source: 'package.json',                      requires: ['README.md'] },
  { source: 'migrations/',                       requires: ['WORKSTREAMS.md', 'CLAUDE.md'] },
];

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function safeGit(...args) {
  try { return git(...args); } catch { return ''; }
}

function getChangedFiles(args) {
  if (args[0] === '--staged') {
    return safeGit('diff', '--cached', '--name-only').split('\n').filter(Boolean);
  }
  let base = args[0];
  const head = args[1] || 'HEAD';
  if (!base) {
    if (safeGit('rev-parse', '--verify', 'origin/main')) base = 'origin/main';
    else if (safeGit('rev-parse', '--verify', 'main')) base = 'main';
    else {
      console.log('[doc-drift] no base branch found; skipping');
      process.exit(0);
    }
  }
  return safeGit('diff', '--name-only', `${base}...${head}`).split('\n').filter(Boolean);
}

function matches(file, rule) {
  return rule.source.endsWith('/') ? file.startsWith(rule.source) : file === rule.source;
}

function main() {
  if (process.env.CHECK_DOC_DRIFT === 'skip') {
    console.log('[doc-drift] CHECK_DOC_DRIFT=skip — skipping');
    process.exit(0);
  }

  const args = process.argv.slice(2);
  const changed = getChangedFiles(args);
  if (changed.length === 0) {
    console.log('[doc-drift] no changes in range — skipping');
    process.exit(0);
  }

  const touchedDocs = new Set(changed.filter((f) => DOC_FILES.includes(f)));
  const violations = [];

  for (const rule of RULES) {
    const triggered = changed.filter((f) => matches(f, rule));
    if (triggered.length === 0) continue;
    const satisfied = rule.requires.some((d) => touchedDocs.has(d));
    if (!satisfied) {
      violations.push({ source: rule.source, changed: triggered, requires: rule.requires });
    }
  }

  if (violations.length === 0) {
    console.log(`[doc-drift] OK (${changed.length} files changed, ${touchedDocs.size} doc(s) touched)`);
    process.exit(0);
  }

  console.error('');
  console.error('[doc-drift] DRIFT DETECTED — load-bearing files changed without updating docs:');
  console.error('');
  for (const v of violations) {
    console.error(`  • ${v.source}`);
    for (const f of v.changed) console.error(`      changed: ${f}`);
    console.error(`      requires touching one of: ${v.requires.join(', ')}`);
  }
  console.error('');
  console.error('Fix: update the relevant doc(s), or bypass with one of:');
  console.error('  - git push --no-verify');
  console.error('  - CHECK_DOC_DRIFT=skip git push');
  console.error('');
  process.exit(1);
}

main();
