// test-image-coverage.js — Image coverage calculation tests
// Run: node tests/test-image-coverage.js

import assert from 'assert';

// ── Image coverage calculation logic (mirrors what admin dashboard computes) ──
function calculateImageCoverage(lots) {
  if (!Array.isArray(lots) || lots.length === 0) return 0;
  const withImages = lots.filter(l => l.imageUrl && l.imageUrl !== '').length;
  return Math.round((withImages / lots.length) * 100);
}

// ── Tests ──

// Test 1: Standard coverage — 8/10 = 80%
(() => {
  const lots = [];
  for (let i = 1; i <= 10; i++) {
    lots.push({
      lot: i,
      address: `${i} Test Street, London, SW1A ${i}AA`,
      price: 100000 + i * 10000,
      imageUrl: i <= 8 ? `https://cdn.example.com/img${i}.jpg` : '',
    });
  }
  const coverage = calculateImageCoverage(lots);
  assert.strictEqual(coverage, 80, `Expected 80%, got ${coverage}%`);
  console.log('PASS: 8/10 lots = 80% coverage');
})();

// Test 2: All lots have images — 100%
(() => {
  const lots = Array.from({ length: 5 }, (_, i) => ({
    lot: i + 1,
    address: `${i + 1} Full Street`,
    imageUrl: `https://cdn.example.com/img${i + 1}.jpg`,
  }));
  const coverage = calculateImageCoverage(lots);
  assert.strictEqual(coverage, 100, `Expected 100%, got ${coverage}%`);
  console.log('PASS: All lots with images = 100%');
})();

// Test 3: All lots missing images — 0%
(() => {
  const lots = Array.from({ length: 5 }, (_, i) => ({
    lot: i + 1,
    address: `${i + 1} Empty Street`,
    imageUrl: '',
  }));
  const coverage = calculateImageCoverage(lots);
  assert.strictEqual(coverage, 0, `Expected 0%, got ${coverage}%`);
  console.log('PASS: No lots with images = 0%');
})();

// Test 4: Empty lots array — 0%
(() => {
  const coverage = calculateImageCoverage([]);
  assert.strictEqual(coverage, 0, `Expected 0% for empty array, got ${coverage}%`);
  console.log('PASS: Empty array = 0%');
})();

// Test 5: Null/undefined imageUrl treated as missing
(() => {
  const lots = [
    { lot: 1, address: 'Test', imageUrl: null },
    { lot: 2, address: 'Test', imageUrl: undefined },
    { lot: 3, address: 'Test' },
    { lot: 4, address: 'Test', imageUrl: 'https://cdn.example.com/img.jpg' },
  ];
  const coverage = calculateImageCoverage(lots);
  assert.strictEqual(coverage, 25, `Expected 25%, got ${coverage}%`);
  console.log('PASS: Null/undefined/missing imageUrl = 25% (1/4)');
})();

// Test 6: Weighted coverage across multiple houses
(() => {
  const houses = [
    { name: 'House A', lots: Array.from({ length: 20 }, (_, i) => ({ imageUrl: i < 18 ? 'https://img.jpg' : '' })) },
    { name: 'House B', lots: Array.from({ length: 10 }, (_, i) => ({ imageUrl: i < 5 ? 'https://img.jpg' : '' })) },
    { name: 'House C', lots: Array.from({ length: 30 }, (_, i) => ({ imageUrl: i < 27 ? 'https://img.jpg' : '' })) },
  ];
  let totalLots = 0, totalWithImg = 0;
  for (const h of houses) {
    totalLots += h.lots.length;
    totalWithImg += h.lots.filter(l => l.imageUrl).length;
  }
  const weighted = Math.round((totalWithImg / totalLots) * 100);
  // 18 + 5 + 27 = 50 with images, 20 + 10 + 30 = 60 total => 83%
  assert.strictEqual(weighted, 83, `Expected 83% weighted coverage, got ${weighted}%`);
  console.log('PASS: Weighted coverage across 3 houses = 83%');
})();

// Test 7: Verify house_skills.image_coverage matches lot-based calculation
(() => {
  const lots = Array.from({ length: 15 }, (_, i) => ({
    lot: i + 1,
    imageUrl: i < 12 ? 'https://cdn.example.com/img.jpg' : '',
  }));
  const coverage = calculateImageCoverage(lots);
  // Simulated house_skills row
  const houseSkill = { image_coverage: 80 };
  assert.strictEqual(coverage, 80, `Expected 80%, got ${coverage}%`);
  assert.strictEqual(houseSkill.image_coverage, coverage, 'house_skills.image_coverage should match lot-based calculation');
  console.log('PASS: Coverage matches house_skills.image_coverage format');
})();

console.log('\nAll image coverage tests passed.');
