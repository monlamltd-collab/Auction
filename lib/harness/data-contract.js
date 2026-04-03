// ═══════════════════════════════════════════════════════════════
// DATA CONTRACT — Schema validation + lot quality scoring
// ═══════════════════════════════════════════════════════════════

// ── Field weights for quality scoring ──
const FIELD_WEIGHTS = {
  imageUrl: 0.25,
  price: 0.20,
  address: 0.20,
  tenure: 0.15,
  beds: 0.10,
  url: 0.10,
};

// ── Canonical property type mapping ──
const PROP_TYPE_MAP = {
  'terraced house': 'house', 'terrace': 'house', 'terraced': 'house',
  'semi-detached': 'house', 'semi detached': 'house', 'semi': 'house',
  'detached house': 'house', 'detached': 'house',
  'end terrace': 'house', 'end-terrace': 'house',
  'bungalow': 'house', 'cottage': 'house', 'villa': 'house',
  'town house': 'house', 'townhouse': 'house',
  'maisonette': 'flat', 'apartment': 'flat', 'studio': 'flat',
  'flat': 'flat', 'penthouse': 'flat',
  'land': 'land', 'plot': 'land', 'building plot': 'land',
  'garage': 'other', 'parking': 'other', 'storage': 'other',
  'commercial': 'commercial', 'shop': 'commercial', 'office': 'commercial',
  'warehouse': 'commercial', 'industrial': 'commercial',
  'mixed use': 'mixed', 'mixed-use': 'mixed',
  'house': 'house',
};

// ── Canonical tenure mapping ──
const TENURE_MAP = {
  'fh': 'Freehold', 'freehold': 'Freehold', 'f/h': 'Freehold', 'f': 'Freehold',
  'lh': 'Leasehold', 'leasehold': 'Leasehold', 'l/h': 'Leasehold', 'l': 'Leasehold',
  'share of freehold': 'Share of Freehold', 'sof': 'Share of Freehold',
};

// ── Junk image patterns ──
const JUNK_IMAGE_PATTERNS = [
  /logo/i, /icon/i, /avatar/i, /placeholder/i,
  /floor[-_]?plan/i, /epc/i, /energy[-_]?performance/i,
  /\.svg$/i, /1x1/i, /pixel/i, /spacer/i, /blank/i,
  /no[-_]?image/i, /no[-_]?photo/i, /coming[-_]?soon/i,
];

/**
 * Normalise price: strip "£", "guide", commas, expand k-suffix, take lower bound of ranges → integer or null.
 */
function normalisePrice(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val > 0 ? Math.round(val) : null;
  let s = String(val).replace(/[£,]/g, '').replace(/guide\s*price\s*/i, '').trim();
  // Expand k-suffix: 50k → 50000, 1.5k → 1500
  s = s.replace(/(\d+(?:\.\d+)?)\s*k\b/gi, (_, n) => String(Math.round(parseFloat(n) * 1000)));
  // Take lower bound of ranges (e.g. '50000-60000' → '50000')
  const rangePart = s.split(/[-–]/)[0].trim();
  const n = parseInt(rangePart, 10);
  return (n && n > 0) ? n : null;
}

/**
 * Normalise address: trim, collapse whitespace, title-case.
 */
function normaliseAddress(val) {
  if (!val || typeof val !== 'string') return val || '';
  return val
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Normalise property type to canonical form.
 */
function normalisePropType(val) {
  if (!val || typeof val !== 'string') return val || '';
  const lower = val.trim().toLowerCase();
  return PROP_TYPE_MAP[lower] || val.trim();
}

/**
 * Normalise tenure to canonical form.
 */
function normaliseTenure(val, propType) {
  if (!val || typeof val !== 'string' || val.trim() === '') {
    // Default inference: flats → Leasehold (but don't force it)
    return '';
  }
  const lower = val.trim().toLowerCase();
  return TENURE_MAP[lower] || val.trim();
}

/**
 * Check if image URL is valid (not junk).
 */
function isValidImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('http')) return false;
  for (const pattern of JUNK_IMAGE_PATTERNS) {
    if (pattern.test(url)) return false;
  }
  return true;
}

/**
 * Validate and score a single lot against the data contract.
 * @param {object} lot - Raw lot object
 * @returns {{ valid: boolean, quality: number, gaps: string[], normalized: object }}
 */
