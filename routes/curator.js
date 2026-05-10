// ═══════════════════════════════════════════════════════════════
// CURATOR ROUTES
// ═══════════════════════════════════════════════════════════════
// Public:
//   GET  /api/curator/today          — approved picks for the homepage widget
//   GET  /api/curator/share/:pickId  — LinkedIn share artefact (post + image url)
//
// Admin (x-admin-secret header):
//   GET  /api/admin/curator               — pending picks for today
//   POST /api/admin/curator/run           — manual cycle trigger (date in body)
//   POST /api/admin/curator/:id/approve   — approve one pick
//   POST /api/admin/curator/:id/reject    — reject one pick
//   POST /api/admin/curator/approve-all   — bulk approve today's pending picks

import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { rateLimit, requireAdmin } from '../lib/auth.js';
import { log } from '../lib/logging.js';
import {
  getApprovedPicksWithLots,
  getPendingPicksWithLots,
  setPickStatus,
  approveAllForDate,
} from '../lib/curator/persist.js';
import { runCuratorCycle } from '../lib/pipeline/curator-cycle.js';
import { getHouseDisplayName } from '../lib/houses.js';

const router = Router();
const SITE = 'https://auctions.bridgematch.co.uk';

// ── In-memory 60s cache for the homepage feed ────────────────────────
// Keyed by `pickDate` (today UK). Cleared on approve/reject so admins see
// changes immediately without waiting for TTL.
const _todayCache = { date: null, payload: null, expires: 0 };
const TODAY_CACHE_MS = 60_000;

function clearTodayCache() {
  _todayCache.date = null;
  _todayCache.payload = null;
  _todayCache.expires = 0;
}

function todayUk() {
  const ukNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
  const y = ukNow.getFullYear();
  const m = String(ukNow.getMonth() + 1).padStart(2, '0');
  const d = String(ukNow.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ═══════════════════════════════════════════════════════════════
// Public: GET /api/curator/today
// ═══════════════════════════════════════════════════════════════
router.get('/api/curator/today', rateLimit(60_000, 120), async (req, res) => {
  const pickDate = todayUk();
  const now = Date.now();
  if (_todayCache.date === pickDate && _todayCache.expires > now && _todayCache.payload) {
    res.set('Cache-Control', 'public, max-age=60, s-maxage=60');
    return res.json(_todayCache.payload);
  }

  let picks = await getApprovedPicksWithLots(pickDate);

  // Fallback: if no approved picks for today (cycle didn't run / approval
  // not yet done), fall back to yesterday so the widget never goes empty
  // mid-morning before approval is finished.
  let usedDate = pickDate;
  if (picks.length === 0) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    picks = await getApprovedPicksWithLots(yesterday);
    if (picks.length > 0) usedDate = yesterday;
  }

  const payload = {
    pickDate: usedDate,
    isStale: usedDate !== pickDate,
    picks: picks.map(({ pick, lot }) => publicPickShape(pick, lot)),
  };

  _todayCache.date = pickDate;
  _todayCache.payload = payload;
  _todayCache.expires = now + TODAY_CACHE_MS;

  res.set('Cache-Control', 'public, max-age=60, s-maxage=60');
  res.json(payload);
});

// ═══════════════════════════════════════════════════════════════
// Public: GET /api/curator/share/:pickId — LinkedIn artefact
// ═══════════════════════════════════════════════════════════════
router.get('/api/curator/share/:pickId', rateLimit(60_000, 60), async (req, res) => {
  const { pickId } = req.params;
  if (!isUuid(pickId)) return res.status(400).json({ error: 'Invalid pick id' });

  const { data, error } = await supabase
    .from('curator_picks')
    .select('id, headline, prose, hook, status, lots:lot_id ( id, house, address, price, price_text, prop_type, score, image_url )')
    .eq('id', pickId)
    .maybeSingle();

  if (error) {
    log.warn('curator.share fetch failed', { pickId, err: error.message });
    return res.status(500).json({ error: 'Lookup failed' });
  }
  if (!data || !data.lots) return res.status(404).json({ error: 'Pick not found' });
  if (data.status !== 'approved') return res.status(403).json({ error: 'Pick is not approved yet' });

  const lot = data.lots;
  const displayName = getHouseDisplayName(lot.house, '') || lot.house;
  const lotUrl = `${SITE}/lot/${lot.id}?utm_source=curator&utm_medium=linkedin&utm_campaign=daily_pick`;
  const imageUrl = `${SITE}/og/lot/${lot.id}.png`;
  const priceLabel = lot.price ? `£${Number(lot.price).toLocaleString('en-GB')}` : (lot.price_text || 'Guide TBA');
  const scoreLabel = lot.score != null ? `${Number(lot.score).toFixed(1)}/10` : null;

  const lines = [];
  lines.push(data.headline);
  lines.push('');
  lines.push(data.hook);
  lines.push('');
  lines.push(`${priceLabel} · ${displayName}${scoreLabel ? ` · Score ${scoreLabel}` : ''}`);
  lines.push('');
  lines.push('Full analysis (free):');
  lines.push(lotUrl);

  res.json({
    pickId: data.id,
    lotId: lot.id,
    postText: lines.join('\n'),
    hook: data.hook,
    imageUrl,
    lotUrl,
    hashtags: '#PropertyInvestment #UKAuctions #BridgingFinance',
  });
});

// ═══════════════════════════════════════════════════════════════
// Admin: list pending picks for review
// ═══════════════════════════════════════════════════════════════
router.get('/api/admin/curator', requireAdmin, async (req, res) => {
  const pickDate = (req.query && typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date))
    ? req.query.date
    : todayUk();

  const pending = await getPendingPicksWithLots(pickDate);
  const approved = await getApprovedPicksWithLots(pickDate);

  res.json({
    pickDate,
    pending: pending.map(({ pick, lot }) => adminPickShape(pick, lot, 'pending')),
    approved: approved.map(({ pick, lot }) => adminPickShape(pick, lot, 'approved')),
  });
});

