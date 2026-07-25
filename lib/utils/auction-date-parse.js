// lib/utils/auction-date-parse.js
// Shared UK auction date parsing (extracted from auction-watcher for reuse).

const MONTHS = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/**
 * Parse a UK-ish human date string to YYYY-MM-DD, or null.
 * Accepts: "Wednesday 14th May 2026", "14 May 2026", "14-May-2026", "14/05/2026", "2026-05-14".
 * @param {string|null|undefined} text
 * @returns {string|null}
 */
export function parseUkDate(text) {
  if (!text) return null;
  const s = String(text).trim();
  if (!s) return null;

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const iso = s.slice(0, 10);
    if (isPlausibleIso(iso)) return iso;
    return null;
  }

  // e.g. "Wednesday 14th May 2026", "14 May 2026", "14th May, 2026"
  const m1 = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9}),?\s+(20\d{2})\b/);
  if (m1) {
    const day = parseInt(m1[1], 10);
    const mo = MONTHS[m1[2].toLowerCase()] || MONTHS[m1[2].slice(0, 3).toLowerCase()];
    const yr = parseInt(m1[3], 10);
    if (mo && day >= 1 && day <= 31) {
      const iso = `${yr}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (isPlausibleIso(iso)) return iso;
    }
  }

  // Month-first: "May 14 2026", "May 14th, 2026"
  const m1b = s.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/);
  if (m1b) {
    const mo = MONTHS[m1b[1].toLowerCase()] || MONTHS[m1b[1].slice(0, 3).toLowerCase()];
    const day = parseInt(m1b[2], 10);
    const yr = parseInt(m1b[3], 10);
    if (mo && day >= 1 && day <= 31) {
      const iso = `${yr}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (isPlausibleIso(iso)) return iso;
    }
  }

  // UK numeric: DD/MM/YYYY or DD-MM-YYYY
  const m2 = s.match(/\b(\d{1,2})[/\-](\d{1,2})[/\-](20\d{2})\b/);
  if (m2) {
    const day = parseInt(m2[1], 10);
    const mo = parseInt(m2[2], 10);
    const yr = parseInt(m2[3], 10);
    if (mo >= 1 && mo <= 12 && day >= 1 && day <= 31) {
      const iso = `${yr}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (isPlausibleIso(iso)) return iso;
    }
  }

  return null;
}

function isPlausibleIso(iso) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === iso;
}

/**
 * True when ISO date is today or later.
 * @param {string|null|undefined} isoDate
 * @param {string} [todayIso]
 */
export function isFutureIsoDate(isoDate, todayIso) {
  if (!isoDate) return false;
  const d = String(isoDate).slice(0, 10);
  const today = todayIso || new Date().toISOString().slice(0, 10);
  return d >= today;
}

/**
 * Reject absurd far-future lot dates (typos / bad OCR), keep multi-year sales ≤ +2y.
 * @param {string|null|undefined} isoDate
 * @param {{ todayIso?: string, maxYearsAhead?: number }} [opts]
 */
export function isSanelyNearFutureDate(isoDate, opts = {}) {
  if (!isoDate) return false;
  const d = String(isoDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  if (d >= '2098-01-01') return false;
  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);
  if (d < todayIso) return false;
  const maxYears = opts.maxYearsAhead ?? 2;
  const maxYear = Number(todayIso.slice(0, 4)) + maxYears;
  const y = Number(d.slice(0, 4));
  return y <= maxYear;
}
