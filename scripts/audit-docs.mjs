#!/usr/bin/env node
// Read-only doc audit. Produces docs/_audit-YYYY-MM-DD.md listing:
//   - line-cap violations (CLAUDE.md, SKILL.md files)
//   - "RESOLVED" / "DEPRECATED" / strikethrough markers still present
//   - greppable claims that no longer match the codebase
//
// No edits to docs. Human reads the report and decides what to fix.
//
// Run: node scripts/audit-docs.mjs

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const TARGETS = [
  { path: 'CLAUDE.md', cap: 100 },
  { path: '.claude/skills/auction-conventions/SKILL.md', cap: 400 },
  { path: '.claude/skills/auction-self-healing/SKILL.md', cap: 400 },
];

// Greppable claims: each entry asserts something the docs say, paired with a
// check against the live codebase. If the assertion fails, the doc is stale.
const CLAIMS = [
  {
    docClaim: 'CLAUDE.md says lib/scoring.js was deleted',
    check: async () => !existsSync(join(ROOT, 'lib', 'scoring.js')),
    failMessage: 'lib/scoring.js exists again — CLAUDE.md says it was deleted',
  },
  {
    docClaim: 'docs reference lib/pipeline/scoring.js::analyseLot',
    check: async () => {
      try {
        const src = await readFile(join(ROOT, 'lib', 'pipeline', 'scoring.js'), 'utf8');
        return /function\s+analyseLot|export\s+function\s+analyseLot|const\s+analyseLot\s*=/.test(src);
      } catch {
        return false;
      }
    },
    failMessage: 'lib/pipeline/scoring.js or analyseLot is missing',
  },
  {
    docClaim: 'docs reference lib/houses.js HOUSE_ROOTS + HOUSE_DISPLAY_NAMES',
    check: async () => {
      try {
        const src = await readFile(join(ROOT, 'lib', 'houses.js'), 'utf8');
        return /HOUSE_ROOTS/.test(src) && /HOUSE_DISPLAY_NAMES/.test(src);
      } catch {
        return false;
      }
    },
    failMessage: 'HOUSE_ROOTS or HOUSE_DISPLAY_NAMES missing from lib/houses.js',
  },
  {
    docClaim: 'docs reference detectPlatformSentinel + RECALL_SENTINELS (moved to lib/scraper/recall-sentinels.js 2026-06-12)',
    check: async () => {
      try {
        const src = await readFile(join(ROOT, 'lib', 'scraper', 'recall-sentinels.js'), 'utf8');
        return /detectPlatformSentinel/.test(src) && /RECALL_SENTINELS/.test(src);
      } catch {
        return false;
      }
    },
    failMessage: 'detectPlatformSentinel or RECALL_SENTINELS missing from lib/scraper/recall-sentinels.js',
  },
  {
    docClaim: 'docs reference fireAlert single-object signature',
    check: async () => {
      try {
        const src = await readFile(join(ROOT, 'lib', 'harness', 'alert-router.js'), 'utf8');
        return /function\s+fireAlert|export\s+function\s+fireAlert|const\s+fireAlert\s*=/.test(src);
      } catch {
        return false;
      }
    },
    failMessage: 'fireAlert missing from lib/harness/alert-router.js',
  },
];

const STALE_MARKERS = [/\bRESOLVED\b/, /\bDEPRECATED\b/, /~~[^~]+~~/];

const findings = { capViolations: [], staleMarkers: [], claimFailures: [] };

for (const { path, cap } of TARGETS) {
  const abs = join(ROOT, path);
  if (!existsSync(abs)) continue;
  const content = await readFile(abs, 'utf8');
  const lines = content.split('\n');
  if (lines.length > cap) {
    findings.capViolations.push({ path, lines: lines.length, cap });
  }
  lines.forEach((line, i) => {
    for (const re of STALE_MARKERS) {
      if (re.test(line)) findings.staleMarkers.push({ path, line: i + 1, text: line.trim() });
    }
  });
}

for (const claim of CLAIMS) {
  const ok = await claim.check();
  if (!ok) findings.claimFailures.push({ docClaim: claim.docClaim, failMessage: claim.failMessage });
}

const today = new Date().toISOString().slice(0, 10);
const outDir = join(ROOT, 'docs');
await mkdir(outDir, { recursive: true });
const outPath = join(outDir, `_audit-${today}.md`);

const sections = [`# Doc audit — ${today}`, '', '_Read-only report. No docs were modified._', ''];

if (!findings.capViolations.length && !findings.staleMarkers.length && !findings.claimFailures.length) {
  sections.push('All checks passed. Docs look healthy.');
} else {
  if (findings.capViolations.length) {
    sections.push('## Line-cap violations', '');
    for (const v of findings.capViolations) {
      sections.push(`- \`${v.path}\` — ${v.lines} lines (cap ${v.cap}). Trim or move detail to references/.`);
    }
    sections.push('');
  }
  if (findings.staleMarkers.length) {
    sections.push('## Stale markers (RESOLVED / DEPRECATED / strikethrough)', '');
    for (const m of findings.staleMarkers) {
      sections.push(`- \`${m.path}:${m.line}\` — ${m.text}`);
    }
    sections.push('', '_Resolved items should be deleted, not annotated. Git remembers._', '');
  }
  if (findings.claimFailures.length) {
    sections.push('## Greppable doc claims that no longer match the codebase', '');
    for (const c of findings.claimFailures) {
      sections.push(`- ${c.docClaim} — ${c.failMessage}`);
    }
    sections.push('');
  }
}

await writeFile(outPath, sections.join('\n'));
console.log(`Audit report written: ${relative(ROOT, outPath)}`);
console.log(
  `  cap violations: ${findings.capViolations.length}, stale markers: ${findings.staleMarkers.length}, claim failures: ${findings.claimFailures.length}`
);
