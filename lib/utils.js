// lib/utils.js — Shared tiny utilities

export function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// URL normalisation — single source of truth for comparing / deduplicating URLs
export const normaliseUrl = u => (u || '').trim().replace(/\/+$/, '').replace(/^http:\/\//i, 'https://').replace(/^(https:\/\/)www\./i, '$1').toLowerCase();
