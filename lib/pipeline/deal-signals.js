// lib/pipeline/deal-signals.js — multi-label deal-archetype detection.
//
// Pure functions, no I/O. Called from analyseLot() (lib/pipeline/scoring.js)
// so every scoring pass — scrape-time, manual re-analyse, hygiene wave and the
// narrative-sweep re-analyse — emits the same signals.
//
// Unlike deal_type (single-label, kept for back-compat), deal_signals is
// multi-label: a lot can be an HMO *and* a title split *and* cash-buyers-only
// at once, and archetypes compound. Slugs are stable machine keys — the
// frontend/search filter on them by literal string, so treat renames as
// breaking changes.
//
// Detection is deliberately regex-only: an LLM-per-lot pass across ~16k active
// lots is not viable on the current AI quota (see lib/ai-provider.js notes).

const WORD_NUMS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

// ── Income extraction ────────────────────────────────────────────────────────
// Matches "£47,700 per annum", "c£975pcm", "£700 PCM", "£81,845 pa", "£450 pw".
// The period token maps to an annualisation multiplier.
const INCOME_RE = /£\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\s*\+?\s*(per\s+annum|per\s+year|per\s+calendar\s+month|per\s+month|per\s+week|p\.a\.?|pa|pcm|pw|pm)\b/gi;
const PERIOD_MULTIPLIER = (period) => {
  const p = period.replace(/\s+/g, ' ').replace(/\./g, '').toLowerCase();
  if (p === 'pcm' || p === 'pm' || p === 'per calendar month' || p === 'per month') return 12;
  if (p === 'pw' || p === 'per week') return 52;
  return 1; // per annum / per year / pa / p.a.
};
// A £-per-period figure near these words is a COST, not lettings income.
// Checked in the window BEFORE the figure ("outgoings include £2,400 pa")…
const COST_CONTEXT_RE = /ground\s+rent|service\s+charge|rateable|business\s+rates|rates\s+payable|outgoings|head\s+rent|insurance|deposit|maintenance|estate\s+charge|chief\s+rent/;
// …and as an appositive label DIRECTLY AFTER it ("£2,400 per annum service
// charge", "£2,000 pa payable to the freeholder"). Anchored at the start so
// "£12,000 pa plus service charge" (income with a separate cost item) passes.
const AFTER_COST_RE = /^\s*(?:service\s+charge|ground\s+rent|rates\b|insurance|maintenance|payable\s+to)/;
// Passing (actual) vs potential (appraised) rent — classified per match from a
// context window, because both often appear in the same listing. POTENTIAL is
// tested FIRST: its phrases are the more specific ("could produce", "when
// fully let", "estimated rent of") and several passing substrings ('produc',
// 'rent of', 'fully let') occur inside them.
const PASSING_CTX_RE = /produc|passing|current(?:ly)?\s+(?:let|producing|achiev|receiv)|let\s+(?:at|to)|income\s+of|receiv|fully\s+let|gross\s+income|rental\s+income|rent\s+of|rent\s+reserved|totall?ing/;
const POTENTIAL_CTX_RE = /potential|could\s+(?:achieve|produce|generate)|estimated|anticipat|expect|achievable|\berv\b|market\s+rent|when\s+(?:fully\s+)?let|if\s+(?:fully\s+)?let|projected|appraisal|would\s+(?:achieve|anticipate)|scope\s+(?:for|to)/;

// Annualised sanity bounds — outside these the figure is a parse artefact
// (a "£250 pa" ground rent that slipped context, or a price mistaken for rent).
const INCOME_MIN_PA = 1200;
const INCOME_MAX_PA = 2_000_000;

/**
 * Extract the best stated rental income from listing text.
 * @param {string} text - lowercased listing text
 * @returns {{ statedIncomePa: number|null, incomeKind: 'passing'|'potential'|null }}
 */