export function validateLot(lot) {
  if (!lot || typeof lot !== 'object') {
    return { valid: false, quality: 0, gaps: ['not_an_object'], normalized: lot };
  }

  // Required: must have lot number OR address
  const hasLot = lot.lot !== undefined && lot.lot !== null && lot.lot !== '';
  const hasAddress = lot.address && typeof lot.address === 'string' && lot.address.trim().length > 3;
  if (!hasLot && !hasAddress) {
    return { valid: false, quality: 0, gaps: ['no_lot_or_address'], normalized: lot };
  }

  // Normalise fields
  const normalized = { ...lot };
  if (lot.price !== undefined) normalized.price = normalisePrice(lot.price);
  if (lot.address) normalized.address = normaliseAddress(lot.address);
  if (lot.propType) normalized.propType = normalisePropType(lot.propType);
  if (lot.tenure !== undefined) normalized.tenure = normaliseTenure(lot.tenure, normalized.propType);
  if (lot.imageUrl && !isValidImageUrl(lot.imageUrl)) normalized.imageUrl = '';

  // Calculate quality score
  const gaps = [];
  let quality = 0;

  if (normalized.imageUrl && isValidImageUrl(normalized.imageUrl)) {
    quality += FIELD_WEIGHTS.imageUrl;
  } else {
    gaps.push('imageUrl');
  }

  if (normalized.price && normalized.price > 0) {
    quality += FIELD_WEIGHTS.price;
  } else {
    gaps.push('price');
  }

  if (normalized.address && normalized.address.trim().length > 3) {
    quality += FIELD_WEIGHTS.address;
  } else {
    gaps.push('address');
  }

  if (normalized.tenure && normalized.tenure !== '' && normalized.tenure !== 'unknown') {
    quality += FIELD_WEIGHTS.tenure;
  } else {
    gaps.push('tenure');
  }

  if (normalized.beds && normalized.beds > 0) {
    quality += FIELD_WEIGHTS.beds;
  } else {
    gaps.push('beds');
  }

  if (normalized.url && normalized.url.startsWith('http')) {
    quality += FIELD_WEIGHTS.url;
  } else {
    gaps.push('url');
  }

  return { valid: true, quality: Math.round(quality * 100) / 100, gaps, normalized };
}

/**
 * Validate and score a batch of lots.
 * @param {object[]} lots - Array of raw lot objects
 * @param {string} house - House slug
 * @param {{ averageLotCount?: number }} baseline - Optional baseline data
 * @returns {{ lots: object[], batchQuality: number, fieldCoverage: object, viable: boolean, lotQualities: number[] }}
 */
export function validateBatch(lots, house, baseline = {}) {
  if (!Array.isArray(lots) || lots.length === 0) {
    return { lots: [], batchQuality: 0, fieldCoverage: {}, viable: false, lotQualities: [] };
  }

  const results = lots.map(lot => validateLot(lot));
  const validResults = results.filter(r => r.valid);
  const normalizedLots = validResults.map(r => r.normalized);
  const qualities = validResults.map(r => r.quality);

  // Mean lot quality
  const meanQuality = qualities.length > 0
    ? qualities.reduce((a, b) => a + b, 0) / qualities.length
    : 0;

  // Lot count factor — penalise if way below expected
  let lotCountFactor = 1;
  if (baseline.averageLotCount && baseline.averageLotCount > 10) {
    const ratio = normalizedLots.length / baseline.averageLotCount;
    if (ratio < 0.3) lotCountFactor = 0.5;
    else if (ratio < 0.5) lotCountFactor = 0.7;
    else if (ratio < 0.8) lotCountFactor = 0.9;
  }

  const batchQuality = Math.round(meanQuality * lotCountFactor * 100) / 100;

  // Field coverage stats
  const fieldCoverage = {};
  for (const field of Object.keys(FIELD_WEIGHTS)) {
    const count = normalizedLots.filter(l => {
      if (field === 'imageUrl') return l.imageUrl && isValidImageUrl(l.imageUrl);
      if (field === 'price') return l.price && l.price > 0;
      if (field === 'address') return l.address && l.address.trim().length > 3;
      if (field === 'tenure') return l.tenure && l.tenure !== '' && l.tenure !== 'unknown';
      if (field === 'beds') return l.beds && l.beds > 0;
      if (field === 'url') return l.url && l.url.startsWith('http');
      return false;
    }).length;
    fieldCoverage[field] = normalizedLots.length > 0
      ? Math.round((count / normalizedLots.length) * 100)
      : 0;
  }

  // propType coverage — tracks canonical types only (not in FIELD_WEIGHTS, does not affect quality score)
  const CANONICAL_PROP_TYPES = new Set(['house', 'flat', 'land', 'commercial', 'mixed']);
  const propTypeCount = normalizedLots.filter(l => CANONICAL_PROP_TYPES.has(l.propType)).length;
  fieldCoverage.propType = normalizedLots.length > 0
    ? Math.round((propTypeCount / normalizedLots.length) * 100)
    : 0;

  const viable = normalizedLots.length > 0 && batchQuality >= 0.15;

  return {
    lots: normalizedLots,
    batchQuality,
    fieldCoverage,
    viable,
    lotQualities: qualities,
  };
}
