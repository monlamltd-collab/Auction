// lib/pipeline/quality-gate.js — Lot batch quality validation (price, URL, coverage, regression)

/**
 * Validate a batch of lots before caching/persisting.
 * Pure function — no external dependencies.
 *
 * @param {Array} lots - Array of lot objects
 * @param {string} house - House slug
 * @param {object|null} prevCached - Previous cache entry { total_lots }
 * @param {Array|null} prevLots - Previous lots array
 * @returns {{ lots: Array, alerts: string[], rejected: boolean }}
 */
// Non-property "lots" that some catalogues render as cards in the listing
// (e.g. SDL's "Free sales valuation" promo banner appears on every page of
// every paginated catalogue, producing dozens of ghost lots with the same
// address and a non-property image — usually an estate-agency banner).
// Match the address exactly (trimmed, case-insensitive) — anything that
// matches is dropped before persistence.
const PROMO_ADDRESS_PATTERNS = [
  /^free\s+sales?\s+valuation\s*$/i,
  /^request\s+a?\s*valuation\s*$/i,
  /^book\s+a?\s*valuation\s*$/i,
  /^sell\s+(your|with)\s+/i,
  /^list\s+your\s+property\s*$/i,
  /^advertise\s+(here|with)\s+/i,
];

function isPromoAddress(address) {
  if (!address) return false;
  const trimmed = String(address).trim();
  if (!trimmed) return false;
  return PROMO_ADDRESS_PATTERNS.some(re => re.test(trimmed));
}

export function qualityGate(lots, house, prevCached, prevLots) {
  const alerts = [];
  const before = lots.length;

  // ── Guard 0: Strip non-property promotional cards ──
  // Some sites (notably SDL) render a "Free sales valuation" promo banner as
  // a lot card on every paginated page. Without filtering, one promo card
  // becomes N ghost lots (one per pagination page) with junk images.
  lots = lots.filter(lot => {
    if (isPromoAddress(lot.address)) {
      alerts.push(`Stripped promo/non-property card: "${(lot.address || '').substring(0, 60)}"`);
      return false;
    }
    return true;
  });

  // ── Guard 1: Price sanity — strip lots with implausible prices ──
  lots = lots.filter(lot => {
    if (!lot.price) return true; // no price is OK (many lots don't list one)
    if (lot.price < 1000) {
      alerts.push(`Stripped lot with implausible price £${lot.price}: "${(lot.address || '').substring(0, 50)}"`);
      return false;
    }
    if (lot.price > 50000000) {
      alerts.push(`Stripped lot with implausible price £${lot.price.toLocaleString()}: "${(lot.address || '').substring(0, 50)}"`);
      return false;
    }
    return true;
  });

  // ── Guard 1b: Suspected buyer's-premium fee — null price, keep lot ──
  // Some catalogues (harmanhealy, edwardmellor, AH UK branches) show the
  // buyer's premium prominently on the card while hiding the guide on the
  // detail page; the extractor picks the prominent number. There is no
  // legitimate sub-£5k guide for a house or flat at UK auction, so nulling
  // lets detail-page enrichment recover the real guide on the next pass.
  let feeNulledCount = 0;
  for (const lot of lots) {
    if (typeof lot.price === 'number' && lot.price > 0 && lot.price < 5000
        && (lot.propType === 'house' || lot.propType === 'flat')) {
      lot.price = null;
      feeNulledCount++;
    }
  }
  if (feeNulledCount > 0) {
    alerts.push(`Nulled ${feeNulledCount} suspected buyer's-premium price(s) on residential lots`);
  }

  // ── Guard 2: URL validation — strip lots without a usable URL ──
  lots = lots.filter(lot => {
    if (!lot.url) return true; // missing URL is tolerated (Gemini-extracted lots often lack URLs)
    // Strip lots with javascript: or clearly broken URLs
    if (/^javascript:|^#|^mailto:|^void/i.test(lot.url)) {
      lot.url = ''; // clear the junk URL but keep the lot
    }
    return true;
  });

  // ── Guard 3: Minimum quality gate — warn if batch is sparse (enrichment can backfill) ──
  // At least 30% of lots should have either a price OR an image.
  // Lots with just addresses are still real lots — enrichment can backfill prices/images from lot pages.
  if (lots.length >= 5) {
    const hasSubstance = lots.filter(l => l.price || l.imageUrl).length;
    const coverage = hasSubstance / lots.length;
    if (coverage < 0.3) {
      alerts.push(`QUALITY GATE WARN: only ${Math.round(coverage * 100)}% of lots have a price or image (${hasSubstance}/${lots.length}). Proceeding — enrichment may backfill.`);
    }
  }

  // ── Guard 4: Regression detection — compare against previous cache ──
  if (prevCached && prevCached.total_lots > 5) {
    // Lot count regression — warn but don't reject. Keep the data we DO have.
    if (lots.length < prevCached.total_lots * 0.5) {
      alerts.push(`LOT COUNT REGRESSION WARN: ${prevCached.total_lots} → ${lots.length} (${Math.round(lots.length / prevCached.total_lots * 100)}%). Proceeding with reduced batch.`);
    }

    // Image coverage regression — if previous had >50% images and new has <20%, flag it
    if (Array.isArray(prevLots) && prevLots.length > 0) {
      const prevImgCount = prevLots.filter(l => l.imageUrl || l.image_url).length;
      const prevImgPct = prevImgCount / prevCached.total_lots;
      const newImgCount = lots.filter(l => l.imageUrl).length;
      const newImgPct = lots.length > 0 ? newImgCount / lots.length : 0;
      if (prevImgPct > 0.5 && newImgPct < 0.2) {
        alerts.push(`IMAGE COVERAGE REGRESSION: ${Math.round(prevImgPct * 100)}% → ${Math.round(newImgPct * 100)}% (${prevImgCount} → ${newImgCount})`);
        // Don't reject — images can be backfilled, but log the alert
      }
    }
  }

  const stripped = before - lots.length;
  if (stripped > 0) {
    alerts.push(`Cleaned ${stripped} lots with invalid data (${before} → ${lots.length})`);
  }

  // Log all alerts
  for (const a of alerts) {
    console.log(`[QUALITY] ${house}: ${a}`);
  }

  return { lots, alerts, rejected: false };
}
