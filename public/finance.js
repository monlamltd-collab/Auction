// public/finance.js — investor deal-metric calculations shared by the browse
// UI and tests. Loaded in index.html as a plain <script> before app.js
// (exposes window.AB_finance); Node tests import the file and read
// globalThis.AB_finance — same pattern as public/town-match.js.
//
// Every metric is deterministic arithmetic over fields already served by
// get_active_lots (price, estMonthlyRent, condition, postcode,
// valueEstimate) — no server round-trip, no AI. The assumption set is ONE
// auditable object; describeAssumptions() renders it for tooltips so no
// number is ever shown without its basis.
//
// sdlt() is ported VERBATIM from bridgematch-lite.html::calcSDLT (2025/26
// investor / additional-dwelling rates, England SDLT / Scotland LBTT+ADS /
// Wales LTT). Keep the two in step — but never edit bridgematch-lite.html
// itself (see CLAUDE.md non-negotiables).

(function (root) {

  // ── Assumptions (Week-2 defaults, 2026-07) ─────────────────────────────
  // Deliberately conservative middle-of-market figures. Surfaced verbatim in
  // every tooltip via describeAssumptions(); change here, changes everywhere.
  const ASSUMPTIONS = {
    ltv: 0.75,              // interest-only BTL mortgage LTV
    btlRatePct: 5.5,        // BTL interest rate (interest-only)
    mgmtPct: 10,            // letting management, % of gross rent
    voidsMaintPct: 10,      // voids + maintenance, % of gross rent
    insurancePa: 350,       // landlord insurance, £/yr
    buyerAdminFee: 1500,    // auction buyer's admin fee (varies by house)
    legalsSurvey: 1500,     // legals + searches + survey allowance
    worksPctByCondition: { 'needs work': 20, 'poor': 30 }, // % of guide; else 0
    refiLtv: 0.75,          // BRRR refinance LTV against the value estimate
  };

  // ── Stamp duty (ported from bridgematch-lite.html calcSDLT) ────────────
  function sdlt(price, country) {
    if (!country) country = 'england';
    switch (country) {
      case 'scotland': {
        const ads = price * 0.06;
        let lbtt = 0;
        if (price > 145000) lbtt += (Math.min(price, 250000) - 145000) * 0.02;
        if (price > 250000) lbtt += (Math.min(price, 325000) - 250000) * 0.05;
        if (price > 325000) lbtt += (Math.min(price, 750000) - 325000) * 0.10;
        if (price > 750000) lbtt += (price - 750000) * 0.12;
        return Math.round(ads + lbtt);
      }
      case 'wales': {
        let ltt = 0;
        if (price <= 180000) ltt = price * 0.04;
        else {
          ltt = 180000 * 0.04;
          ltt += (Math.min(price, 250000) - 180000) * 0.075;
          if (price > 250000) ltt += (Math.min(price, 400000) - 250000) * 0.09;
          if (price > 400000) ltt += (Math.min(price, 750000) - 400000) * 0.115;
          if (price > 750000) ltt += (Math.min(price, 1500000) - 750000) * 0.14;
          if (price > 1500000) ltt += (price - 1500000) * 0.16;
        }
        return Math.round(ltt);
      }
      default: {
        if (price <= 250000) return Math.round(price * 0.05);
        let s = 250000 * 0.05;
        if (price <= 925000) s += (price - 250000) * 0.1;
        else { s += (925000 - 250000) * 0.1; s += (Math.min(price, 1500000) - 925000) * 0.15; }
        if (price > 1500000) s += (price - 1500000) * 0.17;
        return Math.round(s);
      }
    }
  }

  // Postcode area → tax country. Unambiguous areas only; border-straddling
  // areas (SY, NP outskirts, TD fringes) resolve to the majority side — the
  // tax delta there is small and the tooltip states the basis.
  const SCOTLAND_AREAS = new Set(['AB', 'DD', 'DG', 'EH', 'FK', 'G', 'HS', 'IV', 'KA', 'KW', 'KY', 'ML', 'PA', 'PH', 'TD', 'ZE']);
  const WALES_AREAS = new Set(['CF', 'LL', 'LD', 'NP', 'SA']);
  function countryFromPostcode(postcode) {
    const m = String(postcode || '').trim().toUpperCase().match(/^([A-Z]{1,2})\d/);
    if (!m) return 'england';
    if (SCOTLAND_AREAS.has(m[1])) return 'scotland';
    if (WALES_AREAS.has(m[1])) return 'wales';
    return 'england';
  }

  function lotCountry(l) { return countryFromPostcode(l.postcode || ''); }

  function worksCost(l) {
    if (!l.price) return 0;
    const pct = ASSUMPTIONS.worksPctByCondition[l.condition] || 0;
    return Math.round(l.price * pct / 100);
  }

  // Guide + stamp duty + buyer's admin + legals/survey. Works cost is NOT
  // in true cost (it varies by strategy) — it IS in the ROCE cash figure.
  function trueCost(l) {
    if (!l.price) return null;
    return l.price + sdlt(l.price, lotCountry(l)) + ASSUMPTIONS.buyerAdminFee + ASSUMPTIONS.legalsSurvey;
  }

  // Net operating income: gross rent less management, voids/maintenance and
  // insurance. Null when the rent estimate is missing — never fabricated.
  function noi(l) {
    if (!l.estMonthlyRent || !(l.estMonthlyRent > 0)) return null;
    const gross = l.estMonthlyRent * 12;
    return gross * (1 - (ASSUMPTIONS.mgmtPct + ASSUMPTIONS.voidsMaintPct) / 100) - ASSUMPTIONS.insurancePa;
  }

  function netYield(l) {
    const n = noi(l); const tc = trueCost(l);
    if (n == null || tc == null || tc <= 0) return null;
    return (n / tc) * 100;
  }

  // Return on capital employed (cash-on-cash): net cashflow after an
  // interest-only BTL mortgage, over the actual cash in the deal (deposit +
  // stamp duty + fees + condition-implied works). Negative is honest.
  function roce(l) {
    const n = noi(l);
    if (n == null || !l.price) return null;
    const duty = sdlt(l.price, lotCountry(l));
    const interest = l.price * ASSUMPTIONS.ltv * ASSUMPTIONS.btlRatePct / 100;
    const cashIn = l.price * (1 - ASSUMPTIONS.ltv) + duty + ASSUMPTIONS.buyerAdminFee + ASSUMPTIONS.legalsSurvey + worksCost(l);
    if (cashIn <= 0) return null;
    return ((n - interest) / cashIn) * 100;
  }

  // BRRR: refinance at refiLtv × value estimate — what % of the cash in the
  // deal comes back out. >100 = all money out. Confidence rides along from
  // the value estimate; callers must show it (the band IS the honesty).
  function brrrRecycledPct(l) {
    const ve = l.valueEstimate;
    if (!ve || typeof ve !== 'object' || !Number.isFinite(Number(ve.estimate)) || !l.price) return null;
    const refi = ASSUMPTIONS.refiLtv * Number(ve.estimate);
    const totalIn = l.price + sdlt(l.price, lotCountry(l)) + ASSUMPTIONS.buyerAdminFee + ASSUMPTIONS.legalsSurvey + worksCost(l);
    if (totalIn <= 0) return null;
    return { pct: (refi / totalIn) * 100, confidence: String(ve.confidence || 'low').toLowerCase() };
  }

  // Inverse metric: the price at which this lot hits the user's target gross
  // yield, given the rent estimate. Guide-independent by design.
  function maxBid(l, targetYieldPct) {
    if (!l.estMonthlyRent || !(targetYieldPct > 0)) return null;
    return Math.round((l.estMonthlyRent * 12) / (targetYieldPct / 100));
  }

  function describeAssumptions(l) {
    const a = ASSUMPTIONS;
    const w = ASSUMPTIONS.worksPctByCondition[l && l.condition] || 0;
    const c = l ? lotCountry(l) : 'england';
    return 'Assumptions: ' + (a.ltv * 100) + '% LTV interest-only BTL at ' + a.btlRatePct + '%; '
      + a.mgmtPct + '% management + ' + a.voidsMaintPct + '% voids/maintenance; £' + a.insurancePa + '/yr insurance; '
      + 'stamp duty at investor rates (' + c + '); £' + (a.buyerAdminFee + a.legalsSurvey).toLocaleString() + ' admin/legals/survey'
      + (w ? '; works ' + w + '% of guide (condition: ' + l.condition + ')' : '')
      + '. Rent is the platform estimate — verify before bidding.';
  }

  root.AB_finance = {
    ASSUMPTIONS, sdlt, countryFromPostcode, worksCost, trueCost, noi,
    netYield, roce, brrrRecycledPct, maxBid, describeAssumptions,
  };

})(typeof window !== 'undefined' ? window : globalThis);