export function extractStatedIncome(text) {
  let bestPassing = null;
  let bestPotential = null;
  for (const m of text.matchAll(INCOME_RE)) {
    const windowStart = Math.max(0, m.index - 70);
    const before = text.slice(windowStart, m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
    if (COST_CONTEXT_RE.test(before) || AFTER_COST_RE.test(after)) continue;
    const annual = Math.round(parseInt(m[1].replace(/,/g, ''), 10) * PERIOD_MULTIPLIER(m[2]));
    if (!Number.isFinite(annual) || annual < INCOME_MIN_PA || annual > INCOME_MAX_PA) continue;
    const window = before + m[0] + after;
    // Potential first — see the regex comments above; anything appraised,
    // estimated or conditional must never masquerade as achieved rent.
    if (POTENTIAL_CTX_RE.test(window)) bestPotential = Math.max(bestPotential || 0, annual);
    else if (PASSING_CTX_RE.test(window)) bestPassing = Math.max(bestPassing || 0, annual);
    else bestPotential = Math.max(bestPotential || 0, annual); // unlabelled → conservative
  }
  if (bestPassing) return { statedIncomePa: bestPassing, incomeKind: 'passing' };
  if (bestPotential) return { statedIncomePa: bestPotential, incomeKind: 'potential' };
  return { statedIncomePa: null, incomeKind: null };
}

// ── En-suite counting ────────────────────────────────────────────────────────
/**
 * Count en-suite rooms from listing text. Returns 0 when none mentioned.
 * @param {string} text - lowercased listing text
 * @param {number|null} beds
 */
export function countEnsuites(text, beds) {
  let n = 0;
  // "3 ensuite bathrooms", "five en-suite rooms", "6 x en-suites". The
  // lookbehinds reject accommodation-list ROOM LABELS — "bedroom 3 en-suite
  // shower room" is room number three with one en-suite, not three en-suites.
  for (const m of text.matchAll(/(?<!bedroom\s)(?<!\broom\s)(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:x\s*)?en[\s-]?suites?/gi)) {
    const v = m[1].toLowerCase();
    n = Math.max(n, WORD_NUMS[v] || parseInt(v, 10) || 0);
  }
  // "5 of 6 rooms with en-suite", "five of the six bedrooms have en-suites"
  const ofM = text.match(/(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:out\s+)?of\s+(?:the\s+)?(?:\d{1,2}|\w+)\s+(?:bed)?rooms?[^.]{0,30}en[\s-]?suite/);
  if (ofM) {
    const v = ofM[1].toLowerCase();
    n = Math.max(n, WORD_NUMS[v] || parseInt(v, 10) || 0);
  }
  // "en-suite to all/each/every bedroom", "all rooms with en-suite"
  if (/en[\s-]?suites?\s+to\s+(?:all|each|every)|(?:all|each|every)\s+(?:bed)?rooms?\s+(?:with|having|benefit\w*\s+from)\s+(?:an?\s+)?en[\s-]?suite/.test(text)) {
    n = Math.max(n, (typeof beds === 'number' && beds > 0) ? beds : 2);
  }
  // Bare plural implies at least 2; bare singular at least 1.
  if (n === 0 && /en[\s-]?suites\b/.test(text)) n = 2;
  if (n === 0 && /en[\s-]?suite\b/.test(text)) n = 1;
  // A room can't out-number the bedrooms — cap when the bed count is known.
  if (typeof beds === 'number' && beds > 0) n = Math.min(n, beds);
  return n;
}

// ── Archetype patterns ───────────────────────────────────────────────────────
const HMO_KW_RE = /\bhmo\b|house\s+(?:of|in)\s+multiple\s+occupa\w*|multiple\s+occupa\w*|house\s?share|bedsits?\b|room[\s-]by[\s-]room/;
// Multi-let evidence for the 5+ bed route. Deliberately NOT generic tenancy
// language ('tenanted', 'let to', 'assured shorthold') — a 5-bed family home
// on a single AST is legally not an HMO and must not be flagged as one.
const MULTI_LET_RE = /room\s+lets?|per\s+room|rooms?\s+(?:are\s+)?let\b|let\s+by\s+the\s+room|licen[cs]ed\s+(?:hmo|for\s+\d)|hmo\s+licen[cs]e|multi[\s-]?let|let\s+to\s+(?:working\s+professionals|students|sharers)|\bsharers\b/;
const HMO_PLANNING_RE = /sui\s+generis|article\s+4|\bc4\s+use|use\s+class\s+c4/;
const SHORT_LEASE_TEXT_RE = /(\d{1,3})\s*(?:year|yr)s?\s*(?:lease\s+)?(?:unexpired|remaining|left)/;
const MIXED_USE_RE = /mixed[\s-]use/;
const SHOP_UPPERS_RE = /(?:\bshop\b|\bretail\s+unit\b|commercial\s+(?:unit|premises))[^.]{0,120}(?:flats?\s+(?:above|over)|upper\s+parts|uppers\b|maisonette\s+(?:above|over))|(?:flats?\s+(?:above|over)|upper\s+parts)[^.]{0,120}(?:\bshop\b|\bretail\b)/;
const CASH_ONLY_RE = /cash\s+(?:buyers?|purchasers?)\s+only|unmortgageable/;
const PLANNING_GRANTED_RE = /planning\s+(?:permission|consent|approval)[^.]{0,80}(?:granted|approved|obtained|secured)|(?:granted|approved)\s+planning\s+(?:permission|consent)/;
// Negated / conditional / not-yet phrasings that PLANNING_GRANTED_RE's loose
// gap would otherwise match: "no planning permission has been granted",
// "sold subject to planning permission being granted".
const PLANNING_NEGATED_RE = /\b(?:no|not|without|unless|until|subject\s+to)\b[^.]{0,40}planning\s+(?:permission|consent|approval)|planning\s+(?:permission|consent|approval)[^.]{0,60}\b(?:being|to\s+be|not\b|never|yet\s+to\s+be|refused|lapsed|expired)\b/;

function hasPlanningGranted(t) {
  return PLANNING_GRANTED_RE.test(t) && !PLANNING_NEGATED_RE.test(t);
}
const REGULATED_RE = /regulated\s+tenanc|protected\s+tenan|rent\s+act\b|fair\s+rent|statutory\s+tenan/;
const HOLIDAY_LET_RE = /holiday\s+let|serviced\s+accommodation|short[\s-]term\s+let|airbnb/;

/**
 * Detect multi-label deal signals over a lot's combined listing text.
 * Pure function — inputs are values analyseLot has already computed.
 *
 * @param {object} p
 * @param {string} p.text - lowercased bullets + description + address blob
 * @param {number|null} p.beds
 * @param {string} p.propType
 * @param {string} [p.tenure] - analyseLot's tenure verdict ('Freehold' | 'Leasehold' | …)
 * @param {number|null} p.leaseLength - years, when structured field present
 * @param {boolean} p.titleSplit - analyseLot's title-split verdict
 * @returns {{ signals: string[], statedIncomePa: number|null, incomeKind: string|null, ensuiteCount: number }}
 */
export function detectDealSignals({ text, beds, propType, tenure, leaseLength, titleSplit }) {
  const t = text || '';
  const signals = [];
  const { statedIncomePa, incomeKind } = extractStatedIncome(t);
  const ensuiteCount = countEnsuites(t, beds);

  // HMO: explicit keyword, or a 5+ bed house with MULTI-LET evidence (3+
  // en-suites, or room-level letting language). Bed count alone is NOT enough
  // (large family homes), en-suite alone is NOT enough (2-bed flats with an
  // en-suite master), and generic tenancy/income is NOT enough (a 5-bed let
  // to one family on a single AST is not a house in multiple occupation).
  const bigHouse = typeof beds === 'number' && beds >= 5 && propType === 'house';
  const hmo = HMO_KW_RE.test(t)
    || (bigHouse && (ensuiteCount >= 3 || MULTI_LET_RE.test(t)));
  if (hmo) signals.push('hmo');

  // Investment-valuation candidate — the HMO arbitrage case: enough scale or
  // fabric (6+ beds, 3+ en-suites), a stated passing income, or explicit
  // planning status, such that a lender's panel valuer may apply a
  // commercial/yield-based valuation instead of bricks-and-mortar comps
  // (RICS BTL/HMO valuation standard; Shawbrook HMO2-4 / Paragon territory).
  if (hmo && (
    (typeof beds === 'number' && beds >= 6)
    || ensuiteCount >= 3
    || (statedIncomePa != null && incomeKind === 'passing')
    || HMO_PLANNING_RE.test(t)
  )) signals.push('investment-valuation');

  if (statedIncomePa != null) signals.push('income-stated');
  if (titleSplit === true) signals.push('title-split');

  // short-lease is a TITLE defect. On a freehold lot, "let … 7 years
  // unexpired" describes the occupational tenancy (standard commercial-
  // investment boilerplate), not the title — so the text route is gated on
  // tenure; the structured leaseLength field still counts wherever set.
  const isFreeholdTitle = /freehold/i.test(tenure || '');
  const textLease = isFreeholdTitle ? null : t.match(SHORT_LEASE_TEXT_RE);
  const leaseYears = (typeof leaseLength === 'number' && leaseLength > 0)
    ? leaseLength
    : (textLease ? parseInt(textLease[1], 10) : null);
  if (leaseYears != null && leaseYears > 0 && leaseYears < 80) signals.push('short-lease');

  if (MIXED_USE_RE.test(t) || SHOP_UPPERS_RE.test(t)) signals.push('mixed-use');
  if (CASH_ONLY_RE.test(t)) signals.push('cash-buyers-only');
  if (hasPlanningGranted(t)) signals.push('planning-granted');
  if (REGULATED_RE.test(t)) signals.push('regulated-tenancy');
  if (HOLIDAY_LET_RE.test(t)) signals.push('holiday-let');

  return { signals, statedIncomePa, incomeKind, ensuiteCount };
}
