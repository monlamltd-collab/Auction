// lib/pipeline/platform-discovery.js
// Family-level discovery config resolver (Task 6).
//
// Explicit AUCTION_DISCOVERY[slug] always wins. Otherwise enrol AH / EIG
// platform families so we don't need 200 hand configs.

/**
 * @typedef {object} DiscoveryConfig
 * @property {string} [homepage]
 * @property {string} [auctionsIndexPath]
 * @property {string} [platform]
 * @property {RegExp} [linkPattern]
 * @property {Function} [buildUrl]
 * @property {string} [source]
 * @property {boolean} [familyAuto]
 */

/**
 * Resolve discovery config for a slug.
 *
 * @param {string} slug
 * @param {object} opts
 * @param {object|null} [opts.explicit] AUCTION_DISCOVERY[slug]
 * @param {Set<string>|string[]} [opts.ahSlugs]
 * @param {Record<string,string>} [opts.houseRoots]
 * @param {{ eig?: boolean }} [opts.htmlFingerprints]
 * @param {boolean} [opts.expandEnabled] gate for family auto-enrol writes path
 */
export function resolveDiscoveryConfig(slug, opts = {}) {
  const s = String(slug || '').toLowerCase();
  if (!s) return null;

  if (opts.explicit) {
    return { ...opts.explicit, source: opts.explicit.source || 'explicit', familyAuto: false };
  }

  const expandEnabled = opts.expandEnabled !== false; // default on at code level; watcher may still gate writes
  if (!expandEnabled) return null;

  const ah = opts.ahSlugs instanceof Set ? opts.ahSlugs : new Set(opts.ahSlugs || []);
  const roots = opts.houseRoots || {};

  if (ah.has(s)) {
    return ahFamilyConfig(s, roots[s]);
  }

  // HTML fingerprinting path (caller fetched homepage already)
  if (opts.htmlFingerprints?.eig) {
    return eigFamilyConfig(s, roots[s]);
  }

  // Root URL heuristic for known EIG host patterns (cheap, no HTML needed)
  const root = roots[s] || '';
  if (looksLikeEigRoot(root)) {
    return eigFamilyConfig(s, root);
  }

  return null;
}

export function looksLikeEigRoot(url) {
  if (!url) return false;
  const u = String(url).toLowerCase();
  // common EIG white-label signals in house roots / auction pages
  return (
    /search-auction/.test(u) ||
    /eigroup|eigpropertyauctions/.test(u) ||
    /auctioneertemplates/.test(u)
  );
}

export function ahFamilyConfig(slug, homepage) {
  return {
    homepage: homepage || `https://www.auctionhouse.co.uk/`,
    platform: 'auctionhouse-uk',
    source: 'family:ah',
    familyAuto: true,
    // AH future-dates resolver feeds dated URLs; pattern optional.
  };
}

export function eigFamilyConfig(slug, homepage) {
  const home = homepage || null;
  return {
    homepage: home,
    platform: 'eig-whitelabel',
    auctionsIndexPath: '/auctions/',
    // Broad EIG patterns: month-slug path OR ?auction=N OR ?bid=N
    linkPattern: /\/search-auction(?:-([a-z]{2,10})\/|\/?(?:[?](?:auction|bid)=(\d+)))/gi,
    buildUrl: (id) => {
      if (!home) return null;
      try {
        const origin = new URL(home).origin;
        if (/^\d+$/.test(id)) {
          // prefer auction=N; bid= houses usually have explicit config already
          return `${origin}/search-auction/?auction=${id}`;
        }
        return `${origin}/search-auction-${id}/`;
      } catch {
        return null;
      }
    },
    source: 'family:eig',
    familyAuto: true,
  };
}

/**
 * Build the slug list the watcher should process.
 * Explicit configs first, then family auto-enrol.
 *
 * @param {object} opts
 * @param {Record<string,object>} opts.explicitMap AUCTION_DISCOVERY
 * @param {Set<string>|string[]} [opts.ahSlugs]
 * @param {Record<string,string>} [opts.houseRoots]
 * @param {Set<string>|string[]} [opts.retired]
 * @param {boolean} [opts.expandEnabled]
 */
export function listWatchableSlugs(opts = {}) {
  const explicitMap = opts.explicitMap || {};
  const retired = opts.retired instanceof Set ? opts.retired : new Set(opts.retired || []);
  const expandEnabled = opts.expandEnabled !== false;
  const ah = opts.ahSlugs instanceof Set ? opts.ahSlugs : new Set(opts.ahSlugs || []);
  const roots = opts.houseRoots || {};

  const out = [];
  const seen = new Set();

  for (const slug of Object.keys(explicitMap)) {
    if (retired.has(slug)) continue;
    out.push(slug);
    seen.add(slug);
  }

  if (expandEnabled) {
    for (const slug of ah) {
      if (retired.has(slug) || seen.has(slug)) continue;
      if (!roots[slug]) continue;
      out.push(slug);
      seen.add(slug);
    }
    // EIG root-heuristic enrol from active roots not already listed
    for (const slug of Object.keys(roots)) {
      if (retired.has(slug) || seen.has(slug)) continue;
      if (looksLikeEigRoot(roots[slug])) {
        out.push(slug);
        seen.add(slug);
      }
    }
  }

  return out;
}

export function isAuctionWatcherExpandEnabled(env = process.env) {
  // Default ON for family resolution once Task 6 ships — kill-switch to false if needed.
  const raw = env.AUCTION_WATCHER_EXPAND_ENABLED;
  if (raw == null || raw === '') return true;
  return String(raw).toLowerCase() !== 'false';
}
