// ═══════════════════════════════════════════════════════════════
// FIELD-SOURCE HELPER — Per-field provenance stamping
// ═══════════════════════════════════════════════════════════════
// When a lot field is populated by a specific source (DOM extractor,
// EPC API, OS Places, Gemini, bullets-parser, etc.), use setField()
// instead of direct assignment. The helper records both the value
// AND its provenance into lot._fieldSources, which is then persisted
// to the lots.field_sources JSONB column.
//
// Phase A approach: SPARSE provenance. Only new code paths use this
// helper — existing direct assignments remain untouched. That means
// field_sources may be `{}` for a field even when the field is set.
// We accept this trade-off: a sparse-but-truthful map beats a dense
// map filled with guesses about which source won.
//
// Source vocabulary (extend conservatively):
//   'dom'              — house-specific DOM extractor
//   'dom-detail'       — detail-page DOM extractor (vs catalogue)
//   'gemini-catalogue' — Gemini AI on catalogue HTML
//   'gemini-detail'    — Gemini AI on a single lot's detail page
//   'bullets-parser'   — regex over lot.bullets
//   'epc'              — EPC API match
//   'land_registry'    — LR sales lookup
//   'flood_api'        — Environment Agency flood API
//   'geocode'          — postcodes.io
//   'os-places'        — OS Data Hub Places API
//   'merge-preserve'   — kept from previous DB row during upsert merge

/**
 * Set a field on a lot AND stamp its provenance.
 *
 * Rules:
 *   • Skips if `value` is null/undefined/empty-string — preserves whatever
 *     was there before. Use clearField() if you need to actively null out.
 *   • Initialises lot._fieldSources lazily.
 *   • Does NOT enforce source whitelist at runtime (keep flexible);
 *     prefer one of the documented strings above for downstream auditing.
 *
 * @param {object} lot   - Lot object being assembled
 * @param {string} field - camelCase field name (e.g. 'beds', 'tenure', 'imageUrl')
 * @param {*}      value - The value to set
 * @param {string} source - Provenance label, see vocabulary above
 */
export function setField(lot, field, value, source) {
  if (!lot || typeof lot !== 'object') return;
  if (value === null || value === undefined) return;
  if (typeof value === 'string' && value.trim() === '') return;
  if (typeof value === 'number' && !Number.isFinite(value)) return;

  lot[field] = value;
  if (!lot._fieldSources) lot._fieldSources = {};
  lot._fieldSources[field] = source;
}

/**
 * Set a field ONLY if it isn't already set (or is empty).
 * Higher-precedence callers should run before this — e.g. DOM stamps
 * `beds` first, then bullets-parser calls setFieldIfEmpty so it doesn't
 * overwrite a high-confidence DOM value with a regex guess.
 */
export function setFieldIfEmpty(lot, field, value, source) {
  if (!lot || typeof lot !== 'object') return;
  const existing = lot[field];
  if (existing !== null && existing !== undefined && existing !== '') return;
  setField(lot, field, value, source);
}

/**
 * Get the provenance map. Returns {} not null so callers can spread safely.
 */
export function getFieldSources(lot) {
  return (lot && lot._fieldSources) || {};
}

/**
 * Stamp a field that's already been set by direct assignment.
 * Bridge for old code paths that haven't been refactored to setField yet —
 * lets a caller retroactively claim provenance after the fact.
 *
 *   lot.beds = 3;          // legacy DOM extractor wrote this
 *   stampSource(lot, 'beds', 'dom');
 *
 * No-op if the field is empty.
 */
export function stampSource(lot, field, source) {
  if (!lot || typeof lot !== 'object') return;
  const v = lot[field];
  if (v === null || v === undefined || v === '') return;
  if (!lot._fieldSources) lot._fieldSources = {};
  lot._fieldSources[field] = source;
}
