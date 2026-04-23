// lib/extractors/details/index.js — Registry of per-house DETAIL extractors
//
// A detail extractor is a template literal IIFE that runs in a JSDOM context
// (see ./runner.js) and returns a single lot object:
//
//   { address, postcode, price, priceText, bullets[], images[], imageUrl,
//     tenure, leaseLength, propType, beds, vacant, viewingDates[], condition }
//
// All fields are optional except `address` (string) and `images[]` (array).
// Returning {} is acceptable and will fall through to the universal text-regex
// extractor (existing logic in enrichLotsFromLotPages).

import maggsandallen from './maggsandallen.js';
import hollismorgan from './hollismorgan.js';
import fssproperty from './fssproperty.js';

export const DETAIL_EXTRACTORS = {
  maggsandallen,
  hollismorgan,
  fssproperty,
};
