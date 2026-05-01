// public/town-match.js — town-search predicate shared by index.html and tests.
//
// Bug fixed: searching "Bristol" matched only lots whose `address` contained
// the literal token. ~95% of Bristol lots store the city only in `postcode`
// (e.g. "BS1 5HX") and got dropped. We now also accept a postcode-area match
// for the typed town (bristol → BS area).
//
// Loaded in index.html as a plain <script> (exposes window.AB_townMatch) and
// imported by tests/test-search-filter.js via JSDOM.

(function (root) {
  // Major-city town → postcode area code(s). Areas overlap intentionally
  // (e.g. Sheffield + Rotherham both use S) — we accept the union.
  const TOWN_POSTCODE_PREFIXES = {
    bristol: ['BS'],
    bath: ['BA'],
    birmingham: ['B'],
    blackburn: ['BB'],
    blackpool: ['FY'],
    bolton: ['BL'],
    bournemouth: ['BH'],
    bradford: ['BD'],
    brighton: ['BN'],
    cambridge: ['CB'],
    canterbury: ['CT'],
    cardiff: ['CF'],
    carlisle: ['CA'],
    chester: ['CH'],
    coventry: ['CV'],
    crewe: ['CW'],
    derby: ['DE'],
    doncaster: ['DN'],
    dundee: ['DD'],
    durham: ['DH'],
    edinburgh: ['EH'],
    exeter: ['EX'],
    glasgow: ['G'],
    gloucester: ['GL'],
    guildford: ['GU'],
    halifax: ['HX'],
    hereford: ['HR'],
    huddersfield: ['HD'],
    hull: ['HU'],
    ipswich: ['IP'],
    lancaster: ['LA'],
    leeds: ['LS'],
    leicester: ['LE'],
    lincoln: ['LN'],
    liverpool: ['L'],
    luton: ['LU'],
    manchester: ['M'],
    'milton keynes': ['MK'],
    newcastle: ['NE'],
    northampton: ['NN'],
    norwich: ['NR'],
    nottingham: ['NG'],
    oxford: ['OX'],
    peterborough: ['PE'],
    plymouth: ['PL'],
    portsmouth: ['PO'],
    preston: ['PR'],
    reading: ['RG'],
    rotherham: ['S'],
    sheffield: ['S'],
    shrewsbury: ['SY'],
    southampton: ['SO'],
    stoke: ['ST'],
    sunderland: ['SR'],
    swansea: ['SA'],
    swindon: ['SN'],
    telford: ['TF'],
    warrington: ['WA'],
    watford: ['WD'],
    wolverhampton: ['WV'],
    worcester: ['WR'],
    york: ['YO']
  };

  function getPostcodeArea(value) {
    if (!value) return '';
    const m = String(value).toUpperCase().match(/^([A-Z]{1,2})\d/);
    return m ? m[1] : '';
  }

  // Test a lot against a typed town. Matches when:
  //   1. The lot's address contains the town string (substring, case-insensitive), OR
  //   2. The town has known postcode area codes AND the lot's postcode (or
  //      address-extracted prefix) matches one of them.
  function townMatchesLot(lot, town) {
    if (!town) return true;
    const townLower = String(town).trim().toLowerCase();
    if (!townLower) return true;
    const addr = (lot && lot.address) || '';
    if (addr.toLowerCase().includes(townLower)) return true;
    const prefixes = TOWN_POSTCODE_PREFIXES[townLower];
    if (!prefixes || !prefixes.length) return false;
    const area = getPostcodeArea((lot && lot.postcode) || '') || getPostcodeArea(addr);
    return !!(area && prefixes.includes(area));
  }

  const api = { TOWN_POSTCODE_PREFIXES, getPostcodeArea, townMatchesLot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AB_townMatch = api;
})(typeof window !== 'undefined' ? window : null);
