-- migrations/2026-07-04-normalise-postcode-sales-property-type.sql
--
-- Unify the postcode_sales.property_type vocabulary (2026-07-03 naming audit).
-- The retired live SPARQL endpoint wrote lowercase slugs ('terraced',
-- 'flat-maisonette'); the current hmlr_ppd path writes Title style
-- ('Terraced', 'Flat/Maisonette') via PPD_TYPE_LABEL. Both forms were still
-- landing as of 2026-07-03 (~21k rows each) because cached lr_data fans back
-- out on cache hits. Companion code change: canonPropertyType() in
-- lib/enrichment.js normalises at the write site from this commit onward.
--
-- Canonical set (matches PPD_TYPE_LABEL): Detached, Semi-Detached, Terraced,
-- Flat/Maisonette, Other. Idempotent: rows already canonical are untouched.

update postcode_sales
set property_type = case lower(property_type)
  when 'terraced'        then 'Terraced'
  when 'semi-detached'   then 'Semi-Detached'
  when 'detached'        then 'Detached'
  when 'flat-maisonette' then 'Flat/Maisonette'
  when 'flat/maisonette' then 'Flat/Maisonette'
  when 'other'           then 'Other'
  else property_type
end
where property_type is not null
  and lower(property_type) in
    ('terraced', 'semi-detached', 'detached', 'flat-maisonette', 'flat/maisonette', 'other')
  and property_type is distinct from case lower(property_type)
    when 'terraced'        then 'Terraced'
    when 'semi-detached'   then 'Semi-Detached'
    when 'detached'        then 'Detached'
    when 'flat-maisonette' then 'Flat/Maisonette'
    when 'flat/maisonette' then 'Flat/Maisonette'
    when 'other'           then 'Other'
    else property_type
  end;