// ═══════════════════════════════════════════════════════════════
// Admin: manual cycle trigger
// ═══════════════════════════════════════════════════════════════
router.post('/api/admin/curator/run', requireAdmin, rateLimit(60_000, 5), async (req, res) => {
  const pickDate = (req.body && typeof req.body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date))
    ? req.body.date
    : todayUk();
  const dryRun = !!(req.body && req.body.dryRun);

  // Fire and respond — the cycle takes ~30-60s with 8 Gemini Pro calls,
  // longer than the typical fetch timeout from a browser.
  res.json({ ok: true, message: `Curator cycle triggered for ${pickDate}${dryRun ? ' (dry-run)' : ''}. Check server logs for completion.` });
  runCuratorCycle(supabase, { pickDate, dryRun })
    .then(r => {
      log.info('curator manual run complete', { pickDate, summary: r.summary });
      clearTodayCache();
    })
    .catch(e => log.error('curator manual run failed', { pickDate, err: e.message }));
});

// ═══════════════════════════════════════════════════════════════
// Admin: approve / reject a single pick
// ═══════════════════════════════════════════════════════════════
router.post('/api/admin/curator/:pickId/approve', requireAdmin, async (req, res) => {
  const { pickId } = req.params;
  if (!isUuid(pickId)) return res.status(400).json({ error: 'Invalid pick id' });
  try {
    const result = await setPickStatus(pickId, 'approved');
    if (!result.ok) return res.status(404).json({ error: result.reason });
    clearTodayCache();
    res.json({ ok: true, status: result.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/admin/curator/:pickId/reject', requireAdmin, async (req, res) => {
  const { pickId } = req.params;
  if (!isUuid(pickId)) return res.status(400).json({ error: 'Invalid pick id' });
  const reason = (req.body && typeof req.body.reason === 'string') ? req.body.reason.slice(0, 280) : null;
  try {
    const result = await setPickStatus(pickId, 'rejected', 'admin', reason);
    if (!result.ok) return res.status(404).json({ error: result.reason });
    clearTodayCache();
    res.json({ ok: true, status: result.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/admin/curator/approve-all', requireAdmin, async (req, res) => {
  const pickDate = (req.body && typeof req.body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date))
    ? req.body.date
    : todayUk();
  try {
    const { approved } = await approveAllForDate(pickDate);
    clearTodayCache();
    res.json({ ok: true, approved, pickDate });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Shape helpers ────────────────────────────────────────────────────
function publicPickShape(pick, lot) {
  const displayName = getHouseDisplayName(lot.house, '') || lot.house;
  return {
    pickId: pick.id,
    rank: pick.rank,
    headline: pick.headline,
    hook: pick.hook,
    lot: {
      id: lot.id,
      address: lot.address,
      price: lot.price,
      priceText: lot.price_text,
      propType: lot.prop_type,
      score: lot.score != null ? Number(lot.score) : null,
      imageUrl: lot.image_url,
      house: lot.house,
      houseDisplay: displayName,
      url: `/lot/${lot.id}?utm_source=curator&utm_medium=homepage&utm_campaign=widget`,
    },
  };
}

function adminPickShape(pick, lot, status) {
  return {
    pickId: pick.id,
    rank: pick.rank,
    status,
    headline: pick.headline,
    prose: pick.prose,
    hook: pick.hook,
    generatedAt: pick.generatedAt,
    lot: {
      id: lot.id,
      address: lot.address,
      price: lot.price,
      priceText: lot.price_text,
      propType: lot.prop_type,
      score: lot.score != null ? Number(lot.score) : null,
      imageUrl: lot.image_url,
      house: lot.house,
      houseDisplay: getHouseDisplayName(lot.house, '') || lot.house,
      opps: lot.opps || [],
      risks: lot.risks || [],
      lotUrl: `/lot/${lot.id}`,
    },
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s) { return typeof s === 'string' && UUID_RE.test(s); }

export default router;
