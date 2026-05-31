// lib/flood-lookup.js — Flood risk proxy replacing decommissioned EA WFS endpoints
//
// The WFS spatial data endpoints at environment.data.gov.uk/spatialdata/ were
// decommissioned in May 2026. This module uses the still-live flood-monitoring
// API as a binary proxy: "is this property in an EA-monitored flood area?"
//
// This is less precise than the original Flood Zone 1/2/3 planning classification.
// For full precision, download the Flood Map for Planning dataset (~200MB GeoPackage
// from data.gov.uk) and replace this module with local point-in-polygon queries.
//
// Current behaviour:
//   - Any flood areas nearby → Medium (in a monitored catchment)
//   - No flood areas → Low (outside EA coverage, likely Scotland/NI)
//
// NOTE: The EA flood-monitoring /floodAreas endpoint operates at catchment
// level. The `dist` parameter uses centroid proximity, not spatial containment,
// so precise zone classification is not possible through this API alone.

const EA_RATE_LIMIT_MS = 300;
let _lastEACallTime = 0;

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{status: string, floodRiskLevel: string|null, source: string, note: string}>}
 */
async function checkFloodRisk(lat, lng) {
  if (lat == null || lng == null) {
    return { status: 'no_coords', floodRiskLevel: null, source: 'EA_FloodMonitoring', note: '' };
  }

  try {
    const now = Date.now();
    const elapsed = now - _lastEACallTime;
    if (elapsed < EA_RATE_LIMIT_MS) {
      await new Promise(r => setTimeout(r, EA_RATE_LIMIT_MS - elapsed));
    }
    _lastEACallTime = Date.now();

    const url = `https://environment.data.gov.uk/flood-monitoring/id/floodAreas?lat=${lat}&long=${lng}&dist=0.005`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return { status: 'api_error', floodRiskLevel: null, source: 'EA_FloodMonitoring', note: `HTTP ${resp.status}` };
    }

    const data = await resp.json();
    const items = data.items || [];

    if (items.length === 0) {
      return { status: 'ok', floodRiskLevel: 'Low', source: 'EA_FloodMonitoring', note: 'Outside EA flood monitoring coverage' };
    }

    // In a monitored flood catchment — use Medium as conservative default
    // (was more precise with WFS zone check; upgrade when dataset available)
    return { status: 'ok', floodRiskLevel: 'Medium', source: 'EA_FloodMonitoring', note: `EA monitored: ${items[0].label || 'flood area'}` };

  } catch (err) {
    if (err.name === 'AbortError') {
      return { status: 'timeout', floodRiskLevel: null, source: 'EA_FloodMonitoring', note: 'Request timed out' };
    }
    return { status: 'api_error', floodRiskLevel: null, source: 'EA_FloodMonitoring', note: err.message };
  }
}

export { checkFloodRisk };
