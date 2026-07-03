#!/usr/bin/env node
// PostToolUse hook: after editing a lib/ module or a test file, run the
// 1:1-named test (lib/pipeline/scoring.js -> tests/test-scoring.js) so
// regressions surface immediately instead of at the 76-command `npm test`.
//
// Silent when no matching test exists or the test passes. On failure,
// exit 2 feeds the tail of the output back to Claude.
//
// Escape hatch: set CLAUDE_SKIP_TEST_HOOK=1 to disable.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

if (process.env.CLAUDE_SKIP_TEST_HOOK) process.exit(0);

const TIMEOUT_MS = 90_000;

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
  const root = process.env.CLAUDE_PROJECT_DIR;
  if (!filePath || !root || !filePath.endsWith('.js')) process.exit(0);

  const rel = path.relative(root, path.resolve(filePath)).replace(/\\/g, '/');
  if (rel.startsWith('..')) process.exit(0); // outside the repo (worktrees etc.)

  let testFile = null;
  const testMatch = rel.match(/^tests\/(test-[\w.-]+\.js)$/);
  if (testMatch) {
    testFile = path.join(root, 'tests', testMatch[1]);
  } else if (rel.startsWith('lib/')) {
    const name = path.basename(rel, '.js');
    const candidate = path.join(root, 'tests', `test-${name}.js`);
    if (fs.existsSync(candidate)) testFile = candidate;
  }
  if (!testFile || !fs.existsSync(testFile)) process.exit(0);

  const res = spawnSync('node', [testFile], {
    cwd: root,
    timeout: TIMEOUT_MS,
    encoding: 'utf8',
  });

  if (res.error && res.error.code === 'ETIMEDOUT') {
    process.stderr.write(
      `test hook: ${path.basename(testFile)} exceeded ${TIMEOUT_MS / 1000}s — ` +
        `skipped (not a failure). Run it manually if this edit could affect it.\n`,
    );
    process.exit(0);
  }

  if (res.status === 0) process.exit(0);

  const tail = ((res.stdout || '') + '\n' + (res.stderr || ''))
    .trim()
    .split('\n')
    .slice(-40)
    .join('\n');
  process.stderr.write(
    `TEST FAILED after this edit: node tests/${path.basename(testFile)} ` +
      `(exit ${res.status})\n${tail}\n`,
  );
  process.exit(2);
});
