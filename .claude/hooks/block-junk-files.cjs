#!/usr/bin/env node
// PreToolUse hook: blocks two classes of file-creation mistakes.
//
// 1. Junk filenames — shell-fragment names like `!curr.has(u))` or
//    `setPreview(r.result)` created by broken redirects/quoting. Dozens of
//    these accumulated at the repo root before this guard existed.
// 2. New files at the repo root — CLAUDE.md rule: working files, tests and
//    docs never live at root. Editing existing root files stays allowed.
//
// Exit 2 blocks the tool call and feeds stderr back to Claude.

const fs = require('fs');
const path = require('path');

// Characters that never appear in a legitimate filename in this repo but
// always appear in shell-fragment junk.
const JUNK_CHARS = /[(){}\[\]!$`'";,|<>*?=]/;

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    process.exit(0);
  }

  const filePath = payload?.tool_input?.file_path || '';
  if (!filePath) process.exit(0);

  const base = path.basename(filePath);

  if (JUNK_CHARS.test(base)) {
    process.stderr.write(
      `BLOCKED: "${base}" looks like a shell-fragment junk filename ` +
        `(contains ${JUNK_CHARS.source} characters). This is almost always a ` +
        `broken redirect or quoting error. Fix the command instead of ` +
        `creating this file.\n`,
    );
    process.exit(2);
  }

  // New-file-at-root guard (only Write can create files; Edit needs an
  // existing file, so it passes the existsSync check automatically).
  const root = process.env.CLAUDE_PROJECT_DIR;
  if (!root) process.exit(0);

  const resolved = path.resolve(filePath);
  const atRoot = path.dirname(resolved).toLowerCase() === path.resolve(root).toLowerCase();
  if (atRoot && !fs.existsSync(resolved)) {
    process.stderr.write(
      `BLOCKED: creating new file "${base}" at the repo root. CLAUDE.md: ` +
        `working files never live at root — use lib/, routes/, tests/, docs/, ` +
        `scripts/, or the session scratchpad for temporary output. If this ` +
        `root file is genuinely intended (rare), ask the user to confirm first.\n`,
    );
    process.exit(2);
  }

  process.exit(0);
});
