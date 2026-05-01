// Edward Mellor single-lot detail extractor
// URL pattern: https://edwardmellor.co.uk/property-for-sale/{id}
//
// Why this exists: the catalogue page (https://www.edwardmellor.co.uk/auction/)
// renders lot cards with addresses truncated at the outward postcode (e.g.
// "Vernon Road, Bredbury, SK6"). The full postcode (`SK6 1QG`) only appears on
// the lot detail page, inside the first `.description > p` paragraph.
//
// Detected via the `extractor_postcode_regression` alert that fired on
// 2026-05-01 (postcode coverage 100% → 1.5%) when EM's catalogue listing
// switched to outward-only address lines. This extractor restores coverage
// via the existing enrichLotsFromLotPages() detail-fetch path — no other
// pipeline changes needed.

const POSTCODE_RE = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s+\d[A-Z]{2}\b/i;

export default function extractEdwardmellor(document) {
  const out = {};

  // Strategy 1 (primary): the first `.description > p` containing a UK postcode
  // is always THIS lot's address. Other postcodes on the page (related lots
  // sidebar, branch addresses) live outside `.description`, so scoping is safe.
  const desc = document.querySelector('.description');
  if (desc) {
    for (const p of desc.querySelectorAll('p')) {
      const text = (p.textContent || '').replace(/\s+/g, ' ').trim();
      const m = text.match(POSTCODE_RE);
      if (m) {
        out.postcode = m[0].toUpperCase().replace(/\s+/g, ' ');
        // Use the paragraph as a richer address only if it looks address-shaped
        // (has commas, isn't too long — guards against the postcode appearing
        // in a prose paragraph instead of an address line).
        if (text.length < 200 && text.split(',').length >= 3) {
          out.address = text;
        }
        break;
      }
    }
  }

  // Strategy 2 (fallback): hidden form field that some EM templates populate
  // with `$propertyNameField.val('...')` — captures the postcode-bearing
  // address when `.description` is absent or unfilled.
  if (!out.postcode) {
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      const code = s.textContent || '';
      const m = code.match(/\$propertyNameField\.val\(['"]([^'"]+)['"]\)/);
      if (m) {
        const pc = m[1].match(POSTCODE_RE);
        if (pc) {
          out.postcode = pc[0].toUpperCase().replace(/\s+/g, ' ');
          if (!out.address && m[1].length < 200) out.address = m[1].trim();
        }
        break;
      }
    }
  }

  return out;
}
