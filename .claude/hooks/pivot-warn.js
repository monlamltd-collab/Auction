#!/usr/bin/env node
// PostToolUse hook: warns when an architectural-pivot file is edited.
// These are the files where a change often invalidates docs in
// CLAUDE.md or .claude/skills/auction-conventions/SKILL.md.

const PIVOT_PATTERNS = [
  /[\\/]lib[\\/]scraper(?:\.js|[\\/])/,
  /[\\/]lib[\\/]pipeline[\\/]/,
  /[\\/]lib[\\/]houses\.js$/,
  /[\\/]lib[\\/]analysis\.js$/,
  /[\\/]lib[\\/]extractors[\\/]/,
];

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
  if (!PIVOT_PATTERNS.some((re) => re.test(filePath))) process.exit(0);

  // Print to stderr so Claude sees it as a hook message but the user-facing
  // tool output stays clean. Non-blocking — exit 0.
  process.stderr.write(
    [
      '',
      '── doc-drift check ──',
      `Pivot file edited: ${filePath}`,
      'This file is one of: lib/scraper, lib/pipeline/, lib/houses.js, lib/analysis.js, lib/extractors/.',
      'A change here often invalidates documentation. Before ending the task, scan:',
      '  - Auction/CLAUDE.md (extraction narrative, env vars, non-negotiables)',
      '  - .claude/skills/auction-conventions/SKILL.md (project tree, conventions, Adding a New Auction House)',
      'If anything is now wrong, fix it in the same change.',
      '',
    ].join('\n')
  );
  process.exit(0);
});
