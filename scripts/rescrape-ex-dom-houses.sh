#!/usr/bin/env bash
# scripts/rescrape-ex-dom-houses.sh — One-off rescrape for the 43 houses
# whose extraction path materially changed in the DOM-extractor retirement.
#
# Usage:
#   ADMIN_SECRET=<secret> AUCTION_BASE_URL=https://auctions.bridgematch.co.uk \
#     bash scripts/rescrape-ex-dom-houses.sh
#
# Or smoke-test a single house first:
#   ADMIN_SECRET=<secret> AUCTION_BASE_URL=https://auctions.bridgematch.co.uk \
#     bash scripts/rescrape-ex-dom-houses.sh barnardmarcus
#
# Strategy: clear cache + force rescrape per house, sequentially with a
# 30-second pause between waves of 5 to respect Firecrawl rate limits.
# Logs lot count before vs after for each house. Stops on first hard
# error (non-2xx response).

set -euo pipefail

if [[ -z "${ADMIN_SECRET:-}" ]]; then
  echo "ERROR: ADMIN_SECRET env var not set." >&2
  echo "Run: ADMIN_SECRET=<secret> bash scripts/rescrape-ex-dom-houses.sh" >&2
  exit 1
fi

BASE="${AUCTION_BASE_URL:-https://auctions.bridgematch.co.uk}"
SUPABASE_URL_VAR="${SUPABASE_URL:-}"
SUPABASE_KEY_VAR="${SUPABASE_SERVICE_KEY:-${SUPABASE_ANON_KEY:-}}"

# The 43 ex-DOM houses (deleted from lib/extractors/houses/ in commit 1173a77).
HOUSES=(
  savills network barnardmarcus auctionhouselondon cliveemson
  strettons acuitus pattinson bidx1 philliparnold edwardmellor
  barnettross cottons dedmangray probateauction connectuk
  auctionestates loveitts robinsonhall goldings dawsons durrants
  agentsproperty andrewcraig buttersjohnbee cheffins fssproperty
  wilsons strakers underthehammer symondsandsampson shonkibros
  bagshaws propertysolvers pugh pearsons nesbits smithandsons
  brutonknowles mccartneys bramleys morrismarshall cleetompkinson
)

# Single-house smoke test mode
if [[ $# -ge 1 ]]; then
  HOUSES=("$1")
  echo "Smoke-test mode: rescraping '$1' only"
fi

# Optional Supabase lookup of pre-rescrape lot count.
get_count() {
  local slug=$1
  if [[ -z "$SUPABASE_URL_VAR" || -z "$SUPABASE_KEY_VAR" ]]; then
    echo "?"; return
  fi
  curl -s -H "apikey: $SUPABASE_KEY_VAR" -H "Authorization: Bearer $SUPABASE_KEY_VAR" \
    "$SUPABASE_URL_VAR/rest/v1/lots?select=id&house=ilike.$slug&limit=1000" \
    | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?"
}

call_admin() {
  local path=$1; local body=$2
  curl -sS -X POST "$BASE$path" \
    -H "Content-Type: application/json" \
    -H "Origin: $BASE" \
    -H "x-admin-secret: $ADMIN_SECRET" \
    -d "$body" \
    -w "\nHTTP %{http_code}\n" \
    --max-time 30
}

echo "=== Rescraping ${#HOUSES[@]} ex-DOM house(s) ==="
echo "Base URL: $BASE"
echo "Started:  $(date -u +%FT%TZ)"
echo

WAVE_SIZE=5
WAVE_PAUSE_S=30

i=0
for slug in "${HOUSES[@]}"; do
  i=$((i+1))
  before=$(get_count "$slug")
  echo "--- [$i/${#HOUSES[@]}] $slug (before: $before lots) ---"

  # Trigger rescrape (which clears the house's cached_analyses + analyses each URL).
  echo "  rescrape..."
  resp=$(call_admin "/api/admin/rescrape" "{\"house\":\"$slug\"}")
  code=$(echo "$resp" | tail -1 | awk '{print $2}')
  if [[ "$code" != "200" && "$code" != "202" ]]; then
    echo "  ERROR: rescrape returned $code"
    echo "  Response: $(echo "$resp" | head -1)"
    echo "  Halting. Investigate before continuing."
    exit 1
  fi
  echo "  ok (HTTP $code)"

  # Wave pause every WAVE_SIZE houses.
  if (( i % WAVE_SIZE == 0 )) && (( i < ${#HOUSES[@]} )); then
    echo
    echo "--- Wave done. Pausing ${WAVE_PAUSE_S}s before next wave (Firecrawl rate-limit headroom) ---"
    sleep "$WAVE_PAUSE_S"
  fi
done

echo
echo "=== All done ==="
echo "Finished: $(date -u +%FT%TZ)"
echo
echo "Next steps:"
echo "  1. Wait ~120s for the last rescrapes to finish."
echo "  2. Run get_count on each slug to compare before vs after."
echo "  3. Query pipeline_alerts for new event_type='extractor_regression'"
echo "     OR event_type='recall_diagnostic' rows whose house IS IN the list."
