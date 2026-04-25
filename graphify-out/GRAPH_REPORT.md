# Graph Report - C:\Users\User\Documents\GitHub\Auction  (2026-04-17)

## Corpus Check
- 64 files · ~250,086 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 851 nodes · 2197 edges · 37 communities detected
- Extraction: 72% EXTRACTED · 28% INFERRED · 0% AMBIGUOUS · INFERRED: 624 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]

## God Nodes (most connected - your core abstractions)
1. `log()` - 92 edges
2. `map()` - 65 edges
3. `filter()` - 63 edges
4. `nt()` - 59 edges
5. `from()` - 52 edges
6. `ResourceBudget` - 41 edges
7. `_returnResult()` - 35 edges
8. `zt()` - 34 edges
9. `_doAutoAnalyseAll()` - 33 edges
10. `match()` - 32 edges

## Surprising Connections (you probably didn't know these)
- `initAI()` --calls--> `log()`  [INFERRED]
  C:\Users\User\Documents\GitHub\Auction\lib\ai-provider.js → C:\Users\User\Documents\GitHub\Auction\public\supabase.min.js
- `_doAutoAnalyseAll()` --calls--> `resetCycleSignals()`  [INFERRED]
  C:\Users\User\Documents\GitHub\Auction\lib\analysis.js → C:\Users\User\Documents\GitHub\Auction\lib\pipeline\harness-bridge.js
- `safeCompare()` --calls--> `from()`  [INFERRED]
  C:\Users\User\Documents\GitHub\Auction\lib\auth.js → C:\Users\User\Documents\GitHub\Auction\public\supabase.min.js
- `stripAIFields()` --calls--> `map()`  [INFERRED]
  C:\Users\User\Documents\GitHub\Auction\lib\config.js → C:\Users\User\Documents\GitHub\Auction\public\supabase.min.js
- `extractStreet()` --calls--> `match()`  [INFERRED]
  C:\Users\User\Documents\GitHub\Auction\lib\enrichment.js → C:\Users\User\Documents\GitHub\Auction\public\supabase.min.js

## Communities

