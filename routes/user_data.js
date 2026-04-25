// routes/user_data.js — Per-user likes, analysed list, and saved deal-stacking scenarios
//
// Lots are addressed by (house, lot_url) — see migrations/2026-04-25-user-lot-data.sql
// for the rationale (scenarios outlive a lot rolling off the active catalogue).
//
// All endpoints require auth via validateUserFromReq(); user_id is always taken
// from the verified JWT, never from the request body.

import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { validateUserFromReq } from '../lib/auth.js';
import { log } from '../lib/logging.js';

const router = Router();

// ─── helpers ────────────────────────────────────────────────────────────────
function normLotKey(body) {
  const house = (body?.house || '').trim();
  const lot_url = (body?.lot_url || '').trim();
  if (!house || !lot_url) return null;
  return { house, lot_url };
}

async function recomputeStacksFlag(user_id, house, lot_url) {
  const { data } = await supabase
    .from('user_deal_scenarios')
    .select('id')
    .eq('user_id', user_id)
    .eq('house', house)
    .eq('lot_url', lot_url)
    .eq('stacks', true)
    .limit(1);
  const stacks = !!(data && data.length);
  await supabase
    .from('user_lot_actions')
    .update({ stacks })
    .eq('user_id', user_id)
    .eq('house', house)
    .eq('lot_url', lot_url);
  return stacks;
}

async function upsertAction(user_id, house, lot_url, patch) {
  const now = new Date().toISOString();
  const row = {
    user_id, house, lot_url,
    liked: false, analysed: false, stacks: false,
    ...patch,
    updated_at: now,
  };
  // Upsert on the unique constraint (user_id, house, lot_url)
  const { data, error } = await supabase
    .from('user_lot_actions')
    .upsert(row, { onConflict: 'user_id,house,lot_url' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── GET /api/me/likes ──────────────────────────────────────────────────────
router.get('/api/me/likes', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  try {
    const { data } = await supabase
      .from('user_lot_actions')
      .select('house, lot_url, liked, analysed, stacks, analysed_at, updated_at')
      .eq('user_id', user.id)
      .eq('liked', true)
      .order('updated_at', { ascending: false });
    res.json({ likes: data || [] });
  } catch (err) {
    log.error('GET /api/me/likes', { error: err.message, userId: user.id });
    res.status(500).json({ error: 'Failed to load likes' });
  }
});

// ─── GET /api/me/analysed ───────────────────────────────────────────────────
router.get('/api/me/analysed', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  try {
    const { data } = await supabase
      .from('user_lot_actions')
      .select('house, lot_url, liked, analysed, stacks, analysed_at, updated_at')
      .eq('user_id', user.id)
      .eq('analysed', true)
      .order('analysed_at', { ascending: false });
    res.json({ analysed: data || [] });
  } catch (err) {
    log.error('GET /api/me/analysed', { error: err.message, userId: user.id });
    res.status(500).json({ error: 'Failed to load analysed list' });
  }
});

// ─── POST /api/me/likes — toggle like for a lot ─────────────────────────────
router.post('/api/me/likes', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const key = normLotKey(req.body);
  if (!key) return res.status(400).json({ error: 'house and lot_url required' });
  const liked = req.body.liked !== false;
  try {
    const row = await upsertAction(user.id, key.house, key.lot_url, { liked });
    res.json({ ok: true, action: row });
  } catch (err) {
    log.error('POST /api/me/likes', { error: err.message, userId: user.id });
    res.status(500).json({ error: 'Failed to update like' });
  }
});

// ─── POST /api/me/likes/bulk — one-time merge of localStorage favs on sign-in ──
router.post('/api/me/likes/bulk', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.json({ ok: true, merged: 0 });
  try {
    let merged = 0;
    for (const it of items) {
      const key = normLotKey(it);
      if (!key) continue;
      await upsertAction(user.id, key.house, key.lot_url, { liked: true });
      merged++;
    }
    res.json({ ok: true, merged });
  } catch (err) {
    log.error('POST /api/me/likes/bulk', { error: err.message, userId: user.id });
    res.status(500).json({ error: 'Failed to merge likes' });
  }
});

