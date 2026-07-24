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

  // Token / plot / nominal-guide detectors. These poison net yield + ROCE
  // rankings because rent is estimated like a normal home while the guide is
  // £1–£5k (or a parking space / garden plot on a residential street).
  //
  // Thresholds deliberately below your "50% below road average" suggestion —
  // at 50% we'd still show £125k guides on £250k streets, which can be real.
  // 70%+ below comps on a tiny guide is almost always not a whole house.
  const UNREALISTIC = {
    maxTokenGuide: 15000,           // residential-looking guide this low is almost never the whole asset
    maxGuideVsStreetRatio: 0.30,    // guide ≤ 30% of street avg ≈ ≥70% below market
    maxGrossYieldPct: 30,           // already stamped as _yieldEstimateWarning server-side
    requireStreetAvg: 50000,        // only trust street avg above this (avoids garbage comps)
  };

  function streetAvgOf(l) {
    const v = l && (l.streetAvg != null ? l.streetAvg : l.comparablePrice);
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /**
   * True when guide economics are too distorted for % returns / rankings.
   * Does NOT hide the lot from browse — only suppresses net yield, ROCE,
   * and (callers should) demote it in yield sorts.
   *
   * @returns {{ bad: boolean, reason: string|null, bmvPct: number|null }}
   */
  function guideDistortion(l) {
    if (!l || !(l.price > 0)) return { bad: false, reason: null, bmvPct: null };
    const price = Number(l.price);
    const avg = streetAvgOf(l);
    let bmvPct = null;
    if (avg && avg >= UNREALISTIC.requireStreetAvg) {
      bmvPct = ((avg - price) / avg) * 100;
      // Extreme vs comps: £1.5k on a £250k street (~99% below).
      if (price / avg <= UNREALISTIC.maxGuideVsStreetRatio) {
        return { bad: true, reason: 'guide_vs_street', bmvPct };
      }
    }
    // Gross yield from served estimate OR from rent/price — either way
    // >30% is not a trustworthy BTL figure for ranking (token guides,
    // peppercorn witnesses, parking rented as flats, etc.).
    let gy = null;
    if (l.estGrossYield != null && Number.isFinite(Number(l.estGrossYield))) {
      gy = Number(l.estGrossYield);
    } else if (l.estMonthlyRent > 0) {
      gy = (Number(l.estMonthlyRent) * 12 / price) * 100;
    }
    if (l._yieldEstimateWarning || (gy != null && gy > UNREALISTIC.maxGrossYieldPct)) {
      return { bad: true, reason: 'gross_yield_cap', bmvPct };
    }
    // Tiny guide without a crazy yield still smells like a plot/parking token
    // when paired with a normal-home rent estimate below the 30% cap somehow.
    if (price <= UNREALISTIC.maxTokenGuide && l.estMonthlyRent > 0 && gy != null && gy >= 20) {
      return { bad: true, reason: 'token_guide_yield', bmvPct };
    }
    return { bad: false, reason: null, bmvPct };
  }

  function isUnrealisticGuide(l) {
    return guideDistortion(l).bad;
  }

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
    if (isUnrealisticGuide(l)) return null;
    const n = noi(l); const tc = trueCost(l);
    if (n == null || tc == null || tc <= 0) return null;
    return (n / tc) * 100;
  }

  // Return on capital employed (cash-on-cash): net cashflow after an
  // interest-only BTL mortgage, over the actual cash in the deal (deposit +
  // stamp duty + fees + condition-implied works). Negative is honest.
  function roce(l) {
    if (isUnrealisticGuide(l)) return null;
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
    if (isUnrealisticGuide(l)) return null;
    const ve = l.valueEstimate;
    if (!ve || typeof ve !== 'object' || !Number.isFinite(Number(ve.estimate)) || !l.price) return null;
    const refi = ASSUMPTIONS.refiLtv * Number(ve.estimate);
    const totalIn = l.price + sdlt(l.price, lotCountry(l)) + ASSUMPTIONS.buyerAdminFee + ASSUMPTIONS.legalsSurvey + worksCost(l);
    if (totalIn <= 0) return null;
    return { pct: (refi / totalIn) * 100, confidence: String(ve.confidence || 'low').toLowerCase() };
  }

  // Inverse metric: the price at which this lot hits the user's target gross
  // yield, given the rent estimate. Guide-independent by design.
  // Still suppressed on distorted guides so a £1.5k lot doesn't claim a
  // hero "max bid for 8%" inflated by normal-home rent estimates.
  function maxBid(l, targetYieldPct) {
    if (isUnrealisticGuide(l)) return null;
    if (!l.estMonthlyRent || !(targetYieldPct > 0)) return null;
    return Math.round((l.estMonthlyRent * 12) / (targetYieldPct / 100));
  }

  /** Gross yield for ranking only — null when guide is distorted. */
  function rankingGrossYield(l) {
    if (isUnrealisticGuide(l)) return null;
    if (l.estGrossYield != null && Number.isFinite(Number(l.estGrossYield))) return Number(l.estGrossYield);
    if (l.price > 0 && l.estMonthlyRent > 0) return (l.estMonthlyRent * 12 / l.price) * 100;
    return null;
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
    ASSUMPTIONS, UNREALISTIC, sdlt, countryFromPostcode, streetAvgOf,
    guideDistortion, isUnrealisticGuide, worksCost, trueCost, noi,
    netYield, roce, brrrRecycledPct, maxBid, rankingGrossYield, describeAssumptions,
  };

})(typeof window !== 'undefined' ? window : globalThis);
