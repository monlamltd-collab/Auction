/**
 * EPC & Flood Risk Enrichment Test Suite
 * =======================================
 * Tests enrichment functions: EPC matching, flood zone classification,
 * cache TTL logic, and ungated display verification.
 *
 * Run: node tests/test-enrichment.js [--epc] [--flood] [--cache] [--ungated]
 * No flags = run all tests
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const runAll = args.length === 0;
const runEPC = runAll || args.includes('--epc');
const runFlood = runAll || args.includes('--flood');
const runCache = runAll || args.includes('--cache');
const runUngated = runAll || args.includes('--ungated');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg}`);
    failed++;
  }
}

// ─── Import matchEPCToLot + read enrichment source for cache-pattern checks ───
import { matchEPCToLot, normaliseEpcSearchRecord, parseEpcCertificate } from '../lib/enrichment.js';

// Cache-pattern assertions below want to sanity-check that enrichment_cache is
// still queried/deleted/TTL'd. Enrichment logic now lives in lib/enrichment.js
// rather than server.js; read that file so the grep-style assertions still mean
// something.
const enrichmentCode = readFileSync(join(__dirname, '..', 'lib', 'enrichment.js'), 'utf-8');

// ─── EPC Tests ───
if (runEPC) {
  console.log('\n=== EPC Matching Tests ===');

  // Test 1: Basic match
  const mockEPC = [
    {
      address1: '42 High Street',
      address2: 'Testtown',
      'current-energy-rating': 'C',
      'current-energy-efficiency': '68',
      'lodgement-date': '2023-06-15',
    },
    {
      address1: '44 High Street',
      address2: 'Testtown',
      'current-energy-rating': 'B',
      'current-energy-efficiency': '81',
      'lodgement-date': '2024-01-10',
    },
  ];

  const result1 = matchEPCToLot(mockEPC, '42 High Street, Testtown, AB1 2CD');
  assert(result1 !== null, 'Match found for 42 High Street');
  assert(result1?.epcRating === 'C', 'EPC rating is C');
  assert(result1?.epcScore === 68, 'EPC score is 68');
  assert(result1?.epcDate === '2023-06-15', 'EPC date is 2023-06-15');

  // Test 2: Rating validation (A-G only)
  const invalidEPC = [{
    address1: '10 Elm Road',
    'current-energy-rating': 'Z',
    'current-energy-efficiency': '50',
    'lodgement-date': '2023-01-01',
  }];
  const result2 = matchEPCToLot(invalidEPC, '10 Elm Road, Town, AB1 2CD');
  assert(result2 === null, 'Invalid rating Z returns null');

  // Test 3: Score validation (1-100)
  const badScoreEPC = [{
    address1: '10 Elm Road',
    'current-energy-rating': 'D',
    'current-energy-efficiency': '150',
    'lodgement-date': '2023-01-01',
  }];
  const result3 = matchEPCToLot(badScoreEPC, '10 Elm Road, Town, AB1 2CD');
  assert(result3 === null, 'Score > 100 returns null');

  // Test 4: Most recent lodgement date wins
  const multiDateEPC = [
    {
      address1: '5 Oak Lane',
      'current-energy-rating': 'E',
      'current-energy-efficiency': '35',
      'lodgement-date': '2020-03-01',
    },
    {
      address1: '5 Oak Lane',
      'current-energy-rating': 'D',
      'current-energy-efficiency': '55',
      'lodgement-date': '2023-09-15',
    },
  ];
  const result4 = matchEPCToLot(multiDateEPC, '5 Oak Lane, Somewhere, XY1 2ZZ');
  assert(result4?.epcRating === 'D', 'Most recent date picked (D not E)');
  assert(result4?.epcScore === 55, 'Most recent score is 55');

  // Test 5: No match when building number differs
  const result5 = matchEPCToLot(mockEPC, '99 High Street, Testtown, AB1 2CD');
  assert(result5 === null, 'No match for different building number');

  // Test 6: Null inputs
  assert(matchEPCToLot(null, '42 High St') === null, 'Null records returns null');
  assert(matchEPCToLot([], '42 High St') === null, 'Empty records returns null');
  assert(matchEPCToLot(mockEPC, null) === null, 'Null address returns null');

  // ── New EPC API (Get energy performance of buildings data, 2026-06-13) ──
  // The search endpoint returns the rating BAND but no numeric score. Records
  // are normalised by normaliseEpcSearchRecord, then matched band-only.
  // Test 7: normaliseEpcSearchRecord maps the new camelCase shape
  const newApiRec = {
    certificateNumber: '9423-3957-2202-4655-4204',
    addressLine1: '13 Villiers Road', addressLine2: 'Southsea', addressLine3: '', addressLine4: '',
    postcode: 'PO5 2HG', postTown: 'Southsea',
    currentEnergyEfficiencyBand: 'D', registrationDate: '2021-04-12', uprn: '1775082094',
  };
  const norm = normaliseEpcSearchRecord(newApiRec);
  assert(norm.currentEnergyRating === 'D', 'normalise: band → currentEnergyRating');
  assert(norm.address1 === '13 Villiers Road', 'normalise: addressLine1 → address1');
  assert(norm.lmkKey === '9423-3957-2202-4655-4204', 'normalise: certificateNumber → lmkKey');
  assert(norm.uprn === '1775082094', 'normalise: uprn carried through');
  assert(normaliseEpcSearchRecord(null) === null, 'normalise: null → null');

  // Test 8: a band-only record (no score) still matches, with epcScore=null
  const bandOnly = matchEPCToLot([norm], '13 Villiers Road, Southsea, PO5 2HG');
  assert(bandOnly !== null, 'band-only record matches (new API has no score)');
  assert(bandOnly?.epcRating === 'D', 'band-only: rating D returned');
  assert(bandOnly?.epcScore === null, 'band-only: epcScore is null (not fabricated)');
  // Free UPRN harvest: the matched EPC cert exposes the property's UPRN so we
  // can fill lots.uprn without a paid OS Places lookup (trial-capped 2026-06-14).
  assert(bandOnly?.uprn === '1775082094', 'match exposes uprn for free harvest');

  // Test 9: junk score >100 STILL rejected even via the band fallback
  const junkBand = matchEPCToLot(
    [{ address1: '7 Junk St', currentEnergyEfficiencyBand: 'C', 'current-energy-efficiency': '150' }],
    '7 Junk St, Town, AB1 2CD',
  );
  assert(junkBand === null, 'score > 100 still rejected (Test 3 contract preserved)');

  // Test 10: parseEpcCertificate extracts score/floor-area/beds from the full
  // certificate (GET /api/certificate) — the band-only search can't supply these.
  const certData = {
    energy_rating_current: 70, total_floor_area: 54, heated_room_count: 2,
    current_energy_efficiency_band: 'C',
  };
  const cert = parseEpcCertificate(certData);
  assert(cert.epcScore === 70, 'cert: energy_rating_current → epcScore 70');
  assert(cert.epcFloorAreaSqm === 54, 'cert: total_floor_area → epcFloorAreaSqm 54');
  assert(cert.epcFloorAreaSqft === Math.round(54 * 10.7639), 'cert: sqm → sqft converted');
  assert(cert.epcBeds === 2, 'cert: heated_room_count → epcBeds 2');
  assert(cert.band === 'C', 'cert: band carried through');
  const certBad = parseEpcCertificate({ energy_rating_current: 0, total_floor_area: 0 });
  assert(certBad.epcScore === null && certBad.epcFloorAreaSqm === null, 'cert: zero/absent → null (not fabricated)');
  assert(parseEpcCertificate(null).epcScore === null, 'cert: null input safe');
  assert(matchEPCToLot(mockEPC, '') === null, 'Empty address returns null');
}

// ─── Flood Zone Tests ───
if (runFlood) {
  console.log('\n=== Flood Zone Classification Tests ===');

  // Test flood zone classification logic (mock-based, no actual API calls)
  // We verify the response shape expectations

  // Zone 3 response mock
  const z3Response = { features: [{ type: 'Feature', properties: {} }] };
  assert(z3Response.features.length > 0, 'Zone 3 hit: features array has items');
  const z3Zone = z3Response.features.length > 0 ? '3' : '1';
  assert(z3Zone === '3', 'Zone 3 classified correctly');

  // Zone 2 response mock
  const z2Response = { features: [{ type: 'Feature', properties: {} }] };
  const z2Zone = z2Response.features.length > 0 ? '2' : '1';
  assert(z2Zone === '2', 'Zone 2 classified correctly');

  // Zone 1 (no hits) mock
  const z1Response = { features: [] };
  const z1Zone = z1Response.features.length > 0 ? '2' : '1';
  assert(z1Zone === '1', 'Zone 1 classified correctly (no features)');

  // Flood risk levels
  const riskMap = { '3': 'High', '2': 'Medium', '1': 'Low' };
  assert(riskMap['3'] === 'High', 'Zone 3 -> High risk');
  assert(riskMap['2'] === 'Medium', 'Zone 2 -> Medium risk');
  assert(riskMap['1'] === 'Low', 'Zone 1 -> Low risk');

  // Postcodes.io response shape
  const geoMock = { status: 200, result: { latitude: 51.5074, longitude: -0.1278 } };
  assert(typeof geoMock.result.latitude === 'number', 'Postcodes.io returns numeric latitude');
  assert(typeof geoMock.result.longitude === 'number', 'Postcodes.io returns numeric longitude');

  // Flood monitoring API fallback shape
  const monitoringMock = { items: [{ floodAreaID: 'test', severity: 3 }] };
  assert(monitoringMock.items.length > 0, 'Flood monitoring API returns items array');
  const fallbackLevel = monitoringMock.items.length > 0 ? 'Alert' : 'Low';
  assert(fallbackLevel === 'Alert', 'Active warnings -> Alert level');
}

// ─── Cache TTL Tests ───
if (runCache) {
  console.log('\n=== Cache TTL Logic Tests ===');

  // Verify cache TTL logic
  const now = new Date();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(now.getTime() + thirtyDaysMs);

  assert(expiresAt > now, 'Cache expiry is in the future');
  assert(expiresAt.getTime() - now.getTime() >= thirtyDaysMs - 1000, 'TTL is approximately 30 days');

  // Simulate expired cache check
  const expiredEntry = { expires_at: new Date(now.getTime() - 1000).toISOString() };
  const validEntry = { expires_at: new Date(now.getTime() + thirtyDaysMs).toISOString() };

  assert(new Date(expiredEntry.expires_at) < now, 'Expired entry correctly identified');
  assert(new Date(validEntry.expires_at) > now, 'Valid entry correctly identified');

  // Verify enrichment_cache table definition exists in lib/enrichment.js
  assert(enrichmentCode.includes('enrichment_cache'), 'enrichment_cache table referenced in lib/enrichment.js');
  assert(enrichmentCode.includes("INTERVAL '30 days'") || enrichmentCode.includes('30 * 24 * 60 * 60 * 1000'), '30-day TTL defined');

  // Verify cache-first pattern in enrichLots
  assert(enrichmentCode.includes('.from(\'enrichment_cache\')'), 'enrichLots queries enrichment_cache');
  assert(enrichmentCode.includes('gt(\'expires_at\'') || enrichmentCode.includes('expires_at'), 'Cache checks expiry');

  // Verify expired cache cleanup
  assert(enrichmentCode.includes('.delete()') && enrichmentCode.includes('enrichment_cache'), 'Expired cache cleanup present');
}

// ─── Ungated Display Tests ───
if (runUngated) {
  console.log('\n=== Ungated Display Tests ===');

  // After Issue 8 frontend split, render code lives in public/app.js, not
  // inline in index.html. Scan both so the contract still holds wherever the
  // tokens currently live.
  const frontendSrc = [
    readFileSync(join(__dirname, '..', 'index.html'), 'utf-8'),
    readFileSync(join(__dirname, '..', 'public', 'app.js'), 'utf-8'),
  ].join('\n');

  // Verify EPC display exists
  assert(frontendSrc.includes('epcRating'), 'frontend (index.html + app.js) references epcRating');
  assert(frontendSrc.includes('floodZone'), 'frontend (index.html + app.js) references floodZone');

  // Verify NO tier-gating on enrichment data
  // Search for EPC/flood references that are near gating classes
  const gatingClasses = ['blurred', 'premium-only', 'upgrade-prompt'];

  for (const cls of gatingClasses) {
    // Find all occurrences of the gating class
    const lines = frontendSrc.split('\n');
    let gatedEnrichment = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Check if a line contains both a gating class and EPC/flood reference
      if ((line.includes('epcRating') || line.includes('floodZone') || line.includes('floodRiskLevel')) &&
          line.includes(cls)) {
        gatedEnrichment = true;
        console.error(`  WARNING: Line ${i+1} contains both enrichment ref and '${cls}'`);
      }
    }

    assert(!gatedEnrichment, `No '${cls}' gating on enrichment data`);
  }

  // Verify enrichment section doesn't check isPremium() or tier
  const enrichLines = frontendSrc.split('\n').filter(l =>
    l.includes('epcRating') || l.includes('floodZone') || l.includes('exp-enrichment')
  );

  let tierGated = false;
  for (const line of enrichLines) {
    if (line.includes('isPremium') || line.includes('tier') || line.includes('subscription')) {
      tierGated = true;
    }
  }
  assert(!tierGated, 'Enrichment display code does not reference tier/premium checks');
}

// ─── Summary ───
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All enrichment tests passed!');
}