// ─── GET /api/me/scenarios?house=&lot_url= ──────────────────────────────────
router.get('/api/me/scenarios', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const house = (req.query.house || '').toString().trim();
  const lot_url = (req.query.lot_url || '').toString().trim();
  if (!house || !lot_url) return res.status(400).json({ error: 'house and lot_url required' });
  try {
    const { data } = await supabase
      .from('user_deal_scenarios')
      .select('id, name, inputs, results, stacks, created_at, updated_at')
      .eq('user_id', user.id)
      .eq('house', house)
      .eq('lot_url', lot_url)
      .order('updated_at', { ascending: false });
    res.json({ scenarios: data || [] });
  } catch (err) {
    log.error('GET /api/me/scenarios', { error: err.message, userId: user.id });
    res.status(500).json({ error: 'Failed to load scenarios' });
  }
});

// ─── POST /api/me/scenarios — create new scenario ───────────────────────────
router.post('/api/me/scenarios', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const key = normLotKey(req.body);
  if (!key) return res.status(400).json({ error: 'house and lot_url required' });
  const { name, inputs, results, stacks } = req.body || {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
  if (!inputs || typeof inputs !== 'object') return res.status(400).json({ error: 'inputs object required' });
  if (!results || typeof results !== 'object') return res.status(400).json({ error: 'results object required' });
  try {
    const { data, error } = await supabase
      .from('user_deal_scenarios')
      .insert({
        user_id: user.id,
        house: key.house,
        lot_url: key.lot_url,
        name: name.slice(0, 80),
        inputs,
        results,
        stacks: !!stacks,
      })
      .select()
      .single();
    if (error) throw error;

    // Auto-mark the lot as liked + analysed and recompute stacks flag
    await upsertAction(user.id, key.house, key.lot_url, {
      liked: true,
      analysed: true,
      analysed_at: new Date().toISOString(),
    });
    const stacksFlag = await recomputeStacksFlag(user.id, key.house, key.lot_url);
    res.json({ ok: true, scenario: data, stacks: stacksFlag });
  } catch (err) {
    log.error('POST /api/me/scenarios', { error: err.message, userId: user.id });
    res.status(500).json({ error: 'Failed to save scenario' });
  }
});

// ─── PUT /api/me/scenarios/:id — rename or re-save inputs/results ───────────
router.put('/api/me/scenarios/:id', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const { id } = req.params;
  const { name, inputs, results, stacks } = req.body || {};
  const updates = {};
  if (typeof name === 'string') updates.name = name.slice(0, 80);
  if (inputs && typeof inputs === 'object') updates.inputs = inputs;
  if (results && typeof results === 'object') updates.results = results;
  if (typeof stacks === 'boolean') updates.stacks = stacks;
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'no updates' });
  try {
    const { data, error } = await supabase
      .from('user_deal_scenarios')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Scenario not found' });
    const stacksFlag = await recomputeStacksFlag(user.id, data.house, data.lot_url);
    res.json({ ok: true, scenario: data, stacks: stacksFlag });
  } catch (err) {
    log.error('PUT /api/me/scenarios/:id', { error: err.message, userId: user.id });
    res.status(500).json({ error: 'Failed to update scenario' });
  }
});

// ─── DELETE /api/me/scenarios/:id ───────────────────────────────────────────
router.delete('/api/me/scenarios/:id', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const { id } = req.params;
  try {
    // Read first so we can recompute the stacks flag for the (house, lot_url)
    const { data: row } = await supabase
      .from('user_deal_scenarios')
      .select('house, lot_url')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();
    if (!row) return res.status(404).json({ error: 'Scenario not found' });

    const { error } = await supabase
      .from('user_deal_scenarios')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) throw error;

    const stacksFlag = await recomputeStacksFlag(user.id, row.house, row.lot_url);
    res.json({ ok: true, stacks: stacksFlag });
  } catch (err) {
    log.error('DELETE /api/me/scenarios/:id', { error: err.message, userId: user.id });
    res.status(500).json({ error: 'Failed to delete scenario' });
  }
});

export default router;
