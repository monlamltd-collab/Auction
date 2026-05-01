#!/usr/bin/env node
/**
 * Visual Audit ("Human-Eye" Auditor)
 * ===================================
 * Programmatic detection of issues a human would spot while scrolling pages
 * of lots. Runs SQL-side heuristics across all houses in seconds; flags
 * things like hero-image bleed, slug-case duplication, town-only addresses,
 * identical-price walls, Guide-TBA walls, bullet starvation, image-coverage
 * dips, image-domain mismatch, stale-lot walls, duplicate-address walls,
 * cross-house URL leaks, retired-slug stragglers.
 *
 * Each finding maps to a real incident pattern caught by hand-scrolling
 * (see plan: streamed-greeting-fountain.md). Findings are written to
 *   audits/visual-audit-{ISO-date}.md
 * and (optionally) upserted as pipeline_alerts (event_type:
 * 'visual_audit_issue') so the next /heal session opens with them queued.
 *
 * Usage:
 *   node scripts/visual-audit.mjs                   # Full audit, write report + alerts
 *   node scripts/visual-audit.mjs --dry-run         # No alert writes (report only)
 *   node scripts/visual-audit.mjs --no-report       # Skip report file (alerts only)
 *   node scripts/visual-audit.mjs --house stags     # Single house
 *   node scripts/visual-audit.mjs --json            # Machine-readable JSON to stdout
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../lib/supabase.js';
import { HOUSE_ROOTS } from '../lib/houses.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const AUDIT_DIR = join(PROJECT_ROOT, 'audits');

// ── CLI args ──
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const param = (n) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};
const DRY_RUN = flag('dry-run');
const NO_REPORT = flag('no-report');
const JSON_MODE = flag('json');
const HOUSE_FILTER = param('house')?.toLowerCase() || null;

// ── Heuristic thresholds ──
const HERO_BLEED_MIN_DISTINCT = 3;       // image_url shared by ≥3 distinct addresses
const TOWN_ONLY_RATIO = 0.7;             // >70% of lots have ≤2-word, no-comma address
const IDENTICAL_PRICE_RATIO = 0.5;       // >50% of lots share same price value
const GUIDE_TBA_RATIO = 0.7;             // >70% have null price + null price_text
const BULLET_STARVATION_RATIO = 0.7;     // >70% have empty/null bullets
const IMAGE_COVERAGE_MISS = 0.5;         // >50% missing image_url
const STALE_LOT_RATIO = 0.5;             // >50% past auction_date but still 'available'
const DUPLICATE_ADDRESS_MIN = 3;         // address appears in ≥3 rows in one house
const MIN_HOUSE_LOTS = 5;                // ratio heuristics need a meaningful sample

// ── Severity ordering for sorted output ──
const SEV_ORDER = { error: 0, warn: 1, info: 2 };

// ── Heuristic runners ──
// Each runner returns array of findings: { heuristic, severity, house, message, meta }

async function heroImageBleed() {
  // Group by (house, image_url) — flag where the same image_url is shared by ≥N distinct addresses
  const { data, error } = await supabase.rpc('exec_sql_visual_audit_v1');
  // Fallback to direct SELECT (no custom RPC required)
  if (!data) {
    const { data: rows, error: e2 } = await supabase
      .from('lots')
      .select('house, image_url, address')
      .not('image_url', 'is', null)
      .not('address', 'is', null);
    if (e2) throw e2;
    const map = new Map();
    for (const r of rows || []) {
      const k = `${(r.house || '').toLowerCase()}|${r.image_url}`;
      if (!map.has(k)) map.set(k, { house: (r.house || '').toLowerCase(), image_url: r.image_url, addrs: new Set() });
      map.get(k).addrs.add((r.address || '').trim().toLowerCase());
    }
    const findings = [];
    for (const v of map.values()) {
      if (v.addrs.size >= HERO_BLEED_MIN_DISTINCT) {
        findings.push({
          heuristic: 'hero_image_bleed',
          severity: 'error',
          house: v.house,
          message: `Hero-image bleed: ${v.addrs.size} distinct addresses share one image_url`,
          meta: { image_url: v.image_url, distinct_addresses: v.addrs.size },
        });
      }
    }
    return findings;
  }
  return [];
}

async function slugCaseDuplication() {
  const { data, error } = await supabase.from('lots').select('house');
  if (error) throw error;
  const variants = new Map();
  for (const r of data || []) {
    const h = r.house;
    if (!h) continue;
    const k = h.toLowerCase();
    if (!variants.has(k)) variants.set(k, new Set());
    variants.get(k).add(h);
  }
  const findings = [];
  for (const [k, set] of variants.entries()) {
    if (set.size > 1) {
      findings.push({
        heuristic: 'slug_case_dup',
        severity: 'error',
        house: k,
        message: `Slug-case duplication: ${set.size} case variants exist for slug`,
        meta: { variants: [...set] },
      });
    }
  }
  return findings;
}

async function loadAllLots() {
  // Single fetch — all lots, lightweight columns. Used by the ratio heuristics.
  let allRows = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('lots')
      .select('house, address, price, price_text, bullets, image_url, url, auction_date, status')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return allRows;
}

function groupByHouse(rows) {
  const m = new Map();
  for (const r of rows) {
    const h = (r.house || '').toLowerCase();
    if (!h) continue;
    if (!m.has(h)) m.set(h, []);
    m.get(h).push(r);
  }
  return m;
}

function townOnlyAddress(rows) {
  // ≤2 word, no comma, no postcode-shaped token
  const findings = [];
  for (const [house, lots] of groupByHouse(rows)) {
    if (lots.length < MIN_HOUSE_LOTS) continue;
    const townOnly = lots.filter(l => {
      const a = (l.address || '').trim();
      if (!a) return false;
      if (a.includes(',')) return false;
      if (/[A-Z]{1,2}\d/.test(a)) return false; // looks like a postcode
      const words = a.split(/\s+/).filter(Boolean);
      return words.length > 0 && words.length <= 2;
    }).length;
    const ratio = townOnly / lots.length;
    if (ratio > TOWN_ONLY_RATIO) {
      findings.push({
        heuristic: 'town_only_addresses',
        severity: 'warn',
        house,
        message: `Town-only addresses: ${townOnly}/${lots.length} (${(ratio * 100).toFixed(0)}%) lots have ≤2-word, no-comma addresses — extractor may be targeting branch/event cards`,
        meta: { town_only: townOnly, total: lots.length, ratio: +ratio.toFixed(3) },
      });
    }
  }
  return findings;
}

function identicalPriceWall(rows) {
  const findings = [];
  for (const [house, lots] of groupByHouse(rows)) {
    if (lots.length < MIN_HOUSE_LOTS) continue;
    const counts = new Map();
    for (const l of lots) {
      if (l.price == null) continue;
      counts.set(l.price, (counts.get(l.price) || 0) + 1);
    }
    let topPrice = null, topCount = 0;
    for (const [p, c] of counts) if (c > topCount) { topPrice = p; topCount = c; }
    if (lots.length === 0) continue;
    const ratio = topCount / lots.length;
    if (ratio > IDENTICAL_PRICE_RATIO) {
      findings.push({
        heuristic: 'identical_price_wall',
        severity: 'warn',
        house,
        message: `Identical-price wall: ${topCount}/${lots.length} (${(ratio * 100).toFixed(0)}%) lots share price £${topPrice} — extractor likely picking up hero/banner price`,
        meta: { price: topPrice, count: topCount, total: lots.length, ratio: +ratio.toFixed(3) },
      });
    }
  }
  return findings;
}

function guideTbaWall(rows) {
  const findings = [];
  for (const [house, lots] of groupByHouse(rows)) {
    if (lots.length < MIN_HOUSE_LOTS) continue;
    const tba = lots.filter(l => l.price == null && (l.price_text == null || l.price_text === '')).length;
    const ratio = tba / lots.length;
    if (ratio > GUIDE_TBA_RATIO) {
      findings.push({
        heuristic: 'guide_tba_wall',
        severity: 'warn',
        house,
        message: `Guide-TBA wall: ${tba}/${lots.length} (${(ratio * 100).toFixed(0)}%) lots have no price + no price_text`,
        meta: { tba, total: lots.length, ratio: +ratio.toFixed(3) },
      });
    }
  }
  return findings;
}

function bulletStarvation(rows) {
  const findings = [];
  for (const [house, lots] of groupByHouse(rows)) {
    if (lots.length < MIN_HOUSE_LOTS) continue;
    const empty = lots.filter(l => !Array.isArray(l.bullets) || l.bullets.length === 0).length;
    const ratio = empty / lots.length;
    if (ratio > BULLET_STARVATION_RATIO) {
      findings.push({
        heuristic: 'bullet_starvation',
        severity: 'info',
        house,
        message: `Bullet starvation: ${empty}/${lots.length} (${(ratio * 100).toFixed(0)}%) lots have empty bullets`,
        meta: { empty, total: lots.length, ratio: +ratio.toFixed(3) },
      });
    }
  }
  return findings;
}

function imageCoverageLow(rows) {
  const findings = [];
  for (const [house, lots] of groupByHouse(rows)) {
    if (lots.length < MIN_HOUSE_LOTS) continue;
    const missing = lots.filter(l => !l.image_url).length;
    const ratio = missing / lots.length;
    if (ratio > IMAGE_COVERAGE_MISS) {
      findings.push({
        heuristic: 'image_coverage_low',
        severity: 'warn',
        house,
        message: `Image coverage low: ${missing}/${lots.length} (${(ratio * 100).toFixed(0)}%) lots missing image_url`,
        meta: { missing, total: lots.length, ratio: +ratio.toFixed(3) },
      });
    }
  }
  return findings;
}

function imageDomainMismatch(rows) {
  // Flag a house where >70% of image hosts come from a single non-CDN/logo-shaped host
  // (heuristic: every card showing the same logo). Skip if image is from the auctioneer's own domain.
  const findings = [];
  const KNOWN_CDNS = ['cloudfront.net', 'amazonaws.com', 'cloudinary', 'akamai', 'cdn.', 'imgix', 'fastly'];
  for (const [house, lots] of groupByHouse(rows)) {
    if (lots.length < MIN_HOUSE_LOTS) continue;
    const hosts = new Map();
    for (const l of lots) {
      if (!l.image_url) continue;
      try {
        const host = new URL(l.image_url).host;
        hosts.set(host, (hosts.get(host) || 0) + 1);
      } catch {}
    }
    if (hosts.size === 0) continue;
    let topHost = null, topCount = 0;
    for (const [h, c] of hosts) if (c > topCount) { topHost = h; topCount = c; }
    const ratio = topCount / lots.length;
    if (topHost && ratio > 0.9 && !KNOWN_CDNS.some(c => topHost.includes(c)) && !topHost.includes(house)) {
      findings.push({
        heuristic: 'image_domain_mismatch',
        severity: 'info',
        house,
        message: `Image domain mismatch: ${topCount}/${lots.length} (${(ratio * 100).toFixed(0)}%) lots use host '${topHost}' — could be a logo/placeholder`,
        meta: { host: topHost, count: topCount, total: lots.length, ratio: +ratio.toFixed(3) },
      });
    }
  }
  return findings;
}

function staleLotWall(rows) {
  const findings = [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  for (const [house, lots] of groupByHouse(rows)) {
    if (lots.length < MIN_HOUSE_LOTS) continue;
    const stale = lots.filter(l => {
      if (!l.auction_date) return false;
      const d = new Date(l.auction_date);
      const isAvail = !l.status || l.status === 'available';
      return d < cutoff && isAvail;
    }).length;
    const ratio = stale / lots.length;
    if (ratio > STALE_LOT_RATIO) {
      findings.push({
        heuristic: 'stale_lot_wall',
        severity: 'info',
        house,
        message: `Stale lot wall: ${stale}/${lots.length} (${(ratio * 100).toFixed(0)}%) lots are past auction date >7d but still marked available`,
        meta: { stale, total: lots.length, ratio: +ratio.toFixed(3), cutoff: cutoff.toISOString() },
      });
    }
  }
  return findings;
}

function duplicateAddressWall(rows) {
  const findings = [];
  for (const [house, lots] of groupByHouse(rows)) {
    if (lots.length < MIN_HOUSE_LOTS) continue;
    const counts = new Map();
    for (const l of lots) {
      const a = (l.address || '').trim().toLowerCase();
      if (!a) continue;
      counts.set(a, (counts.get(a) || 0) + 1);
    }
    const dupes = [...counts.entries()].filter(([, c]) => c >= DUPLICATE_ADDRESS_MIN);
    if (dupes.length > 0) {
      const total = dupes.reduce((s, [, c]) => s + c, 0);
      findings.push({
        heuristic: 'duplicate_address_wall',
        severity: 'error',
        house,
        message: `Duplicate-address wall: ${dupes.length} addresses appear ≥${DUPLICATE_ADDRESS_MIN} times each (${total} total dupe rows) — pagination may be looping page 1`,
        meta: { unique_dupes: dupes.length, total_dupe_rows: total, examples: dupes.slice(0, 3).map(([a, c]) => ({ address: a, count: c })) },
      });
    }
  }
  return findings;
}

function crossHouseUrlLeak(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r.url) continue;
    if (!map.has(r.url)) map.set(r.url, new Set());
    map.get(r.url).add((r.house || '').toLowerCase());
  }
  const findings = [];
  for (const [url, set] of map.entries()) {
    if (set.size > 1) {
      const houses = [...set];
      // Attribute to first house alphabetically (arbitrary — both are affected)
      findings.push({
        heuristic: 'cross_house_url_leak',
        severity: 'error',
        house: houses.sort()[0],
        message: `Cross-house URL leak: '${url}' exists under ${set.size} houses (${houses.join(', ')}) — detectAuctionHouse() may be misrouting`,
        meta: { url, houses },
      });
    }
  }
  return findings;
}

function retiredSlugStraggler(rows) {
  const known = new Set(Object.keys(HOUSE_ROOTS).map(k => k.toLowerCase()));
  const seen = new Set();
  const findings = [];
  for (const r of rows) {
    const h = (r.house || '').toLowerCase();
    if (!h || seen.has(h)) continue;
    seen.add(h);
    if (!known.has(h)) {
      findings.push({
        heuristic: 'retired_slug_straggler',
        severity: 'error',
        house: h,
        message: `Retired slug straggler: '${h}' is not in HOUSE_ROOTS — should not have lots`,
        meta: { slug: h },
      });
    }
  }
  return findings;
}

// ── Run all heuristics ──
async function runAudit() {
  const findings = [];
  const t0 = Date.now();

  // hero-image bleed + slug-case dup query their own slim data sets
  findings.push(...await heroImageBleed());
  findings.push(...await slugCaseDuplication());

  // Single fat fetch for all ratio-style heuristics
  const rows = await loadAllLots();
  findings.push(...townOnlyAddress(rows));
  findings.push(...identicalPriceWall(rows));
  findings.push(...guideTbaWall(rows));
  findings.push(...bulletStarvation(rows));
  findings.push(...imageCoverageLow(rows));
  findings.push(...imageDomainMismatch(rows));
  findings.push(...staleLotWall(rows));
  findings.push(...duplicateAddressWall(rows));
  findings.push(...crossHouseUrlLeak(rows));
  findings.push(...retiredSlugStraggler(rows));

  const ms = Date.now() - t0;
  return { findings, scannedRows: rows.length, ms };
}

// ── Render markdown report ──
function renderReport({ findings, scannedRows, ms }) {
  const date = new Date().toISOString().slice(0, 10);
  const byHouse = new Map();
  for (const f of findings) {
    if (!byHouse.has(f.house)) byHouse.set(f.house, []);
    byHouse.get(f.house).push(f);
  }
  const houses = [...byHouse.keys()].sort();

  const counts = { error: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;

  let md = `# Visual Audit — ${date}\n\n`;
  md += `Scanned **${scannedRows.toLocaleString()}** rows in **${ms}ms** across **${houses.length}** houses with findings.\n\n`;
  md += `**Findings:** ${counts.error || 0} error · ${counts.warn || 0} warn · ${counts.info || 0} info\n\n`;
  if (findings.length === 0) {
    md += `_No issues detected. All heuristics passed._\n`;
    return md;
  }
  for (const h of houses) {
    const list = byHouse.get(h).sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
    md += `## ${h}\n\n`;
    for (const f of list) {
      md += `- **[${f.severity}] ${f.heuristic}** — ${f.message}\n`;
      if (f.meta && Object.keys(f.meta).length > 0) {
        md += `  - \`${JSON.stringify(f.meta)}\`\n`;
      }
    }
    md += '\n';
  }
  return md;
}

// ── Auto-fix recipes for known-mechanical findings ──
// V1 only handles hero_image_bleed (pure column update, no constraint risk —
// UNIQUE (house, url) on lots doesn't include image_url). Each recipe must be
// idempotent: running twice should null 0 rows on the second pass. The next
// scrape's backfill repopulates per-card images.
//
// slug_case_dup, retired_slug_straggler, stale_lot_wall deferred — they involve
// DELETEs or could collide with UNIQUE (house, url).
async function applyAutoFixes(findings) {
  const summary = { hero_image_bleed: { houses_affected: 0, rows_nulled: 0, details: [] } };
  const bleedFindings = (findings || []).filter(f => f.heuristic === 'hero_image_bleed');
  if (bleedFindings.length === 0) return summary;

  const housesTouched = new Set();
  for (const f of bleedFindings) {
    const slug = (f.house || '').toLowerCase();
    const url = f.meta?.image_url;
    if (!slug || !url) continue;
    // Cannot use lower(house) in a Supabase JS client filter directly — fetch
    // matching rows by image_url first, then filter slug client-side. With a
    // single equality on image_url this is cheap (one image_url per finding).
    const { data: matches, error: selErr } = await supabase
      .from('lots')
      .select('id, house')
      .eq('image_url', url);
    if (selErr) {
      console.warn(`AUTO-FIX: select failed for ${slug} ${url}: ${selErr.message}`);
      continue;
    }
    const ids = (matches || []).filter(r => (r.house || '').toLowerCase() === slug).map(r => r.id);
    if (ids.length === 0) continue;
    const { error: updErr } = await supabase
      .from('lots')
      .update({ image_url: null })
      .in('id', ids);
    if (updErr) {
      console.warn(`AUTO-FIX: update failed for ${slug}: ${updErr.message}`);
      continue;
    }
    housesTouched.add(slug);
    summary.hero_image_bleed.rows_nulled += ids.length;
    summary.hero_image_bleed.details.push({ house: slug, image_url: url, rows_nulled: ids.length });
    console.log(`AUTO-FIX: hero_image_bleed — ${slug}: nulled ${ids.length} row(s) sharing ${url}`);
  }
  summary.hero_image_bleed.houses_affected = housesTouched.size;
  return summary;
}

// ── Upsert findings as pipeline_alerts (idempotent on (house, heuristic)) ──
async function writeAlerts(findings) {
  if (DRY_RUN || findings.length === 0) return { inserted: 0, skipped: 0 };
  // Fetch existing unresolved alerts of this type to dedupe
  const { data: existing, error: e1 } = await supabase
    .from('pipeline_alerts')
    .select('id, house, meta')
    .eq('event_type', 'visual_audit_issue')
    .eq('resolved', false);
  if (e1) throw e1;
  const seen = new Set();
  for (const a of existing || []) {
    const heuristic = a.meta?.heuristic;
    if (heuristic) seen.add(`${a.house}|${heuristic}`);
  }
  let inserted = 0, skipped = 0;
  for (const f of findings) {
    const k = `${f.house}|${f.heuristic}`;
    if (seen.has(k)) { skipped++; continue; }
    const { error } = await supabase.from('pipeline_alerts').insert({
      event_type: 'visual_audit_issue',
      severity: f.severity,
      house: f.house,
      message: f.message,
      resolved: false,
      meta: { heuristic: f.heuristic, ...f.meta },
    });
    if (!error) inserted++;
  }
  return { inserted, skipped };
}

// ── Main ──
async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
    process.exit(1);
  }
  const result = await runAudit();
  let filtered = result.findings;
  if (HOUSE_FILTER) filtered = filtered.filter(f => f.house === HOUSE_FILTER);

  if (JSON_MODE) {
    process.stdout.write(JSON.stringify({ ...result, findings: filtered }, null, 2));
    return { findings: filtered, ...result };
  }

  // Render report
  if (!NO_REPORT) {
    if (!existsSync(AUDIT_DIR)) mkdirSync(AUDIT_DIR, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const path = join(AUDIT_DIR, `visual-audit-${date}.md`);
    writeFileSync(path, renderReport({ ...result, findings: filtered }));
    console.log(`Wrote report: ${path}`);
  }

  // Counts
  const counts = filtered.reduce((acc, f) => { acc[f.severity] = (acc[f.severity] || 0) + 1; return acc; }, {});
  console.log(`Visual audit: scanned ${result.scannedRows} rows in ${result.ms}ms — ${filtered.length} findings (${counts.error || 0} error, ${counts.warn || 0} warn, ${counts.info || 0} info)`);

  // Write alerts (unless dry-run)
  if (!DRY_RUN) {
    const { inserted, skipped } = await writeAlerts(filtered);
    console.log(`Pipeline alerts: ${inserted} new, ${skipped} already open`);
  } else {
    console.log('Dry-run: pipeline alerts NOT written');
  }
  return { findings: filtered, ...result };
}

// Allow import as a module (for /api/admin/visual-audit) AND CLI usage
const isMainModule = import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || import.meta.url.endsWith(process.argv[1].split(/[\\\/]/).pop());

export { runAudit, renderReport, writeAlerts, applyAutoFixes };

if (isMainModule) {
  main().catch(err => {
    console.error('Visual audit failed:', err);
    process.exit(1);
  });
}