### Community 0 - "Community 0"
Cohesion: 0.04
Nodes (107): fireAlert(), getUnresolved(), resolveAlert(), loadBrokenExtractors(), autoAnalyseAll(), autoAnalyseOne(), buildSearchText(), clearHealingCooldown() (+99 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (84): analyseLot(), extractPriceFromText(), detectProblems(), enrichStage(), extractWithJSDOM(), getLastExtractorUsed(), isValidImageUrl(), resetBrokenExtractors() (+76 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (97): _acquireLock(), _approveAuthorization(), _authenticate(), _autoRefreshTokenTick(), br(), Bt(), _callRefreshToken(), _challenge() (+89 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (22): ae(), channel(), createNamespace(), createNamespaceIfNotExists(), dropNamespace(), _emitInitialSession(), f(), fe() (+14 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (1): ResourceBudget

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (22): initAnalysis(), EnrichmentService, initExperiment(), computeFieldCoverage(), extract(), initModularExtractor(), mergeDomai(), assessHealingConfidence() (+14 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (24): buildPageUrl(), detectAuctionHouse(), detectTotalPages(), extractLotsWithClaude(), fetchPage(), handler(), scrapeAllPages(), dbRowToLot() (+16 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (24): callAI(), callClaudeProvider(), callGeminiProvider(), callGrokProvider(), estimateCost(), initAI(), logAICost(), rateLimited() (+16 more)

### Community 8 - "Community 8"
Cohesion: 0.08
Nodes (29): safeCompare(), verifySupabaseToken(), api_call(), check_table_exists(), get_table_count(), insert_calendar_rows(), main(), Auction Tool — One-time setup script ===================================== Cre (+21 more)

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (29): copy(), createBucket(), createIndex(), createSignedUploadUrl(), createSignedUrl(), createSignedUrls(), deleteBucket(), deleteIndex() (+21 more)

### Community 10 - "Community 10"
Cohesion: 0.1
Nodes (28): _appendParams(), _clearAllTimers(), _clearTimer(), connect(), disconnect(), endpointURL(), _handleTokenChanged(), isConnecting() (+20 more)

### Community 11 - "Community 11"
Cohesion: 0.14
Nodes (16): autoDisableBrokenHouses(), discoverNewHouses(), extractBraceBlock(), extractConfig(), extractStatedCountFromReality(), extractTemplateLiteral(), fetchProductionData(), imageCoverageAnalysis() (+8 more)

### Community 12 - "Community 12"
Cohesion: 0.09
Nodes (23): constructor(), _hasReceived(), _initializeOptions(), _initRealtimeClient(), _initSupabaseAuthClient(), K(), _listenForAuthEvents(), _logPrefix() (+15 more)

### Community 13 - "Community 13"
Cohesion: 0.12
Nodes (20): _addToPushBuffer(), _canPush(), connectionState(), _fetchWithTimeout(), flushSendBuffer(), httpSend(), inPendingSyncState(), isConnected() (+12 more)

### Community 14 - "Community 14"
Cohesion: 0.31
Nodes (12): applyCodeFixes(), applyRuntimeFixes(), buildEmailHtml(), categoriseResults(), extractBraceBlock(), fixDomainMoved(), fixNeedsPuppeteer(), main() (+4 more)

### Community 15 - "Community 15"
Cohesion: 0.24
Nodes (11): isValidImageUrl(), normaliseAddress(), normalisePrice(), normalisePropType(), normaliseTenure(), validateLot(), enrichBatch(), extractBedsFromAddress() (+3 more)

### Community 16 - "Community 16"
Cohesion: 0.17
Nodes (12): _cancelRefEvent(), _cancelTimeout(), destroy(), finally(), _isLeaving(), _leaveOpenTopic(), _off(), _rejoin() (+4 more)

### Community 17 - "Community 17"
Cohesion: 0.42
Nodes (8): buildBridgematchUrl(), detectGeography(), enrichLotsWithFundability(), getCached(), getFundabilityBadge(), mapLotToDeal(), _mapPropertyType(), setCache()

### Community 18 - "Community 18"
Cohesion: 0.25
Nodes (9): B(), C(), D(), invoke(), L(), N(), q(), U() (+1 more)

### Community 19 - "Community 19"
Cohesion: 0.29
Nodes (8): download(), exists(), _getFinalPath(), getPublicUrl(), he(), _removeEmptyFolders(), transformOptsToQueryString(), uploadToSignedUrl()

### Community 20 - "Community 20"
Cohesion: 0.29
Nodes (8): createTable(), createTableIfNotExists(), dropTable(), listTables(), loadTable(), ne(), tableExists(), updateTable()

### Community 21 - "Community 21"
Cohesion: 0.29
Nodes (3): getCacheTTL(), stripAIFields(), truncateAddress()

### Community 22 - "Community 22"
Cohesion: 0.33
Nodes (2): onExtract(), sseWrite()

### Community 23 - "Community 23"
Cohesion: 0.33
Nodes (6): ar(), At(), Rt(), sr(), t(), vr()

### Community 24 - "Community 24"
Cohesion: 0.6
Nodes (5): er(), Ot(), Pt(), toJSON(), tr()

### Community 25 - "Community 25"
Cohesion: 0.83
Nodes (4): cloneDeep(), syncDiff(), syncState(), transformState()

### Community 26 - "Community 26"
Cohesion: 0.5
Nodes (4): createWebSocket(), detectEnvironment(), getWebSocketConstructor(), isWebSocketSupported()

### Community 27 - "Community 27"
Cohesion: 0.5
Nodes (0): 

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **7 isolated node(s):** `Auction Tool — One-time setup script ===================================== Cre`, `Make a request to the Supabase REST API.`, `Call the Auction app's API endpoints.`, `Check if a table exists by trying to select from it.`, `Get row count from a table.` (+2 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 28`** (1 nodes): `server.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (1 nodes): `supabase.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (1 nodes): `index.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (1 nodes): `auth.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (1 nodes): `calendar.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (1 nodes): `leads.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (1 nodes): `stripe.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (1 nodes): `test-btg-extractor.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (1 nodes): `test-new-houses.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `log()` connect `Community 1` to `Community 0`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 7`, `Community 10`, `Community 11`, `Community 13`, `Community 14`, `Community 16`?**
  _High betweenness centrality (0.225) - this node is a cross-community bridge._
- **Why does `filter()` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 7`, `Community 8`, `Community 9`, `Community 11`, `Community 13`, `Community 14`, `Community 15`, `Community 16`?**
  _High betweenness centrality (0.119) - this node is a cross-community bridge._
- **Why does `map()` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 5`, `Community 6`, `Community 7`, `Community 8`, `Community 10`, `Community 11`, `Community 12`, `Community 13`, `Community 14`, `Community 18`, `Community 21`, `Community 25`?**
  _High betweenness centrality (0.092) - this node is a cross-community bridge._
- **Are the 77 inferred relationships involving `log()` (e.g. with `initAI()` and `qualityGate()`) actually correct?**
  _`log()` has 77 INFERRED edges - model-reasoned connections that need verification._
- **Are the 47 inferred relationships involving `map()` (e.g. with `handler()` and `detectTotalPages()`) actually correct?**
  _`map()` has 47 INFERRED edges - model-reasoned connections that need verification._
- **Are the 51 inferred relationships involving `filter()` (e.g. with `handler()` and `detectTotalPages()`) actually correct?**
  _`filter()` has 51 INFERRED edges - model-reasoned connections that need verification._
- **Are the 43 inferred relationships involving `from()` (e.g. with `logAICost()` and `_persistHealingState()`) actually correct?**
  _`from()` has 43 INFERRED edges - model-reasoned connections that need verification._