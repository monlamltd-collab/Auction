#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// AUDIT AUTO-FIX + EMAIL REPORT
// Reads audit-results.json, applies safe code fixes to server.js,
// triggers cache refreshes, and emails a health report via Resend.
// ═══════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const AUDIT_RESULTS_PATH = join(PROJECT_ROOT, 'audit-results.json');
const SERVER_JS_PATH = join(PROJECT_ROOT, 'server.js');

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const PROD_URL = process.env.PROD_URL || 'https://auctions.bridgematch.co.uk';
const EMAIL_TO = 'hello@bridgematch.co.uk';

// ═══════════════════════════════════════════════════════════════
// BRACE-BLOCK PARSER (same as audit.mjs)
// ═══════════════════════════════════════════════════════════════

function extractBraceBlock(code, startMarker) {
  const idx = code.indexOf(startMarker);
  if (idx === -1) return null;
  let depth = 0, end = -1;
  for (let i = idx; i < code.length; i++) {
    if (code[i] === '{') depth++;
    if (code[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  return end === -1 ? null : code.substring(idx, end);
}

// ═══════════════════════════════════════════════════════════════
// READ AUDIT RESULTS
// ═══════════════════════════════════════════════════════════════

function readAuditResults() {
  if (!existsSync(AUDIT_RESULTS_PATH)) {
    // Fall back to last-audit.json saved by --save
    const fallback = join(PROJECT_ROOT, 'scripts', 'audit', 'last-audit.json');
    if (existsSync(fallback)) {
      console.log('Using scripts/audit/last-audit.json (no audit-results.json found)');
      return JSON.parse(readFileSync(fallback, 'utf-8'));
    }
    throw new Error('No audit-results.json or scripts/audit/last-audit.json found');
  }

  const raw = readFileSync(AUDIT_RESULTS_PATH, 'utf-8');

  // audit.mjs may mix stderr + JSON in the same file when run with 2>&1
  // Try parsing the whole thing first, then try extracting JSON from the end
  try {
    return JSON.parse(raw);
  } catch {
    // Find the last { ... } block that looks like the JSON output
    const lastBrace = raw.lastIndexOf('\n{');
    if (lastBrace !== -1) {
      try {
        return JSON.parse(raw.substring(lastBrace));
      } catch { /* fall through */ }
    }
    // Try finding first line that starts with {
    for (const line of raw.split('\n')) {
      if (line.trim().startsWith('{')) {
        try { return JSON.parse(raw.substring(raw.indexOf(line))); } catch { /* continue */ }
      }
    }
    throw new Error('Could not parse audit results JSON');
  }
}

// ═══════════════════════════════════════════════════════════════
// CODE FIXES
// ═══════════════════════════════════════════════════════════════

function fixDomainMoved(code, house, newUrl) {
  // Update the URL in HOUSE_ROOTS — match: housename: 'old-url' or housename: "old-url"
  // Pattern: house key followed by a quoted URL
  const pattern = new RegExp(
    `(${house}:\\s*)'[^']+'`,
    'g'
  );
  const newCode = code.replace(pattern, `$1'${newUrl}'`);
  if (newCode === code) {
    // Try double quotes
    const pattern2 = new RegExp(`(${house}:\\s*)"[^"]+"`, 'g');
    const newCode2 = code.replace(pattern2, `$1'${newUrl}'`);
    return newCode2 !== code ? newCode2 : null;
  }
  return newCode;
}

function fixNeedsPuppeteer(code, house) {
  // Find the house's return statement in rewriteUrl() and add preferPuppeteer: true
  // Pattern: if (house === 'housename') { ... return { ... }; }
  // We need to find the return inside the house's if block and add preferPuppeteer

  // First check if it already has preferPuppeteer
  const houseBlock = new RegExp(
    `if\\s*\\(house\\s*===\\s*'${house}'\\)\\s*\\{[^}]*return\\s*\\{([^}]*)\\}`,
    's'
  );
  const match = code.match(houseBlock);
  if (!match) return null;
  if (match[1].includes('preferPuppeteer')) return null; // already set

  // Add preferPuppeteer: true before the closing }
  const returnContent = match[1];
  const newReturn = returnContent.trimEnd().replace(/,?\s*$/, '') + ', preferPuppeteer: true ';
  const newCode = code.replace(match[0], match[0].replace(returnContent, newReturn));
  return newCode !== code ? newCode : null;
}

function removeExtractor(code, house) {
  // Remove a house's entry from DOM_EXTRACTORS
  // Each entry looks like:  housename: `...`,  (possibly spanning many lines)
  // Find the entry start and its closing backtick + comma

  // Strategy: find "  house: `" and then find the matching closing backtick
  const marker = `  ${house}: \``;
  const idx = code.indexOf(marker);
  if (idx === -1) return null;

  const backtickStart = code.indexOf('`', idx + `  ${house}: `.length - 1);
  if (backtickStart === -1) return null;

  // Find matching closing backtick (skip escaped)
  let closeIdx = -1;
  for (let i = backtickStart + 1; i < code.length; i++) {
    if (code[i] === '\\') { i++; continue; }
    if (code[i] === '`') { closeIdx = i; break; }
  }
  if (closeIdx === -1) return null;

  // Include trailing comma and newline if present
  let endIdx = closeIdx + 1;
  if (code[endIdx] === ',') endIdx++;
  if (code[endIdx] === '\n') endIdx++;

  // Also remove comment lines immediately above (like // ─── HOUSE ───)
  let startIdx = idx;
  const beforeEntry = code.substring(Math.max(0, idx - 200), idx);
  const commentLines = beforeEntry.split('\n');
  // Walk backwards from the entry to find adjacent comment lines
  let lineStart = idx;
  while (lineStart > 0 && code[lineStart - 1] !== '\n') lineStart--;
  let checkPos = lineStart - 1;
  while (checkPos > 0) {
    // Find start of previous line
    let prevLineStart = checkPos;
    while (prevLineStart > 0 && code[prevLineStart - 1] !== '\n') prevLineStart--;
    const prevLine = code.substring(prevLineStart, checkPos + 1).trim();
    if (prevLine.startsWith('//') || prevLine === '') {
      startIdx = prevLineStart;
      checkPos = prevLineStart - 1;
    } else {
      break;
    }
  }

  return code.substring(0, startIdx) + code.substring(endIdx);
}

// ═══════════════════════════════════════════════════════════════
// APPLY ALL CODE FIXES
// ═══════════════════════════════════════════════════════════════

function applyCodeFixes(auditData) {
  let code = readFileSync(SERVER_JS_PATH, 'utf-8');
  const originalCode = code;
  const fixes = [];

  for (const r of auditData.results || []) {
    if (!r.issues || r.issues.length === 0) continue;

    for (const issue of r.issues) {
      // DOMAIN_MOVED — update URL in HOUSE_ROOTS
      if (issue.type === 'DOMAIN_MOVED' && r.httpFinalUrl) {
        const result = fixDomainMoved(code, r.house, r.httpFinalUrl);
        if (result) {
          code = result;
          fixes.push({ house: r.house, type: 'DOMAIN_MOVED', detail: `Updated URL to ${r.httpFinalUrl}` });
        }
      }

      // NEEDS_PUPPETEER — add preferPuppeteer: true in rewriteUrl
      if (issue.type === 'NEEDS_PUPPETEER') {
        const result = fixNeedsPuppeteer(code, r.house);
        if (result) {
          code = result;
          fixes.push({ house: r.house, type: 'NEEDS_PUPPETEER', detail: 'Added preferPuppeteer: true' });
        }
      }

      // UNIVERSAL_BETTER + extractorLots=0 — remove broken custom extractor
      if (issue.type === 'UNIVERSAL_BETTER' && r.extractorLots === 0 && r.universalLots >= 5) {
        const result = removeExtractor(code, r.house);
        if (result) {
          code = result;
          fixes.push({ house: r.house, type: 'REMOVE_EXTRACTOR', detail: `Removed broken extractor (universal finds ${r.universalLots} lots)` });
        }
      }
    }
  }

  return { newCode: code, originalCode, fixes, changed: code !== originalCode };
}

// ═══════════════════════════════════════════════════════════════
// VALIDATE SERVER.JS
// ═══════════════════════════════════════════════════════════════

function validateServerJs(code) {
  const errors = [];

  // Check HOUSE_ROOTS parses
  const hrBlock = extractBraceBlock(code, 'const HOUSE_ROOTS = {');
  if (!hrBlock) {
    errors.push('HOUSE_ROOTS block not found');
  } else {
    try {
      new Function(`${hrBlock}; return HOUSE_ROOTS;`)();
    } catch (e) {
      errors.push(`HOUSE_ROOTS parse error: ${e.message}`);
    }
  }

  // Check DOM_EXTRACTORS parses
  const deBlock = extractBraceBlock(code, 'const DOM_EXTRACTORS = {');
  if (!deBlock) {
    errors.push('DOM_EXTRACTORS block not found');
  } else {
    try {
      new Function(`${deBlock}; return DOM_EXTRACTORS;`)();
    } catch (e) {
      errors.push(`DOM_EXTRACTORS parse error: ${e.message}`);
    }
  }

  // Check rewriteUrl parses
  const rwBlock = extractBraceBlock(code, 'function rewriteUrl(url, house) {');
  if (!rwBlock) {
    errors.push('rewriteUrl function not found');
  }

  return errors;
}

// ═══════════════════════════════════════════════════════════════
// RUNTIME FIXES (cache refresh)
// ═══════════════════════════════════════════════════════════════

async function applyRuntimeFixes(auditData) {
  const runtimeFixes = [];
  const needsRefresh = (auditData.results || []).some(r =>
    r.issues?.some(i => i.type === 'CACHE_STALE' || i.type === 'MISSING_FROM_CACHE')
  );

  if (needsRefresh && ADMIN_SECRET) {
    try {
      const resp = await fetch(`${PROD_URL}/api/refresh-cache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: ADMIN_SECRET }),
      });
      if (resp.ok) {
        runtimeFixes.push({ type: 'CACHE_REFRESH', detail: 'Triggered production cache refresh' });
      } else {
        runtimeFixes.push({ type: 'CACHE_REFRESH_FAILED', detail: `HTTP ${resp.status}` });
      }
    } catch (e) {
      runtimeFixes.push({ type: 'CACHE_REFRESH_FAILED', detail: e.message });
    }
  }

  return runtimeFixes;
}

// ═══════════════════════════════════════════════════════════════
// EMAIL REPORT
// ═══════════════════════════════════════════════════════════════

function categoriseResults(auditData) {
  const broken = [], warnings = [], healthy = [];
  for (const r of auditData.results || []) {
    const hasBroken = r.issues?.some(i => i.severity === 'BROKEN');
    const hasWarning = r.issues?.some(i => i.severity === 'WARNING');
    if (hasBroken) broken.push(r);
    else if (hasWarning) warnings.push(r);
    else healthy.push(r);
  }
  return { broken, warnings, healthy };
}

function buildEmailHtml(auditData, codeFixes, runtimeFixes) {
  const { broken, warnings, healthy } = categoriseResults(auditData);
  const date = new Date().toISOString().split('T')[0];

  const s = (label, color) => `style="padding:8px 12px;text-align:left;border-bottom:1px solid #eee;color:${color}"`;
  const badge = (text, bg) => `<span style="display:inline-block;padding:2px 8px;border-radius:4px;background:${bg};color:#fff;font-size:12px;font-weight:600">${text}</span>`;

  let html = `
<div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;max-width:700px;margin:0 auto;background:#f5f7fa;padding:20px">
  <div style="background:linear-gradient(135deg,#1a3a5c,#2a5a8c);padding:20px 24px;border-radius:8px 8px 0 0">
    <span style="color:#fff;font-size:22px;font-weight:700">Auction <span style="color:#8bc34a">Health</span></span>
    <span style="color:#a0b8d0;font-size:14px;float:right;margin-top:6px">${date}</span>
  </div>
  <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px">`;

  // ── Auto-fixes applied ──
  if (codeFixes.length > 0 || runtimeFixes.length > 0) {
    html += `
    <h2 style="color:#2e7d32;margin:0 0 12px">Auto-Fixes Applied</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">
      <tr style="background:#e8f5e9"><th ${s('House','#1b5e20')}>House</th><th ${s('Fix','#1b5e20')}>Fix</th><th ${s('Detail','#1b5e20')}>Detail</th></tr>`;
    for (const f of [...codeFixes, ...runtimeFixes]) {
      html += `<tr><td ${s(f.house || '—','#333')}>${f.house || '—'}</td><td ${s('','#333')}>${badge(f.type, '#4caf50')}</td><td ${s('','#555')}>${f.detail}</td></tr>`;
    }
    html += `</table>`;
  }

  // ── Broken houses ──
  if (broken.length > 0) {
    html += `
    <h2 style="color:#c0392b;margin:0 0 12px">Broken — Needs Human Attention (${broken.length})</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">
      <tr style="background:#fdecea"><th ${s('House','#c0392b')}>House</th><th ${s('Issues','#c0392b')}>Issues</th></tr>`;
    for (const r of broken) {
      const issueList = r.issues.filter(i => i.severity === 'BROKEN').map(i => `${badge(i.type, '#e53935')} ${i.detail}`).join('<br>');
      html += `<tr><td ${s('','#333')}><strong>${r.house}</strong></td><td ${s('','#555')}>${issueList}</td></tr>`;
    }
    html += `</table>`;
  }

  // ── Warnings ──
  if (warnings.length > 0) {
    html += `
    <h2 style="color:#e67e22;margin:0 0 12px">Warnings (${warnings.length})</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">
      <tr style="background:#fff8e1"><th ${s('House','#e65100')}>House</th><th ${s('Issues','#e65100')}>Issues</th></tr>`;
    for (const r of warnings) {
      const issueList = r.issues.filter(i => i.severity === 'WARNING').map(i => `${badge(i.type, '#fb8c00')} ${i.detail}`).join('<br>');
      html += `<tr><td ${s('','#333')}><strong>${r.house}</strong></td><td ${s('','#555')}>${issueList}</td></tr>`;
    }
    html += `</table>`;
  }

  // ── Healthy summary ──
  html += `
    <details style="margin-bottom:16px">
      <summary style="cursor:pointer;color:#2e7d32;font-weight:700;font-size:16px;margin-bottom:8px">
        Healthy Houses (${healthy.length})
      </summary>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr style="background:#e8f5e9"><th ${s('House','#1b5e20')}>House</th><th ${s('Lots','#1b5e20')}>Lots</th><th ${s('Images','#1b5e20')}>Img %</th></tr>`;
  for (const r of healthy) {
    html += `<tr><td ${s('','#333')}>${r.house}</td><td ${s('','#333')}>${r.extractorLots ?? '—'}</td><td ${s('','#333')}>${r.imgCoverage != null ? r.imgCoverage + '%' : '—'}</td></tr>`;
  }
  html += `</table></details>`;

  // ── Production stats ──
  if (auditData.production) {
    html += `
    <div style="background:#f0f4f8;padding:12px 16px;border-radius:6px;font-size:14px;color:#333">
      <strong>Production cache:</strong> ${auditData.production.total} lots across ${auditData.production.houses} houses
    </div>`;
  }

  html += `
    <p style="color:#999;font-size:12px;margin-top:20px">
      Generated by Auction Health Bot &middot; ${auditData.elapsed || ''}
    </p>
  </div>
</div>`;

  return html;
}

async function sendEmailReport(auditData, codeFixes, runtimeFixes) {
  if (!RESEND_API_KEY) {
    console.log('RESEND_API_KEY not set — skipping email');
    return;
  }

  const { broken, warnings, healthy } = categoriseResults(auditData);
  const date = new Date().toISOString().split('T')[0];
  const subject = `Auction Health: ${broken.length} broken, ${warnings.length} warnings, ${healthy.length} healthy — ${date}`;
  const html = buildEmailHtml(auditData, codeFixes, runtimeFixes);

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Auction Health Bot <hello@bridgematch.co.uk>',
        to: [EMAIL_TO],
        subject,
        html,
      }),
    });

    if (resp.ok) {
      console.log(`Email sent to ${EMAIL_TO}`);
    } else {
      const body = await resp.text();
      console.error(`Email failed: ${resp.status} — ${body}`);
    }
  } catch (e) {
    console.error(`Email error: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('─── Audit Auto-Fix ───');

  // 1. Read audit results
  let auditData;
  try {
    auditData = readAuditResults();
    console.log(`Loaded ${auditData.results?.length || 0} house results`);
  } catch (e) {
    console.error(`Failed to read audit results: ${e.message}`);
    // Still try to send a failure notification email
    if (RESEND_API_KEY) {
      await sendEmailReport(
        { results: [], production: null, elapsed: '0s' },
        [],
        [{ type: 'AUDIT_FAILED', detail: e.message }]
      );
    }
    process.exit(1);
  }

  // 2. Apply code fixes to server.js
  let codeFixes = [];
  const { newCode, originalCode, fixes, changed } = applyCodeFixes(auditData);
  codeFixes = fixes;

  if (changed) {
    // Validate before writing
    const errors = validateServerJs(newCode);
    if (errors.length > 0) {
      console.error('Validation failed after code fixes — reverting:');
      errors.forEach(e => console.error(`  - ${e}`));
      codeFixes = codeFixes.map(f => ({ ...f, detail: `REVERTED: ${f.detail}` }));
    } else {
      writeFileSync(SERVER_JS_PATH, newCode, 'utf-8');
      console.log(`Applied ${fixes.length} code fix(es) to server.js`);
      for (const f of fixes) {
        console.log(`  ✓ ${f.house}: ${f.type} — ${f.detail}`);
      }
    }
  } else {
    console.log('No code fixes needed');
  }

  // 3. Runtime fixes (cache refresh)
  const runtimeFixes = await applyRuntimeFixes(auditData);
  for (const f of runtimeFixes) {
    console.log(`  ✓ ${f.type} — ${f.detail}`);
  }

  // 4. Send email report
  await sendEmailReport(auditData, codeFixes, runtimeFixes);

  console.log('─── Done ───');
}

main().catch(err => {
  console.error('FATAL:', err.message, err.stack);
  process.exit(1);
});
