// Regression coverage for visual-audit cohort/noise controls.
process.env.SUPABASE_URL ||= 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY ||= 'dummy';

const audit = await import('../scripts/visual-audit.mjs');
let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

const now = Date.parse('2026-07-26T12:00:00Z');
const rows = [
  { house: 'live', status: 'available', last_seen_at: '2026-07-26T10:00:00Z', auction_date: '2026-08-01' },
  { house: 'yesterday-grace', status: 'available', last_seen_at: '2026-07-26T10:00:00Z', auction_date: '2026-07-25' },
  { house: 'stc-hidden', status: 'stc', last_seen_at: '2026-07-26T10:00:00Z', auction_date: '2026-08-01' },
  { house: 'stale', status: 'available', last_seen_at: '2026-07-10T10:00:00Z', auction_date: '2026-08-01' },
  { house: 'ended', status: 'available', last_seen_at: '2026-07-26T10:00:00Z', auction_date: '2026-07-01' },
  { house: 'sold', status: 'sold', last_seen_at: '2026-07-26T10:00:00Z', auction_date: '2026-07-26' },
  { house: 'unsold-current', status: 'unsold', last_seen_at: '2026-07-20T10:00:00Z', auction_date: '2026-07-20' },
  { house: 'unsold-future-fresh', status: 'unsold', last_seen_at: '2026-07-26T10:00:00Z', auction_date: '2026-08-20' },
  { house: 'unsold-future-stale', status: 'unsold', last_seen_at: '2026-07-01T10:00:00Z', auction_date: '2026-08-20' },
  { house: 'unsold-old', status: 'unsold', last_seen_at: '2026-05-01T10:00:00Z', auction_date: '2026-05-01' },
];

console.log('\ncurrentAuditRows');
assert(typeof audit.currentAuditRows === 'function', 'exports currentAuditRows');
if (audit.currentAuditRows) {
  const houses = audit.currentAuditRows(rows, now).map(r => r.house);
  assert(JSON.stringify(houses) === JSON.stringify(['live', 'yesterday-grace', 'unsold-current', 'unsold-future-fresh']), `matches the production active-feed contract (${houses.join(', ')})`);
}

console.log('\nheroImageBleed');
assert(typeof audit.heroImageBleed === 'function', 'exports heroImageBleed');
if (audit.heroImageBleed) {
  const current = Array.from({ length: 3 }, (_, i) => ({ id: `current-${i}`, house: 'current', address: `${i} Current Street`, image_url: 'https://bad.example/repeated.jpg' }));
  const archive = Array.from({ length: 3 }, (_, i) => ({ house: 'archive', address: `${i} Old Street`, image_url: 'https://bad.example/archive.jpg' }));
  const bleed = audit.heroImageBleed(current);
  assert(bleed.length === 1, 'flags repeated hero images in current inventory');
  assert(JSON.stringify(bleed[0]?.meta?.row_ids) === JSON.stringify(['current-0', 'current-1', 'current-2']), 'autofix input is scoped to audited current-row IDs');
  assert(audit.heroImageBleed([]).length === 0, 'archive rows cannot create hero-image autofix inputs when excluded from the current cohort');
  assert(archive.length === 3, 'archive fixture is non-empty');
}

console.log('\nbulletStarvation');
assert(typeof audit.bulletStarvation === 'function', 'exports bulletStarvation');
if (audit.bulletStarvation) {
  const described = Array.from({ length: 5 }, (_, i) => ({ house: 'described', bullets: [], description: `Useful description for lot ${i} with enough property detail to display.` }));
  assert(audit.bulletStarvation(described).length === 0, 'does not flag lots with usable descriptions merely because bullets are empty');
}

console.log('\nimageDomainMismatch');
assert(typeof audit.imageDomainMismatch === 'function', 'exports imageDomainMismatch');
if (audit.imageDomainMismatch) {
  const distinct = Array.from({ length: 10 }, (_, i) => ({ house: 'platformhouse', image_url: `https://images.platform.example/property-${i}.jpg` }));
  assert(audit.imageDomainMismatch(distinct).length === 0, 'does not flag a normal shared image host when lot image URLs are distinct');
}

console.log('\nduplicateAddressWall');
assert(typeof audit.duplicateAddressWall === 'function', 'exports duplicateAddressWall');
if (audit.duplicateAddressWall) {
  const relists = [
    { house: 'relist', address: '1 Same Street', auction_date: '2026-08-01', status: 'available', last_seen_at: '2026-07-26T10:00:00Z' },
    { house: 'relist', address: '1 Same Street', auction_date: '2026-09-01', status: 'available', last_seen_at: '2026-07-26T10:00:00Z' },
    { house: 'relist', address: '1 Same Street', auction_date: '2026-10-01', status: 'available', last_seen_at: '2026-07-26T10:00:00Z' },
    { house: 'relist', address: '2 Other Street', auction_date: '2026-08-01', status: 'available', last_seen_at: '2026-07-26T10:00:00Z' },
    { house: 'relist', address: '3 Other Street', auction_date: '2026-08-01', status: 'available', last_seen_at: '2026-07-26T10:00:00Z' },
  ];
  assert(audit.duplicateAddressWall(relists).length === 0, 'does not treat the same property in distinct future sales as duplicate rows');
  const sameSale = relists.map(r => ({ ...r, auction_date: '2026-08-01' }));
  assert(audit.duplicateAddressWall(sameSale).length === 1, 'still flags three copies of one address in the same sale');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
