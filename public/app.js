// public/app.js — extracted from index.html (was inline <script> block, ~4,679 lines).
// Loaded via <script src="/public/app.js"> in the body, AFTER:
//   1. /public/supabase.min.js  (Supabase SDK)
//   2. /public/town-match.js    (town-postcode predicate, search filter helper)
//   3. inline env-shim          (window.__SUPABASE_URL__ / __SUPABASE_ANON_KEY__ / __AUTH_ENABLED__)
// Tag position is mid-body (matches the original parser-blocking inline script) — no defer.
// Globals declared here (LOTS, ALL_LOTS, SMART_RESULTS, currentUser, _searchCentre, …) live
// on window, same as before extraction. No build step.

const _nullProxy=new Proxy(document.createElement('div'),{get(t,p){if(p==='_isNull')return true;const v=t[p];return typeof v==='function'?v.bind(t):v},set(t,p,v){return true}});
const $=id=>document.getElementById(id)||_nullProxy;
function esc(s){if(s==null)return '';const d=document.createElement('div');d.textContent=String(s);return d.innerHTML.replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function safeHref(u){if(!u)return '#';const s=String(u).trim();if(!/^https?:\/\//i.test(s))return '#';if(/google\.\w+\/maps|maps\.google|maps\.app\.goo|waze\.com|bing\.com\/maps/i.test(s))return '#';return esc(s);}
let LOTS=[], SMART_RESULTS=null;
let ALL_LOTS=[], ALL_SOURCES=[];
let LENDER_DATA=[];
const BATCH_SIZE=60;
let _pendingCards=[];
let _batchObserver=null;
function isPremium(){return !!window._userTier && window._userTier !== 'anon';} // All signed-in users get full access
let _searchAbort=null; // AbortController for in-flight searches
let _searchTimers=[]; // setTimeout IDs for step animations
let _searchReader=null; // SSE ReadableStreamDefaultReader (for cleanup on abort)

// Reset ALL search state to a clean slate before each new search.
function resetSearchState(){
  if(_searchAbort){_searchAbort.abort();_searchAbort=null}
  if(_searchReader){try{_searchReader.cancel()}catch(e){}_searchReader=null}
  _searchTimers.forEach(id=>clearTimeout(id));
  _searchTimers=[];
  LOTS=[];
  SMART_RESULTS=null;
  // Reset sold filter to prevent mismatch — backend already filters by soldFilter sent in request
  if($('fSoldTop')) $('fSoldTop').value='all';
  const _rp=$('resultsPanel'); if(_rp) _rp.style.display='none';
  const _lb=$('logBox'); if(_lb) _lb.innerHTML='';
  const _mb=$('mainBtn'); if(_mb) _mb.disabled=true;
  const _sc=document.querySelector('.search-counter'); if(_sc) _sc.remove();
}

function clearAllFilters(silent){
  const resets={fDeal:'',fType:'',fCondition:'',fTenure:'',fLocation:'',fAfford:'all',fSoldTop:'all',fSort:'score',fBeds:'',fTown:'',fPostcode:'',fMinPrice:'',fMaxPrice:'',fExcludePOA:'',fRadius:'',fMinYield:'',fMinBmv:'',fMinScore:'',fSignal:'',fEpc:'',fFlood:'',fRedFlag:'',fMinRoce:'',fBidTarget:''};
  for(const[id,val] of Object.entries(resets)){const el=$(id);if(el)el.value=val}
  _searchCentre=null;
  if($('fShowPast')) { $('fShowPast').checked=false; if(!silent) onShowPastChange(); }
  _selectedHouses.clear();
  updateHouseBtn();
  updatePriceBtn();
  $('smartQuery').value='';
  updateMoreDot();
  if(SMART_RESULTS){ LOTS=ALL_LOTS; SMART_RESULTS=null; $('resultsTitle').textContent=ALL_LOTS.length.toLocaleString()+' auction lots'; }
  if(!silent) renderLots();
}

// ── LOCAL FILTER (instant text filtering) ──
let _filterTimer=null;
function localFilter(){ clearTimeout(_filterTimer);_filterTimer=setTimeout(()=>renderLots(),150); }

// ── List view ──
// The grid/list toggle was removed 2026-05-25 — list view is now the only
// layout. Keeping the `list-view` class on `.lots-grid` because many
// styles.css selectors hang off it.

// ── MORE FILTERS POPOVER ──
function toggleMoreFilters(e) {
  e.stopPropagation();
  var pop = $('moreFiltersPop');
  pop.classList.toggle('open');
  if (pop.classList.contains('open')) {
    setTimeout(function() {
      document.addEventListener('click', closeMoreFilters);
    }, 0);
  }
}
function closeMoreFilters(e) {
  var pop = $('moreFiltersPop');
  if (pop && !pop.contains(e.target) && e.target !== $('moreFiltersBtn')) {
    pop.classList.remove('open');
    document.removeEventListener('click', closeMoreFilters);
  }
}
function updateMoreDot() {
  // Postcode + Radius now live in the main filter row, not the Pro filters
  // popover, so don't count them toward the "active filter" dot indicator.
  var active = $('fDeal')?.value || $('fTenure')?.value ||
    $('fExcludePOA')?.value || $('fCondition')?.value ||
    $('fMinYield')?.value || $('fMinBmv')?.value || $('fMinScore')?.value ||
    $('fSignal')?.value || $('fEpc')?.value || $('fFlood')?.value || $('fRedFlag')?.value ||
    $('fMinRoce')?.value || $('fBidTarget')?.value ||
    (getSelectedHouses && getSelectedHouses().length > 0);
  $('mfDot').style.display = active ? '' : 'none';
}

// ── Mobile filter toggle ──
// At ≤640px the filter rows are hidden by default (CSS: .search-panel
// not having .mobile-expanded). Tapping the "Filters" pill toggles the
// class. Active filter count surfaces inside the pill so users see at a
// glance whether they have any filters applied.
function getActiveFilterCount() {
  var n = 0;
  if ($('fMinPrice')?.value || $('fMaxPrice')?.value) n++;
  if ($('fBeds')?.value) n++;
  if ($('fType')?.value) n++;
  if ($('fLocation')?.value) n++;
  if ($('fTown')?.value) n++;
  if ($('fPostcode')?.value) n++;
  if ($('fRadius')?.value) n++;
  if ($('fSoldTop') && $('fSoldTop').value && $('fSoldTop').value !== 'all') n++;
  if ($('fDeal')?.value) n++;
  if ($('fTenure')?.value) n++;
  if ($('fCondition')?.value) n++;
  if ($('fExcludePOA')?.value) n++;
  if ($('fMinYield')?.value) n++;
  if ($('fMinBmv')?.value) n++;
  if ($('fMinScore')?.value) n++;
  if ($('fSignal')?.value) n++;
  if ($('fEpc')?.value) n++;
  if ($('fFlood')?.value) n++;
  if ($('fRedFlag')?.value) n++;
  if ($('fMinRoce')?.value) n++;
  if ($('fBidTarget')?.value) n++;
  if (typeof getSelectedHouses === 'function' && getSelectedHouses().length > 0) n++;
  return n;
}
function refreshMobileFilterCount() {
  var el = $('mfActiveCount');
  if (!el) return;
  var n = getActiveFilterCount();
  if (n > 0) { el.textContent = n; el.style.display = ''; }
  else { el.style.display = 'none'; }
}
function toggleMobileFilters() {
  var panel = $('filterBar');
  if (!panel) return;
  var expanded = panel.classList.toggle('mobile-expanded');
  document.body.classList.toggle('sheet-open', expanded);
  var btn = $('mobileFiltersToggle');
  if (btn) btn.setAttribute('aria-expanded', String(expanded));
  refreshMobileFilterCount();
}

// Mirror select in the sticky top bar (#fSortMirror) and the canonical
// #fSort inside the sheet stay in sync. When the user changes either,
// both reflect the new value and we trigger a re-render.
function syncSortFromMirror() {
  var src = $('fSortMirror'); var tgt = $('fSort');
  if (!src || !tgt) return;
  tgt.value = src.value;
  if (typeof debouncedRender === 'function') debouncedRender();
}
function syncSortToMirror() {
  var src = $('fSort'); var tgt = $('fSortMirror');
  if (src && tgt) tgt.value = src.value;
}

// Auction-date chip group inside the sheet — mirrors #fLookahead.
function setLookaheadFromChip(val) {
  var sel = $('fLookahead'); if (!sel) return;
  sel.value = String(val);
  if (typeof saveLookahead === 'function') saveLookahead();
  // Repaint chip active state
  document.querySelectorAll('.sp-date-chips .sp-chip').forEach(function(b){
    b.classList.toggle('is-active', b.getAttribute('data-look') === String(val));
  });
  if (typeof debouncedRender === 'function') debouncedRender();
}
function refreshAuctionDateChips() {
  var sel = $('fLookahead'); if (!sel) return;
  var val = sel.value || '2';
  document.querySelectorAll('.sp-date-chips .sp-chip').forEach(function(b){
    b.classList.toggle('is-active', b.getAttribute('data-look') === val);
  });
}

// ── FAVOURITES ──
// Likes live in `user_lot_actions` (server) when the user is signed in;
// localStorage `bm_favourites` is the fallback for anon users. The legacy key
// is migrated into the server table on first sign-in via /api/me/likes/bulk.
function getFavourites() {
  try { return JSON.parse(localStorage.getItem('bm_favourites') || '[]'); } catch(e) { return []; }
}
function saveFavourites(favs) {
  try { localStorage.setItem('bm_favourites', JSON.stringify(favs)); } catch(e) {}
}
function isFavourite(lot) {
  if (!lot) return false;
  // Signed-in: check the server-backed _userActions cache
  if (currentSession && window._userActions) {
    const a = window._userActions[(lot._house || '') + '|' + (lot.url || '')];
    if (a) return !!a.liked;
  }
  // Anon fallback: legacy localStorage key
  var key = (lot._house || '') + ':' + (lot.lot || '') + ':' + (lot.address || '');
  return getFavourites().indexOf(key) !== -1;
}
function getFavKey(lot) {
  return (lot._house || '') + ':' + (lot.lot || '') + ':' + (lot.address || '');
}
// Apply visual state to whichever fav-btn variant is in the DOM. The new
// pill button (.lcv2-save) shows '\u2665 Saved' / '\u2661 Save' with text;
// the legacy expanded-card button (.exp-v2-fav, .fav-btn) shows just the
// icon.
function _setFavBtnState(btn, isLiked) {
  if (!btn) return;
  btn.classList.toggle('fav-active', isLiked);
  btn.classList.toggle('is-saved', isLiked);
  if (btn.classList.contains('lcv2-save')) {
    btn.textContent = isLiked ? '\u2665 Saved' : '\u2661 Save';
    btn.setAttribute('aria-label', isLiked ? 'Saved \u2014 tap to remove' : 'Save this lot');
  } else {
    btn.textContent = isLiked ? '\u2665' : '\u2661';
  }
}

// Top-of-card Save pill click handler. Anon visitors get a clear
// sign-in nudge here instead of fishing for the heart icon inside the
// expanded card.
function handleSaveLotClick(idx) {
  if (!currentSession) { requireSignup(); return; }
  return toggleFav(idx, { stopPropagation: () => {} });
}

async function toggleFav(idx, event) {
  event.stopPropagation();
  if (!window._userTier) { $('signupModal').classList.add('show'); return; }
  var lot = LOTS[idx];
  if (!lot) return;
  var card = document.getElementById('lot-' + idx);
  // Match either the collapsed-card pill or the expanded-card heart icon.
  var btn = card ? card.querySelector('.lcv2-save, .fav-btn, .exp-v2-fav') : null;

  // Signed-in path \u2192 hit the server
  if (currentSession && lot._house && lot.url) {
    const actKey = (lot._house || '') + '|' + (lot.url || '');
    window._userActions = window._userActions || {};
    const wasLiked = !!(window._userActions[actKey] && window._userActions[actKey].liked);
    const nowLiked = !wasLiked;
    // Optimistic UI
    _setFavBtnState(btn, nowLiked);
    window._userActions[actKey] = Object.assign({}, window._userActions[actKey] || {}, { liked: nowLiked });
    try {
      const r = await fetch('/api/me/likes', {
        method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ house: lot._house, lot_url: lot.url, liked: nowLiked })
      });
      if (!r.ok) throw new Error('like failed');
    } catch {
      // Roll back on failure
      window._userActions[actKey] = Object.assign({}, window._userActions[actKey] || {}, { liked: wasLiked });
      _setFavBtnState(btn, wasLiked);
      showToast && showToast('Could not update like', 'err');
    }
    return;
  }

  // Anon path \u2192 localStorage (toggleFav is mostly invoked through
  // handleSaveLotClick which intercepts anon to show the signup modal,
  // but this fallback keeps existing direct callers working).
  var key = getFavKey(lot);
  var favs = getFavourites();
  var i = favs.indexOf(key);
  if (i === -1) { favs.push(key); } else { favs.splice(i, 1); }
  saveFavourites(favs);
  if (card && btn) _setFavBtnState(btn, i === -1);
}

// ═══════════════════════════════
// UNSOLD LOT VIEW TOGGLE (Item 9)
// ═══════════════════════════════
let _unsoldViewActive = false;
let _favViewActive = false;
let _preUnsoldSort = '';
let _preUnsoldStatus = '';
let _preUnsoldShowPast = false;

// Pro-tool gate. The Unsold-lots view targets a niche post-auction
// motivated-seller play that's meaningless without finance + valuation
// context — meaningless for free users, premium-only by product design.
// Returns true if the action is allowed to proceed.
function _gateUnsoldView() {
  const tier = window._userTier || 'anon';
  if (tier === 'premium') return true;
  // Anon → push to signup. Signed-in free → push to upgrade modal.
  // Either way the unsold state should not toggle.
  if (typeof showPaywall === 'function') {
    showPaywall('Unsold lots is a Pro tool — it surfaces lots whose auction passed without a sale.');
  }
  return false;
}

function toggleUnsoldView() {
  if (!_gateUnsoldView()) return;
  _unsoldViewActive = !_unsoldViewActive;
  if (_favViewActive) { _favViewActive = false; $('favToggle').classList.remove('active'); }
  const btn = $('unsoldToggle');
  btn.classList.toggle('active', _unsoldViewActive);

  if (_unsoldViewActive) {
    // Save current filter state
    _preUnsoldSort = $('fSort').value;
    _preUnsoldStatus = $('fSoldTop').value;
    _preUnsoldShowPast = $('fShowPast')?.checked || false;
    // Apply unsold view
    $('fSoldTop').value = 'unsold';
    $('fSort').value = 'days_unsold';
    if ($('fShowPast')) $('fShowPast').checked = true;
    // Show unsold alert bar
    showUnsoldAlertBar();
  } else {
    // Restore previous state
    $('fSoldTop').value = _preUnsoldStatus || 'all';
    $('fSort').value = _preUnsoldSort || 'date_asc';
    if ($('fShowPast')) $('fShowPast').checked = _preUnsoldShowPast;
    hideUnsoldAlertBar();
  }
  renderLots();
}

function toggleFavView() {
  _favViewActive = !_favViewActive;
  if (_unsoldViewActive) { _unsoldViewActive = false; $('unsoldToggle').classList.remove('active'); hideUnsoldAlertBar(); }
  if (_analysedViewActive) { _analysedViewActive = false; $('analysedToggle')?.classList.remove('active'); }
  $('favToggle').classList.toggle('active', _favViewActive);
  renderLots();
}

let _analysedViewActive = false;
function toggleAnalysedView() {
  if (!currentSession) { $('signupModal')?.classList.add('show'); return; }
  _analysedViewActive = !_analysedViewActive;
  if (_unsoldViewActive) { _unsoldViewActive = false; $('unsoldToggle').classList.remove('active'); hideUnsoldAlertBar(); }
  if (_favViewActive) { _favViewActive = false; $('favToggle').classList.remove('active'); }
  $('analysedToggle')?.classList.toggle('active', _analysedViewActive);
  renderLots();
}

// Inject fav filter into renderLots — hook into existing filter chain
const _origRenderLots = typeof renderLots !== 'undefined' ? renderLots : null;

function showUnsoldAlertBar() {
  let bar = $('unsoldAlertBar');
  if (bar) { bar.style.display = ''; return; }
  bar = document.createElement('div');
  bar.className = 'unsold-alert-bar';
  bar.id = 'unsoldAlertBar';
  bar.innerHTML = '<span class="ua-text">Get emailed when lots fail to sell — vendors often accept lower offers after auction.</span>' +
    '<button class="ua-btn" id="unsoldAlertBtn" onclick="toggleUnsoldAlert()">' + (_unsoldAlertActive ? '✓ Subscribed' : 'Alert me') + '</button>';
  const statsRow = $('statsRow');
  if (statsRow) statsRow.parentNode.insertBefore(bar, statsRow.nextSibling);
}

function hideUnsoldAlertBar() {
  const bar = $('unsoldAlertBar');
  if (bar) bar.style.display = 'none';
}

// ═══════════════════════════════
// UNSOLD LOT ALERTS (Item 12)
// ═══════════════════════════════
let _unsoldAlertActive = false;

async function loadUnsoldAlertStatus() {
  if (!currentSession) return;
  try {
    const r = await fetch('/api/alerts/unsold', { headers: getAuthHeaders() });
    const d = await r.json();
    _unsoldAlertActive = !!(d.alert && d.alert.active);
    const btn = $('unsoldAlertBtn');
    if (btn) { btn.textContent = _unsoldAlertActive ? '✓ Subscribed' : 'Alert me'; btn.classList.toggle('subscribed', _unsoldAlertActive); }
  } catch {}
}

async function toggleUnsoldAlert() {
  if (!currentSession) { requireSignup(); return; }
  try {
    const newState = !_unsoldAlertActive;
    // Gather current filter state as the alert filters
    const filters = {};
    const minP = +$('fMinPrice').value; if (minP) filters.minPrice = minP;
    const maxP = +$('fMaxPrice').value; if (maxP) filters.maxPrice = maxP;
    const ft = $('fType').value; if (ft) filters.propType = ft;
    const floc = $('fLocation').value; if (floc) filters.location = floc;

    await fetch('/api/alerts/unsold', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ filters, frequency: 'daily', active: newState })
    });
    _unsoldAlertActive = newState;
    const btn = $('unsoldAlertBtn');
    if (btn) { btn.textContent = newState ? '✓ Subscribed' : 'Alert me'; btn.classList.toggle('subscribed', newState); }
  } catch (e) {
    console.warn('Unsold alert toggle failed:', e);
  }
}

// ═══════════════════════════════
// SAVED SEARCHES (Item 13)
// ═══════════════════════════════
let _savedSearches = [];

async function loadSavedSearches() {
  if (!currentSession) { $('savedSearchBar').style.display = 'none'; return; }
  try {
    const r = await fetch('/api/searches', { headers: getAuthHeaders() });
    const d = await r.json();
    _savedSearches = d.searches || [];
    renderSavedSearchChips();
  } catch {}
}

function renderSavedSearchChips() {
  const bar = $('savedSearchBar');
  if (!bar) return;
  if (_savedSearches.length === 0) { bar.style.display = 'none'; return; }
  bar.style.display = '';
  // DOM-API render (createElement + textContent) — keeps user-controlled
  // search names safe by construction. Each chip has the existing label +
  // delete (✕) controls plus a new bell toggle for Pro email alerts.
  bar.replaceChildren();
  for (const s of _savedSearches) {
    const alertOn = !!s.notify_email;
    const bellTitle = alertOn ? 'Email alerts ON — tap to disable' : 'Email alerts OFF — tap to enable (Pro)';

    const btn = document.createElement('button');
    btn.className = 'ss-chip';
    btn.title = 'Load: ' + s.name;
    btn.addEventListener('click', () => applySavedSearch(s.id));
    btn.appendChild(document.createTextNode(s.name));

    const bell = document.createElement('span');
    bell.className = 'ss-bell' + (alertOn ? ' ss-bell-on' : '');
    bell.title = bellTitle;
    bell.setAttribute('aria-label', bellTitle);
    bell.textContent = alertOn ? '🔔' : '🔕';
    bell.addEventListener('click', (e) => { e.stopPropagation(); toggleSavedSearchAlert(s.id); });
    btn.appendChild(bell);

    const del = document.createElement('span');
    del.className = 'ss-del';
    del.title = 'Delete';
    del.textContent = '✕';
    del.addEventListener('click', (e) => { e.stopPropagation(); deleteSavedSearch(s.id); });
    btn.appendChild(del);

    bar.appendChild(btn);
  }
}

// Toggle email alerts on a saved search. Pro-only — server returns 403
// for free users with upgrade_required:true and we surface the paywall
// modal instead of silently failing.
async function toggleSavedSearchAlert(id) {
  const s = (_savedSearches || []).find(x => x.id === id);
  if (!s) return;
  const next = !s.notify_email;
  // Optimistic UI flip
  s.notify_email = next;
  renderSavedSearchChips();
  try {
    const r = await fetch('/api/searches/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ notify_email: next })
    });
    if (r.status === 403) {
      // Free user — roll back, show upsell
      s.notify_email = !next;
      renderSavedSearchChips();
      if (typeof showPaywall === 'function') {
        showPaywall('Email alerts on saved searches are a Pro feature. Get notified the moment a new lot matches your filters.');
      } else {
        $('signupModal').classList.add('show');
      }
      return;
    }
    if (!r.ok) throw new Error('Patch failed: ' + r.status);
    showToast && showToast(next ? 'Email alerts on for "' + s.name + '"' : 'Email alerts off');
  } catch (err) {
    // Roll back optimistic flip on failure
    s.notify_email = !next;
    renderSavedSearchChips();
    showToast && showToast('Could not update alert', 'err');
  }
}

function getCurrentFilters() {
  return {
    minPrice: $('fMinPrice').value || '',
    maxPrice: $('fMaxPrice').value || '',
    beds: $('fBeds').value || '',
    type: $('fType').value || '',
    location: $('fLocation').value || '',
    status: $('fSoldTop').value || '',
    sort: $('fSort').value || '',
    deal: $('fDeal')?.value || '',
    tenure: $('fTenure')?.value || '',
    town: $('fTown')?.value || '',
    postcode: $('fPostcode')?.value || '',
    radius: $('fRadius')?.value || '',
    condition: $('fCondition')?.value || '',
    excludePOA: $('fExcludePOA')?.value || '',
    minYield: $('fMinYield')?.value || '',
    minBmv: $('fMinBmv')?.value || '',
    minScore: $('fMinScore')?.value || '',
    signal: $('fSignal')?.value || '',
    epc: $('fEpc')?.value || '',
    flood: $('fFlood')?.value || '',
    redFlag: $('fRedFlag')?.value || '',
    minRoce: $('fMinRoce')?.value || '',
    bidTarget: $('fBidTarget')?.value || '',
    query: $('smartQuery')?.value || ''
  };
}

function applyFilters(f) {
  if (!f) return;
  if (f.minPrice) $('fMinPrice').value = f.minPrice;
  if (f.maxPrice) $('fMaxPrice').value = f.maxPrice;
  if (f.beds) $('fBeds').value = f.beds;
  if (f.type) $('fType').value = f.type;
  if (f.location) $('fLocation').value = f.location;
  if (f.status) $('fSoldTop').value = f.status;
  if (f.sort) $('fSort').value = f.sort;
  if (f.deal && $('fDeal')) $('fDeal').value = f.deal;
  if (f.tenure && $('fTenure')) $('fTenure').value = f.tenure;
  if (f.town && $('fTown')) { $('fTown').value = f.town; onLocationInput(); }
  if (f.postcode && $('fPostcode')) { $('fPostcode').value = f.postcode; onLocationInput(); }
  if (f.radius && $('fRadius')) $('fRadius').value = f.radius;
  if (f.condition && $('fCondition')) $('fCondition').value = f.condition;
  if (f.excludePOA && $('fExcludePOA')) $('fExcludePOA').value = f.excludePOA;
  if (f.minYield && $('fMinYield')) $('fMinYield').value = f.minYield;
  if (f.minBmv && $('fMinBmv')) $('fMinBmv').value = f.minBmv;
  if (f.minScore && $('fMinScore')) $('fMinScore').value = f.minScore;
  if (f.signal && $('fSignal')) $('fSignal').value = f.signal;
  if (f.epc && $('fEpc')) $('fEpc').value = f.epc;
  if (f.flood && $('fFlood')) $('fFlood').value = f.flood;
  if (f.redFlag && $('fRedFlag')) $('fRedFlag').value = f.redFlag;
  if (f.minRoce && $('fMinRoce')) $('fMinRoce').value = f.minRoce;
  if (f.bidTarget && $('fBidTarget')) $('fBidTarget').value = f.bidTarget;
  if (f.query && $('smartQuery')) $('smartQuery').value = f.query;
  if (typeof umami !== 'undefined') {
    const keys = Object.keys(f).filter(k => f[k] != null && f[k] !== '');
    umami.track('filter_applied', { keys: keys.join(',').slice(0, 80), n: keys.length });
  }
  updatePriceBtn();
  updateMoreDot();
  refreshMobileFilterCount();
  // A saved/shared filter set can carry a past-implying LOT STATUS (sold, stc,
  // unsold, withdrawn…). Setting the dropdown .value directly doesn't fire
  // onStatusChange, so without this the past lots were never fetched and the
  // grid rendered empty (2026-07-07 audit). Tick Show-past and refetch; its
  // own render covers the view, so skip the immediate (empty) renderLots.
  const _needPast = $('fSoldTop')?.value && PAST_STATUS_VALUES.has($('fSoldTop').value);
  if (_needPast && $('fShowPast') && !$('fShowPast').checked) {
    $('fShowPast').checked = true;
    onShowPastChange({ force: true });
  } else {
    renderLots();
  }
}

async function saveCurrentSearch() {
  if (!currentSession) { requireSignup(); return; }
  const filters = getCurrentFilters();
  // Check if any filters are actually set
  const hasFilter = Object.values(filters).some(v => v && v !== 'all' && v !== 'date_asc' && v !== 'score');
  const name = prompt('Name this search' + (hasFilter ? '' : ' (no filters set)') + ':', '');
  if (!name || !name.trim()) return;

  try {
    const r = await fetch('/api/searches', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name: name.trim(), filters })
    });
    const d = await r.json();
    if (d.error) { alert(d.error); return; }
    if (d.search) _savedSearches.unshift(d.search);
    if (typeof umami !== 'undefined') try { umami.track('saved_search_created', { has_filters: hasFilter }); } catch (e) {}
    renderSavedSearchChips();
  } catch (e) {
    console.warn('Save search failed:', e);
  }
}

function applySavedSearch(id) {
  const s = _savedSearches.find(x => x.id === id);
  if (!s) return;
  // Reset unsold/fav views
  if (_unsoldViewActive) { _unsoldViewActive = false; $('unsoldToggle').classList.remove('active'); hideUnsoldAlertBar(); }
  if (_favViewActive) { _favViewActive = false; $('favToggle').classList.remove('active'); }
  clearAllFilters(true);
  applyFilters(s.filters);
}

async function deleteSavedSearch(id) {
  try {
    await fetch('/api/searches/' + id, { method: 'DELETE', headers: getAuthHeaders() });
    _savedSearches = _savedSearches.filter(s => s.id !== id);
    renderSavedSearchChips();
  } catch {}
}

// ═══════════════════════════════
// ONBOARDING FLOW (Item 10)
// ═══════════════════════════════
let _obData = { referral: '', referral_other: '', experience: '', interests: [], regions: [] };
// When true the onboarding modal is showing ONLY the location step (step 4) —
// used to ask anonymous visitors for their preferred investment area without
// running the full sign-up wizard (which still fires on first sign-in).
let _obLocationOnly = false;

// ═══════════════════════════════
// PREFERRED INVESTMENT LOCATION
// Captured by onboarding step 4 (or the anonymous location prompt), stored in
// localStorage + users.preferred_location, and applied as the default
// town/postcode + radius filter on every visit. AI search picks it up
// automatically because runSmartSearch() reads the same filter inputs.
// ═══════════════════════════════
const PREF_LOC_KEY = 'ab_pref_location';
const OB_REGION_LABELS = { north_west: 'North West', north_east: 'North East', yorkshire: 'Yorkshire', west_midlands: 'West Midlands', east_midlands: 'East Midlands', east: 'East of England', london: 'London', south_east: 'South East', south_west: 'South West', wales: 'Wales', scotland: 'Scotland' };

function getStoredPrefLocation() {
  try { return JSON.parse(localStorage.getItem(PREF_LOC_KEY) || 'null'); } catch (e) { return null; }
}
function storePrefLocation(pref) {
  try { localStorage.setItem(PREF_LOC_KEY, JSON.stringify(pref)); } catch (e) {}
}

// Apply a preference {input, radius, regions} to the filter bar. Returns true
// if anything was applied. Town/postcode wins over regions; a single region
// maps to the region dropdown; multi-region can't be expressed in the current
// filter UI so we leave the list unfiltered.
function applyPreferredLocation(pref) {
  if (!pref) return false;
  let applied = false;
  const input = (pref.input || '').trim();
  if (input && $('fTown') && $('fPostcode')) {
    // UK postcode shape (full or prefix): 1-2 letters then a digit
    const isPostcode = /^[a-z]{1,2}\d/i.test(input.replace(/\s+/g, ''));
    if (isPostcode) { $('fPostcode').value = input.toUpperCase(); $('fTown').value = ''; }
    else { $('fTown').value = input; $('fPostcode').value = ''; }
    if (pref.radius && $('fRadius')) {
      const opts = Array.from($('fRadius').options).map(o => o.value);
      if (opts.includes(String(pref.radius))) $('fRadius').value = String(pref.radius);
    }
    if (typeof onLocationInput === 'function') onLocationInput();
    applied = true;
  } else if (Array.isArray(pref.regions) && pref.regions.length === 1 && pref.regions[0] !== 'anywhere' && $('fLocation')) {
    const label = OB_REGION_LABELS[pref.regions[0]];
    const match = label && Array.from($('fLocation').options).find(o => o.textContent.includes(label) || o.value === label);
    if (match) { $('fLocation').value = match.value; applied = true; }
  }
  if (applied) {
    if (typeof updateMoreDot === 'function') updateMoreDot();
    if (typeof refreshMobileFilterCount === 'function') refreshMobileFilterCount();
    renderLots();
  }
  return applied;
}

// Load-time variant: never stomp a deep link or a location the user already
// set this session (URL-restored filters run before this).
function applyPreferredLocationIfUnset(pref) {
  if (!pref) return false;
  if (($('fTown')?.value || '') || ($('fPostcode')?.value || '') || ($('fLocation')?.value || '')) return false;
  return applyPreferredLocation(pref);
}

// Keep the stored preference in sync when the USER edits the location filters
// (typing town/postcode, changing radius) — so "change or clear it from the
// filters" sticks across visits. Deliberately not called on URL-restored or
// saved-search-applied filters: a shared deep link shouldn't rewrite your
// preference.
let _prefPersistTimer = null;
function persistLocPref() {
  clearTimeout(_prefPersistTimer);
  _prefPersistTimer = setTimeout(() => {
    const input = (($('fPostcode')?.value || '').trim()) || (($('fTown')?.value || '').trim());
    const prev = getStoredPrefLocation() || {};
    const radius = +($('fRadius')?.value || 0) || null;
    storePrefLocation({ input, radius, regions: prev.regions || [] });
  }, 800);
}

// Cross-device: signed-in users carry their preference in users.preferred_location /
// preferred_regions. Pull it once when there's no local copy yet.
async function syncPreferredLocationFromServer() {
  if (getStoredPrefLocation()) return;
  try {
    const r = await fetch('/api/auth/me', { headers: getAuthHeaders() });
    if (!r.ok) return;
    const me = await r.json();
    const pref = {
      input: (me.preferred_location && me.preferred_location.input) || '',
      radius: (me.preferred_location && me.preferred_location.radius) || null,
      regions: Array.isArray(me.preferred_regions) ? me.preferred_regions : [],
    };
    if (!pref.input && !(pref.regions.length === 1 && pref.regions[0] !== 'anywhere')) return;
    storePrefLocation(pref);
    applyPreferredLocationIfUnset(pref);
  } catch {}
}

// Ask anonymous first-time visitors for their preferred area using just the
// location step of the onboarding modal. Signed-in first-timers get the full
// wizard instead (maybeShowOnboarding), so this never double-asks.
function maybeAskLocation() {
  if (currentSession) return;
  if (getStoredPrefLocation()) return;
  if (localStorage.getItem('bm_onboarding_done')) return;
  if (localStorage.getItem('ab_loc_prompt_done')) return;
  if ($('onboardingModal')?.classList.contains('show')) return;
  // Don't stomp deep links (shared filter URLs, ?lot= drawer links)
  const p = new URLSearchParams(window.location.search);
  if (p.get('lot') || p.get('fTown') || p.get('fPostcode') || p.get('fLocation') || p.get('fRadius') || p.get('smartQuery')) return;
  _obLocationOnly = true;
  if ($('obProgress')) $('obProgress').style.display = 'none';
  obNext(4);
  $('onboardingModal').classList.add('show');
}

function obSelect(type, btn) {
  const parent = btn.parentElement;
  parent.querySelectorAll('.ob-opt').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  if (type === 'referral') {
    _obData.referral = btn.dataset.val;
    const otherInput = $('obRefOther');
    if (btn.dataset.val === 'other') {
      otherInput.style.display = '';
      otherInput.focus();
      // Don't auto-advance — wait for them to type + press Next or just advance
      otherInput.onkeydown = function(e) { if (e.key === 'Enter') { _obData.referral_other = otherInput.value.trim(); setTimeout(() => obNext(2), 150); } };
      return;
    }
    otherInput.style.display = 'none';
    setTimeout(() => obNext(2), 300);
  } else if (type === 'exp') {
    _obData.experience = btn.dataset.val;
    setTimeout(() => obNext(3), 300);
  }
}

function obToggleInt(btn) {
  btn.classList.toggle('selected');
  _obData.interests = Array.from($('obInterests').querySelectorAll('.selected')).map(b => b.dataset.val);
}

function obToggleRegion(btn) {
  if (btn.dataset.val === 'anywhere') {
    // Deselect all others, select only "Anywhere"
    $('obRegions').querySelectorAll('.ob-int').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  } else {
    // Deselect "Anywhere" if selecting a specific region
    const anyBtn = $('obRegions').querySelector('[data-val="anywhere"]');
    if (anyBtn) anyBtn.classList.remove('selected');
    btn.classList.toggle('selected');
  }
  _obData.regions = Array.from($('obRegions').querySelectorAll('.selected')).map(b => b.dataset.val);
}

function obNext(step) {
  // Capture "other" text if leaving step 1
  if (step === 2 && _obData.referral === 'other') {
    _obData.referral_other = ($('obRefOther')?.value || '').trim();
  }
  // Update progress dots
  $('obProgress').querySelectorAll('.ob-dot').forEach((d, i) => d.classList.toggle('active', i < step));
  // Show/hide steps
  for (let i = 1; i <= 4; i++) {
    const el = $('obStep' + i);
    if (el) el.classList.toggle('active', i === step);
  }
}

// Close the modal + reset location-only mode so a later full wizard renders
// with all steps and progress dots intact.
function obClose() {
  $('onboardingModal').classList.remove('show');
  if (_obLocationOnly) {
    _obLocationOnly = false;
    localStorage.setItem('ab_loc_prompt_done', '1');
    if ($('obProgress')) $('obProgress').style.display = '';
    obNext(1);
  } else {
    localStorage.setItem('bm_onboarding_done', '1');
  }
}

async function obFinish() {
  const wasLocationOnly = _obLocationOnly;
  obClose();

  // Capture preferred location from step 4 (text input wins over regions)
  const locInput = ($('obLocInput')?.value || '').trim().substring(0, 80);
  const locRadius = +($('obLocRadius')?.value || 0) || null;
  const pref = { input: locInput, radius: locInput ? locRadius : null, regions: _obData.regions };
  const hasPref = !!(locInput || (pref.regions.length && pref.regions[0] !== 'anywhere'));
  if (hasPref) storePrefLocation(pref);

  // Save to server
  if (currentSession) {
    try {
      const body = wasLocationOnly
        ? { preferred_regions: _obData.regions, preferred_location: { input: locInput, radius: locRadius } }
        : {
            experience_level: _obData.experience,
            interests: _obData.interests,
            referral_source: _obData.referral === 'other' ? ('other: ' + _obData.referral_other) : _obData.referral,
            preferred_regions: _obData.regions,
            preferred_location: { input: locInput, radius: locRadius },
          };
      await fetch('/api/auth/onboarding', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(body)
      });
    } catch {}
  }

  if (hasPref) applyPreferredLocation(pref);
  else renderLots();
}

function obSkip() {
  const wasLocationOnly = _obLocationOnly;
  obClose();
  if (currentSession && !wasLocationOnly) {
    fetch('/api/auth/onboarding', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ experience_level: null, interests: [], referral_source: null, preferred_regions: [] })
    }).catch(() => {});
  }
}

function maybeShowOnboarding() {
  // Show onboarding wizard on first sign-in
  if (localStorage.getItem('bm_onboarding_done')) return;
  if (!currentSession) return;
  // Prefill the location step from any preference captured while anonymous
  // so finishing the wizard persists it server-side instead of wiping it.
  const pref = getStoredPrefLocation();
  if (pref) {
    if (pref.input && $('obLocInput')) $('obLocInput').value = pref.input;
    if (pref.radius && $('obLocRadius')) $('obLocRadius').value = String(pref.radius);
  }
  setTimeout(() => {
    $('onboardingModal').classList.add('show');
  }, 800);
}

// Close onboarding on backdrop click
document.addEventListener('click', e => {
  if (e.target === $('onboardingModal')) { obSkip(); }
});

// Price popover toggle
function togglePricePopover(e){
  e.stopPropagation();
  const pop=$('pricePopover');
  pop.classList.toggle('open');
  if(pop.classList.contains('open')){
    const close=ev=>{if(!$('priceDropdown').contains(ev.target)){pop.classList.remove('open');document.removeEventListener('click',close)}};
    setTimeout(()=>document.addEventListener('click',close),0);
  }
}
function updatePriceBtn(){
  const mn=$('fMinPrice').value,mx=$('fMaxPrice').value;
  const fmt=v=>{const n=+v;if(n>=1000000)return '£'+(n/1000000)+'m';return '£'+(n/1000)+'k'};
  if(!mn&&!mx) $('priceDdBtn').textContent='Any price';
  else if(mn&&!mx) $('priceDdBtn').textContent=fmt(mn)+' +';
  else if(!mn&&mx) $('priceDdBtn').textContent='Up to '+fmt(mx);
  else $('priceDdBtn').textContent=fmt(mn)+' – '+fmt(mx);
}

// ═══════════════════════════════
// LOOKAHEAD FILTER PERSISTENCE
// ═══════════════════════════════
function saveLookahead(){try{localStorage.setItem('bm_lookahead',$('fLookahead').value)}catch(e){}}
function restoreLookahead(){try{const v=localStorage.getItem('bm_lookahead');if(v&&$('fLookahead'))$('fLookahead').value=v}catch(e){}}
restoreLookahead();

let _currentPage=1;
function savePerPage(){try{localStorage.setItem('bm_per_page',$('fPerPage').value)}catch(e){}}
function restorePerPage(){try{const v=localStorage.getItem('bm_per_page');if(v&&$('fPerPage'))$('fPerPage').value=v}catch(e){}}
restorePerPage();
// Restore view toggle state
let _pageFromGoPage=false;
function goPage(p){_pageFromGoPage=true;_currentPage=Math.max(1,p);renderLots();window.scrollTo({top:$('filterBar')?.offsetTop||0,behavior:'smooth'})}

// ═══════════════════════════════
// LOAD ALL LOTS FOR FILTERING
// ═══════════════════════════════
function showSkeletonCards(n){
  const rp=$('resultsPanel');if(!rp)return;
  rp.style.display='block';
  const cv=$('cardsView');if(cv)cv.style.display='block';
  const out=$('lotsOut');if(!out)return;
  const skelHtml=Array(n).fill('<div class="skel-card"><div class="skel-img"></div><div class="skel-body"><div class="skel-line w80"></div><div class="skel-line w60"></div><div class="skel-line w40"></div></div></div>').join('');
  out.innerHTML='<div class="lots-grid list-view" id="lotsGrid">'+skelHtml+'</div>';
}

function onShowPastChange(opts){
  const showPast=$('fShowPast')?.checked;
  const url=new URL(window.location);
  if(showPast) url.searchParams.set('showPast','true');
  else url.searchParams.delete('showPast');
  window.history.replaceState({},'',url);
  loadAllLots(opts);
}

// LOT STATUS values that inherently refer to past auctions. Selecting one
// auto-enables "Show past auctions" and refetches — without this, Sold /
// Sale Agreed / Recently unsold filtered a future-only dataset and silently
// returned an empty grid (2026-07-06 audit).
const PAST_STATUS_VALUES=new Set(['unsold','recently_unsold','sold','stc','withdrawn','everything']);
function onStatusChange(){
  const v=$('fSoldTop')?.value;
  if(PAST_STATUS_VALUES.has(v)&&$('fShowPast')&&!$('fShowPast').checked){
    $('fShowPast').checked=true;
    onShowPastChange({force:true}); // syncs the URL + refetches with includePast
  }
  debouncedRender();
}

let _lotsLoadedAt=0; // timestamp of last successful load

// ── IndexedDB lot cache (no 5MB limit like sessionStorage) ──
const _IDB_NAME='auctionbrain', _IDB_VER=1, _IDB_STORE='lots';
function _openLotsDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(_IDB_NAME,_IDB_VER);
    req.onupgradeneeded=()=>req.result.createObjectStore(_IDB_STORE);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
// Bump this when the lot payload SHAPE changes (new fields like _lat/_lng)
// so existing browser caches invalidate automatically instead of serving
// records missing the new fields. The ETag in sessionStorage is also
// keyed off this so 304 paths can't preserve stale shapes either.
const _IDB_KEY = 'latest-v2';
async function _getCachedLots(){
  try{const db=await _openLotsDB();return new Promise(r=>{const tx=db.transaction(_IDB_STORE,'readonly');const req=tx.objectStore(_IDB_STORE).get(_IDB_KEY);req.onsuccess=()=>r(req.result||null);req.onerror=()=>r(null)})}catch{return null}
}
async function _setCachedLots(data){
  try{const db=await _openLotsDB();const tx=db.transaction(_IDB_STORE,'readwrite');tx.objectStore(_IDB_STORE).put(data,_IDB_KEY)}catch{}
}
// Wipe IndexedDB lot cache + sessionStorage ETag. Called on auth-state change
// so an anon payload (with `anonGated:true`) can't survive into a signed-in
// session and vice versa. Without this, the server's ETag change alone isn't
// enough — the stale IndexedDB copy is rendered before the network round-trip.
async function _clearCachedLots(){
  try{const db=await _openLotsDB();const tx=db.transaction(_IDB_STORE,'readwrite');const store=tx.objectStore(_IDB_STORE);store.delete(_IDB_KEY);store.delete('latest');/* old key — sweep on next auth event */}catch{}
  try{sessionStorage.removeItem('ab_lots_etag');sessionStorage.removeItem('ab_lots_ts');sessionStorage.removeItem('ab_render_key');}catch{}
}

function _renderLotsToUI(d) {
  if(!d.anonGated&&$('fCondition')) $('fCondition').style.display='';
  // Hide tier-gated chrome for anon users — Favourites / Analysed / Save
  // search / CSV / JSON / etc. all need an account. Showing them to anon
  // visitors is just clutter that pushes the first lot below the fold.
  document.querySelectorAll('[data-anon-hide]').forEach(el => {
    el.style.display = d.anonGated ? 'none' : '';
  });
  const lsEl = document.querySelector('.ls-val[data-target="2000"]');
  if(lsEl) lsEl.dataset.target = ALL_LOTS.length;
  if(d.houseCount) document.querySelectorAll('.house-count-dynamic').forEach(el=>{el.textContent=d.houseCount});
  if(!ALL_LOTS.length){
    const out=$('lotsGrid');
    if(out) out.textContent='No auction lots currently available. Check back soon for new listings.';
  }
  if(ALL_LOTS.length && !document.body.classList.contains('view-results') && !SMART_RESULTS){
    // ── Skip rebuild if incoming data is identical to last render ──
    // _renderLotsToUI fires every time loadAllLots completes, including on
    // INITIAL_SESSION repeats and ETag-200 races. Without this fingerprint,
    // every re-fetch causes a full filter+sort+DOM rebuild even when nothing
    // about the lot list has actually changed.
    var _fp = ALL_LOTS.length + '|' + (ALL_LOTS[0]?.url || '') + '|' + (ALL_LOTS[ALL_LOTS.length-1]?.url || '') + '|' + (d.anonGated ? 'anon' : 'signed');
    if (window.__lastLotsFingerprint === _fp && document.getElementById('lotsGrid')) {
      LOTS = ALL_LOTS; // keep reference fresh
      // ALL_LOTS carries fresh lot objects on every fetch (no shared identity
      // with the previous LOTS), so the rendered cards' inline onclick
      // handlers — `expandCard(LOTS[_idx])` — would resolve to objects
      // without _idx set. expandCard would then silently bail at
      // getElementById('lot-undefined') and clicks would do nothing.
      // Re-assign _idx by LOTS position; fingerprint match guarantees the
      // order matches what was rendered, so cached cards stay correct.
      LOTS.forEach((l, i) => { l._idx = i; });
      return;
    }
    window.__lastLotsFingerprint = _fp;
    LOTS=ALL_LOTS;
    window._lastRenderKey=null;
    $('resultsTitle').textContent=ALL_LOTS.length.toLocaleString()+' auction lots';
    $('viewToggle').style.display='none';
    $('reportView').style.display='none';
    $('cardsView').style.display='block';
    buildLotFilters();
    if($('fAfford'))$('fAfford').value='all';
    renderLots();
    $('resultsPanel').style.display='block';
  }
}

async function loadAllLots(opts){
  const force = opts?.force;
  // Skip if lots were loaded very recently (e.g. auth callback re-triggering)
  // or if an AI search is active (don't overwrite LOTS mid-search)
  if (!force && ALL_LOTS.length > 0 && (Date.now() - _lotsLoadedAt) < 10000) {
    return;
  }
  if (!force && (SMART_RESULTS || _searchAbort)) {
    return;
  }

  // ── Try IndexedDB cache for instant render while fetching fresh data ──
  let idbRendered = false;
  if (!force && ALL_LOTS.length === 0) {
    try {
      const cached = await _getCachedLots();
      if (cached && cached.ts && (Date.now() - cached.ts) < 5 * 60 * 1000) {
        ALL_LOTS = cached.lots || [];
        ALL_SOURCES = cached.sources || [];
        window._houseMeta = cached.houseMeta || {};
        if (cached.stripeEnabled !== undefined) window._stripeEnabled = cached.stripeEnabled;
        _lotsLoadedAt = cached.ts;
        _renderLotsToUI({ anonGated: cached.anonGated, houseCount: cached.houseCount });
        idbRendered = true;
        console.log('[BM] Rendered from IndexedDB cache (' + ALL_LOTS.length + ' lots)');
      }
    } catch {}
  }

  // Only show skeleton cards on a truly cold start (no cached data, no prior lots)
  if (!idbRendered && !sessionStorage.getItem('ab_render_key')) showSkeletonCards(12);

  try{
    const showPast=$('fShowPast')?.checked;
    const apiUrl='/api/all-lots'+(showPast?'?includePast=true':'');
    const headers = { ...getAuthHeaders() };
    // Only send If-None-Match when we actually have lots in memory to keep on a
    // 304. The sessionStorage ETag outlives the 5-min IndexedDB render window,
    // so without this guard a reload could 304 with ALL_LOTS empty → blank grid
    // (2026-07-07 audit). No lots in hand → force a full 200.
    const cachedEtag = sessionStorage.getItem('ab_lots_etag');
    if (cachedEtag && ALL_LOTS.length > 0) headers['If-None-Match'] = cachedEtag;

    const r=await fetch(apiUrl,{headers});

    // 304 Not Modified — server data unchanged, keep current lots
    if (r.status === 304) {
      _lotsLoadedAt = Date.now();
      console.log('[BM] all-lots: 304 Not Modified (ETag cache hit)');
      return;
    }

    if(!r.ok) throw new Error('Server error: '+r.status);

    // Store ETag for future conditional requests
    const newEtag = r.headers.get('ETag');
    if (newEtag) try { sessionStorage.setItem('ab_lots_etag', newEtag); } catch {}

    const d=await r.json();
    if(d.stripeEnabled!==undefined) window._stripeEnabled=d.stripeEnabled;
    ALL_LOTS=d.lots||[];
    ALL_SOURCES=d.sources||[];
    window._houseMeta=d.houseMeta||{};
    _lotsLoadedAt = Date.now();
    if (!SMART_RESULTS) _browseSnapshot = null;
    try { sessionStorage.setItem('ab_lots_ts', _lotsLoadedAt.toString()); } catch(e) {}
    if(d._debug) console.log('[BM] all-lots pipeline:',d._debug);

    // ── Persist to IndexedDB for instant next-visit render ──
    _setCachedLots({ lots: ALL_LOTS, sources: ALL_SOURCES, houseMeta: d.houseMeta, houseCount: d.houseCount, stripeEnabled: d.stripeEnabled, anonGated: d.anonGated, ts: _lotsLoadedAt });

    _renderLotsToUI(d);
  }catch(e){
    console.log('Failed to load lots:',e);
    // If we already rendered from IndexedDB cache, don't show error
    if (idbRendered) return;
    const out=$('lotsGrid');
    if(out) out.textContent='Unable to load auction lots. Please check your connection and try again.';
  }
}

// ═══════════════════════════════
// LOCATION / RADIUS SEARCH
// ═══════════════════════════════
let _searchLocationCache={};
let _searchLocationTimer=null;
let _searchCentre=null; // {lat,lng,label}

function haversine(lat1,lng1,lat2,lng2){
  const R=3958.8; // miles
  const dLat=(lat2-lat1)*Math.PI/180;
  const dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function onTownInput(){ if(($('fTown')?.value||'').trim() && $('fPostcode')) $('fPostcode').value=''; onLocationInput(); persistLocPref(); }
function onPostcodeInput(){ if(($('fPostcode')?.value||'').trim() && $('fTown')) $('fTown').value=''; onLocationInput(); persistLocPref(); }

function onLocationInput(){
  clearTimeout(_searchLocationTimer);
  const town=($('fTown')?.value||'').trim();
  const postcode=($('fPostcode')?.value||'').trim();
  const val=postcode||town;
  const isPostcode=!!postcode;
  const locEl=isPostcode?$('fPostcode'):$('fTown');
  $('fTown')?.classList.remove('locating');
  $('fPostcode')?.classList.remove('locating');
  if(!val){_searchCentre=null;renderLots();updateMoreDot();return}
  _searchLocationTimer=setTimeout(async()=>{
    const cacheKey=(isPostcode?'P:':'T:')+val.toUpperCase();
    if(_searchLocationCache[cacheKey]){_searchCentre=_searchLocationCache[cacheKey];renderLots();updateMoreDot();return}
    locEl?.classList.add('locating');
    try{
      let resp,data;
      if(isPostcode){
        resp=await fetch('https://api.postcodes.io/postcodes/'+encodeURIComponent(val));
        data=await resp.json();
        if(data.status===200&&data.result){
          _searchCentre={lat:data.result.latitude,lng:data.result.longitude,label:val};
          _searchLocationCache[cacheKey]=_searchCentre;
        } else { _searchCentre=null; }
      } else {
        resp=await fetch('https://api.postcodes.io/places?q='+encodeURIComponent(val)+'&limit=1');
        data=await resp.json();
        if(data.status===200&&data.result&&data.result.length>0){
          _searchCentre={lat:data.result[0].latitude,lng:data.result[0].longitude,label:data.result[0].name_1||val};
          _searchLocationCache[cacheKey]=_searchCentre;
        } else { _searchCentre=null; }
      }
    }catch(e){ _searchCentre=null; }
    locEl?.classList.remove('locating');
    renderLots();updateMoreDot();
  },400);
}

// Region → postcode prefix mapping for location filter
const REGION_POSTCODES={
  london:['E','EC','N','NW','SE','SW','W','WC','EN','HA','IG','KT','TW','UB','BR','CR','DA','SM','RM'],
  'south east':['BN','CT','GU','ME','MK','OX','PO','RG','RH','SL','SO','TN','HP'],
  'south west':['BA','BH','BS','DT','EX','GL','PL','SN','SP','TA','TQ','TR'],
  east:['AL','CB','CM','CO','IP','LU','NR','PE','SG','SS','WD'],
  'west midlands':['B','CV','DY','HR','ST','TF','WR','WS','WV'],
  'east midlands':['DE','DN','LE','LN','NG','NN'],
  'north west':['BB','BL','CA','CH','CW','FY','L','LA','M','OL','PR','SK','WA','WN'],
  'north east':['DH','DL','HG','NE','SR','TS'],
  yorkshire:['BD','DN','HD','HG','HU','HX','LS','S','WF','YO'],
  wales:['CF','LD','LL','NP','SA','SY'],
  scotland:['AB','DD','DG','EH','FK','G','HS','IV','KA','KW','KY','ML','PA','PH','TD','ZE']
};

const REGION_TOWNS={
  london:['london','hackney','islington','camden','westminster','greenwich','lewisham','southwark','lambeth','wandsworth','hammersmith','kensington','chelsea','tower hamlets','newham','barking','redbridge','walthamstow','tottenham','brixton','peckham','croydon','bromley','sutton','kingston','richmond','ealing','hounslow','brent','harrow','barnet','enfield','haringey','eltham','woolwich','deptford','stratford','ilford','romford','dagenham'],
  'south east':['brighton','hove','canterbury','guildford','maidstone','milton keynes','oxford','portsmouth','reading','slough','southampton','tunbridge','crawley','hastings','eastbourne','chichester','basingstoke','aylesbury','margate','dover','folkestone','ashford','woking','winchester','horsham','worthing','bognor','isle of wight','epsom','reigate','sevenoaks','tonbridge','chatham','rochester','gillingham','dartford','gravesend','thanet'],
  'south west':['bath','bournemouth','bristol','exeter','gloucester','plymouth','swindon','taunton','torquay','truro','cheltenham','poole','weymouth','barnstaple','tiverton','yeovil','bridgwater','salisbury','chippenham','weston-super-mare','stroud','penzance','newquay','falmouth','dorchester','bideford'],
  east:['cambridge','chelmsford','colchester','ipswich','norwich','peterborough','luton','southend','st albans','stevenage','watford','harlow','basildon','braintree','bury st edmunds','great yarmouth','kings lynn','lowestoft','bedford','hertford','welwyn','hatfield','hemel hempstead'],
  'west midlands':['birmingham','coventry','dudley','hereford','stoke','telford','worcester','wolverhampton','walsall','solihull','west bromwich','smethwick','sutton coldfield','redditch','bromsgrove','kidderminster','stafford','tamworth','nuneaton','rugby','leamington','warwick','stratford-upon-avon','shrewsbury'],
  'east midlands':['derby','leicester','lincoln','nottingham','northampton','mansfield','loughborough','grantham','corby','kettering','wellingborough','chesterfield','buxton','matlock','hinckley','melton','newark','worksop','retford','boston','spalding','stamford','oakham'],
  'north west':['blackburn','bolton','carlisle','chester','crewe','blackpool','lancaster','liverpool','manchester','oldham','preston','stockport','warrington','wigan','salford','rochdale','burnley','accrington','kendal','barrow','macclesfield','congleton','nantwich','runcorn','widnes','st helens','southport','chorley','leyland','morecambe','fleetwood','lytham'],
  'north east':['durham','darlington','hartlepool','newcastle','sunderland','middlesbrough','stockton','gateshead','south shields','washington','bishop auckland','consett','redcar','whitby','scarborough','northallerton','thirsk','ripon'],
  yorkshire:['bradford','doncaster','harrogate','hull','halifax','huddersfield','leeds','sheffield','wakefield','york','barnsley','rotherham','dewsbury','batley','keighley','skipton','selby','goole','beverley','bridlington','scunthorpe','grimsby','pontefract','castleford','wetherby'],
  wales:['cardiff','llandudno','newport','swansea','aberystwyth','carmarthen','wrexham','bangor','rhyl','colwyn bay','barry','caerphilly','pontypridd','merthyr','bridgend','neath','port talbot','llanelli','haverfordwest','pembroke','tenby','brecon','newtown','welshpool','holyhead'],
  scotland:['aberdeen','dundee','dumfries','edinburgh','falkirk','glasgow','inverness','kilmarnock','kirkcaldy','motherwell','paisley','perth','stirling','ayr','livingston','dunfermline','greenock','hamilton','coatbridge','cumbernauld','east kilbride','elgin','fort william','oban','wick','lerwick','stornoway']
};

function getPostcodePrefix(addr){
  if(!addr) return '';
  const m=addr.match(/\b([A-Z]{1,2})\d/i);
  return m?m[1].toUpperCase():'';
}

function matchesRegion(addr, region){
  if(!addr || !region) return false;

  // 1) Try postcode prefix — the authoritative signal
  const pc = getPostcodePrefix(addr);
  if (pc) {
    if ((REGION_POSTCODES[region] || []).includes(pc)) return true;

    // CRITICAL: if the postcode resolves to a DIFFERENT region, don't
    // fall through to the town-name fallback. Otherwise street names
    // like "Gloucester Road" in Liverpool L6 falsely match South West
    // (because 'gloucester' is in the SW town list). The postcode wins.
    // Reported by Simon: "12 Gloucester Road, Anfield, Liverpool L6 4DS"
    // showing under the South West filter.
    let pcRegion = null;
    for (const r in REGION_POSTCODES) {
      if (REGION_POSTCODES[r].includes(pc)) { pcRegion = r; break; }
    }
    if (pcRegion && pcRegion !== region) return false;
  }

  // 2) Fallback: town-name match only when the postcode didn't tell us
  // anything definitive (no UK postcode in the string). Word-boundary
  // regex avoids partial matches inside other words.
  const towns = REGION_TOWNS[region] || [];
  for (const town of towns) {
    const re = new RegExp('\\b' + town.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(addr)) return true;
  }
  return false;
}

// applyFilters() removed — all filtering now handled in renderLots()

// ═══════════════════════════════
// SMART DETECTION: URL or search query?
// ═══════════════════════════════
function isUrl(s){ return s.match(/^https?:\/\//) || s.match(/\.(co\.uk|com|org)\//i); }

function isPdfUrl(url) {
  return /\.pdf(\?|$|#)/i.test(url) || /content-type=application\/pdf/i.test(url);
}

function detectHouseFromUrl(url) {
  if (isPdfUrl(url)) return { recognised: true, name: 'PDF catalogue', isPdf: true };
  const u = (url || '').toLowerCase();
  const houses = {
    'savills': 'Savills', 'allsop': 'Allsop', 'sdlauctions': 'SDL Auctions',
    'btgeddisonspropertyauctions': 'SDL Auctions', 'btgeddisons': 'SDL Auctions',
    'networkauctions': 'Network Auctions', 'bondwolfe': 'Bond Wolfe',
    'barnardmarcusauctions': 'Barnard Marcus', 'auctionhouselondon': 'Auction House London',
    'cliveemson': 'Clive Emson', 'strettons': 'Strettons', 'acuitus': 'Acuitus',
    'hollismorgan': 'Hollis Morgan', 'maggsandallen': 'Maggs & Allen',
    'mchughandco': 'McHugh & Co', 'knightfrankauctions': 'Knight Frank',
    'pattinson.co.uk': 'Pattinson', 'bidx1.com': 'BidX1',
    'philliparnoldauctions': 'Phillip Arnold', 'edwardmellor': 'Edward Mellor',
    'paulfosh': 'Paul Fosh', 'cottons.co.uk': 'Cottons',
    'dedmangray': 'Dedman Gray', 'barnettross': 'Barnett Ross',
    'bradleyhall': 'Bradley Hall', 'connectukauctions': 'Connect UK',
    'auctionestates': 'Auction Estates', 'landwoodpropertyauctions': 'Landwood',
    'loveitts': 'Loveitts', 'hunters.com': 'Hunters',
    'auctionhouse.co.uk': 'Auction House UK', 'pughauctions': 'SDL Auctions',
    'probate.auction': 'Probate Auction', 'timedauctions.probate.auction': 'Probate Auction',
  };
  for (const [domain, name] of Object.entries(houses)) {
    if (u.includes(domain)) return { recognised: true, name, isPdf: false };
  }
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    const name = hostname.split('.')[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return { recognised: false, name, isPdf: false };
  } catch { return { recognised: false, name: 'this catalogue', isPdf: false }; }
}

function handleSearch(){
  const q = $('smartQuery').value.trim();
  if(!q){
    // Empty box. If we're sitting in an AI-result subset, the button reads
    // 'Browse' and the user expects the full catalogue back — exit AI mode
    // rather than just re-rendering the 12-lot subset (2026-07-07 audit).
    if(SMART_RESULTS){ backToAuctions(); return; }
    // Otherwise filters are live — just re-render.
    renderLots();
    return;
  }
  if(isUrl(q)){
    runAnalysis(q);
  } else {
    runSmartSearch(q);
  }
}

function setQ(q){
  if(!window._userTier){$('signupModal').classList.add('show');return}
  $('smartQuery').value=q;
  runSmartSearch(q);
}
function applyPreset(name){
  // Reset all filters first
  const resets={fDeal:'',fType:'',fCondition:'',fTenure:'',fLocation:'',fSoldTop:'all',fSort:'score',fBeds:'',fTown:'',fPostcode:'',fMinPrice:'',fMaxPrice:'',fExcludePOA:'',fMinYield:'',fMinBmv:'',fMinScore:'',fSignal:'',fEpc:'',fFlood:'',fRedFlag:'',fMinRoce:'',fBidTarget:''};
  for(const[id,val] of Object.entries(resets)){const el=$(id);if(el)el.value=val}
  $('smartQuery').value='';
  if(name==='refurb150'){$('fCondition').value='needs work';$('fMaxPrice').value='150000'}
  else if(name==='titlesplit'){$('fDeal').value='Title Split'}
  else if(name==='highyield'){$('fSort').value='yield'}
  else if(name==='devland'){$('fType').value='land';$('fDeal').value='Development'}
  else if(name==='under100'){$('fMaxPrice').value='100000'}
  else if(name==='vacant'){$('fCondition').value='vacant'}
  updatePriceBtn();
  LOTS=ALL_LOTS;SMART_RESULTS=null;
  $('resultsTitle').textContent=ALL_LOTS.length.toLocaleString()+' auction lots';
  renderLots();
}

// ═══════════════════════════════
// VIEW SWITCHING
// ═══════════════════════════════
function showResultsView(){
  document.body.classList.add('view-results');
  window.scrollTo({top:0,behavior:'smooth'});
}

let _browseSnapshot=null; // cached DOM + state for instant back-navigation
function backToAuctions(){
  // Abort any pending search without clearing the visible lots/panel (prevents flicker)
  if(_searchAbort){_searchAbort.abort();_searchAbort=null}
  if(_searchReader){try{_searchReader.cancel()}catch(e){}_searchReader=null}
  _searchTimers.forEach(id=>clearTimeout(id));
  _searchTimers=[];
  SMART_RESULTS=null;
  if($('fSoldTop')) $('fSoldTop').value='all';
  const _lb=$('logBox'); if(_lb) _lb.innerHTML='';

  document.body.classList.remove('view-results');
  $('progressPanel').style.display='none';
  $('mainBtn').disabled=false;
  $('mainBtn').textContent=$('smartQuery').value.trim()?'AI Search':'Browse';
  // Restore all-lots view
  if(ALL_LOTS.length){
    LOTS=ALL_LOTS;
    $('resultsTitle').textContent=ALL_LOTS.length.toLocaleString()+' auction lots';
    $('viewToggle').style.display='none';
    $('reportView').style.display='none';
    $('cardsView').style.display='block';
    $('resultsPanel').style.display='block';
    // Restore cached browse DOM if available (instant, no re-render)
    if(_browseSnapshot&&_browseSnapshot.lotCount===ALL_LOTS.length){
      const out=$('lotsOut');
      if(out) out.innerHTML=_browseSnapshot.html;
      window._lastRenderKey=_browseSnapshot.renderKey;
      $('statsRow').innerHTML=_browseSnapshot.statsHtml;
      if($('filterBarCount')) $('filterBarCount').textContent=_browseSnapshot.filterCount;
      startCardCarousels();
    } else {
      buildLotFilters();
      renderLots();
    }
  }
  // Restore saved scroll or go to top
  const _savedY = parseInt(sessionStorage.getItem('ab_scroll_y') || '0');
  if (_savedY > 0) {
    requestAnimationFrame(() => window.scrollTo({ top: _savedY, behavior: 'smooth' }));
    sessionStorage.removeItem('ab_scroll_y'); // consumed
  } else {
    window.scrollTo({top:0,behavior:'smooth'});
  }
}

// ═══════════════════════════════
// LENDER DATA + AFFORDABILITY ENGINE
// ═══════════════════════════════
(async()=>{try{
  const r=await fetch('https://www.bridgematch.co.uk/api/lenders-lite');
  if(r.ok){LENDER_DATA=await r.json();console.log('[Finance] Lender data loaded:',LENDER_DATA.length,'lenders');updateFinanceProfile();document.querySelectorAll('.lender-count-dynamic').forEach(el=>el.textContent=LENDER_DATA.length)}
}catch(e){console.warn('[Finance] Lender data unavailable, using basic budget mode')}})();

// Parsing utilities (same as BridgeMatch Lite)
function _parseLTV(s){if(!s)return{pct:0,net:false};const m=s.match(/([\d.]+)/);if(!m)return{pct:0,net:false};return{pct:parseFloat(m[0]),net:s.toLowerCase().includes('net')}}
function _parseRate(s){if(!s)return 0;const rates=s.match(/[\d.]+/g);if(!rates)return 0;if(rates.length>=2)return(parseFloat(rates[0])+parseFloat(rates[1]))/2;return parseFloat(rates[0])}
function _parseProcFee(s){if(!s)return 2;const str=s.toLowerCase();if(str.includes('negotiable')||str.includes('no set'))return 1.5;const m=str.match(/(\d+\.?\d*)/);return m?parseFloat(m[0]):2}
function _parseMinMonths(s){if(!s)return 3;if(s.toLowerCase().includes('depends'))return 3;const m=s.match(/(\d+)/);return m?parseInt(m[0]):3}
function _estNetFromGross(gross,rateStr,pfStr,termMo,mmStr){
  if(!gross)return 0;
  const fee=_parseProcFee(pfStr),mr=_parseRate(rateStr)||0.75;
  const intDed=mr*termMo*0.5;
  return gross*(1-(fee+intDed)/100);
}

function calcAffordability(cash,propType,termMo){
  if(!cash||LENDER_DATA.length===0)return null;
  const col={resi:'l1',semi:'ls',comm:'lc',land_no_pp:'lnp',land_with_pp:'lwp'}[propType]||'l1';
  const isLand=propType==='land_no_pp'||propType==='land_with_pp';
  let bestStdNet=0, bestRefurbNet=0;

  for(const l of LENDER_DATA){
    // Standard LTV (or land LTV)
    const p=_parseLTV(l[col]);
    if(p.pct>0){
      const net=p.net?p.pct:_estNetFromGross(p.pct,l.r,l.pf,termMo,l.mm);
      if(net>bestStdNet)bestStdNet=net;
    }
    // Refurb day-1 LTV — not applicable for land
    if(!isLand){
      for(const k of ['ld1','ud1']){
        const rp=_parseLTV(l[k]);
        if(rp.pct>0){
          const net=rp.net?rp.pct:_estNetFromGross(rp.pct,l.r,l.pf,termMo,l.mm);
          if(net>bestRefurbNet)bestRefurbNet=net;
        }
      }
    }
  }

  const costPct=0.07; // SDLT + legal estimate
  const maxStd=bestStdNet>0?Math.round(cash/(1-bestStdNet/100+costPct)):0;
  const maxRefurb=bestRefurbNet>0?Math.round(cash/(1-bestRefurbNet/100+costPct)):0;

  // Title split: proper split-premium math
  const splitPremium=(+($('fpSplitPremium')?.value)||30)/100;
  const bestSplitLTV=bestStdNet/100;
  const effectiveLTV=(1+splitPremium)*bestSplitLTV;
  let maxTS=0,fullFinance=false;
  if(bestSplitLTV>0){
    if(effectiveLTV>=1.0){
      maxTS=Math.round(cash/costPct);
      fullFinance=true;
    }else{
      maxTS=Math.round(cash/(1-effectiveLTV+costPct));
    }
  }

  return{maxStd,maxRefurb,maxTS,bestStdNet:Math.round(bestStdNet*10)/10,bestRefurbNet:Math.round(bestRefurbNet*10)/10,splitPremium,effectiveLTV:Math.round(effectiveLTV*1000)/10,fullFinance};
}

function getAffordabilityTag(lot,aff){
  if(!lot.price||!aff||!aff.maxStd)return 'unknown';
  if(lot.price<=aff.maxStd)return 'in_budget';
  if(isPremium()&&$('fpRefurb')?.checked){
    const isRefurb=lot.condition==='needs work'||lot.condition==='poor'||lot.dealType==='Refurb'||lot.dealType==='Refurb+Extend'||lot.dealType==='Development';
    if(isRefurb&&aff.maxRefurb&&lot.price<=aff.maxRefurb)return 'stretch_refurb';
  }
  if(isPremium()&&$('fpTitleSplit')?.checked){
    if(lot.titleSplit&&aff.maxTS&&lot.price<=aff.maxTS)return aff.fullFinance?'full_finance':'stretch_split';
  }
  return 'out_of_reach';
}

function affBadgeHtml(tag){
  if(tag==='in_budget')return '<span class="tag-aff aff-ok">&#10003; In budget</span>';
  if(tag==='stretch_refurb')return '<span class="tag-aff aff-stretch">&#8599; Refurb stretch</span>';
  if(tag==='stretch_split')return '<span class="tag-aff aff-stretch">&#8599; Split opportunity</span>';
  if(tag==='full_finance')return '<span class="tag-aff aff-full">&#9733; Zero deposit*</span>';
  if(tag==='out_of_reach')return '<span class="tag-aff aff-oor">&#10007; Out of reach</span>';
  return '';
}

// ═══════════════════════════════
// FINANCE PROFILE
// ═══════════════════════════════
function fmtK(n){return n>=1e6?'£'+(n/1e6).toFixed(1)+'m':'£'+Math.round(n/1000)+'k'}

function updateFinanceProfile(){
  const cash=+$('fpCash')?.value||0;
  const propType=$('fpPropType')?.value||'resi';
  const termMo=+($('fpTerm')?.value)||12;
  const el=$('fpSummary');
  if(!el)return{cash,aff:null};

  // Toggle title split settings panel visibility
  const tsChecked=isPremium()&&$('fpTitleSplit')?.checked;
  const tsPanel=$('fpTsSettings');
  if(tsPanel){tsChecked?tsPanel.classList.add('show'):tsPanel.classList.remove('show')}

  // Update slider label
  const sliderEl=$('fpSplitPremium'),sliderValEl=$('fpSplitPremiumVal');
  if(sliderEl&&sliderValEl)sliderValEl.textContent=sliderEl.value+'%';

  if(!cash){el.innerHTML='<span style="color:var(--text4)">Enter your cash to see affordability across all lots</span>';return{cash:0,aff:null}}

  const aff=calcAffordability(cash,propType,termMo);
  if(!aff){
    // Fallback: simple deposit-% calculation (no lender data)
    const maxBasic=Math.round(cash/0.32); // ~25% deposit + 7% costs
    el.innerHTML=`Standard bridge: <b>${fmtK(maxBasic)}</b> max <span style="color:var(--text4)">(estimated — lender data loading)</span>`;
    return{cash,aff:{maxStd:maxBasic,maxRefurb:0,maxTS:0}};
  }

  // Update split premium info box
  const tsInfo=$('fpTsInfo');
  if(tsInfo&&tsChecked&&cash){
    const eLTV=aff.effectiveLTV;
    if(aff.fullFinance){
      tsInfo.innerHTML=`<span class="fp-full-finance">Effective LTV: ${eLTV}% — Zero deposit potential</span><br>Split value may cover full purchase. Cash for SDLT + legal only.`;
    }else{
      const depPct=Math.round((100-eLTV)*10)/10;
      tsInfo.innerHTML=`Effective LTV: ${eLTV}% — ~${Math.max(0,depPct)}% deposit needed`;
    }
  }else if(tsInfo){tsInfo.innerHTML=''}

  const isLand=propType==='land_no_pp'||propType==='land_with_pp';
  const lbl=isLand?(propType==='land_with_pp'?'Land (with planning)':'Land (no planning)'):'Standard bridge';
  let html=`${lbl}: <b>${fmtK(aff.maxStd)}</b> max <span style="color:var(--text4)">(best ${aff.bestStdNet}% net LTV)</span>`;
  if(!isLand&&isPremium()&&$('fpRefurb')?.checked&&aff.maxRefurb>aff.maxStd){
    html+=`<br>Refurb projects: <span class="fp-refurb"><b>${fmtK(aff.maxRefurb)}</b> max</span> <span style="color:var(--text4)">(${aff.bestRefurbNet}% net day-1 LTV)</span>`;
  }
  if(!isLand&&tsChecked&&aff.maxTS>aff.maxStd){
    if(aff.fullFinance){
      html+=`<br>Title splits: <span class="fp-split"><b>${fmtK(aff.maxTS)}</b> max</span> <span class="fp-full-finance">(zero deposit* — ${aff.effectiveLTV}% effective LTV, costs only)</span>`;
    }else{
      html+=`<br>Title splits: <span class="fp-split"><b>${fmtK(aff.maxTS)}</b> max</span> <span style="color:var(--text4)">(${aff.effectiveLTV}% effective LTV, ${Math.round(aff.splitPremium*100)}% premium)</span>`;
    }
  }
  el.innerHTML=html;

  // Persist to localStorage
  try{localStorage.setItem('bm_finance_profile',JSON.stringify({cash,propType,termMo,refurb:$('fpRefurb')?.checked,titleSplit:$('fpTitleSplit')?.checked,splitPremium:+($('fpSplitPremium')?.value)||30,sdltCountry:$('sdltCountry')?.value||'england'}))}catch(e){}

  return{cash,aff};
}

// Restore from localStorage
try{
  const saved=JSON.parse(localStorage.getItem('bm_finance_profile'));
  if(saved){
    window.addEventListener('DOMContentLoaded',()=>{
      if(saved.cash&&$('fpCash'))$('fpCash').value=saved.cash;
      if(saved.propType&&$('fpPropType'))$('fpPropType').value=saved.propType;
      if(saved.termMo&&$('fpTerm'))$('fpTerm').value=saved.termMo;
      if(saved.refurb!=null&&$('fpRefurb'))$('fpRefurb').checked=saved.refurb;
      if(saved.titleSplit!=null&&$('fpTitleSplit'))$('fpTitleSplit').checked=saved.titleSplit;
      if(saved.splitPremium&&$('fpSplitPremium'))$('fpSplitPremium').value=saved.splitPremium;
      if(saved.sdltCountry&&$('sdltCountry'))$('sdltCountry').value=saved.sdltCountry;
      updateFinanceProfile();
    });
  }
}catch(e){}

// Wire up input listeners
['fpCash','fpPropType','fpTerm','fpRefurb','fpTitleSplit','fpSplitPremium','sdltCountry'].forEach(id=>{
  const el=$(id);
  if(el)el.addEventListener(el.type==='checkbox'?'change':'input',()=>{updateFinanceProfile();if(typeof debouncedRender==='function')debouncedRender()});
});

function toggleAdvanced(){
  $('advancedPanel').classList.toggle('show');
}

// ═══════════════════════════════
// CALENDAR
// ═══════════════════════════════
let calendarData=[];
let cacheStatus={};

async function loadCalendar(){
  try{
    const calR=await fetch('/api/auctions');
    const d=await calR.json();
    calendarData=d.auctions||[];
  }catch(e){
    console.warn('Failed to load calendar:', e);
  }
}

// Calendar rendering removed — lots are shown directly via ALL_LOTS
function analyseFromCal(url){
  $('smartQuery').value = url;
  runAnalysis(url);
}

async function analyseAll(){
  try{
    const r=await fetch('/api/analyse-all',{
      method:'POST',
      headers:authHeaders(),
      body:JSON.stringify({})
    });
    const d=await r.json();
    if(!r.ok) throw new Error(d.error||'Failed');
    loadCalendar();
  }catch(e){
    console.warn('analyseAll failed:', e);
  }
}

// ═══════════════════════════════
// AUTH (Supabase Magic Link)
// ═══════════════════════════════
let supabaseClient = null;
let currentSession = null;
let currentUser = null;

function initAuth() {
  if (!AUTH_ENABLED) return;
  if (typeof supabase !== 'undefined' && SUPABASE_URL && SUPABASE_ANON_KEY) {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    supabaseClient.auth.getSession().then(({ data }) => {
      if (data.session) onSignIn(data.session);
      else onSignOut();
    });
    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        onSignIn(session);
      } else if (session && event === 'TOKEN_REFRESHED') {
        // Update session/token without re-fetching lots
        currentSession = session;
        currentUser = session.user;
      } else if (event === 'SIGNED_OUT') {
        onSignOut();
      }
    });
  }
}

function getAuthHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (currentSession && currentSession.access_token) {
    h['Authorization'] = 'Bearer ' + currentSession.access_token;
  }
  return h;
}
// Backward compat alias used by existing call sites
function authHeaders() { return getAuthHeaders(); }

function toggleAccountMenu() {
  const dd = $('accountDropdown');
  dd.classList.toggle('show');
}
function closeAccountMenu() {
  $('accountDropdown').classList.remove('show');
}
// Close dropdown when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('.nav-account')) closeAccountMenu();
});

function onSignIn(session) {
  // Reset the inactivity clock so a fresh sign-in doesn't get kicked out on
  // the next 5-min check by a stale lastActivityTime.
  recordActivity();
  // Grace window: for 8s after sign-in, the fetch wrapper treats 401s as
  // transient (server-side JWT cache warming, JWKS key-rotation race,
  // brand-new-user creation race) instead of immediately bouncing the
  // user back to the sign-in modal. Without this guard, any /api 401
  // during the post-sign-in burst (consent / likes / analysed / all-lots)
  // triggers signOut + showSessionExpiredModal — the OAuth-loop bug
  // reported on 2026-05-03.
  window.__lastSignInAt = Date.now();
  if (typeof umami !== 'undefined') umami.track('signup', { provider: session.user?.app_metadata?.provider || 'email' });
  currentSession = session;
  currentUser = session.user;
  const email = currentUser.email || '';
  $('acctEmail').textContent = email;
  $('navCta').textContent = email.split('@')[0];
  $('navCta').onclick = (e) => { e.stopPropagation(); toggleAccountMenu(); };
  $('signupModal').classList.remove('show');

  // Submit pending consent from sessionStorage
  const pending = sessionStorage.getItem('bm_pending_consent');
  if (pending) {
    sessionStorage.removeItem('bm_pending_consent');
    try {
      const consent = JSON.parse(pending);
      fetch('/api/auth/consent', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(consent) })
        .catch(e => console.warn('Consent submit failed:', e));
    } catch {}
  }

  // Clean up legacy localStorage tokens
  localStorage.removeItem('bm_user');
  localStorage.removeItem('bm_token');

  // Re-fetch lots now that auth token is available (fixes race where
  // loadAllLots() fires before initAuth() resolves, gating all lots).
  // Wipe the anon IDB/ETag cache first so the un-gated payload lands in-place
  // instead of a 304 preserving the gated stubs.
  // Guard: Supabase fires INITIAL_SESSION on every page load AND on cross-tab
  // localStorage sync. Without this guard, each fire force-refetches /api/all-lots
  // (3-4s server work each) even when the user identity hasn't changed.
  const _prevUserId = window.__lastSignedInUserId;
  const _curUserId = currentUser.id || currentUser.email || '';
  if (_prevUserId !== _curUserId) {
    window.__lastSignedInUserId = _curUserId;
    _clearCachedLots().finally(() => loadAllLots({ force: true }));
    // Per-user lot actions and onboarding only need to fire on real identity
    // change. On a cross-tab INITIAL_SESSION re-fire, loadUserActions() ends
    // in renderLots() which trips _currentPage=1 — losing the user's place
    // in pagination whenever they tab away and return.
    loadUserActions().then(migrateLegacyFavourites);
    maybeShowOnboarding();
    // Pull preferred investment location from the user profile when this
    // device has no local copy (new device / cleared storage).
    syncPreferredLocationFromServer();
  }

  // Check Pro status
  updateProStatus();

  // Load saved searches and alert status
  loadSavedSearches();
  loadUnsoldAlertStatus();
}

// Pulls likes + analysed lots and indexes them into window._userActions
async function loadUserActions() {
  if (!currentSession) return;
  window._userActions = window._userActions || {};
  try {
    const [likesRes, anlRes] = await Promise.all([
      fetch('/api/me/likes', { headers: getAuthHeaders() }),
      fetch('/api/me/analysed', { headers: getAuthHeaders() })
    ]);
    if (likesRes.ok) {
      const data = await likesRes.json();
      for (const a of data.likes || []) {
        const k = (a.house || '') + '|' + (a.lot_url || '');
        window._userActions[k] = Object.assign({}, window._userActions[k] || {}, a);
      }
    }
    if (anlRes.ok) {
      const data = await anlRes.json();
      for (const a of data.analysed || []) {
        const k = (a.house || '') + '|' + (a.lot_url || '');
        window._userActions[k] = Object.assign({}, window._userActions[k] || {}, a);
      }
    }
    // Re-render so cards reflect liked/stacks state
    if (typeof renderLots === 'function') renderLots();
  } catch (e) {
    console.warn('loadUserActions failed', e);
  }
}

// One-time merge of localStorage `bm_favourites` into the server table.
// Old keys are `<house>:<lotNum>:<address>` and don't directly carry lot_url —
// best we can do is match against in-memory LOTS to recover (house, url).
async function migrateLegacyFavourites() {
  if (!currentSession) return;
  let legacy;
  try { legacy = JSON.parse(localStorage.getItem('bm_favourites') || '[]'); } catch { return; }
  if (!Array.isArray(legacy) || !legacy.length) return;
  const items = [];
  for (const key of legacy) {
    const lot = (window.LOTS || []).find(l => getFavKey(l) === key);
    if (lot && lot._house && lot.url) items.push({ house: lot._house, lot_url: lot.url });
  }
  if (!items.length) { localStorage.removeItem('bm_favourites'); return; }
  try {
    const r = await fetch('/api/me/likes/bulk', {
      method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    });
    if (r.ok) {
      localStorage.removeItem('bm_favourites');
      // Refresh actions so isFavourite() picks them up
      await loadUserActions();
    }
  } catch {}
}

function onSignOut() {
  currentSession = null;
  currentUser = null;
  closeAccountMenu();
  $('navCta').textContent = 'Sign in';
  $('navCta').onclick = () => requireSignup();
  $('acctTier').textContent = 'Free';
  $('acctTier').classList.remove('pro');
  if ($('acctManage')) $('acctManage').style.display = 'none';
  // Pro-only chrome (Unsold-lots toggle, etc.) hides itself on tier loss.
  try { document.body.classList.remove('is-pro'); } catch {}
  // Wipe any active unsold-view state so the now-anonymous session doesn't
  // see a stuck filter pill it can't disable.
  if (typeof enforceUnsoldGating === 'function') enforceUnsoldGating();
  // Wipe signed-in lot cache so anon reload isn't served a signed-in payload
  // (with score/dealType) that the server would now strip.
  _clearCachedLots();
}

function requireSignup() {
  if (currentUser) return true;
  $('signupModal').classList.add('show');
  $('authStep1').style.display = '';
  $('authStep2').style.display = 'none';
  $('signupError').style.display = 'none';
  $('signupEmail').value = '';
  $('signupEmail').focus();
  return false;
}

async function handleSendMagicLink() {
  const email = ($('signupEmail').value || '').trim();
  const btn = $('btnSendMagicLink');
  $('signupError').style.display = 'none';
  if (!email || !email.includes('@')) {
    $('signupError').textContent = 'Please enter a valid email address';
    $('signupError').style.display = 'block';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Sending...';

  // Store consent choices in sessionStorage to submit after magic link callback
  sessionStorage.setItem('bm_pending_consent', JSON.stringify({
    auction_alerts: !!$('consentAlerts').checked,
    partner_marketing: !!$('consentPartner').checked
  }));
  _saveReturnUrlForOAuth();

  try {
    const { error } = await supabaseClient.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: window.location.origin }
    });
    if (error) throw error;
    $('authStep1').style.display = 'none';
    $('authStep2').style.display = '';
    $('authSentEmail').textContent = email;
  } catch (err) {
    console.error('Magic link error:', err);
    $('signupError').textContent = 'Failed to send magic link. Please try again.';
    $('signupError').style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send Magic Link';
  }
}

// Save the pre-OAuth URL state so we can restore filters + the open-lot
// context after Supabase's callback (which appends #access_token=… to the
// redirectTo and strips any path/query we don't pass through). Lot id is
// already kept in sessionStorage('ab_open_lot') by _setOpenLotKey() — what
// gets lost without this is the search string (Bristol filter, etc.).
function _saveReturnUrlForOAuth() {
  try {
    sessionStorage.setItem('ab_post_auth_search', window.location.search || '');
  } catch {}
}

async function handleGoogleSignIn() {
  if (!supabaseClient) return;
  // Store consent choices before redirect
  sessionStorage.setItem('bm_pending_consent', JSON.stringify({
    auction_alerts: !!$('consentAlerts').checked,
    partner_marketing: !!$('consentPartner').checked
  }));
  _saveReturnUrlForOAuth();
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
  if (error) {
    console.error('Google sign-in error:', error);
    $('signupError').textContent = 'Google sign-in failed. Please try again.';
    $('signupError').style.display = 'block';
  }
}

function signOut() {
  if (supabaseClient) supabaseClient.auth.signOut();
  onSignOut();
}

// ── Session Timeout & Error Handling ──
// Cross-tab login/logout sync is provided by Supabase's built-in localStorage
// listener (onAuthStateChange fires across tabs). No extra channel needed.

const ACTIVITY_KEY = 'bm_last_activity';
const INACTIVITY_TIMEOUT_MS = 48 * 60 * 60 * 1000;    // 48 hours of genuine inactivity
const SESSION_STALENESS_THRESHOLD_MS = 10 * 60 * 1000; // skip cold-start check if >10 min remain

// Captured at page-load so the 2s cold-start check can tell "the user
// hasn't touched this tab yet" apart from "they're actively interacting".
const pageLoadTime = Date.now();

// Restore from storage so the timeout survives tab close/reopen.
// If storage is empty (first ever visit OR dev-cleared storage) we leave
// lastActivityTime as null so the cold-start check below treats it as
// "unknown" rather than "fresh activity right now". A pagehide listener
// further down writes the precise lastActivityTime on tab close so the
// next session starts from the exact last interaction, not a 60s-stale
// throttled value.
const _storedActivity = parseInt(localStorage.getItem(ACTIVITY_KEY), 10);
let lastActivityTime = Number.isFinite(_storedActivity) ? _storedActivity : null;
let lastActivityWriteTime = 0;

function recordActivity() {
  const now = Date.now();
  lastActivityTime = now;
  // Throttle writes to once per minute
  if (now - lastActivityWriteTime > 60000) {
    lastActivityWriteTime = now;
    try { localStorage.setItem(ACTIVITY_KEY, String(now)); } catch {}
  }
}

// Flush the latest activity timestamp on tab close so the throttled-write
// gap can't make the next cold-start check think the user was idle longer
// than they really were. pagehide fires on tab close, navigation, and
// browser-quit (more reliable than beforeunload for mobile Safari).
window.addEventListener('pagehide', () => {
  if (lastActivityTime) {
    try { localStorage.setItem(ACTIVITY_KEY, String(lastActivityTime)); } catch {}
  }
});

function showSessionExpiredModal(reason) {
  $('signupModal').classList.add('show');
  $('authStep1').style.display = '';
  $('authStep2').style.display = 'none';
  const errEl = $('signupError');
  if (errEl) {
    errEl.textContent = reason || 'Your session has expired — please sign in again.';
    errEl.style.display = 'block';
  }
}

// Capture the unwrapped fetch before wrapping
const originalFetch = window.fetch.bind(window);

// Re-entrancy guard for the 401 handler. supabaseClient.auth.getSession() and
// the SDK's internal token refresh both go through window.fetch — if a token
// refresh itself returns 401, we must not call getSession() again from inside
// the wrapper or we'd loop and fire signOut/showSessionExpiredModal multiple
// times before currentSession nullifies.
let _handlingExpiry = false;

// Wrap fetch to detect "our session expired" — but only for our own auth-bearing
// requests. Unrelated 401s (admin secret, third-party APIs, Stripe failures, etc.)
// must not log the user out.
window.fetch = async function(...args) {
  const response = await originalFetch(...args);

  if (response.status === 401 && currentSession && supabaseClient && !_handlingExpiry) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    const headers = args[1]?.headers || {};
    let authHeader = '';
    if (headers instanceof Headers) authHeader = headers.get('Authorization') || '';
    else authHeader = headers.Authorization || headers.authorization || '';
    const sentOurToken = typeof authHeader === 'string' && authHeader.startsWith('Bearer ');
    const isOurApi = url.startsWith('/api/') || url.startsWith(window.location.origin + '/api/');

    if (sentOurToken && isOurApi) {
      // Grace window: never sign the user out within 8s of a fresh
      // sign-in. The post-sign-in burst (/api/auth/consent, /api/me/*,
      // /api/all-lots) can race with server-side JWT validation cache
      // warming + JWKS key-rotation. A single 401 during this window
      // should NOT eject the user back to the sign-in modal — that's
      // exactly what produced the OAuth-loop bug.
      const sinceSignIn = Date.now() - (window.__lastSignInAt || 0);
      if (sinceSignIn < 8000) {
        console.warn('[fetch wrapper] 401 within sign-in grace window (' + sinceSignIn + 'ms) — letting it pass', { url });
        return response;
      }

      _handlingExpiry = true;
      try {
        // Double-check the session is actually gone before signing out (avoids
        // false positives where the backend rejects for a different reason)
        const { data } = await supabaseClient.auth.getSession();
        if (!data.session) {
          console.warn('Session expired — signing out');
          signOut();
          showSessionExpiredModal();
        }
      } catch {
        signOut();
        showSessionExpiredModal();
      } finally {
        _handlingExpiry = false;
      }
    }
  }

  return response;
};

function checkInactivity() {
  if (!currentSession) return;
  // No recorded activity at all (first visit / cleared storage) — treat as
  // fresh; recordActivity will populate lastActivityTime once the user moves.
  if (lastActivityTime == null) return;
  if (Date.now() - lastActivityTime > INACTIVITY_TIMEOUT_MS) {
    console.warn('Session expired due to inactivity (48 h)');
    signOut();
    showSessionExpiredModal('You\'ve been signed out after 48 hours of inactivity.');
  }
}
// Run shortly after init so reopened-tab case is caught quickly, then every 5 min.
// Gate the cold-start check on actual staleness:
//   (a) if the user has already interacted since page load, skip — they're active
//   (b) if the session token has >10 min remaining, it's not stale — skip
//   (c) if no activity has ever been recorded, skip — checkInactivity guards too
setTimeout(() => {
  if (!currentSession) return;
  if (lastActivityTime != null && lastActivityTime >= pageLoadTime) return;
  // Check token expiry — skip if plenty of lifetime remains
  const expiresAt = currentSession.expires_at; // Unix seconds (Supabase)
  if (expiresAt && (expiresAt * 1000 - Date.now()) > SESSION_STALENESS_THRESHOLD_MS) return;
  checkInactivity();
}, 2000);
setInterval(checkInactivity, 5 * 60 * 1000);

// Track real user activity — any of these resets the 48-hour inactivity clock
document.addEventListener('click', recordActivity);
document.addEventListener('scroll', recordActivity, { passive: true });
document.addEventListener('keydown', recordActivity);
document.addEventListener('touchstart', recordActivity, { passive: true });
document.addEventListener('mousemove', recordActivity, { passive: true });

// Init auth on load
initAuth();

$('signupModal').addEventListener('click', e => { if (e.target === $('signupModal')) $('signupModal').classList.remove('show'); });
$('paywallModal').addEventListener('click', e => { if (e.target === $('paywallModal')) $('paywallModal').classList.remove('show'); });
document.addEventListener('keydown', e => { if(e.key==='Escape'){$('signupModal').classList.remove('show');$('paywallModal').classList.remove('show');$('budgetCalcModal').classList.remove('show')} });
$('budgetCalcModal').addEventListener('click', e => { if (e.target === $('budgetCalcModal')) $('budgetCalcModal').classList.remove('show'); });

// ── Budget calculator ──
function fmtCurrency(v) { var prefix = v < 0 ? '-\u00a3' : '\u00a3'; return prefix + Math.abs(Math.round(v)).toLocaleString(); }
function calcBudget() {
  const price = parseInt($('bcPrice').value) || 0;
  const region = $('bcRegion').value;
  const works = parseInt($('bcWorks').value) || 0;
  const survey = parseInt($('bcSurvey').value) || 0;
  const legal = parseInt($('bcLegal').value) || 0;
  const buyerPrem = parseInt($('bcBuyerPrem').value) || 0;
  const cash = parseInt($('bcCash').value) || 0;
  if (!price) { $('bcResults').innerHTML = ''; return; }
  const sdlt = calcSDLT(price, region);
  const deposit = Math.round(price * 0.1);
  const totalCost = price + sdlt + works + survey + legal + buyerPrem;
  const dayOneCash = deposit + sdlt + buyerPrem + survey + legal;
  let html = '<div class="bc-results">' +
    '<div style="font-weight:600;font-size:.88rem;margin-bottom:8px;color:var(--text)">Cost breakdown</div>' +
    '<div class="bc-row"><span class="bc-label">Purchase price</span><span class="bc-val">' + fmtCurrency(price) + '</span></div>' +
    '<div class="bc-row"><span class="bc-label">SDLT / stamp duty</span><span class="bc-val">' + fmtCurrency(sdlt) + '</span></div>' +
    '<div class="bc-row"><span class="bc-label">Refurb / works</span><span class="bc-val">' + fmtCurrency(works) + '</span></div>' +
    '<div class="bc-row"><span class="bc-label">Survey</span><span class="bc-val">' + fmtCurrency(survey) + '</span></div>' +
    '<div class="bc-row"><span class="bc-label">Solicitor fees</span><span class="bc-val">' + fmtCurrency(legal) + '</span></div>' +
    '<div class="bc-row"><span class="bc-label">Buyer\'s premium</span><span class="bc-val">' + fmtCurrency(buyerPrem) + '</span></div>' +
    '<div class="bc-row bc-total"><span class="bc-label">Total real cost</span><span class="bc-val">' + fmtCurrency(totalCost) + '</span></div>' +
    '</div>' +
    '<div class="bc-results" style="margin-top:8px">' +
    '<div style="font-weight:600;font-size:.88rem;margin-bottom:8px;color:var(--text)">Cash you need</div>' +
    '<div class="bc-row"><span class="bc-label">10% deposit (auction day)</span><span class="bc-val">' + fmtCurrency(deposit) + '</span></div>' +
    '<div class="bc-row"><span class="bc-label">Day-one cash needed</span><span class="bc-val" style="color:var(--accent)">' + fmtCurrency(dayOneCash) + '</span></div>' +
    '<div style="font-size:.75rem;color:var(--text3);margin-top:4px">Deposit + SDLT + buyer\'s premium + survey + legal</div>' +
    '</div>';
  if (cash > 0) {
    const surplus = cash - dayOneCash;
    const verdictColor = surplus >= 0 ? 'var(--signal-pos)' : 'var(--accent-danger)';
    const verdictBg = surplus >= 0 ? '#e8f5ee' : '#fdf0ee';
    const verdictText = surplus >= 0
      ? 'You have ' + fmtCurrency(surplus) + ' spare after day-one costs. ' + (works > 0 && surplus >= works ? 'Enough to cover your refurb budget.' : works > 0 ? 'You may need bridging finance to cover the remaining ' + fmtCurrency(works - Math.max(0, surplus)) + ' of works.' : '')
      : 'You are ' + fmtCurrency(Math.abs(surplus)) + ' short of day-one costs. Consider a lower purchase price or arranging bridging finance.';
    html += '<div class="bc-verdict" style="background:' + verdictBg + ';color:' + verdictColor + '">' + verdictText + '</div>';
  }
  $('bcResults').innerHTML = html;
}

// ═══════════════════════════════
// STRIPE / PAYWALL
// ═══════════════════════════════
function showPaywall(reason) {
  // Server-side activity event so the admin Intel dashboard can see who's
  // hitting limits and which feature gated them — drives billing decisions.
  try {
    fetch('/api/track/event', {
      method: 'POST',
      headers: {'Content-Type':'application/json', ...(typeof getAuthHeaders === 'function' ? getAuthHeaders() : {})},
      body: JSON.stringify({
        action: 'paywall_hit',
        detail: { reason: typeof reason === 'string' ? reason.slice(0, 120) : '', tier: window._userTier || 'anon' }
      })
    }).catch(function(){});
  } catch {}
  if (typeof umami !== 'undefined') umami.track('paywall_hit', {
    reason: typeof reason === 'string' ? reason.slice(0, 60) : '',
    tier: window._userTier || 'anon',
  });

  // When not signed in, show sign-up modal
  if (!window._userTier) {
    $('signupModal').classList.add('show');
    return;
  }
  // Signed in — show daily limit modal
  if (reason) $('paywallReason').textContent = reason;
  $('paywallModal').classList.add('show');
}

async function startCheckout(product) {
  console.log('[BM] startCheckout called', { product, hasSession: !!currentSession });
  if (!currentSession) { requireSignup(); return; }
  try {
    const resp = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ product }),
    });
    const data = await resp.json();
    console.log('[BM] Stripe checkout response', { status: resp.status, hasUrl: !!data.url, error: data.error });
    if (data.url) {
      window.location.href = data.url;
    } else {
      alert(data.error || 'Failed to start checkout');
    }
  } catch (err) {
    console.error('[BM] Checkout error', err);
    alert('Checkout failed: ' + err.message);
  }
}

async function openBillingPortal() {
  try {
    const resp = await fetch('/api/stripe/portal', {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    const data = await resp.json();
    if (data.url) window.location.href = data.url;
    else alert(data.error || 'Failed to open billing portal');
  } catch (err) {
    alert('Portal error: ' + err.message);
  }
}

// ═══════════════════════════════
// Anonymous-browsing nudges (Milestone 1)
// ═══════════════════════════════
// Counts unique lot views in localStorage. At 10 unique views we drop a
// dismissible toast; at 25 we open the signup modal once. Both nudges
// fire at most once per device — clearing localStorage resets them, but
// that's a low-effort act of self-harm we don't try to defeat.
//
// Skipped for signed-in users (they've already converted) and for users
// who actively opted out via the "Don't show again" close button — we
// honour that even before the count threshold via ab_anon_nudge_dismissed.
const ANON_NUDGE_TOAST_AT = 10;
const ANON_NUDGE_MODAL_AT = 25;

function _anonNudgeStorage() {
  try { return window.localStorage; } catch { return null; }
}

function trackAnonViewNudge(lot) {
  if (window._userTier) return; // signed in
  const ls = _anonNudgeStorage();
  if (!ls) return;
  if (ls.getItem('ab_anon_nudge_dismissed') === '1') return;

  // Dedup per-lot per-device so the same card opened thrice still counts as 1.
  const key = (lot && lot._house ? lot._house : '') + ':' + (lot && lot.lot ? lot.lot : '') +
              ':' + (lot && lot.address ? String(lot.address).slice(0, 40) : '');
  let seen = {};
  try { seen = JSON.parse(ls.getItem('ab_anon_seen_lots') || '{}'); } catch {}
  if (seen[key]) return;
  seen[key] = 1;
  // Cap the seen-set so it doesn't grow forever — we only need to know
  // if a lot has already been counted, and 100 entries is more than enough.
  const keys = Object.keys(seen);
  if (keys.length > 120) {
    const drop = keys.slice(0, keys.length - 100);
    drop.forEach(k => delete seen[k]);
  }
  ls.setItem('ab_anon_seen_lots', JSON.stringify(seen));

  const n = (parseInt(ls.getItem('ab_anon_view_count') || '0', 10) || 0) + 1;
  ls.setItem('ab_anon_view_count', String(n));

  if (n === ANON_NUDGE_TOAST_AT && ls.getItem('ab_anon_nudge_10') !== '1') {
    ls.setItem('ab_anon_nudge_10', '1');
    showAnonViewToast();
  }
  if (n === ANON_NUDGE_MODAL_AT && ls.getItem('ab_anon_nudge_25') !== '1') {
    ls.setItem('ab_anon_nudge_25', '1');
    setTimeout(showAnonViewSoftModal, 500);
  }
}

function showAnonViewToast() {
  if (document.getElementById('anonViewToast')) return;

  const wrap = document.createElement('div');
  wrap.id = 'anonViewToast';
  wrap.className = 'anon-toast';
  wrap.setAttribute('role', 'status');

  const msg = document.createElement('span');
  msg.className = 'anon-toast-msg';
  msg.textContent = 'Enjoying Auction Brain? ';
  const cta = document.createElement('a');
  cta.href = '#';
  cta.className = 'anon-toast-cta';
  cta.textContent = 'Sign up free';
  cta.addEventListener('click', function(e) {
    e.preventDefault();
    if (typeof $ === 'function' && $('signupModal')) $('signupModal').classList.add('show');
    wrap.remove();
  });
  msg.appendChild(cta);
  msg.appendChild(document.createTextNode(' to save lots.'));

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'anon-toast-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  close.addEventListener('click', function() {
    const ls = _anonNudgeStorage();
    if (ls) ls.setItem('ab_anon_nudge_dismissed', '1');
    wrap.remove();
  });

  wrap.appendChild(msg);
  wrap.appendChild(close);
  document.body.appendChild(wrap);

  if (typeof umami !== 'undefined') umami.track('anon_nudge_toast');

  setTimeout(function() {
    if (wrap.parentNode) wrap.classList.add('anon-toast-out');
    setTimeout(function() { if (wrap.parentNode) wrap.remove(); }, 400);
  }, 8000);
}

function showAnonViewSoftModal() {
  if (window._userTier) return;
  if (typeof $ !== 'function' || !$('signupModal')) return;
  $('signupModal').classList.add('show');
  if (typeof umami !== 'undefined') umami.track('anon_nudge_modal');
}

// ═══════════════════════════════
// Weekly digest subscribe (Milestone 6)
// ═══════════════════════════════
async function handleDigestSubscribe(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  const input = document.getElementById('digestEmail');
  const status = document.getElementById('digestFormStatus');
  const btn = document.querySelector('.digest-form-btn');
  if (!input || !status) return false;
  const email = (input.value || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    status.textContent = 'Please enter a valid email address.';
    status.className = 'digest-form-status digest-form-status-error';
    return false;
  }
  status.textContent = 'Subscribing…';
  status.className = 'digest-form-status';
  if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/digest/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok) {
      status.textContent = data.message || 'Thanks — first digest will be on its way Monday.';
      status.className = 'digest-form-status digest-form-status-ok';
      input.value = '';
      if (typeof umami !== 'undefined') umami.track('digest_subscribe');
    } else {
      status.textContent = data.error || 'Subscription temporarily unavailable.';
      status.className = 'digest-form-status digest-form-status-error';
    }
  } catch (err) {
    status.textContent = 'Network issue — try again.';
    status.className = 'digest-form-status digest-form-status-error';
  } finally {
    if (btn) btn.disabled = false;
  }
  return false;
}

// Pricing-page CTA dispatch — /pricing CTAs link back to /?cta=<action>.
// We pick that up at boot and either open the signup modal (anon) or the
// Stripe checkout (signed in). Drops the query param so a refresh doesn't
// retrigger.
(function checkCtaIntent() {
  const params = new URLSearchParams(window.location.search);
  const cta = params.get('cta');
  if (!cta) return;
  if (!['signup', 'day_pass', 'monthly'].includes(cta)) return;
  window.history.replaceState({}, '', window.location.pathname);
  // Run after auth bootstrap so we can check currentSession.
  setTimeout(() => {
    if (cta === 'signup') {
      if (typeof $ === 'function' && $('signupModal')) $('signupModal').classList.add('show');
      return;
    }
    // day_pass or monthly — needs an account
    if (!window._userTier) {
      if (typeof $ === 'function' && $('signupModal')) $('signupModal').classList.add('show');
      return;
    }
    if (typeof startCheckout === 'function') startCheckout(cta);
  }, 700);
})();

// Payment success toast
(function checkPaymentSuccess() {
  const params = new URLSearchParams(window.location.search);
  const paymentStatus = params.get('payment');
  if (paymentStatus === 'success' || paymentStatus === 'cancelled') {
    if (typeof umami !== 'undefined') {
      umami.track(paymentStatus === 'success' ? 'payment_success' : 'payment_cancelled');
    }
    window.history.replaceState({}, '', window.location.pathname);
    setTimeout(() => {
      const toast = document.createElement('div');
      const isSuccess = paymentStatus === 'success';
      toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:' + (isSuccess ? '#C0392B' : '#6b7c8d') + ';color:white;padding:12px 24px;border-radius:8px;font-weight:600;z-index:999;font-size:.9rem;box-shadow:0 4px 20px rgba(0,0,0,.15)';
      toast.textContent = isSuccess ? 'Welcome! You now have full access.' : 'Checkout cancelled.';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 5000);
    }, 500);
  }
})();

// Pro badge + scan counter in user bar
async function updateProStatus() {
  if (!currentSession) return;
  try {
    const resp = await fetch('/api/stripe/status', { headers: getAuthHeaders() });
    if (!resp.ok) return;
    const data = await resp.json();
    // Store Stripe enabled flag from server
    if (data.stripeEnabled !== undefined) window._stripeEnabled = data.stripeEnabled;
    const emailEl = $('userEmail');
    // Remove old badge if present
    const oldBadge = document.querySelector('.pro-badge');
    if (oldBadge) oldBadge.remove();

    // All signed-in users are members — no paid tiers
    $('acctTier').textContent = 'Member';
    $('acctTier').classList.add('pro');
    // Remove any legacy trial banners
    const existingBanner = document.querySelector('.trial-banner');
    if (existingBanner) existingBanner.remove();
    // Store for search counter display
    window._userTier = data.tier;
    window._scansUsed = data.scansUsed;
    window._scanLimit = data.scanLimit;
    window._aiSearchesUsed = data.aiSearchesUsed || 0;
    window._aiSearchLimit = data.aiSearchLimit;
    // Toggle the body.is-pro class — CSS uses it to reveal Pro-only chrome
    // (data-pro-only items like the Unsold-lots toggle stay hidden until
    // a premium tier is confirmed). isPremium() handles trial too.
    try { document.body.classList.toggle('is-pro', data.tier === 'premium'); } catch {}
    // Gate the unsold filter on the resolved tier. Activates a deferred
    // ?status=unsold URL param for Pro users; clears any stale state for
    // free users so they don't see a stuck filter they can't disable.
    if (typeof enforceUnsoldGating === 'function') enforceUnsoldGating();
    // Cross-tab tier sync: broadcast tier change to other tabs
    try {
      localStorage.setItem('bridgematch_tier', window._userTier);
      localStorage.setItem('bridgematch_tier_ts', Date.now().toString());
    } catch(e) { /* localStorage unavailable (private browsing, quota) */ }
  } catch {}
}

// ── Cross-tab tier synchronisation ──
// When another tab changes tier via Stripe checkout or status refresh,
// this tab picks up the change instantly without polling.
function refreshTierUI() {
  if ($('acctTier') && window._userTier) {
    $('acctTier').textContent = 'Member';
    $('acctTier').classList.add('pro');
  }
}

window.addEventListener('storage', function(e) {
  if (e.key === 'bridgematch_tier' && e.newValue && e.newValue !== window._userTier) {
    window._userTier = e.newValue;
    // UI-only refresh — no /api/stripe/status call to avoid infinite loop
    refreshTierUI();
    try { document.body.classList.toggle('is-pro', e.newValue === 'premium'); } catch {}
    if (typeof enforceUnsoldGating === 'function') enforceUnsoldGating();
  }
});

// ═══════════════════════════════
// CATALOGUE ANALYSIS
// ═══════════════════════════════
function log(m,c=''){const d=document.createElement('div');d.className=c;d.textContent=`[${new Date().toLocaleTimeString()}] ${m}`;$('logBox').appendChild(d);$('logBox').scrollTop=9e9}
function prog(p,t){$('pBar').style.width=p+'%';if(t)$('pStatus').textContent=t}

async function runAnalysis(url){
  if(!requireSignup()) return;
  if(!url) url=$('smartQuery').value.trim();
  if(!url)return alert('Please paste an auction catalogue URL');

  // Clean slate — abort previous, clear all state, reset filters
  resetSearchState();
  _searchAbort=new AbortController();
  const signal=_searchAbort.signal;

  $('mainBtn').disabled=true;
  showResultsView();

  // Show scanning animation with house detection
  const detected = detectHouseFromUrl(url);
  const safeName = esc(detected.name || '');
  const scanTitle = detected.isPdf
    ? `Reading PDF catalogue`
    : detected.recognised
      ? `Scanning ${safeName}`
      : `Scanning new auction house`;
  const step1Label = detected.isPdf
    ? `PDF detected — sending to AI`
    : detected.recognised
      ? `Recognised: ${safeName}`
      : `Auto-detecting catalogue structure`;

  $('progressPanel').style.display='block';
  $('progressPanel').innerHTML=`<div class="scan-animation">
    <div class="scan-title">${scanTitle}</div>
    <div class="scan-steps">
      <div class="scan-step active" id="ss1"><span class="spinner"></span><span class="check">✓</span> ${step1Label}</div>
      <div class="scan-step waiting" id="ss2"><span class="spinner"></span><span class="check">✓</span> Extracting lots</div>
      <div class="scan-step waiting" id="ss3"><span class="spinner"></span><span class="check">✓</span> Scoring deals</div>
      <div class="scan-step waiting" id="ss4"><span class="spinner"></span><span class="check">✓</span> Land Registry check</div>
      <div class="scan-step waiting" id="ss5"><span class="spinner"></span><span class="check">✓</span> Yield estimates</div>
    </div>
    <div class="scan-count" id="scanCount">—</div>
    <div class="scan-label" id="scanLabel">lots found so far</div>
  </div>`;

  // Map SSE phase names to step indicators
  const PHASE_STEPS = { connecting: 1, scraping: 2, extracting: 3, scoring: 4, enriching: 5 };

  function advanceStep(stepNum) {
    for (let i = 1; i < stepNum; i++) {
      const s = $('ss'+i);
      if (s) { s.classList.remove('active','waiting'); s.classList.add('done'); }
    }
    const cur = $('ss'+stepNum);
    if (cur) { cur.classList.remove('waiting'); cur.classList.add('active'); }
  }

  function showResults(data) {
    LOTS = data.lots || [];
    for (let i=1;i<=5;i++) { const s=$('ss'+i); if(s){s.classList.remove('active','waiting');s.classList.add('done')} }
    if($('scanCount')) $('scanCount').textContent = LOTS.length;
    const scanParts = [`lots scored`, `${data.titleSplits} title splits`, `${data.topPicks} top picks`];
    if (data.under100k > 0) scanParts.push(`${data.under100k} under £100k`);
    if (data.avgYield) scanParts.push(`avg ${data.avgYield}% yield`);
    if (data.devPotential > 0) scanParts.push(`${data.devPotential} dev potential`);
    if (data.vacantCount > 0) scanParts.push(`${data.vacantCount} vacant`);
    if($('scanLabel')) $('scanLabel').textContent = scanParts.join(' · ');

    setTimeout(() => {
      $('progressPanel').style.display='none';
      $('resultsTitle').textContent = `${data.house || 'Auction'} — ${LOTS.length} lots`;
      const existingNotice = document.querySelector('.auto-detect-notice');
      if (existingNotice) existingNotice.remove();
      if (data.recognised === false && LOTS.length > 0) {
        const notice = document.createElement('div');
        notice.className = 'auto-detect-notice';
        notice.textContent = 'New house auto-detected — results may vary for unfamiliar sites';
        $('resultsTitle').parentNode.insertBefore(notice, $('resultsTitle').nextSibling);
      }
      $('viewToggle').style.display='none';
      $('reportView').style.display='none';
      $('cardsView').style.display='block';
      buildLotFilters();
      renderLots();
      $('resultsPanel').style.display='block';

      // Show scan counter for free users
      if (data.blurred) {
        showPaywall('You\'ve used your AI scans for today. Your allowance resets at midnight.');
      } else if (data.scansUsed !== undefined && data.scanLimit && (window._userTier || 'free') === 'free') {
        const remaining = Math.max(0, data.scanLimit - data.scansUsed);
        const counter = document.querySelector('.scan-counter') || document.createElement('div');
        counter.className = 'scan-counter';
        counter.textContent = remaining > 0 ? remaining + ' AI scan' + (remaining !== 1 ? 's' : '') + ' remaining today' : 'Daily AI scan limit reached';
        if (!counter.parentNode) $('resultsPanel').insertBefore(counter, $('resultsPanel').firstChild);
      }
    }, data.cached ? 500 : 1200);
  }

  try{
    const resp=await fetch('/api/analyse',{
      method:'POST',
      headers:authHeaders(),
      body:JSON.stringify({url,budget:{deposit:+($('dep')?.value||0),stdPct:+($('stdPct')?.value||25),tsPct:+($('tsPct')?.value||0)}}),
      signal
    });

    const ct = resp.headers.get('content-type') || '';

    if (ct.includes('application/json')) {
      // Cached response — plain JSON
      const data = await resp.json();
      if (!resp.ok) {
        if(data.error==='signup_required'){requireSignup();throw new Error('Please sign up first')}
        if(data.error==='rate_limited'){throw new Error(data.message||'Daily limit reached')}
        throw new Error(data.message||data.error||'Analysis failed');
      }
      showResults(data);
    } else {
      // Fresh analysis — SSE stream
      const reader = resp.body.getReader();
      _searchReader = reader; // Track for cleanup on abort
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          // Check abort BEFORE reading — prevents processing stale data from previous search
          if (signal.aborted) break;
          const { done, value } = await reader.read();
          if (done || signal.aborted) break;
          buffer += decoder.decode(value, { stream: true });

          // Parse complete SSE events from buffer
          const parts = buffer.split('\n\n');
          buffer = parts.pop(); // keep incomplete event in buffer

          for (const part of parts) {
            if (signal.aborted) break;
            let eventType = 'message', eventData = '';
            for (const line of part.split('\n')) {
              if (line.startsWith('event: ')) eventType = line.slice(7);
              else if (line.startsWith('data: ')) eventData = line.slice(6);
            }
            if (!eventData) continue;

            try {
              const d = JSON.parse(eventData);
              if (eventType === 'phase') {
                const step = PHASE_STEPS[d.step];
                if (step) advanceStep(step);
                if (d.step === 'connecting' && d.house) {
                  const t = $('ss1'); if(t) t.querySelector('.check').nextSibling.textContent = ' ' + d.house;
                }
                if (d.lots && $('scanCount')) $('scanCount').textContent = d.lots;
              } else if (eventType === 'scrape') {
                if (d.lots !== undefined && $('scanCount')) $('scanCount').textContent = d.lots;
                if (d.pages && $('scanLabel')) $('scanLabel').textContent = `${d.pages} page(s) found`;
              } else if (eventType === 'extract') {
                advanceStep(3);
                if (d.lotsFound !== undefined && $('scanCount')) $('scanCount').textContent = d.lotsFound;
                if ($('scanLabel')) $('scanLabel').textContent = `batch ${d.batch}/${d.totalBatches} · ${d.lotsFound} lots extracted`;
              } else if (eventType === 'enrich') {
                advanceStep(5);
                if ($('scanLabel')) $('scanLabel').textContent = `Land Registry: ${d.postcodes}/${d.total} postcodes`;
              } else if (eventType === 'done') {
                showResults(d);
              } else if (eventType === 'error') {
                throw new Error(d.message || 'Analysis failed');
              }
            } catch (parseErr) {
              if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr;
            }
          }
        }
      } finally {
        // Always clean up reader reference
        _searchReader = null;
        try { reader.cancel(); } catch(e) {}
      }
    }
  }catch(e){
    if(e.name==='AbortError') return;
    console.error('Analysis error:', e);
    $('progressPanel').innerHTML=`<div class="scan-animation" style="background:var(--red)">
      <div class="scan-title">✗ Analysis failed — please try again</div>
      <div class="scan-label"><a href="#" onclick="backToAuctions();return false" style="color:white;text-decoration:underline">← Back to auctions</a></div>
    </div>`;
  }
  // Only clear if this search's controller is still the active one (prevents race with new search)
  if(_searchAbort?.signal === signal) _searchAbort=null;
  $('mainBtn').disabled=false;
}

// ═══════════════════════════════
// SMART SEARCH
// ═══════════════════════════════
async function runSmartSearch(query) {
  // Anonymous users must sign in
  if (!window._userTier || window._userTier === 'anon') {
    $('signupModal').classList.add('show');
    return;
  }
  // Snapshot current browse view DOM for instant restore on back-navigation
  try {
    const out=$('lotsOut');
    if(out&&ALL_LOTS.length&&!SMART_RESULTS){
      _browseSnapshot={html:out.innerHTML,renderKey:window._lastRenderKey,lotCount:ALL_LOTS.length,
        statsHtml:$('statsRow')?.innerHTML||'',filterCount:$('filterBarCount')?.textContent||''};
    }
  } catch(e){}

  // Pre-confirmation: show remaining credits before consuming one
  if (window._aiSearchLimit && window._aiSearchLimit !== 'unlimited') {
    const used = window._aiSearchesUsed || 0;
    const remaining = Math.max(0, window._aiSearchLimit - used);
    if (remaining <= 5) {
      const proceed = confirm('This will use 1 of your ' + remaining + ' remaining AI search' + (remaining !== 1 ? 'es' : '') + ' today.\n\nContinue?');
      if (!proceed) return;
    }
  }

  // Clean slate — abort previous, clear all state, reset filters.
  // Capture the LOT STATUS selection FIRST: resetSearchState() sets fSoldTop
  // to 'all', so reading it after (as the request body used to) silently
  // discarded the user's Sold/Unsold/etc selection on every AI search.
  const _smSold = $('fSoldTop')?.value || 'all';
  resetSearchState();
  // Restore so the client-side post-filter on returned results matches what
  // the server was asked to filter by.
  if($('fSoldTop')) $('fSoldTop').value = _smSold;
  _searchAbort=new AbortController();
  const signal=_searchAbort.signal;

  $('mainBtn').disabled = true;
  $('mainBtn').textContent = 'Searching...';
  showResultsView();

  // Show search animation
  $('progressPanel').style.display = 'block';
  $('progressPanel').innerHTML=`<div class="scan-animation">
    <div class="scan-title">🔍 AI is searching ${ALL_LOTS.length > 0 ? ALL_LOTS.length + ' lots' : 'all cached catalogues'}</div>
    <div class="scan-steps">
      <div class="scan-step active" id="sq1"><span class="spinner"></span><span class="check">✓</span> Understanding query</div>
      <div class="scan-step waiting" id="sq2"><span class="spinner"></span><span class="check">✓</span> Searching cached lots</div>
      <div class="scan-step waiting" id="sq3"><span class="spinner"></span><span class="check">✓</span> Scoring matches</div>
      <div class="scan-step waiting" id="sq4"><span class="spinner"></span><span class="check">✓</span> Building report</div>
    </div>
    <div class="scan-count" id="scanCount">—</div>
    <div class="scan-label" id="scanLabel">matches found</div>
  </div>`;

  // Animate steps — track timer IDs so resetSearchState() can cancel them
  const stepTimings = [1000, 2500, 4000];
  stepTimings.forEach((t, i) => {
    _searchTimers.push(setTimeout(() => {
      if(signal.aborted) return;
      const prev = $('sq'+(i+1));
      const next = $('sq'+(i+2));
      if(prev){prev.classList.remove('active');prev.classList.add('done')}
      if(next){next.classList.remove('waiting');next.classList.add('active')}
    }, t));
  });
  _searchTimers.push(setTimeout(()=>{
    if(signal.aborted) return;
    const sl=$('scanLabel');
    if(sl&&$('progressPanel')?.style.display==='block')sl.textContent='Still working — querying AI...';
  },5000));

  try {
    const _smTown = ($('fTown')?.value || '').trim();
    const _smPostcode = ($('fPostcode')?.value || '').trim();
    const _smRaw = _smPostcode || _smTown;
    const _smRadius = +($('fRadius')?.value || 0) || null;
    const resp = await fetch('/api/smart-search', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        query,
        soldFilter: _smSold,
        // Region dropdown (fLocation) — scope the AI candidate pool server-side
        // so "N matches" reflects what's actually shown. Client-side region
        // filtering is skipped for SMART_RESULTS (see renderLots) to avoid
        // double-filtering the already-scoped set.
        region: $('fLocation')?.value || '',
        location: (_smRaw || (_searchCentre && _smRadius)) ? {
          center: _searchCentre || null,
          rawInput: _smRaw || null,
          radiusMiles: _smRadius,
        } : null,
      }),
      signal
    });
    const data = await resp.json();
    if (!resp.ok) {
      if (data.error === 'premium_required') {
        const _pp=$('progressPanel'); if(_pp) _pp.style.display='none';
        const _sb=$('mainBtn'); if(_sb){_sb.disabled=false;_sb.textContent='Search';}
        showPaywall(data.message || 'Sign in free to use AI search.');
        return;
      }
      if (data.error === 'rate_limited') {
        const _pp=$('progressPanel'); if(_pp) _pp.style.display='none';
        const _sb=$('mainBtn'); if(_sb){_sb.disabled=false;_sb.textContent='Search';}
        if (data.signup_prompt) {
          // Anonymous user hit limit — prompt signup
          $('signupModal').classList.add('show');
          $('authStep1').style.display = '';
          $('authStep2').style.display = 'none';
          $('signupError').style.display = 'none';
          $('signupError').textContent = '';
          $('signupEmail').value = '';
          $('signupEmail').focus();
          const errEl = $('signupError');
          errEl.textContent = 'Sign in free to unlock AI searches!';
          errEl.style.display = '';
          errEl.style.color = 'var(--accent)';
        } else {
          showPaywall(data.message || 'You\'ve used your AI searches for today. Your allowance resets at midnight.');
        }
        return;
      }
      if (data.error === 'ai_quota_exhausted') {
        throw new Error(data.message || 'AI search temporarily unavailable — rate limit reached. Please try again later.');
      }
      throw new Error(data.detail || data.error || 'Search failed');
    }

    LOTS = data.results || [];
    SMART_RESULTS = data;

    // Complete all steps
    for(let i=1;i<=4;i++){const s=$('sq'+i);if(s){s.classList.remove('active','waiting');s.classList.add('done')}}
    if($('scanCount'))$('scanCount').textContent=LOTS.length;
    if($('scanLabel'))$('scanLabel').textContent=`matches across ${data.sources?.length||0} catalogues · ${data.totalSearched||0} lots searched${data.cached?' (cached)':''}`;

    if(!data.cached) await new Promise(r=>setTimeout(r,1200));

    $('progressPanel').style.display = 'none';

    // Show results with report toggle
    $('resultsTitle').textContent = `"${query}" — ${LOTS.length} matches`;
    $('viewToggle').style.display = 'flex';

    // Report
    let rh = '';
    if (data.report) rh += `<p>${esc(data.report).replace(/\n/g, '</p><p>')}</p>`;
    if (data.sources?.length) rh += `<div class="sources">Searched ${data.totalSearched||0} lots across ${data.sources.length} catalogues: ${data.sources.map(s=>`${esc(s.house)} (${s.count})`).join(', ')}</div>`;
    $('reportView').innerHTML = rh;

    showView('cards');
    buildLotFilters();
    renderLots();
    $('resultsPanel').style.display = 'block';
    $('statsRow').innerHTML = `
      <div class="stat-card"><div class="v g">${data.totalSearched||0}</div><div class="l">Lots searched</div></div>
      <div class="stat-card"><div class="v y">${LOTS.length}</div><div class="l">Matches</div></div>
      <div class="stat-card"><div class="v g">${LOTS.filter(l=>(l.score||0)>=3).length}</div><div class="l">Score 3+</div></div>
      <div class="stat-card"><div class="v p">${LOTS.filter(l=>l.vacant).length}</div><div class="l">Vacant</div></div>
      <div class="stat-card"><div class="v y">${data.sources?.length||0}</div><div class="l">Catalogues</div></div>`;
    // Show AI search counter
    if (data.searchLimit && data.searchLimit !== 'unlimited') {
      const remaining = Math.max(0, data.searchLimit - (data.searchesUsed || 0));
      $('statsRow').insertAdjacentHTML('afterend', '<div class="search-counter">' + remaining + ' AI search' + (remaining !== 1 ? 'es' : '') + ' left today</div>');
    }
    // Non-determinism + interpretive-results disclaimer (insert once)
    if (!document.getElementById('aiSearchDisclaimer')) {
      $('statsRow').insertAdjacentHTML('afterend', '<div id="aiSearchDisclaimer" style="text-align:center;font-size:.72rem;color:var(--text3);margin-top:6px;line-height:1.5;max-width:680px;margin-left:auto;margin-right:auto">AI searches are non-deterministic — running the same search twice may return different results. The AI interprets your intent semantically and may suggest properties outside your literal parameters when it judges them relevant (or when no exact matches exist). Always verify each lot against the auction house listing before acting.</div>');
    }
    // Update stored counters
    if (data.searchesUsed != null) window._aiSearchesUsed = data.searchesUsed;
  } catch (e) {
    if(e.name==='AbortError') return; // Silently ignore aborted requests
    console.error('Analysis error:', e);
    $('progressPanel').innerHTML=`<div class="scan-animation" style="background:var(--red)">
      <div class="scan-title">✗ ${esc(e.message || 'Analysis failed')}</div>
      <div class="scan-label"><a href="#" onclick="backToAuctions();return false" style="color:white;text-decoration:underline">← Back to auctions</a></div>
    </div>`;
  }
  // Only clear if this search's controller is still the active one (prevents race with new search)
  if(_searchAbort?.signal === signal) _searchAbort=null;
  $('mainBtn').disabled = false;
  $('mainBtn').textContent = 'Search';
}

function showView(v) {
  document.querySelectorAll('.vtog').forEach((b,i) => b.classList.toggle('active', i===(v==='report'?0:1)));
  $('reportView').style.display = v === 'report' ? 'block' : 'none';
  $('cardsView').style.display = v === 'cards' ? 'block' : 'none';
}

// ═══════════════════════════════
// LOT RENDERING
// ═══════════════════════════════
function buildLotFilters(){
  const _prevDeal=$('fDeal')?.value||'';
  const deals=new Set(LOTS.map(l=>l.dealType).filter(Boolean));
  $('fDeal').innerHTML='<option value="">Opportunity</option>'+[...deals].sort().map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('');
  // fDeal options are built dynamically from loaded lots, but restoreFiltersFromURL()
  // runs at parse time BEFORE they exist — so a shared ?fDeal=Title+Split URL was
  // silently dropped and the grid showed every deal type (2026-07-07 audit).
  // Re-apply the desired value (URL wins on first build; otherwise preserve the
  // user's current selection across the rebuild) now that the option exists.
  const _wantDeal=new URLSearchParams(location.search).get('fDeal')||_prevDeal;
  if(_wantDeal){ $('fDeal').value=_wantDeal; } // no-op if the option doesn't exist (value stays '')

  /* fTS dropdown removed — title splits shown inline via section dividers */

  const hasCash=+($('fpCash')?.value)>0;
  if($('fAfford')) $('fAfford').style.display=hasCash?'':'none';

  buildHouseChecklist();
}

// ═══════════════════════════════
// HOUSE MULTI-SELECT DROPDOWN
// ═══════════════════════════════
let _selectedHouses=new Set();

function houseFreshness(slug){
  const src=ALL_SOURCES.find(s=>s.house===slug);
  if(!src||!src.updatedAt) return '';
  const hrs=Math.round((Date.now()-new Date(src.updatedAt).getTime())/3600000);
  if(hrs<1) return ' <span style="color:var(--green);font-size:.65rem">just now</span>';
  if(hrs<24) return ' <span style="color:var(--green);font-size:.65rem">'+hrs+'h ago</span>';
  return ' <span style="color:var(--warn,#e67e22);font-size:.65rem">'+Math.round(hrs/24)+'d ago</span>';
}
function buildHouseChecklist(){
  const counts={};
  LOTS.forEach(l=>{ const h=l._house||'Unknown'; counts[h]=(counts[h]||0)+1; });
  const houses=Object.keys(counts).sort();
  const list=$('houseCheckList');
  list.innerHTML='<label class="all-label"><input type="checkbox" checked onchange="toggleAllHouses(this.checked)"> All houses <span class="house-count">'+LOTS.length+'</span></label>'+
    houses.map(h=>{
      const checked=_selectedHouses.size===0||_selectedHouses.has(h);
      return '<label data-house="'+esc(h)+'"><input type="checkbox" '+(checked?'checked':'')+' value="'+esc(h)+'" onchange="onHouseCheck()"> '+esc(h)+' <span class="house-count">'+counts[h]+'</span>'+houseFreshness(h)+'</label>';
    }).join('');
  updateHouseBtn();
}

function toggleHousePopover(e){
  e.stopPropagation();
  const pop=$('housePopover');
  pop.classList.toggle('open');
  $('houseDropdownBtn').setAttribute('aria-expanded', pop.classList.contains('open'));
}

function filterHouseList(q){
  q=q.toLowerCase();
  $('houseCheckList').querySelectorAll('label[data-house]').forEach(lbl=>{
    lbl.style.display=lbl.dataset.house.toLowerCase().includes(q)?'':'none';
  });
}

function toggleAllHouses(checked){
  _selectedHouses.clear();
  $('houseCheckList').querySelectorAll('input[type="checkbox"][value]').forEach(cb=>{ cb.checked=checked; });
  updateHouseBtn();
  renderLots();
}

function onHouseCheck(){
  const cbs=$('houseCheckList').querySelectorAll('input[type="checkbox"][value]');
  const allCb=$('houseCheckList').querySelector('.all-label input');
  _selectedHouses.clear();
  let allChecked=true;
  cbs.forEach(cb=>{ if(cb.checked) _selectedHouses.add(cb.value); else allChecked=false; });
  if(allChecked) _selectedHouses.clear(); // empty = all
  if(allCb) allCb.checked=allChecked;
  updateHouseBtn();
  renderLots();
}

function updateHouseBtn(){
  const btn=$('houseDropdownBtn');
  if(_selectedHouses.size===0){
    btn.textContent='All houses';
    btn.classList.remove('active-filter');
  } else {
    btn.textContent=_selectedHouses.size+' house'+((_selectedHouses.size!==1)?'s':'');
    btn.classList.add('active-filter');
  }
}

function getSelectedHouses(){
  return _selectedHouses.size>0?[..._selectedHouses]:[];
}

// Close house popover on outside click
document.addEventListener('click',e=>{
  const dd=$('houseDropdown');
  if(dd && !dd.contains(e.target)) $('housePopover').classList.remove('open');
});

function getFundabilityBadgeHtml(lot) {
  if (!lot.fundability) return '';
  const f = lot.fundability;
  if (f.lenderCount > 0) {
    // Track badge shown
    // lot_id is the DB UUID (not the render-order array index, which changes
    // with every filter/sort and made events unjoinable across sessions).
    const lotIdForEvents = lot._dbId || String(lot._idx);
    if (typeof umami !== 'undefined') try { umami.track('fundability_badge_shown', { lot_id: lotIdForEvents, lender_count: f.lenderCount }); } catch {}
    return '<a href="' + esc(f.bridgematchUrl) + '" target="_blank" rel="noopener" class="fundability-badge" onclick="event.stopPropagation();this.href=_bmHref(' + lot._idx + ',\'lot_badge\');if(typeof umami!==\'undefined\')try{umami.track(\'fundability_badge_clicked\',{lot_id:\'' + esc(lotIdForEvents) + '\',lender_count:' + f.lenderCount + '});umami.track(\'bridge_to_bridgematch\');}catch(e){}" title="Check bridging finance options on BridgeMatch">' +
      f.lenderCount + ' lender' + (f.lenderCount !== 1 ? 's' : '') + ' can fund this</a>';
  }
  if (f.lenderCount === 0) {
    return '<span class="fundability-badge complex" title="No standard lenders matched at 70% LTV — try adjusting parameters on BridgeMatch">Complex deal</span>';
  }
  return '';
}

function renderLots(){
  if(!_pageFromGoPage) _currentPage=1;
  _pageFromGoPage=false;
  // Defensive: if we're on the catalog browse view but LOTS has drifted out
  // of sync with ALL_LOTS (e.g. residue from a prior smart-search or analysis
  // session that didn't fully reset), pull it back to the full catalog so
  // filters apply to every lot. Symptom: "Showing 0 of N" where N is far
  // smaller than the catalog total — region/status filters then over-prune
  // the stale subset and the user sees 0 results despite matching lots
  // existing in the live data. Reproduced via a user screenshot showing
  // "South West + Available only = 0 of 118" while the live data had 88
  // matching SW available lots.
  if(typeof ALL_LOTS!=='undefined'&&ALL_LOTS.length>LOTS.length&&!document.body.classList.contains('view-results')&&!SMART_RESULTS){
    LOTS=ALL_LOTS;
  }
  const fp=updateFinanceProfile();
  const aff=fp.aff;
  let lots=LOTS.slice();

  // Property-type dropdown matcher. The DB vocabulary is wider than the
  // dropdown (block_sale, commercial_block, portfolio — 101 active lots at
  // the 2026-07-06 audit were unreachable by every option): 'commercial'
  // folds in commercial blocks, and 'other' is a catch-all for anything the
  // named options don't cover, so no lot is silently unfilterable.
  // Named options in the PROPERTY TYPE dropdown. 'bungalow' is intentionally
  // absent: the extractor + address-inference canonicalise bungalows to
  // 'house', so a Bungalow option was a dead control (always 0 lots) and was
  // removed (2026-07-07 audit). Any stray prop_type='bungalow' now falls to
  // 'Other' rather than becoming unreachable.
  const PROP_TYPE_NAMED=['house','flat','commercial','land','garage'];
  function matchesPropType(pt,sel){
    if(sel==='commercial') return pt==='commercial'||pt==='commercial_block';
    if(sel==='other') return !PROP_TYPE_NAMED.includes(pt||'');
    return pt===sel;
  }

  // Assign stable index for card IDs
  lots.forEach((l,i) => { l._idx = i; });

  // Tag every lot with affordability tier
  lots.forEach(l=>{l._affTag=getAffordabilityTag(l,aff)});

  // ── All filters in one pass ──
  let minP=+$('fMinPrice').value, maxP=+$('fMaxPrice').value;
  // Inverted range (Min £500k / Max £100k) would otherwise show only POA lots
  // with no cue — swap silently, matching standard portal behaviour.
  if(minP&&maxP&&minP>maxP){const _t=minP;minP=maxP;maxP=_t;}
  const minBeds=+$('fBeds').value;
  const ft=$('fType').value, fd=$('fDeal').value, fa=$('fAfford')?.value||'all';
  const fsold=$('fSoldTop')?.value||'';
  const fs=$('smartQuery').value.toLowerCase();
  const fco=$('fCondition')?.value||'', ften=$('fTenure')?.value||'';
  const floc=$('fLocation')?.value||'';
  const fpc=$('fPostcode')?.value.trim().toUpperCase()||'';
  const ftown=($('fTown')?.value||'').trim();
  const ftownLower=ftown.toLowerCase();

  // If the user typed a town/postcode that geocoded successfully, default to
  // a sensible radius (10mi for towns, 5mi for postcodes) when they haven't
  // picked one. Otherwise the literal address-includes fallback only matches
  // ~15% of relevant lots — e.g. typing 'Bristol' missed 318 of 375 BS-postcode
  // lots whose addresses don't contain the literal word 'Bristol'.
  //
  // EXCEPTION: when the typed town is a major UK city we have a postcode-area
  // mapping for (Bristol → BS, Manchester → M, etc.), prefer the broader
  // postcode-area match over a strict default radius. 10mi from Bristol's
  // city centre excludes Weston-Super-Mare (BS23, ~18mi) and other legit
  // metro lots that share the BS postcode region. User can still pick an
  // explicit radius from the dropdown — that wins. (Reported 2026-05-10:
  // typing Bristol returned 2 unsold Bristol lots when the DB had 3.)
  const _explicitRadius=+($('fRadius')?.value||0);
  const _townHasPostcode=!!(ftownLower && window.AB_townMatch?.TOWN_POSTCODE_PREFIXES?.[ftownLower]);
  const _defaultRadius=(_searchCentre && (fpc || ftown) && !_townHasPostcode) ? (fpc ? 5 : 10) : 0;
  const fradius=_explicitRadius || _defaultRadius;
  const _today=new Date().toISOString().slice(0,10);
  const _radiusSearch=!!((fpc||ftown)&&_searchCentre&&fradius);
  const _prefixSearch=!!(fpc&&!_radiusSearch);
  const _townSearch=!!(ftown&&!_radiusSearch);
  const fPoaMode=$('fExcludePOA')?.value||'';
  const fExcludePOA=fPoaMode==='yes';
  const fNilOnly=fPoaMode==='nil_reserve';
  // Investor-metric + signal/risk filters (Pro filters popover)
  const fMinYieldV=+($('fMinYield')?.value||0);
  const fMinBmvV=+($('fMinBmv')?.value||0);
  const fMinScoreV=+($('fMinScore')?.value||0);
  const fSignalV=$('fSignal')?.value||'';
  const fEpcV=$('fEpc')?.value||'';
  const fFloodV=$('fFlood')?.value||'';
  const fRedFlagV=$('fRedFlag')?.value||'';
  const fMinRoceV=+($('fMinRoce')?.value||0);
  const selectedHouses=getSelectedHouses();
  const _hasFavView=typeof _favViewActive!=='undefined'&&_favViewActive;
  const favKeys=_hasFavView?getFavourites():null;
  const _hasAnalysedView=typeof _analysedViewActive!=='undefined'&&_analysedViewActive;
  const _repoPattern=/\b(repossess(?:ion|ed)?|receivership|lpa receiver|mortgagee.?(?:sale|possess)|bank.?sale)\b/i;
  const _repoPattern2=/repossess|receivership/i;

  // Pre-compute lookahead allowed dates (needs full lot list before filtering)
  const fLook=$('fLookahead')?.value||'all';
  var houseAllowed=null;
  if(fLook!=='all'&&!SMART_RESULTS){
    const maxAuctions=parseInt(fLook)||1;
    const houseDates={};
    for(const l of lots){
      if(!l._auctionDate||!l._house) continue;
      if(!houseDates[l._house]) houseDates[l._house]=new Set();
      houseDates[l._house].add(l._auctionDate);
    }
    houseAllowed={};
    for(const[h,dates] of Object.entries(houseDates)){
      const sorted=[...dates].sort();
      houseAllowed[h]=new Set(sorted.slice(0,maxAuctions));
    }
  }

  // ── Single-pass filter ──
  lots=lots.filter(l=>{
    // Price
    if(minP&&l.price&&l.price<minP) return false;
    if(maxP&&l.price&&l.price>maxP) return false;
    // Beds
    if(minBeds&&l.beds&&l.beds<minBeds) return false;
    // Type / Deal / Tenure
    if(ft&&!SMART_RESULTS&&!matchesPropType(l.propType,ft)) return false;
    if(fd&&l.dealType!==fd) return false;
    if(ften&&l.tenure!==ften) return false;
    // Condition
    if(fco==='needs work'&&l.condition!=='needs work'&&l.condition!=='poor') return false;
    else if(fco==='good'&&l.condition!=='good') return false;
    else if(fco==='vacant'&&!l.vacant) return false;
    else if(fco==='tenanted'&&l.vacant!==false) return false;
    else if(fco==='repossession'){
      if(!(_repoPattern.test((l.bullets||[]).join(' '))||_repoPattern2.test((l.opps||[]).join(' ')))) return false;
    }
    // Investment-metric thresholds — a lot without the metric is excluded
    // while its threshold is active; the stats row carries the coverage note
    // so absence is visible, never silent.
    if(fMinYieldV&&!(l.estGrossYield>=fMinYieldV)) return false;
    if(fMinBmvV&&!(l.belowMarket>=fMinBmvV)) return false;
    if(fMinScoreV&&!(l.score>=fMinScoreV)) return false;
    // Deal signal (multi-label slugs from lib/pipeline/deal-signals.js)
    if(fSignalV&&!(l.dealSignals||[]).includes(fSignalV)) return false;
    // EPC band
    if(fEpcV){
      const b=l.epcRating?String(l.epcRating).toUpperCase()[0]:'';
      if(fEpcV==='none'){ if(b) return false; }
      else if(!b) return false;
      else if(fEpcV==='ac'&&b!=='A'&&b!=='B'&&b!=='C') return false;
      else if(fEpcV==='de'&&b!=='D'&&b!=='E') return false;
      else if(fEpcV==='fg'&&b!=='F'&&b!=='G') return false;
    }
    // Flood — filters on floodRiskLevel (lots.flood_risk, the EA catchment
    // proxy: 'Low'/'Medium', ~70% coverage). NOT flood_zone, which is null
    // fleet-wide (the proxy can't grade zones — see lib/flood-lookup.js).
    // exclude mode keeps unknown-flood lots visible (absence of data is not
    // evidence of safety); 'medium' is the deliberate bargain-hunt view.
    if(fFloodV==='exclude_medium'&&l.floodRiskLevel==='Medium') return false;
    if(fFloodV==='medium'&&l.floodRiskLevel!=='Medium') return false;
    if(fFloodV==='low'&&l.floodRiskLevel!=='Low') return false;
    // Red flags (hard risks only — see RED_FLAG_RISKS)
    if(fRedFlagV==='exclude'&&hasRedFlag(l)) return false;
    if(fRedFlagV==='only'&&!hasRedFlag(l)) return false;
    // ROCE threshold — derived client-side (public/finance.js); lots without
    // a rent estimate compute to null and are excluded while active
    if(fMinRoceV&&!(roceOf(l)>=fMinRoceV)) return false;
    // Location (region) — skip for SMART_RESULTS: the AI search scopes by
    // region server-side (postcode column, authoritative), so re-applying the
    // weaker address-string matchesRegion here would double-filter and drop
    // genuine matches, desyncing the grid from the "N matches" count.
    if(floc&&!SMART_RESULTS&&!matchesRegion(l.address, floc)) return false;
    // Postcode / town / radius
    if(_radiusSearch){
      if(l._lat&&l._lng){ if(haversine(_searchCentre.lat,_searchCentre.lng,l._lat,l._lng)>fradius) return false; }
      else if(fpc){ if(!(l.address||'').toUpperCase().includes(fpc)&&!(l.postcode||'').toUpperCase().startsWith(fpc)) return false; }
      else if(ftown){ if(!window.AB_townMatch.townMatchesLot(l,ftown)) return false; }
    } else if(_prefixSearch){
      if(!(l.address||'').toUpperCase().includes(fpc)&&!(l.postcode||'').toUpperCase().startsWith(fpc)) return false;
    } else if(_townSearch){
      if(!window.AB_townMatch.townMatchesLot(l,ftown)) return false;
    }
    // Affordability
    if(fa==='affordable'&&fp.cash&&l._affTag==='out_of_reach') return false;
    if(fa==='in_budget'&&fp.cash&&l._affTag!=='in_budget'&&l._affTag!=='unknown') return false;
    if(fa==='full_finance'&&fp.cash&&l._affTag!=='full_finance') return false;
    // Status / date filtering
    // 'recently_unsold' surfaces lots whose auction passed within the last
    // 30 days AND ended unsold — these are motivated-seller territory; the
    // post-auction-sweep cron tags them accurately so the filter is reliable.
    if(SMART_RESULTS){
      if(fsold==='available'&&!(l.status==='available'||!l.status)) return false;
      else if(fsold==='unsold'&&l.status!=='unsold') return false;
      else if(fsold==='recently_unsold'){
        if(l.status!=='unsold') return false;
        if(!l._auctionDate) return false;
        const cutoff=new Date(_today); cutoff.setDate(cutoff.getDate()-30);
        if(l._auctionDate < cutoff.toISOString().slice(0,10)) return false;
      }
      else if(fsold==='sold'&&l.status!=='sold') return false;
      else if(fsold==='stc'&&l.status!=='stc') return false;
      else if(fsold==='withdrawn'&&l.status!=='withdrawn') return false;
    } else {
      const notEnded=!l._auctionDate||l._auctionDate>=_today;
      if(!fsold||fsold==='all'){ if(!(((!l.status||l.status==='available'||l.status==='unsold')&&notEnded))) return false; }
      else if(fsold==='available'){ if(!((l.status==='available'||!l.status)&&notEnded)) return false; }
      else if(fsold==='unsold'&&l.status!=='unsold') return false;
      else if(fsold==='recently_unsold'){
        if(l.status!=='unsold') return false;
        if(!l._auctionDate) return false;
        const cutoff=new Date(_today); cutoff.setDate(cutoff.getDate()-30);
        if(l._auctionDate < cutoff.toISOString().slice(0,10)) return false;
      }
      else if(fsold==='sold'&&l.status!=='sold') return false;
      else if(fsold==='stc'&&l.status!=='stc') return false;
      else if(fsold==='withdrawn'&&l.status!=='withdrawn') return false;
      // fsold==='everything' → no filter
    }
    // Favourites — uses isFavourite() so it picks up server-backed likes for signed-in users
    if(_hasFavView && !isFavourite(l)) return false;
    // Analysed — only applies for signed-in users (anon users have no analysed list)
    if(_hasAnalysedView){
      var _act = (window._userActions || {})[(l._house || '') + '|' + (l.url || '')];
      if(!_act || !_act.analysed) return false;
    }
    // Text search (skip for SMART_RESULTS)
    if(fs&&!SMART_RESULTS){
      const addr=(l.address||'').toLowerCase(),bull=(l.bullets||[]).join(' ').toLowerCase(),opp=(l.opps||[]).join(' ').toLowerCase(),rsk=(l.risks||[]).join(' ').toLowerCase(),dt=(l.dealType||'').toLowerCase(),pt=(l.propType||'').toLowerCase(),hs=(l._house||'').toLowerCase(),tn=(l.tenure||'').toLowerCase();
      const subMatch=addr.includes(fs)||bull.includes(fs)||opp.includes(fs)||rsk.includes(fs)||dt.includes(fs)||pt.includes(fs)||hs.includes(fs)||tn.includes(fs);
      // Town-postcode bridge: typing "Bristol" / "Manchester" / etc. in the
      // top search bar should also catch lots in the matching postcode area
      // (BS, M, …), not only lots whose address literally contains the word.
      // townMatchesLot returns false for queries that aren't recognised
      // towns, so generic queries like "freehold block" still fall through.
      const townMatch=window.AB_townMatch&&typeof window.AB_townMatch.townMatchesLot==='function'
        ? window.AB_townMatch.townMatchesLot(l, fs) : false;
      if(!subMatch && !townMatch) return false;
    }
    // House filter
    if(selectedHouses.length&&!selectedHouses.includes(l._house)) return false;
    // Exclude POA — but never hide Nil Reserve lots: no reserve is a positive
    // signal (sells to the highest bid), not a withheld price.
    if(fExcludePOA&&!(l.price>0)&&!isNilReserveLot(l)) return false;
    // Nil Reserve only — the guaranteed-transaction hunting ground
    if(fNilOnly&&!isNilReserveLot(l)) return false;
    // Lookahead
    if(houseAllowed&&l._auctionDate&&l._house){
      if(!houseAllowed[l._house]?.has(l._auctionDate)) return false;
    }
    return true;
  });

  // Sort by distance (closest first) when radius filtering — must be after filter
  if(_radiusSearch){
    lots.sort((a,b)=>{
      const da=(a._lat&&a._lng)?haversine(_searchCentre.lat,_searchCentre.lng,a._lat,a._lng):999;
      const db=(b._lat&&b._lng)?haversine(_searchCentre.lat,_searchCentre.lng,b._lat,b._lng):999;
      return da-db;
    });
  }

  // Historical auction filter now handled server-side via ?includePast=true

  // Sort
  const sortVal=$('fSort')?.value||'date_asc';
  if(sortVal==='date_asc'){
    const today=new Date().toISOString().slice(0,10);
    lots.sort((a,b)=>{
      const da=a._auctionDate||'9999-12-31', db=b._auctionDate||'9999-12-31';
      const aPast=da<today?1:0, bPast=db<today?1:0;
      if(aPast!==bPast) return aPast-bPast; // future first, past last
      if(da!==db) return da<db?-1:1;
      return (b.score||0)-(a.score||0);
    });
  }
  else if(sortVal==='price_asc') lots.sort((a,b)=>((a.price||Infinity)-(b.price||Infinity)));
  else if(sortVal==='price_desc') lots.sort((a,b)=>((b.price||0)-(a.price||0)));
  else if(sortVal==='yield') lots.sort((a,b)=>((b.estGrossYield||0)-(a.estGrossYield||0)));
  // belowMarket is signed (negative = above comps); lots without comps sink last
  else if(sortVal==='bmv') lots.sort((a,b)=>((b.belowMarket??-1e9)-(a.belowMarket??-1e9)));
  else if(sortVal==='net_yield') lots.sort((a,b)=>((netYieldOf(b)??-1e9)-(netYieldOf(a)??-1e9)));
  else if(sortVal==='roce') lots.sort((a,b)=>((roceOf(b)??-1e9)-(roceOf(a)??-1e9)));
  else if(sortVal==='days_unsold') lots.sort((a,b)=>((b.daysSinceAuction||0)-(a.daysSinceAuction||0)));

  // Store filtered lots for export functions
  window._filteredLots = lots;
  console.log('[BM] renderLots: LOTS='+LOTS.length+' → filtered='+lots.length+' (lookahead='+fLook+')');

  // Update unsold toggle count
  const unsoldCount=LOTS.filter(l=>l.status==='unsold').length;
  const ucEl=$('unsoldCount');if(ucEl) ucEl.textContent=unsoldCount;

  // Stats row: only show affordability breakdown when finance profile is active
  let statsHtml='';
  if(fp.cash&&aff){
    const cOk=lots.filter(l=>l._affTag==='in_budget').length;
    const cStr=lots.filter(l=>l._affTag==='stretch_refurb'||l._affTag==='stretch_split').length;
    const cFull=lots.filter(l=>l._affTag==='full_finance').length;
    const cOor=lots.filter(l=>l._affTag==='out_of_reach').length;
    statsHtml=`<div class="stat-card" style="grid-column:1/-1"><div class="aff-stats"><span class="aff-stat as-ok">${cOk} in budget</span>${cStr?`<span class="aff-stat as-str">${cStr} stretch</span>`:''}${cFull?`<span class="aff-stat" style="background:var(--violet-light);color:var(--violet)">${cFull} zero deposit</span>`:''}${cOor?`<span class="aff-stat as-oor">${cOor} out of reach</span>`:''}</div></div>`;
  }
  // Coverage honesty for metric filters — say how many lots even carry the
  // metric, so "yield ≥ 8%" is never mistaken for a scan of the full set.
  let covNote='';
  if(fMinYieldV||fMinBmvV||fMinRoceV||(fEpcV&&fEpcV!=='none')||fFloodV==='medium'||fFloodV==='low'){
    const base=LOTS.length;
    const parts=[];
    if(fMinYieldV||fMinRoceV) parts.push('rent estimate on '+LOTS.filter(l=>l.estGrossYield!=null).length+' of '+base+' lots');
    if(fMinBmvV) parts.push('street comparables on '+LOTS.filter(l=>l.belowMarket!=null).length+' of '+base+' lots');
    if(fEpcV&&fEpcV!=='none') parts.push('EPC on '+LOTS.filter(l=>l.epcRating).length+' of '+base+' lots');
    if(fFloodV==='medium'||fFloodV==='low') parts.push('flood data on '+LOTS.filter(l=>l.floodRiskLevel).length+' of '+base+' lots');
    covNote='<div class="stat-card" style="grid-column:1/-1;font-size:.72rem;color:var(--text3)">Data coverage: '+parts.join(' · ')+' — lots without this data are excluded while the filter is on</div>';
  }
  $('statsRow').innerHTML=statsHtml+covNote;

  // Lookahead warning banner
  const dupCount=lots.filter(l=>l._alsoInFutureAuctions).length;
  let bannerEl=$('lookaheadBanner');
  if(fLook!=='1'&&dupCount>0&&!sessionStorage.getItem('bm_dismiss_lookahead')){
    if(!bannerEl){
      bannerEl=document.createElement('div');
      bannerEl.id='lookaheadBanner';
      bannerEl.style.cssText='background:#fff3cd;color:#856404;border:1px solid #ffc107;border-radius:8px;padding:8px 12px;margin:8px 0;font-size:.85rem;display:flex;align-items:center;justify-content:space-between';
      const sr=$('statsRow');if(sr)sr.parentNode.insertBefore(bannerEl,sr.nextSibling);
    }
    if(bannerEl)bannerEl.innerHTML='⚠️ Showing multiple auction dates — '+dupCount+' lots appear in more than one catalogue. Change from "All auctions" to "Next auction only" in the Auction Date filter to show just one. <button onclick="sessionStorage.setItem(\'bm_dismiss_lookahead\',\'1\');this.parentNode.remove()" style="background:none;border:none;cursor:pointer;font-size:1rem;color:#856404">✕</button>';
  }else if(bannerEl){
    bannerEl.remove();
  }

  // Location-discrepancy banner — explains "Bristol search returned 2 lots
  // but there are clearly many more". Counts lots that match the location
  // filter alone (ignoring status/date/lookahead) and surfaces the gap.
  // Uses safe DOM methods (createElement + textContent) — placeLabel is
  // user-controlled (postcode/town string) so we never feed it to innerHTML.
  let locBanner=$('locationDiscrepancyBanner');
  if((_radiusSearch||_townSearch||_prefixSearch) && LOTS.length){
    let inLoc=0, inLocPast=0, inLocSold=0;
    for(const l of LOTS){
      let m=false;
      if(_radiusSearch){
        if(l._lat&&l._lng){ if(haversine(_searchCentre.lat,_searchCentre.lng,l._lat,l._lng)<=fradius) m=true; }
        else if(fpc){ if((l.address||'').toUpperCase().includes(fpc)) m=true; }
        else if(ftown){ if((l.address||'').toLowerCase().includes(ftownLower)) m=true; }
      } else if(_prefixSearch){
        if((l.address||'').toUpperCase().includes(fpc)) m=true;
      } else if(_townSearch){
        if((l.address||'').toLowerCase().includes(ftownLower)) m=true;
      }
      if(!m) continue;
      inLoc++;
      const ended=l._auctionDate&&l._auctionDate<_today;
      if(ended) inLocPast++;
      if(['sold','stc','withdrawn'].includes(l.status||'')) inLocSold++;
    }
    const hidden=Math.max(0,inLoc-lots.length);
    const placeLabel=String(_searchCentre?.label || ftown || fpc || '');
    const dismissKey='bm_dismiss_locgap_'+placeLabel.toLowerCase();
    if(hidden>=5 && !sessionStorage.getItem(dismissKey)){
      if(locBanner) locBanner.remove();
      locBanner=document.createElement('div');
      locBanner.id='locationDiscrepancyBanner';
      locBanner.style.cssText='background:#e7f3ff;color:#1a3a5c;border:1px solid #2a5a8c;border-radius:8px;padding:10px 14px;margin:8px 0;font-size:.88rem;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap';

      const msg=document.createElement('span');
      const parts=[];
      if(inLocPast>0) parts.push(inLocPast+' had auctions in the past');
      if(inLocSold>0) parts.push(inLocSold+' already sold/STC/withdrawn');
      const detail=parts.length?' — '+parts.join(', ')+'.':'.';
      msg.appendChild(document.createTextNode('📍 '));
      const b=document.createElement('b'); b.textContent=placeLabel; msg.appendChild(b);
      msg.appendChild(document.createTextNode(': '+inLoc+' lots in this area, but only '+lots.length+' match your current filters'+detail));
      locBanner.appendChild(msg);

      const actions=document.createElement('span');
      actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
      const showAllBtn=document.createElement('button');
      showAllBtn.textContent='Show all '+inLoc+' lots';
      showAllBtn.style.cssText='background:var(--accent,#2a5a8c);color:white;border:none;padding:6px 12px;border-radius:6px;font-size:.82rem;font-weight:600;cursor:pointer';
      showAllBtn.onclick=function(){ const s=$('fSoldTop'); if(s) s.value='everything'; const lk=$('fLookahead'); if(lk) lk.value='all'; debouncedRender(); };
      actions.appendChild(showAllBtn);
      const dismissBtn=document.createElement('button');
      dismissBtn.textContent='✕';
      dismissBtn.title='Dismiss';
      dismissBtn.style.cssText='background:none;border:none;cursor:pointer;font-size:1.1rem;color:#1a3a5c;padding:2px 6px';
      dismissBtn.onclick=function(){ try{sessionStorage.setItem(dismissKey,'1')}catch{} locBanner.remove(); };
      actions.appendChild(dismissBtn);
      locBanner.appendChild(actions);

      const sr=$('statsRow'); if(sr) sr.parentNode.insertBefore(locBanner, sr.nextSibling);
    } else if(locBanner) {
      locBanner.remove();
    }
  } else if(locBanner) {
    locBanner.remove();
  }

  // Update filter count — compact form so it fits the mobile top bar where
  // the grid/list toggle used to live. Active filter count on the Filters
  // chip already communicates "you've narrowed something", so the
  // "of Y total" framing isn't carrying weight.
  const filterCountEl=$('filterBarCount');
  if(filterCountEl) filterCountEl.textContent=lots.length.toLocaleString()+' lots';
  // Mobile sheet CTA + sort mirror + auction-date chips sync
  const sheetCta=$('sheetCtaCount'); if(sheetCta) sheetCta.textContent=lots.length.toLocaleString();
  if(typeof syncSortToMirror==='function') syncSortToMirror();
  if(typeof refreshAuctionDateChips==='function') refreshAuctionDateChips();

  // Highlight active filters in unified bar
  document.querySelectorAll('.unified-bar .tb-select').forEach(sel=>{
    sel.classList.toggle('active-filter',sel.value!==''&&sel.value!=='all'&&sel.value!=='score');
  });

  // Collapse any expanded panel (but don't clear cache yet — render-key skip may preserve DOM)
  if (expandedLotId !== null) {
    const _expEl = document.querySelector('.expanded-panel-visible');
    if (_expEl) { _expEl.style.display = 'none'; _expEl.classList.remove('expanded-panel-visible'); }
    const _expCard = document.getElementById('lot-' + expandedLotId);
    if (_expCard) _expCard.classList.remove('expanded');
    expandedLotId = null;
  }
  const out=$('lotsOut');

  // Empty state when no lots match filters
  if(lots.length===0){
    window._lastRenderKey=null;
    _expandedPanelCache.clear();
    const searchQ=$('smartQuery')?.value.trim()||'';
    out.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--text-muted)">'+
      '<div style="font-size:1.5rem;margin-bottom:12px">No lots found</div>'+
      (searchQ?'<p>No results for \''+esc(searchQ)+'\'. Try different search terms.</p>':'<p>Try adjusting your filters or search terms.</p>')+
      '</div>';
    return;
  }

  // Disconnect any existing batch observer
  if(_batchObserver){_batchObserver.disconnect();_batchObserver=null}
  _pendingCards=[];

  // Only show Title Splits group for catalogue analyses or when user searched for them
  const showTSGroup = !SMART_RESULTS || /title.?split|multi.?unit|freehold.?block/i.test($('smartQuery')?.value||'');

  // Thin section divider (no collapse/expand)
  function divider(title, count){
    return '<div class="section-divider"><span>'+esc(title)+' ('+count+')</span></div>';
  }

  // Build flat list of {html, isSectionStart} items preserving section dividers
  let allItems=[];
  if(sortVal==='date_asc'){
    // Group by auction date with human-friendly headers
    const today=new Date().toISOString().slice(0,10);
    let lastDate='';
    lots.forEach(l=>{
      const d=l._auctionDate||'';
      if(d!==lastDate){
        lastDate=d;
        const count=lots.filter(x=>(x._auctionDate||'')===d).length;
        let label=d;
        if(d===today) label='Today — '+d;
        else if(d>today){
          const diff=Math.ceil((new Date(d)-new Date(today))/86400000);
          if(diff===1) label='Tomorrow — '+d;
          else if(diff<=7) label='This week — '+new Date(d+'T00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short'});
          else label=new Date(d+'T00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
        } else {
          label='Past — '+new Date(d+'T00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
        }
        if(!d) label='No auction date';
        allItems.push({html:divider(label,count),isDivider:true});
      }
      allItems.push({html:card(l),idx:l._idx,lot:l});
    });
  } else if(sortVal!=='score'){
    lots.forEach(l=>allItems.push({html:card(l),idx:l._idx,lot:l}));
  } else {
    // Score sort: group by property type so land isn't mixed with houses
    const scoreThenPrice=(a,b)=>(b.score-a.score)||((a.price||Infinity)-(b.price||Infinity));
    const typeOrder=['house','flat','bungalow','commercial','land','garage','other'];
    const typeLabels={house:'Houses',flat:'Flats',bungalow:'Bungalows',commercial:'Commercial',land:'Land',garage:'Garages',other:'Other'};
    // Title splits first (cross-type)
    const tsL=lots.filter(l=>l.titleSplit&&l.score>=2).sort(scoreThenPrice);
    const nonTS=lots.filter(l=>!(l.titleSplit&&l.score>=2));

    if(tsL.length && showTSGroup){allItems.push({html:divider('Title Splits',tsL.length),isDivider:true});tsL.forEach(l=>allItems.push({html:card(l),idx:l._idx,lot:l}))}

    // Group remaining by property type, sorted by score within each
    const grouped={};
    nonTS.forEach(l=>{const t=l.propType||'other';if(!grouped[t])grouped[t]=[];grouped[t].push(l)});
    typeOrder.forEach(t=>{
      if(!grouped[t]||!grouped[t].length) return;
      grouped[t].sort(scoreThenPrice);
      const label=typeLabels[t]||t;
      allItems.push({html:divider(label,grouped[t].length),isDivider:true});
      grouped[t].forEach(l=>allItems.push({html:card(l),idx:l._idx,lot:l}));
    });
    // Any types not in typeOrder
    Object.keys(grouped).filter(t=>!typeOrder.includes(t)).forEach(t=>{
      grouped[t].sort(scoreThenPrice);
      allItems.push({html:divider(t.charAt(0).toUpperCase()+t.slice(1),grouped[t].length),isDivider:true});
      grouped[t].forEach(l=>allItems.push({html:card(l),idx:l._idx,lot:l}));
    });
  }

  const totalLots=lots.length;
  const perPage=parseInt($('fPerPage')?.value)||30;
  const totalPages=Math.max(1,Math.ceil(allItems.filter(i=>!i.isDivider).length/perPage));
  _currentPage=Math.min(Math.max(1,_currentPage),totalPages);

  // Paginate: find items for current page (counting only non-divider items)
  let itemCount=0, startIdx=0, endIdx=allItems.length;
  const pageStart=((_currentPage-1)*perPage);
  const pageEnd=pageStart+perPage;
  let lotsSeen=0;
  const pageItems=[];
  let lastDivider=null;
  for(let i=0;i<allItems.length;i++){
    if(allItems[i].isDivider){lastDivider=allItems[i];continue}
    if(lotsSeen>=pageStart&&lotsSeen<pageEnd){
      if(lastDivider){pageItems.push(lastDivider);lastDivider=null}
      pageItems.push(allItems[i]);
    }
    lotsSeen++;
    if(lotsSeen>=pageEnd) break;
  }

  // Skip DOM rebuild if same lots on same page (avoids image reload flicker).
  // fBidTarget changes what each card DISPLAYS without changing which lots
  // show, so it must be part of the key or the max-bid chips never (dis)appear.
  var _renderKey=_currentPage+'|'+($('fBidTarget')?.value||'')+'|'+pageItems.filter(i=>!i.isDivider).map(i=>i.idx).join(',');
  if(_renderKey===window._lastRenderKey&&document.getElementById('lotsGrid')){
    if(filterCountEl) filterCountEl.textContent=totalLots.toLocaleString()+' lots';
    if(typeof syncFiltersToURL==='function') syncFiltersToURL();
    return;
  }
  window._lastRenderKey=_renderKey;
  _expandedPanelCache.clear(); // Only clear when we're actually rebuilding DOM
  try { sessionStorage.setItem('ab_render_key', _renderKey); } catch(e) {}
  _imgRenderCount=0;
  out.innerHTML='<div class="lots-grid list-view" id="lotsGrid">'+pageItems.map(i=>i.html).join('')+'</div>';
  // Preload all images on this page into browser cache for instant re-renders
  pageItems.forEach(function(i){if(i.lot&&i.lot.imageUrl){var p=new Image();p.src=optimImg(i.lot.imageUrl,400)}});
  const renderedCount=pageItems.filter(i=>!i.isDivider).length;

  // Update filter count — compact form for the top bar
  if(filterCountEl) filterCountEl.textContent=totalLots.toLocaleString()+' lots';

  // Pagination controls
  if(totalPages>1){
    let pgHtml='<div style="display:flex;justify-content:center;align-items:center;gap:6px;padding:16px 0;flex-wrap:wrap">';
    pgHtml+='<button class="btn-page'+((_currentPage<=1)?' disabled':'')+'" onclick="goPage('+(_currentPage-1)+')"'+((_currentPage<=1)?' disabled':'')+'>← Prev</button>';
    const maxBtns=7;
    let startP=Math.max(1,_currentPage-Math.floor(maxBtns/2));
    let endP=Math.min(totalPages,startP+maxBtns-1);
    if(endP-startP<maxBtns-1) startP=Math.max(1,endP-maxBtns+1);
    if(startP>1) pgHtml+='<button class="btn-page" onclick="goPage(1)">1</button><span style="color:var(--text3)">…</span>';
    for(let p=startP;p<=endP;p++) pgHtml+='<button class="btn-page'+(p===_currentPage?' active':'')+'" onclick="goPage('+p+')">'+p+'</button>';
    if(endP<totalPages) pgHtml+='<span style="color:var(--text3)">…</span><button class="btn-page" onclick="goPage('+totalPages+')">'+totalPages+'</button>';
    pgHtml+='<button class="btn-page'+((_currentPage>=totalPages)?' disabled':'')+'" onclick="goPage('+(_currentPage+1)+')"'+((_currentPage>=totalPages)?' disabled':'')+'>Next →</button>';
    pgHtml+='</div>';
    out.insertAdjacentHTML('beforeend',pgHtml);
  }
  if(typeof syncFiltersToURL==='function') syncFiltersToURL();
  startCardCarousels();

  // ── Restore previously-open lot if it's still in the visible page ──
  // _idx is the lot's position in LOTS (assigned at the top of renderLots),
  // not page-relative — but it is render-relative: a fresh fetch builds new
  // lot objects, so the stored idx points at the wrong object after
  // /api/all-lots refreshes. Match by stable (house, lot#, address) key
  // so navigation, refresh, and filter changes all preserve the open lot.
  var _wantKey = _getOpenLotKey();
  var _urlLotId = _isMobileDrawer() ? new URLSearchParams(window.location.search).get('lot') : null;
  if (_urlLotId && !_drawerOpen) {
    var _um = pageItems.find(function (i) { return i.lot && i.lot._dbId === _urlLotId; });
    if (_um && _um.lot) { requestAnimationFrame(function () { openLotDrawer(_um.lot); }); }
  } else if (_wantKey && expandedLotId === null && !_drawerOpen) {
    var _pageMatch = pageItems.find(function(i){ return i.lot && _lotKey(i.lot) === _wantKey; });
    if (_pageMatch && _pageMatch.lot) {
      requestAnimationFrame(function(){ expandCard(_pageMatch.lot); });
    } else {
      var _stillInResults = lots.some(function(l){ return _lotKey(l) === _wantKey; });
      if (!_stillInResults) _setOpenLotKey(null);
    }
  }
}

// ── Cascading image carousel for lot cards ──
var _renderDebounceTimer=null;
function debouncedRender(){
  if(_renderDebounceTimer) clearTimeout(_renderDebounceTimer);
  _renderDebounceTimer=setTimeout(renderLots,80);
}
var _brokenImageUrls=new Set();
var _carouselTimer=null;
function startCardCarousels(){
  if(_carouselTimer) clearInterval(_carouselTimer);
  var carousels=document.querySelectorAll('.card-carousel');
  if(!carousels.length) return;
  // Each card gets a stagger offset based on its position in the grid
  // so transitions cascade down the page like a wave
  var INTERVAL=4000; // ms between transitions per card
  var STAGGER=300;   // ms delay between consecutive cards
  var tick=0;
  _carouselTimer=setInterval(function(){
    for(var i=0;i<carousels.length;i++){
      var c=carousels[i];
      // Each card advances when tick matches its staggered slot
      var cardTrigger=Math.floor((tick-i*STAGGER)/INTERVAL);
      var prevTrigger=Math.floor((tick-STAGGER-i*STAGGER)/INTERVAL);
      if(cardTrigger>prevTrigger && cardTrigger>0){
        var count=parseInt(c.dataset.count)||1;
        var idx=(parseInt(c.dataset.idx)+1)%count;
        c.dataset.idx=idx;
        var imgs=c.querySelectorAll('img');
        var dots=c.querySelectorAll('.carousel-dot');
        for(var j=0;j<imgs.length;j++){
          imgs[j].classList.toggle('carousel-active',j===idx);
        }
        for(var j=0;j<dots.length;j++){
          dots[j].classList.toggle('dot-active',j===idx);
        }
      }
    }
    tick+=200;
  },200);
}

// ── Freshness / completeness / lender-match meta badges ──
// Reads the per-lot enrichment manifest (`_enrichment`) persisted on `lots`
// and surfaces three small chips below the EPC/flood row:
//   1. Freshness    — age of the data (enriched_at ?? scraped_at)
//   2. Completeness — fraction of enrichment sources with OK-ish status
//   3. Lender match — bridging lender count from fundability
// Returns '' for legacy lots without a manifest, and for gated cards
// (blurred / anonGated users don't need pipeline diagnostics).
const _OK_STATUSES = {
  epc: new Set(['ok', 'cache_hit']),
  flood: new Set(['ok', 'cache_hit']),
  land_registry: new Set(['ok', 'cache_hit', 'ok_no_comps']),
  geocode: new Set(['ok', 'cache_hit']),
  fundability: new Set(['api_ok', 'cache_hit']),
};
function _relativeAge(ms){
  const h = Math.floor(ms / 3.6e6);
  if (h < 1) { const m = Math.max(1, Math.floor(ms / 6e4)); return m + 'm ago'; }
  if (h < 48) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}
function getFreshnessBadges(l){
  if (!l || !l._enrichment) return '';
  if (l.blurred || l.anonGated) return '';
  const m = l._enrichment;
  const chips = [];

  // ── Freshness ──
  const basis = m.enriched_at || m.scraped_at;
  if (basis) {
    const ts = new Date(basis).getTime();
    if (!isNaN(ts)) {
      const ageMs = Date.now() - ts;
      const ageH = ageMs / 3.6e6;
      const cls = ageH < 24 ? 'fc-green' : ageH < 72 ? 'fc-amber' : 'fc-red';
      const label = _relativeAge(ageMs);
      const tip = (m.enriched_at ? 'Enriched ' + m.enriched_at : 'Scraped ' + m.scraped_at)
        + (m.enriched_at && m.scraped_at && m.enriched_at !== m.scraped_at ? ' · scraped ' + m.scraped_at : '');
      chips.push('<span class="freshness-chip ' + cls + '" data-tip="' + esc(tip) + '">' + esc(label) + '</span>');
    }
  }

  // ── Completeness ──
  const sources = ['epc', 'flood', 'land_registry', 'geocode', 'fundability'];
  let okCount = 0;
  const breakdown = [];
  for (const s of sources) {
    const entry = m[s];
    const status = entry && entry.status;
    const ok = status && _OK_STATUSES[s].has(status);
    if (ok) okCount++;
    const niceName = s === 'land_registry' ? 'Land Reg' : (s.charAt(0).toUpperCase() + s.slice(1));
    breakdown.push(niceName + ' ' + (ok ? '✓' : '✗' + (status ? ' (' + status + ')' : '')));
  }
  const compCls = okCount >= 5 ? 'fc-green' : okCount >= 3 ? 'fc-amber' : 'fc-red';
  const compTip = breakdown.join(' · ');
  chips.push('<span class="freshness-chip ' + compCls + '" data-tip="' + esc(compTip) + '">Data ' + okCount + '/5</span>');

  // ── Lender match ──
  const f = m.fundability;
  if (f && f.status !== 'zero_price') {
    const count = f.lender_count;
    const conf = f.confidence || 'unknown';
    let lendCls;
    if (count >= 3 && conf === 'high') lendCls = 'fc-green';
    else if (count >= 1) lendCls = 'fc-amber';
    else lendCls = 'fc-red';
    const lendLabel = (count != null ? count : 0) + ' lender' + (count === 1 ? '' : 's');
    const lendTip = (count != null ? count : 0) + ' UK bridging lenders match this deal (confidence: ' + conf + ')';
    chips.push('<span class="freshness-chip ' + lendCls + '" data-tip="' + esc(lendTip) + '">' + esc(lendLabel) + '</span>');
  }

  return chips.length ? '<div class="freshness-row">' + chips.join('') + '</div>' : '';
}

// ─── Editorial-redesign helpers (Trading Desk lot card v2) ───
//
// Live alongside card() so the rest of app.js can call them too.
// Produce small markup fragments shared between the search card and
// the lot-detail header.

function splitAddressPostcode(full) {
  if (!full) return { addr: 'Address not available', pc: '' };
  // UK postcode at end of string. Match across optional comma/space sep.
  const m = String(full).match(/^(.*?)[,\s]+([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\s*$/i);
  if (m) {
    const pcRaw = m[2].toUpperCase().replace(/\s+/g, ' ');
    const pc = /\s/.test(pcRaw) ? pcRaw : pcRaw.replace(/(.{3,4})(.{3})$/, '$1 $2');
    return { addr: m[1].trim(), pc };
  }
  return { addr: String(full).trim(), pc: '' };
}

function formatAuctionDateShort(iso) {
  if (!iso || typeof iso !== 'string' || iso.length < 10) return '';
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const d = parseInt(iso.slice(8, 10), 10);
  const m = parseInt(iso.slice(5, 7), 10) - 1;
  if (isNaN(d) || isNaN(m) || m < 0 || m > 11) return '';
  return d + ' ' + months[m];
}

// Nil Reserve detector — drives the badge and the exclude-POA exemption.
// Structured priceStatus when the feed carries it; priceText fallback for
// cached blobs scraped before price_status was populated. Literal twin of
// NIL_RESERVE_RE in lib/quality/lot-quality.js — keep them aligned.
var NIL_RESERVE_RE = /\b(?:nil|no|without|zero)[\s-]*reserve|unreserved\b/i;
function isNilReserveLot(l) {
  if (!l) return false;
  if (l.priceStatus === 'nil_reserve') return true;
  return !l.price && NIL_RESERVE_RE.test(l.priceText || '');
}

// Hard red flags an investor screens on — a subset of lots.risks written by
// lib/pipeline/scoring.js. Deliberately excludes soft notes ('Guide TBA',
// 'Listed building') and 'Flood risk', which has its own structured filter.
const RED_FLAG_RISKS = ['Sitting tenant', 'Knotweed', 'Flying freehold', 'Non-std construction', 'Contamination', 'Subsidence', 'Cladding/EWS1'];
function hasRedFlag(l) { return (l.risks || []).some(function(r) { return RED_FLAG_RISKS.includes(r); }); }

// Derived investor metrics (public/finance.js), cached on the lot object so a
// render pass computes each at most once. Assumptions are static per deploy,
// so cache staleness isn't a concern.
function roceOf(l) { if (l._roce === undefined) l._roce = (window.AB_finance ? AB_finance.roce(l) : null); return l._roce; }
function netYieldOf(l) { if (l._netYield === undefined) l._netYield = (window.AB_finance ? AB_finance.netYield(l) : null); return l._netYield; }

function statusForStrip(l) {
  // Map lot.status to the editorial strip's dot colour + label.
  const s = (l.status || 'live').toLowerCase();
  if (s === 'sold' || s === 'stc') return { dot: 'red', label: 'SOLD' };
  if (s === 'unsold') return { dot: 'amber', label: 'UNSOLD · OPEN TO OFFERS' };
  if (s === 'withdrawn') return { dot: 'red', label: 'WITHDRAWN' };
  return { dot: 'green', label: 'LIVE' };
}

function epcSquareColor(rating) {
  if (!rating) return null;
  const r = String(rating).toUpperCase()[0];
  if ('ABC'.includes(r)) return 'green';
  if (r === 'D') return 'amber';
  return 'red';
}

function scoreBadgeKind(s) {
  // Score is 0-10 in this codebase (see lib/pipeline/scoring.js). Map
  // to green >=8, amber >=6.5, neutral otherwise -- same thresholds the
  // old .lot-score-good / .lot-score-mid rules used.
  if (s == null || isNaN(s)) return '';
  if (s >= 8) return 'green';
  if (s >= 6.5) return 'amber';
  return '';
}

// BridgeMatch deep-link attribution (Phase 3): the base bridgematchUrl is
// cached server-side per DEAL SHAPE (lots with the same price/type share
// one URL), so per-lot attribution is appended here at click time —
// lot_ref + utm_campaign=lot_<uuid> land in BridgeMatch's lead record, and
// click_id is minted fresh per click so each handoff is distinguishable.
// Wired as onclick="this.href=_bmHref(idx)": mutating href inside onclick
// happens before the browser follows the link, and modified clicks
// (ctrl/cmd/shift) fire onclick too, so new-tab opens carry attribution.
function _bmHref(idx, medium) {
  var l = LOTS[idx] || {};
  var base = (l.fundability && l.fundability.bridgematchUrl) || ('/check?lot=' + idx);
  if (!l._dbId || base.indexOf('bridgematch.co.uk') === -1) return base;
  try {
    var u = new URL(base);
    u.searchParams.set('utm_campaign', 'lot_' + l._dbId);
    u.searchParams.set('utm_medium', medium || 'lot_card');
    u.searchParams.set('lot_ref', l._dbId);
    u.searchParams.set('click_id', 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
    return u.href;
  } catch (e) { return base; }
}

// Card-address click intercept: keep the inline expand on plain click, but
// let modified clicks (new tab) and crawlers use the real /lot/:id href.
function _cardAddrClick(ev, idx) {
  ev.stopPropagation();
  if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey || ev.button === 1) return true;
  ev.preventDefault();
  expandCard(LOTS[idx]);
  return false;
}

function card(l){
  // Editorial Trading Desk card (v2). The handoff README maps each
  // section explicitly -- preserve that vocabulary so future edits are
  // easy to trace.

  const idx = l._idx;
  // Use the friendly display name when we have one — falls back to the raw
  // slug for unknown houses. Raw slugs like "futureauctions" upper-cased to
  // "FUTUREAUCTIONS" lose word boundaries; the display map fixes that.
  const houseLabel = (typeof getHouseDisplay === 'function')
    ? getHouseDisplay(l._house || l.house || '')
    : (l._house || (l.house || '').toString());
  const lotNum = l.lot != null ? String(l.lot).padStart(2, '0') : '—';
  const dateShort = formatAuctionDateShort(l._auctionDate);
  const status = statusForStrip(l);

  const parsed = splitAddressPostcode(l.address);
  const addr = parsed.addr;
  const pc = parsed.pc;

  // Guide price
  let guideText = 'POA';
  if (l.priceText && !l.price) guideText = l.priceText;
  else if (l.price) guideText = '£' + l.price.toLocaleString();

  // Nil Reserve — a positive signal (sells to the highest bid). Show it as a
  // badge, not as a "no price" gap.
  const isNilReserve = isNilReserveLot(l);
  if (isNilReserve) guideText = 'Nil Reserve';

  // Yield
  const showYield = l.estGrossYield && !l.blurred && !l.anonGated && !l._yieldEstimateWarning;
  const yieldText = showYield ? l.estGrossYield.toFixed(1) : null;

  // Score
  const scoreKind = scoreBadgeKind(l.score);
  const scoreNum = (l.score != null && !isNaN(l.score)) ? Math.round(l.score) : null;

  // Opportunity + risk tags (cap at 4 to keep cards balanced)
  const oppTags = (l.opps || []).slice(0, 3).map(function(o){
    return '<span class="tag green">+ ' + esc(o) + '</span>';
  });
  const riskTags = (l.risks || []).slice(0, 3).map(function(r){
    return '<span class="tag red">! ' + esc(r) + '</span>';
  });
  // MEES: an F/G EPC cannot legally be let under MEES — a hard legal trap for
  // BTL buyers (and a value-add angle for refurbers), so it leads the tag row.
  const epcBand = l.epcRating ? String(l.epcRating).toUpperCase()[0] : '';
  const meesTag = (epcBand === 'F' || epcBand === 'G')
    ? ['<span class="tag red">! MEES: can\'t let (EPC ' + epcBand + ')</span>'] : [];
  // Deal-signal chips — multi-label slugs (lib/pipeline/deal-signals.js) the
  // opps/risks tags don't already verbalise (HMO, probate, receivership and
  // title-split arrive via opps). Capped at 2 so opps/risks keep priority.
  const SIGNAL_CHIP_LABELS = { 'repossession': 'Repossession', 'public-sector-disposal': 'Public-sector sale', 'short-lease': 'Short lease', 'regulated-tenancy': 'Regulated tenancy', 'mixed-use': 'Mixed use', 'holiday-let': 'Holiday let', 'cash-buyers-only': 'Cash only' };
  const signalTags = (l.dealSignals || [])
    .filter(function(s){ return SIGNAL_CHIP_LABELS[s]; })
    .slice(0, 2)
    .map(function(s){ return '<span class="tag signal">◆ ' + esc(SIGNAL_CHIP_LABELS[s]) + '</span>'; });
  const tagBudget = 4;
  const allTags = meesTag.concat(oppTags).concat(riskTags).concat(signalTags);
  const tags = allTags.slice(0, tagBudget);
  const overflow = allTags.length - tags.length;
  if (overflow > 0) tags.push('<span class="tag" style="opacity:.7">+' + overflow + ' more</span>');

  // Meta line: PROPTYPE · BEDS · TENURE · FZ · EPC
  const metaParts = [];
  if (l.propType) metaParts.push('<span>' + esc(String(l.propType).toUpperCase()) + '</span>');
  if (l.beds != null) metaParts.push('<span>' + l.beds + ' BED</span>');
  if (l.tenure) {
    const tenLabel = l.tenure.toUpperCase() + (l.tenure === 'Leasehold' && l.leaseLength ? ' (' + l.leaseLength + 'YR)' : '');
    metaParts.push('<span>' + esc(tenLabel) + '</span>');
  }
  if (l.floodZone && l.floodZone !== '1') {
    const fzCls = l.floodZone === '3' ? 'fz red' : 'fz amber';
    metaParts.push('<span class="' + fzCls + '">FZ' + esc(l.floodZone) + '</span>');
  } else if (l.floodZone === '1') {
    metaParts.push('<span>FZ1</span>');
  }
  if (l.epcRating) {
    const epcCls = epcSquareColor(l.epcRating);
    metaParts.push('<span>EPC<span class="epc-square ' + epcCls + '">' + esc(String(l.epcRating).toUpperCase()[0]) + '</span></span>');
  }
  // Rent estimate (the numerator behind the yield figure — showing it makes
  // the yield auditable) + £/sqft, the least gameable value metric. Both
  // respect the same gating as the yield cell.
  if (l.estMonthlyRent && !l.blurred && !l.anonGated && !l._yieldEstimateWarning) {
    metaParts.push('<span>~£' + Number(l.estMonthlyRent).toLocaleString() + ' PCM RENT</span>');
  }
  if (l.price && l.sqft) {
    metaParts.push('<span>£' + Math.round(l.price / l.sqft) + '/SQFT</span>');
  }
  const metaLine = metaParts.length
    ? '<div class="lcv2-meta">' + metaParts.join('<span class="sep">·</span>') + '</div>'
    : '';

  // Optional editor's pull-quote -- surfaces the first AI bullet for signed-in users.
  const quoteHtml = (!l.blurred && !l.anonGated && l.bullets && l.bullets.length)
    ? '<div class="lcv2-quote">"' + esc(l.bullets[0]) + '"</div>'
    : '';

  // Hero -- image vs stripe
  let heroHtml;
  let addressRowHtml;
  // Save pill — always visible top-right of every card hero. Anon →
  // handleSaveLotClick intercepts and pops the signup modal; signed-in →
  // toggleFav optimistically toggles. Was previously only available
  // inside the expanded card as a tiny heart icon — invisible on mobile.
  const isFav = (typeof isFavourite === 'function') && isFavourite(l);
  const saveBtnHtml = '<button type="button" class="lcv2-save fav-btn' +
    (isFav ? ' fav-active is-saved' : '') +
    '" onclick="event.stopPropagation();handleSaveLotClick(' + idx + ')" aria-label="' +
    (isFav ? 'Saved — tap to remove' : 'Save this lot') + '">' +
    (isFav ? '♥ Saved' : '♡ Save') +
    '</button>';
  // Mobile-only overlays — surface AI score (top-left of hero), auction
  // house + lot # + date (bottom-left "footer pill" inside hero). CSS
  // hides .lcv2-mobile-overlays on ≥641px so desktop is unaffected.
  const mobileScoreHtml = (scoreNum != null)
    ? '<div class="lcv2-score-mobile ' + scoreKind + '" aria-label="AI score ' + scoreNum + ' out of 10">' + scoreNum + '</div>'
    : '';
  const mobileStripHtml = '<div class="lcv2-strip-mobile">' +
    '<span class="dot ' + status.dot + '"></span>' +
    '<span>' + esc((houseLabel || 'AUCTION HOUSE').toUpperCase()) + ' · LOT ' + lotNum + '</span>' +
    (dateShort ? '<span>· ' + dateShort + '</span>' : '') +
  '</div>';
  const mobileOverlays = '<div class="lcv2-mobile-overlays">' + mobileScoreHtml + mobileStripHtml + '</div>';
  // Crawlable deep link (SEO Phase 1, 2026-07-03): the server-rendered
  // /lot/:id pages had ZERO internal links pointing at them, so Google never
  // discovered them. The address is now a real <a href="/lot/<uuid>"> —
  // crawlers and middle-click/ctrl-click follow it; a plain click is
  // intercepted by _cardAddrClick and keeps today's inline-expand UX.
  const lotHref = l._dbId ? '/lot/' + esc(l._dbId) : null;
  const addrInner = esc(addr);
  const addrLinked = lotHref
    ? '<a class="lcv2-addr-link" href="' + lotHref + '" onclick="return _cardAddrClick(event,' + idx + ')">' + addrInner + '</a>'
    : addrInner;
  if (l.imageUrl && typeof isValidImageUrl === 'function' && isValidImageUrl(l.imageUrl)) {
    const imgSrc = (typeof optimImg === 'function') ? optimImg(l.imageUrl, 600) : l.imageUrl;
    heroHtml = '<div class="lcv2-hero-img" style="background-image:url(\'' + esc(imgSrc) + '\')">' + saveBtnHtml + mobileOverlays + '</div>';
    addressRowHtml = '<div class="lcv2-addr">' +
      '<h3>' + addrLinked + '</h3>' +
      (pc ? '<span class="pc">' + esc(pc) + '</span>' : '') +
    '</div>';
  } else {
    heroHtml = '<div class="lcv2-hero-stripe">' +
      saveBtnHtml +
      mobileOverlays +
      '<span class="noimg-label">▢ NO CATALOGUE IMAGE · ADDRESS ONLY</span>' +
      '<h3 class="addr">' + addrLinked + '</h3>' +
      (pc ? '<span class="pc">' + esc(pc) + '</span>' : '') +
    '</div>';
    addressRowHtml = '';
  }

  // Stat block
  // Yield cell — for anon users we omit it entirely (the `—` placeholder
  // looks like a layout glitch on mobile). For signed-in users without
  // a yield estimate, the dash is correct: they have access to the data,
  // we just couldn't compute it for this lot.
  const yieldCellHtml = l.anonGated
    ? ''
    : (yieldText
        ? '<div class="cell yield"><span class="eyebrow">GROSS YIELD</span><span class="num tabular">' + yieldText + '<span class="pct-glyph">%</span></span></div>'
        : '<div class="cell yield"><span class="eyebrow">GROSS YIELD</span><span class="num tabular" style="color:var(--muted-2)">—</span></div>');
  const statsHtml = '<div class="lcv2-stats">' +
    '<div class="cell guide">' +
      '<span class="eyebrow">' + (isNilReserve ? 'RESERVE' : 'GUIDE') + '</span>' +
      (isNilReserve
        ? '<span class="lcv2-nil-reserve" title="No reserve — sells to the highest bid">Nil Reserve</span>'
        : '<span class="num tabular">' + esc(guideText) + '</span>') +
    '</div>' +
    yieldCellHtml +
    (scoreNum != null
      ? '<div class="cell score"><div class="lcv2-score-badge ' + scoreKind + '"><span class="lbl">SCORE</span><span class="num">' + scoreNum + '</span></div></div>'
      : '') +
  '</div>';

  // Value-estimate one-liner — sits below the stats row when present.
  // Computed server-side by lib/pipeline/value-estimator.js (rule-based,
  // zero AI cost). Always shown as a band with confidence chip; never as
  // a single number — the band IS the honesty signal.
  let estLineHtml = '';
  if (l.valueEstimate && typeof l.valueEstimate === 'object'
      && Number.isFinite(Number(l.valueEstimate.estimate))
      && Number.isFinite(Number(l.valueEstimate.low))
      && Number.isFinite(Number(l.valueEstimate.high))) {
    const ve = l.valueEstimate;
    const conf = String(ve.confidence || 'low').toLowerCase();
    const fmt = function(n) {
      const v = Number(n);
      if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'm';
      if (v >= 1_000) return Math.round(v / 1000) + 'k';
      return String(Math.round(v));
    };
    estLineHtml = '<div class="card-est-value">' +
      '<span class="ce-band">Est. £' + esc(fmt(ve.estimate)) + '</span>' +
      '<span class="ce-conf-' + esc(conf) + '">· ' + esc(conf) + ' confidence</span>' +
    '</div>';
  }

  // Deal-metrics line: net yield + ROCE (+ BRRR recycled % when a value
  // estimate exists). Derived client-side from served fields; the tooltip
  // carries the full assumption set so no number appears without its basis.
  let metricsLineHtml = '';
  if (window.AB_finance && !l.blurred && !l.anonGated && !l._yieldEstimateWarning) {
    const ny = netYieldOf(l);
    const rc = roceOf(l);
    if (ny != null && rc != null) {
      const brrr = AB_finance.brrrRecycledPct(l);
      metricsLineHtml = '<div class="card-metrics" title="' + esc(AB_finance.describeAssumptions(l)) + '">' +
        'NET ' + ny.toFixed(1) + '% · ROCE ' + rc.toFixed(1) + '%' +
        ((brrr && brrr.pct >= 60) ? ' · BRRR ' + Math.round(brrr.pct) + '% out (' + esc(brrr.confidence) + ' conf)' : '') +
        ' <span class="cm-info" aria-hidden="true">ⓘ</span></div>';
    }
  }
  // Max-bid chip — user sets a target gross yield once (Pro filters); every
  // lot with a rent estimate shows the price that hits it. Green when the
  // guide is already at or under the user's max bid.
  let maxBidHtml = '';
  const bidTarget = +(document.getElementById('fBidTarget')?.value || 0);
  if (window.AB_finance && bidTarget && !l.blurred && !l.anonGated) {
    const mb = AB_finance.maxBid(l, bidTarget);
    if (mb != null) {
      const under = l.price && l.price <= mb;
      maxBidHtml = '<div class="maxbid-chip' + (under ? ' ok' : '') + '" title="Highest price that still returns a ' + bidTarget + '% gross yield on the estimated rent">' +
        'Max bid for ' + bidTarget + '%: £' + mb.toLocaleString() + (under ? ' — guide is under' : '') + '</div>';
    }
  }

  // Footer CTAs
  const viewHref = l.url ? safeHref(l.url) : '#';
  const bmHref = (l.fundability && l.fundability.bridgematchUrl)
    ? safeHref(l.fundability.bridgematchUrl)
    : '/check?lot=' + esc(idx);
  const footerHtml = '<div class="lcv2-foot">' +
    '<a class="view" href="' + viewHref + '" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">View lot <span class="arr">↗</span></a>' +
    '<a class="bm card-bm-btn" href="' + bmHref + '" onclick="event.stopPropagation();this.href=_bmHref(' + idx + ')">BridgeMatch it £ <span class="arr">→</span></a>' +
  '</div>';

  // Stacks tick
  const _act = (window._userActions && window._userActions[(l._house || '') + '|' + (l.url || '')]) || null;
  const stacksTick = _act && _act.stacks ? '<div class="stacks-tick" title="This deal stacks">✅</div>' : '';

  const blurredClass = l.blurred ? ' blurred' : '';
  const blurTextAttr = l.blurred ? ' data-blur-text="Sign in free for full details"' : '';

  // Freshness badge — user-visible evidence the data is live. last_seen_at is
  // stamped on every successful re-scrape, so "Updated today" means this lot
  // was re-verified against the auction house within 24h; an amber "Checked
  // Nd ago" is honest about staleness instead of hiding it.
  let freshHtml = '';
  if (l._lastSeenAt) {
    const ageDays = (Date.now() - Date.parse(l._lastSeenAt)) / 86400000;
    if (isFinite(ageDays) && ageDays >= 0) {
      if (ageDays < 1) freshHtml = '<span class="lcv2-fresh ok" title="Re-verified within the last 24 hours">· Updated today</span>';
      else if (ageDays < 7) freshHtml = '<span class="lcv2-fresh ok" title="Re-verified ' + Math.round(ageDays) + ' day(s) ago">· Updated ' + Math.round(ageDays) + 'd ago</span>';
      else freshHtml = '<span class="lcv2-fresh warn" title="Awaiting re-verification">· Checked ' + Math.round(ageDays) + 'd ago</span>';
    }
  }

  return '<article class="lot-card-v2' + blurredClass + '"' + blurTextAttr +
    ' id="lot-' + idx + '" tabindex="0" role="article"' +
    ' aria-label="Lot ' + esc(l.lot || '') + ' — ' + esc(addr) + '"' +
    ' onclick="expandCard(LOTS[' + idx + '])"' +
    ' onkeydown="if(event.key===\'Enter\'){this.click()}">' +
    stacksTick +
    '<div class="lcv2-strip">' +
      '<span class="lcv2-strip-l">' + esc((houseLabel || 'AUCTION HOUSE').toUpperCase()) + ' · LOT ' + lotNum + '</span>' +
      '<span class="lcv2-strip-r">' +
        '<span class="dot ' + status.dot + '"></span>' +
        '<span>' + status.label + '</span>' +
        (dateShort ? '<span class="date">· ' + dateShort + '</span>' : '') +
        freshHtml +
      '</span>' +
    '</div>' +
    heroHtml +
    addressRowHtml +
    statsHtml +
    '<div class="lcv2-body">' +
      estLineHtml +
      metricsLineHtml +
      maxBidHtml +
      (tags.length ? '<div class="lcv2-tags">' + tags.join('') + '</div>' : '') +
      metaLine +
      quoteHtml +
    '</div>' +
    footerHtml +
  '</article>';
}

// SDLT/LBTT/LTT calculator (2025/26 — England, Scotland & Wales)
// surcharge=true adds additional property / investment surcharge (default: true)
// commercial=true uses non-residential/mixed-use rates (6+ units or commercial property)
function calcSDLT(price, country, surcharge, commercial){
  if(!country) country='england';
  if(surcharge===undefined) surcharge=true;
  if(commercial){
    // Non-residential / mixed-use SDLT (no surcharge applies)
    switch(country){
      case 'scotland': {
        let lbtt=0;
        if(price>150000) lbtt+=(Math.min(price,250000)-150000)*0.01;
        if(price>250000) lbtt+=(price-250000)*0.05;
        return Math.round(lbtt);
      }
      case 'wales': {
        let ltt=0;
        if(price>225000) ltt+=(Math.min(price,250000)-225000)*0.01;
        if(price>250000) ltt+=(Math.min(price,1000000)-250000)*0.05;
        if(price>1000000) ltt+=(price-1000000)*0.06;
        return Math.round(ltt);
      }
      default: {
        let sdlt=0;
        if(price>150000) sdlt+=(Math.min(price,250000)-150000)*0.02;
        if(price>250000) sdlt+=(price-250000)*0.05;
        return Math.round(sdlt);
      }
    }
  }
  switch(country){
    case 'scotland': {
      // LBTT bands
      let lbtt=0;
      if(price>145000) lbtt+=(Math.min(price,250000)-145000)*0.02;
      if(price>250000) lbtt+=(Math.min(price,325000)-250000)*0.05;
      if(price>325000) lbtt+=(Math.min(price,750000)-325000)*0.10;
      if(price>750000) lbtt+=(price-750000)*0.12;
      // 6% ADS (Additional Dwelling Supplement) on full price
      if(surcharge) lbtt+=price*0.06;
      return Math.round(lbtt);
    }
    case 'wales': {
      let ltt=0;
      if(surcharge){
        // LTT higher rates (replace standard rates for additional dwellings)
        if(price<=180000) ltt=price*0.04;
        else{
          ltt=180000*0.04;
          ltt+=(Math.min(price,250000)-180000)*0.075;
          if(price>250000) ltt+=(Math.min(price,400000)-250000)*0.09;
          if(price>400000) ltt+=(Math.min(price,750000)-400000)*0.115;
          if(price>750000) ltt+=(Math.min(price,1500000)-750000)*0.14;
          if(price>1500000) ltt+=(price-1500000)*0.16;
        }
      } else {
        // LTT standard rates
        if(price>225000) ltt+=(Math.min(price,400000)-225000)*0.06;
        if(price>400000) ltt+=(Math.min(price,750000)-400000)*0.075;
        if(price>750000) ltt+=(Math.min(price,1500000)-750000)*0.10;
        if(price>1500000) ltt+=(price-1500000)*0.12;
      }
      return Math.round(ltt);
    }
    default: {
      if(surcharge){
        // England SDLT with 5% additional property surcharge
        if(price<=250000) return Math.round(price*0.05);
        let sdlt=250000*0.05;
        if(price<=925000) sdlt+=(price-250000)*0.1;
        else{sdlt+=(925000-250000)*0.1;sdlt+=(Math.min(price,1500000)-925000)*0.15;}
        if(price>1500000) sdlt+=(price-1500000)*0.17;
        return Math.round(sdlt);
      } else {
        // England SDLT standard rates (no surcharge)
        let sdlt=0;
        if(price>250000) sdlt+=(Math.min(price,925000)-250000)*0.05;
        if(price>925000) sdlt+=(Math.min(price,1500000)-925000)*0.10;
        if(price>1500000) sdlt+=(price-1500000)*0.12;
        return Math.round(sdlt);
      }
    }
  }
}

// Auto-detect country/region from address or postcode
function detectCountry(address){
  if(!address)return 'england';
  const a=address.toUpperCase();
  // Scottish postcode prefixes
  const scotPc=/\b(AB|DD|DG|EH|FK|G[0-9]|HS|IV|KA|KW|KY|ML|PA|PH|TD|ZE)\d/;
  if(scotPc.test(a))return 'scotland';
  // Scottish cities
  if(/\b(EDINBURGH|GLASGOW|ABERDEEN|DUNDEE|INVERNESS|STIRLING|PERTH|FALKIRK|PAISLEY|KILMARNOCK|AYR|DUMFRIES)\b/.test(a))return 'scotland';
  if(/\bSCOTLAND\b/.test(a))return 'scotland';
  // Welsh postcode prefixes
  const walesPc=/\b(CF|SA|NP|LL|SY|LD|HR)\d/;
  if(walesPc.test(a))return 'wales';
  // Welsh cities
  if(/\b(CARDIFF|SWANSEA|NEWPORT|WREXHAM|BANGOR|ABERYSTWYTH|LLANELLI|NEATH|BRIDGEND|BARRY|CAERPHILLY|PONTYPRIDD|MERTHYR|RHONDDA)\b/.test(a))return 'wales';
  if(/\bWALES\b/.test(a))return 'wales';
  return 'england';
}

// ── DEAL STACKING — suggestion + scenarios state ──
// Mirrors lib/fundability.js _deriveDeal() so the widget can pre-fill
// refurb cost & GDV even when the lot was loaded from cache (where
// lot.suggested isn't populated by enrichLotsWithFundability).
const _DS_WORKS_RULES = [
  { keys: ['derelict','major_works','shell'], pct: 0.35 },
  { keys: ['poor','needs_modernisation','cosmetic_plus'], pct: 0.20 },
  { keys: ['cosmetic','light_refurb','needs_refresh'], pct: 0.08 }
];
const _DS_DEFAULT_REFURB_PCT = 0.15;
const _DS_GDV_UPLIFT = 0.15;
function suggestWorksAndGdv(lot) {
  if (lot && lot.suggested && (lot.suggested.worksCost || lot.suggested.gdv)) {
    return { worksCost: lot.suggested.worksCost || null, gdv: lot.suggested.gdv || null, source: 'server' };
  }
  const price = (lot && (lot.price || lot.guidePrice)) || 0;
  if (!price) return { worksCost: null, gdv: null, source: null };
  const cond = (lot && lot.condition || '').toLowerCase();
  const refurbKeywords = ['poor','derelict','needs work','needs modernisation','needs refurbishment',
    'major_works','shell','cosmetic_plus','needs_modernisation','light_refurb','needs_refresh','cosmetic'];
  const isRefurb = refurbKeywords.some(k => cond.includes(k));
  if (!isRefurb) return { worksCost: null, gdv: null, source: 'no_refurb_signal' };
  let pct = _DS_DEFAULT_REFURB_PCT;
  for (const rule of _DS_WORKS_RULES) { if (rule.keys.some(k => cond.includes(k))) { pct = rule.pct; break; } }
  const worksCost = Math.round(price * pct);
  const gdv = Math.round(price + worksCost + price * _DS_GDV_UPLIFT);
  return { worksCost, gdv, source: 'derived' };
}

// In-memory cache of saved scenarios keyed by lot._idx. Each entry:
//   { scenarios: [...], selectedId: <id|null> }
const _dsScenarios = {};
function _dsLotKey(lot) { return { house: lot._house || '', lot_url: lot.url || '' }; }
function _dsLotKeyValid(lot) { const k = _dsLotKey(lot); return !!(k.house && k.lot_url); }

async function loadScenariosForLot(lot, idx) {
  if (!isPremium() || !_dsLotKeyValid(lot) || !currentSession) return;
  const k = _dsLotKey(lot);
  try {
    const r = await fetch('/api/me/scenarios?house=' + encodeURIComponent(k.house) + '&lot_url=' + encodeURIComponent(k.lot_url), { headers: getAuthHeaders() });
    if (!r.ok) return;
    const data = await r.json();
    _dsScenarios[idx] = { scenarios: data.scenarios || [], selectedId: null };
    renderScenarioPicker(idx);
  } catch {}
}

function renderScenarioPicker(idx) {
  const sel = document.getElementById('ds-scenario-select-' + idx);
  if (!sel) return;
  const state = _dsScenarios[idx] || { scenarios: [] };
  const current = state.selectedId;
  // Use DOM API rather than innerHTML — scenario names are user-supplied
  while (sel.firstChild) sel.removeChild(sel.firstChild);
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '\u2014 New scenario \u2014';
  sel.appendChild(blank);
  for (const s of state.scenarios) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name + (s.stacks ? ' \u2705' : '');
    if (s.id === current) opt.selected = true;
    sel.appendChild(opt);
  }
  const delBtn = document.getElementById('ds-scenario-delete-' + idx);
  if (delBtn) delBtn.disabled = !current;
}

function selectScenario(idx, scenarioId) {
  const state = _dsScenarios[idx];
  if (!state) return;
  if (!scenarioId) { state.selectedId = null; renderScenarioPicker(idx); return; }
  const s = state.scenarios.find(x => x.id === scenarioId);
  if (!s) return;
  state.selectedId = scenarioId;
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v == null ? '' : v); };
  const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
  const i = s.inputs || {};
  setVal('ds-price-' + idx, i.price);
  setVal('ds-works-' + idx, i.works);
  setVal('ds-gdv-' + idx, i.gdv);
  setVal('ds-rental-' + idx, i.rental);
  setChk('ds-surcharge-' + idx, i.surcharge !== false);
  setChk('ds-commercial-' + idx, !!i.commercial);
  setChk('ds-needs-finance-' + idx, i.needsFinance !== false);
  const ltvSlider = document.getElementById('ltv-slider-' + idx);
  if (ltvSlider && i.ltvPct) {
    ltvSlider.value = i.ltvPct;
    const v = document.getElementById('ltv-val-' + idx); if (v) v.textContent = i.ltvPct + '%';
  }
  renderScenarioPicker(idx);
  runDealStack(idx);
}

function _dsCollectInputs(idx) {
  const num = id => { const v = parseFloat(document.getElementById(id)?.value); return isNaN(v) ? null : v; };
  const chk = id => { const el = document.getElementById(id); return el ? el.checked : null; };
  const ltvSlider = document.getElementById('ltv-slider-' + idx);
  return {
    price: num('ds-price-' + idx),
    works: num('ds-works-' + idx),
    gdv: num('ds-gdv-' + idx),
    rental: num('ds-rental-' + idx),
    ltvPct: ltvSlider ? parseInt(ltvSlider.value, 10) : 70,
    surcharge: chk('ds-surcharge-' + idx) !== false,
    commercial: !!chk('ds-commercial-' + idx),
    needsFinance: chk('ds-needs-finance-' + idx) !== false
  };
}

function _dsDefaultName(inputs) {
  const finance = inputs.needsFinance ? ('@' + inputs.ltvPct + '% LTV') : 'Cash';
  return (inputs.rental ? 'Hold ' : 'Flip ') + finance;
}

async function saveScenario(idx, opts) {
  opts = opts || {};
  const lot = LOTS.find(l => l._idx === idx);
  if (!lot) return;
  if (!isPremium() || !currentSession) { $('signupModal')?.classList.add('show'); return; }
  if (!_dsLotKeyValid(lot)) return;
  const result = window._dsLastResult && window._dsLastResult[idx];
  if (!result) { showToast('Run the calculator first', 'warn'); return; }
  const inputs = _dsCollectInputs(idx);
  const state = _dsScenarios[idx] = _dsScenarios[idx] || { scenarios: [], selectedId: null };
  const k = _dsLotKey(lot);
  const isNew = opts.saveAs || !state.selectedId;
  let name;
  if (isNew) {
    const proposed = (typeof opts.name === 'string' && opts.name) || _dsDefaultName(inputs);
    name = (window.prompt && opts.saveAs) ? (window.prompt('Name this scenario:', proposed) || proposed) : proposed;
  }
  try {
    const url = isNew ? '/api/me/scenarios' : '/api/me/scenarios/' + state.selectedId;
    const method = isNew ? 'POST' : 'PUT';
    const body = isNew
      ? { house: k.house, lot_url: k.lot_url, name, inputs, results: result.payload, stacks: result.stacks }
      : { inputs, results: result.payload, stacks: result.stacks };
    const r = await fetch(url, {
      method, headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('save failed');
    const data = await r.json();
    if (isNew) { state.scenarios.unshift(data.scenario); state.selectedId = data.scenario.id; }
    else {
      const i = state.scenarios.findIndex(x => x.id === data.scenario.id);
      if (i >= 0) state.scenarios[i] = data.scenario;
    }
    renderScenarioPicker(idx);
    _markLotAnalysed(lot, !!data.stacks);
    showToast('Saved \u00b7 added to Analysed', 'ok');
  } catch {
    showToast('Could not save scenario', 'err');
  }
}

async function deleteScenario(idx) {
  const state = _dsScenarios[idx];
  if (!state || !state.selectedId) return;
  if (!confirm('Delete this scenario?')) return;
  try {
    const r = await fetch('/api/me/scenarios/' + state.selectedId, { method: 'DELETE', headers: getAuthHeaders() });
    if (!r.ok) throw new Error('delete failed');
    const data = await r.json();
    state.scenarios = state.scenarios.filter(s => s.id !== state.selectedId);
    state.selectedId = null;
    renderScenarioPicker(idx);
    const lot = LOTS.find(l => l._idx === idx);
    if (lot) _markLotAnalysed(lot, !!data.stacks);
  } catch {
    showToast('Could not delete scenario', 'err');
  }
}

// In-memory map keyed by "<house>|<lot_url>"
window._userActions = window._userActions || {};
function _actionKey(houseOrLot, lot_url) {
  if (typeof houseOrLot === 'object') return (houseOrLot._house || '') + '|' + (houseOrLot.url || '');
  return (houseOrLot || '') + '|' + (lot_url || '');
}
function _markLotAnalysed(lot, stacks) {
  const key = _actionKey(lot);
  window._userActions[key] = Object.assign({}, window._userActions[key] || {}, { liked: true, analysed: true, stacks: !!stacks });
  const card = document.getElementById('lot-' + lot._idx);
  if (card) {
    const btn = card.querySelector('.fav-btn');
    if (btn) { btn.classList.add('fav-active'); btn.textContent = '\u2665'; }
    let tick = card.querySelector('.stacks-tick');
    if (stacks && !tick) {
      tick = document.createElement('div');
      tick.className = 'stacks-tick';
      tick.title = 'This deal stacks';
      tick.textContent = '\u2705';
      card.appendChild(tick);
    } else if (!stacks && tick) {
      tick.remove();
    }
  }
}

function showToast(msg, kind) {
  let host = document.getElementById('bm-toast-host');
  if (!host) {
    host = document.createElement('div'); host.id = 'bm-toast-host';
    host.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:10000;display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  const bg = kind === 'err' ? 'var(--accent-danger,#c0392b)' : kind === 'warn' ? 'var(--accent-warn,#e67e22)' : 'var(--accent,#2e7d32)';
  el.style.cssText = 'padding:10px 16px;border-radius:8px;background:' + bg + ';color:#fff;font-size:13px;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,0.15);opacity:0;transition:opacity .15s';
  el.textContent = msg;
  host.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); }, 2500);
}

// ── DEAL STACKING CALCULATOR (True Acquisition Cost) ──
function calcDealStack(purchasePrice, gdv, worksCost, rentalIncome, ltvPct, address, opts) {
  if (!purchasePrice || purchasePrice <= 0 || isNaN(purchasePrice)) return null;
  opts = opts || {};
  var buyerPremPct = (opts.buyerPremPct || 0) / 100;    // e.g. 2 → 0.02
  var contingencyPct = (opts.contingencyPct || 10) / 100; // e.g. 10 → 0.10
  var legalPackCost = opts.legalPackCost != null ? opts.legalPackCost : 300;
  var insuranceCost = opts.insuranceCost != null ? opts.insuranceCost : 500;
  var surcharge = opts.surcharge !== undefined ? opts.surcharge : true;
  var commercial = opts.commercial || false;
  var needsFinance = opts.needsFinance !== false; // default true for backwards-compat

  // Lender matching — find best rate from LENDER_DATA
  let bestLender = null;
  let usingFallback = true;
  let monthlyRate = 0.0085; // fallback 0.85%/mo
  let procFeePct = 0.02;    // fallback 2%

  if (needsFinance) {
    const lenders = window.LENDER_DATA || [];
    if (lenders.length > 0) {
      let bestRate = Infinity;
      for (const l of lenders) {
        const ltv = _parseLTV(l.l1);
        if (ltv.pct >= ltvPct) {
          const rate = _parseRate(l.r);
          if (rate > 0 && rate < bestRate) {
            bestRate = rate;
            bestLender = l;
          }
        }
      }
      if (bestLender) {
        usingFallback = false;
        monthlyRate = _parseRate(bestLender.r);
        procFeePct = _parseProcFee(bestLender.pf) / 100;
      }
    }
  } else {
    usingFallback = false; // not using lender data, but not "fallback" either
  }

  // Acquisition costs
  const country = detectCountry(address);
  const sdlt = calcSDLT(purchasePrice, country, surcharge, commercial);
  const buyerPremium = Math.round(purchasePrice * buyerPremPct * 1.2); // +VAT
  const worksContingency = Math.round(worksCost * contingencyPct);
  const totalWorks = worksCost + worksContingency;

  // Finance costs (zeroed when paying cash)
  const loanAmount = needsFinance ? Math.round(purchasePrice * (ltvPct / 100)) : 0;
  const bridgingInterest = needsFinance ? Math.round(loanAmount * monthlyRate * 12) : 0;
  const arrangementFee = needsFinance ? Math.round(loanAmount * procFeePct) : 0;
  const solicitor = 1500;
  const survey = 500;
  const brokerFee = needsFinance ? Math.round(loanAmount * 0.01) : 0;

  // True total cost in (everything to get the property done)
  const totalCostIn = purchasePrice + sdlt + buyerPremium + totalWorks + bridgingInterest + arrangementFee + solicitor + survey + brokerFee + legalPackCost + insuranceCost;

  // Day-one cash required (what you need in your bank on completion day)
  const dayOneCash = (purchasePrice - loanAmount) + sdlt + buyerPremium + solicitor + survey + brokerFee + legalPackCost + insuranceCost;

  // Total cash required over project (day-one + works not covered by lender)
  const cashIn = dayOneCash + totalWorks;

  // Exit costs (for flip)
  const agentFees = gdv > 0 ? Math.round(gdv * 0.015 * 1.2) : 0; // 1.5% + VAT
  const exitSolicitor = 1000;
  const totalExitCosts = agentFees + exitSolicitor;

  // Flip scenario
  const netProfit = gdv - totalCostIn - totalExitCosts;
  const roi = cashIn > 0 ? (netProfit / cashIn * 100) : 0;

  // Stress test: GDV -10%
  var stress = null;
  if (gdv > 0) {
    var stressGdv = Math.round(gdv * 0.9);
    var stressAgentFees = Math.round(stressGdv * 0.015 * 1.2);
    var stressExitCosts = stressAgentFees + exitSolicitor;
    var stressProfit = stressGdv - totalCostIn - stressExitCosts;
    var stressRoi = cashIn > 0 ? (stressProfit / cashIn * 100) : 0;
    stress = { gdv: stressGdv, netProfit: stressProfit, roi: stressRoi };
  }

  // Hold scenario (only if rentalIncome > 0)
  let hold = null;
  if (rentalIncome > 0) {
    const refiAmount = Math.round(gdv * 0.75);
    const btlMortgage = Math.round(refiAmount * 0.055 / 12);
    const management = Math.round(rentalIncome * 0.10);
    const voidAllowance = Math.round(rentalIncome / 12);
    const monthlyCashflow = rentalIncome - btlMortgage - management - voidAllowance;
    const annualYield = purchasePrice > 0 ? ((rentalIncome * 12) / purchasePrice * 100) : 0;
    const cashLeftIn = totalCostIn - refiAmount;
    const cashOnCashHold = cashLeftIn > 0 ? ((monthlyCashflow * 12) / cashLeftIn * 100) : 0;
    hold = { refiAmount, btlMortgage, management, voidAllowance, monthlyCashflow, annualYield, cashLeftIn, cashOnCashHold };
  }

  return {
    sdlt, loanAmount, bridgingInterest, arrangementFee, solicitor, survey, brokerFee,
    buyerPremium, worksContingency, totalWorks, legalPackCost, insuranceCost,
    totalCostIn, dayOneCash, cashIn, usingFallback, bestLenderName: bestLender?.name || null,
    agentFees, exitSolicitor, totalExitCosts,
    needsFinance,
    flip: { netProfit, roi },
    stress,
    hold
  };
}

// ── DEAL STACKING LIVE RECALCULATION ──
let _dsTimers = {};
function debounceDealStack(idx) {
  if (window.umami && !window._bmFormStarted) {
    window._bmFormStarted = true;
    var lot = LOTS.find(function(l) { return l._idx === idx; }) || {};
    umami.track('form_start', {
      lot_number: lot.lot || '', house: lot._house || '', guide_price: lot.price || 0
    });
  }
  clearTimeout(_dsTimers[idx]);
  _dsTimers[idx] = setTimeout(function() { runDealStack(idx); }, 300);
}

function runDealStack(idx) {
  var lot = LOTS.find(function(l) { return l._idx === idx; });
  if (!lot) return;

  // Read editable purchase price (falls back to lot.price)
  var priceInput = document.getElementById('ds-price-' + idx);
  var purchasePrice = priceInput ? (parseFloat(priceInput.value) || 0) : (lot.price || 0);
  if (purchasePrice <= 0) {
    var resEl = document.getElementById('ds-results-' + idx);
    if (resEl) resEl.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center; padding:12px 0;">Enter a purchase price to see your deal stack</p>';
    return;
  }

  // Read SDLT checkboxes
  var surchargeEl = document.getElementById('ds-surcharge-' + idx);
  var surcharge = surchargeEl ? surchargeEl.checked : true;
  var commercialEl = document.getElementById('ds-commercial-' + idx);
  var commercial = commercialEl ? commercialEl.checked : false;

  // Commercial overrides surcharge (commercial rates have no surcharge)
  var sdltVal = calcSDLT(purchasePrice, detectCountry(lot.address || ''), surcharge, commercial);
  var sdltEl = document.getElementById('ds-sdlt-' + idx);
  if (sdltEl) sdltEl.value = '\u00a3' + sdltVal.toLocaleString();

  var gdv = parseFloat(document.getElementById('ds-gdv-' + idx)?.value) || 0;
  var works = parseFloat(document.getElementById('ds-works-' + idx)?.value) || 0;
  var rental = parseFloat(document.getElementById('ds-rental-' + idx)?.value) || 0;
  var ltvSlider = document.getElementById('ltv-slider-' + idx);
  var ltv = ltvSlider ? parseInt(ltvSlider.value) : 70;
  var buyerPrem = parseFloat(document.getElementById('ds-buyerprem-' + idx)?.value) || 0;
  var contingency = parseFloat(document.getElementById('ds-contingency-' + idx)?.value);
  if (isNaN(contingency)) contingency = 10;
  var legalPack = parseFloat(document.getElementById('ds-legalpack-' + idx)?.value);
  if (isNaN(legalPack)) legalPack = 300;
  var insurance = parseFloat(document.getElementById('ds-insurance-' + idx)?.value);
  if (isNaN(insurance)) insurance = 500;

  if (gdv <= 0) {
    document.getElementById('ds-results-' + idx).innerHTML =
      '<p style="color:var(--text-muted); font-size:13px; text-align:center; padding:12px 0;">Enter a GDV to see your deal stack</p>';
    return;
  }

  var needsFinanceEl = document.getElementById('ds-needs-finance-' + idx);
  var needsFinance = needsFinanceEl ? needsFinanceEl.checked : true;

  var result = calcDealStack(purchasePrice, gdv, works, rental, ltv, lot.address || '', {
    buyerPremPct: buyerPrem, contingencyPct: contingency,
    legalPackCost: legalPack, insuranceCost: insurance,
    surcharge: surcharge, commercial: commercial,
    needsFinance: needsFinance
  });
  if (!result) {
    document.getElementById('ds-results-' + idx).innerHTML =
      '<p style="color:var(--text-muted); font-size:13px; text-align:center; padding:12px 0;">Guide price not available \u2014 deal stacking requires a price</p>';
    return;
  }
  // Compute "stacks" verdict and stash latest result for the Save button
  var _stress = result.stress ? result.stress.netProfit : null;
  var stacks = (result.flip.netProfit > 0) && (_stress === null || _stress > 0) && (result.flip.roi >= 20);
  window._dsLastResult = window._dsLastResult || {};
  window._dsLastResult[idx] = { stacks, payload: result };
  fetch('/api/track/event', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'deal_stacking', detail:{address: lot.address||''}})}).catch(function(){});
  renderDealStackResults(idx, result, rental > 0);
}

function renderDealStackResults(idx, r, showHold) {
  var el = document.getElementById('ds-results-' + idx);
  if (!el) return;

  var fmtCurrency = function(v) {
    if (isNaN(v) || v == null) return '\u00a30';
    var prefix = v < 0 ? '-\u00a3' : '\u00a3';
    return prefix + Math.abs(Math.round(v)).toLocaleString();
  };
  var valColor = function(v) { return v >= 0 ? 'color:var(--signal-pos)' : 'color:var(--accent-danger)'; };

  // Lender note
  var lenderNote;
  if (r.needsFinance === false) {
    lenderNote = '<p style="font-size:11px; color:var(--text-muted); margin:0 0 8px; font-style:italic;">Cash purchase \u2014 no bridging interest applied</p>';
  } else if (r.usingFallback) {
    lenderNote = '<p style="font-size:11px; color:var(--text-muted); margin:0 0 8px; font-style:italic;">Based on market averages \u2014 lender data unavailable</p>';
  } else {
    lenderNote = '<p style="font-size:11px; color:var(--text-muted); margin:0 0 8px; font-style:italic;">Based on ' + (r.bestLenderName || 'best match') + ' rates</p>';
  }

  // Day-one cash headline
  var dayOneBanner =
    '<div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:4px 12px; padding:10px 14px; background:linear-gradient(135deg,#1a3a5c,#2a5a8c); border-radius:8px; margin-bottom:10px; color:#fff;">' +
      '<div>' +
        '<div style="font-size:11px; opacity:0.8;">Day-one cash required</div>' +
        '<div style="font-size:20px; font-weight:700;">' + fmtCurrency(r.dayOneCash) + '</div>' +
      '</div>' +
      '<div style="text-align:right;">' +
        '<div style="font-size:11px; opacity:0.8;">True total cost</div>' +
        '<div style="font-size:20px; font-weight:700;">' + fmtCurrency(r.totalCostIn) + '</div>' +
      '</div>' +
    '</div>';

  // Cost breakdown (collapsible)
  var costBreakdown =
    '<details style="margin-bottom:12px; font-size:13px;">' +
      '<summary style="cursor:pointer; font-weight:600; color:var(--text); padding:4px 0;">Full Cost Breakdown</summary>' +
      '<div style="padding:8px 0; display:grid; grid-template-columns:1fr auto; gap:4px 12px;">' +
        '<span style="color:var(--text-muted); font-size:11px; font-weight:600; grid-column:span 2; margin-top:4px;">ACQUISITION</span>' +
        '<span style="color:var(--text-muted)">SDLT</span><span>' + fmtCurrency(r.sdlt) + '</span>' +
        (r.buyerPremium > 0 ? '<span style="color:var(--text-muted)">Buyer\'s premium (+VAT)</span><span>' + fmtCurrency(r.buyerPremium) + '</span>' : '') +
        '<span style="color:var(--text-muted)">Legal pack review</span><span>' + fmtCurrency(r.legalPackCost) + '</span>' +
        '<span style="color:var(--text-muted)">Buildings insurance</span><span>' + fmtCurrency(r.insuranceCost) + '</span>' +
        (r.needsFinance === false
          ? '<span style="color:var(--text-muted); font-size:11px; font-weight:600; grid-column:span 2; margin-top:8px;">PROFESSIONAL FEES</span>' +
            '<span style="color:var(--text-muted)">Solicitor</span><span>' + fmtCurrency(r.solicitor) + '</span>' +
            '<span style="color:var(--text-muted)">Survey</span><span>' + fmtCurrency(r.survey) + '</span>'
          : '<span style="color:var(--text-muted); font-size:11px; font-weight:600; grid-column:span 2; margin-top:8px;">FINANCE</span>' +
            '<span style="color:var(--text-muted)">Bridging interest (12mo)</span><span>' + fmtCurrency(r.bridgingInterest) + '</span>' +
            '<span style="color:var(--text-muted)">Arrangement fee</span><span>' + fmtCurrency(r.arrangementFee) + '</span>' +
            '<span style="color:var(--text-muted)">Solicitor</span><span>' + fmtCurrency(r.solicitor) + '</span>' +
            '<span style="color:var(--text-muted)">Survey</span><span>' + fmtCurrency(r.survey) + '</span>' +
            '<span style="color:var(--text-muted)">Broker fee</span><span>' + fmtCurrency(r.brokerFee) + '</span>') +
        '<span style="color:var(--text-muted); font-size:11px; font-weight:600; grid-column:span 2; margin-top:8px;">WORKS</span>' +
        '<span style="color:var(--text-muted)">Works cost</span><span>' + fmtCurrency(r.totalWorks - r.worksContingency) + '</span>' +
        (r.worksContingency > 0 ? '<span style="color:var(--text-muted)">Contingency</span><span>' + fmtCurrency(r.worksContingency) + '</span>' : '') +
        '<span style="font-weight:700; color:var(--text); border-top:1px solid rgba(0,0,0,0.1); padding-top:6px; margin-top:4px;">Total cost in</span>' +
        '<span style="font-weight:700; border-top:1px solid rgba(0,0,0,0.1); padding-top:6px; margin-top:4px;">' + fmtCurrency(r.totalCostIn) + '</span>' +
        (r.totalExitCosts > 0 ? '<span style="color:var(--text-muted); font-size:11px; font-weight:600; grid-column:span 2; margin-top:8px;">EXIT (flip)</span>' +
        '<span style="color:var(--text-muted)">Estate agent (1.5%+VAT)</span><span>' + fmtCurrency(r.agentFees) + '</span>' +
        '<span style="color:var(--text-muted)">Exit solicitor</span><span>' + fmtCurrency(r.exitSolicitor) + '</span>' : '') +
      '</div>' +
    '</details>';

  // Flip column
  var flipCol =
    '<div style="flex:1; min-width:140px;">' +
      '<div style="font-weight:600; font-size:13px; color:var(--text); margin-bottom:8px; text-align:center;">Flip (Sell)</div>' +
      '<div style="text-align:center; margin-bottom:6px;">' +
        '<div style="font-size:11px; color:var(--text-muted);">Net Profit (after exit costs)</div>' +
        '<div style="font-size:18px; font-weight:700; ' + valColor(r.flip.netProfit) + '">' + fmtCurrency(r.flip.netProfit) + '</div>' +
      '</div>' +
      '<div style="text-align:center; margin-bottom:6px;">' +
        '<div style="font-size:11px; color:var(--text-muted);">ROI on Cash</div>' +
        '<div style="font-size:15px; font-weight:600; ' + valColor(r.flip.roi) + '">' + r.flip.roi.toFixed(1) + '%</div>' +
      '</div>' +
      (r.stress ? '<div style="text-align:center; margin-top:8px; padding-top:8px; border-top:1px dashed rgba(0,0,0,0.1);">' +
        '<div style="font-size:10px; color:var(--text-muted); font-weight:600;">STRESS TEST (GDV -10%)</div>' +
        '<div style="font-size:14px; font-weight:600; ' + valColor(r.stress.netProfit) + '">' + fmtCurrency(r.stress.netProfit) + ' <span style="font-size:12px;">(' + r.stress.roi.toFixed(1) + '% ROI)</span></div>' +
      '</div>' : '') +
    '</div>';

  // Hold column
  var holdCol;
  if (showHold && r.hold) {
    var cashLeftInDisplay;
    if (r.hold.cashLeftIn <= 0) {
      cashLeftInDisplay = '<div style="font-size:14px; font-weight:600; color:var(--accent);">All capital recycled</div>';
    } else {
      cashLeftInDisplay = '<div style="font-size:14px; font-weight:600; ' + valColor(-r.hold.cashLeftIn) + '">' + fmtCurrency(r.hold.cashLeftIn) + '</div>';
    }
    var cocDisplay = r.hold.cashLeftIn <= 0
      ? '<div style="font-size:14px; font-weight:600; color:var(--accent);">N/A</div>'
      : '<div style="font-size:14px; font-weight:600; ' + valColor(r.hold.cashOnCashHold) + '">' + r.hold.cashOnCashHold.toFixed(1) + '%</div>';

    holdCol =
      '<div style="flex:1; min-width:140px; border-left:1px solid rgba(0,0,0,0.08); padding-left:12px;">' +
        '<div style="font-weight:600; font-size:13px; color:var(--text); margin-bottom:8px; text-align:center;">Hold (Refinance)</div>' +
        '<div style="text-align:center; margin-bottom:6px;">' +
          '<div style="font-size:11px; color:var(--text-muted);">Cashflow/mo</div>' +
          '<div style="font-size:18px; font-weight:700; ' + valColor(r.hold.monthlyCashflow) + '">' + fmtCurrency(r.hold.monthlyCashflow) + '</div>' +
        '</div>' +
        '<div style="text-align:center; margin-bottom:6px;">' +
          '<div style="font-size:11px; color:var(--text-muted);">Annual Yield</div>' +
          '<div style="font-size:15px; font-weight:600; ' + valColor(r.hold.annualYield) + '">' + r.hold.annualYield.toFixed(1) + '%</div>' +
        '</div>' +
        '<div style="text-align:center; margin-bottom:6px;">' +
          '<div style="font-size:11px; color:var(--text-muted);">Cash Left In</div>' +
          cashLeftInDisplay +
        '</div>' +
        '<div style="text-align:center;">' +
          '<div style="font-size:11px; color:var(--text-muted);">CoC Return</div>' +
          cocDisplay +
        '</div>' +
      '</div>';
  } else {
    holdCol =
      '<div style="flex:1; min-width:140px; border-left:1px solid rgba(0,0,0,0.08); padding-left:12px; display:flex; align-items:center; justify-content:center;">' +
        '<p style="color:var(--text-muted); font-size:12px; text-align:center; margin:0;">Enter rental income<br>to see Hold scenario</p>' +
      '</div>';
  }

  var scenarios =
    '<div style="display:flex; gap:12px; padding:12px; background:rgba(0,0,0,0.02); border-radius:8px;">' +
      flipCol + holdCol +
    '</div>';

  // Verdict message
  var verdict = '';
  var flipProfit = r.flip.netProfit;
  var stressProfit = r.stress ? r.stress.netProfit : null;
  var stressPasses = stressProfit === null || stressProfit > 0;
  var flipRoi = r.flip.roi;
  if (flipProfit > 0 && stressPasses && flipRoi >= 20) {
    verdict = '<div style="margin-top:10px; padding:10px 14px; background:#e8f5ee; border-radius:8px; border-left:4px solid var(--accent); display:flex; align-items:center; gap:10px;">' +
      '<div style="font-size:24px; line-height:1;" aria-hidden="true">\u2705</div>' +
      '<div>' +
        '<div style="font-size:14px; font-weight:700; color:var(--accent); margin-bottom:2px;">This deal stacks.</div>' +
        '<div style="font-size:12px; color:var(--text-muted);">Profitable even at GDV -10%. ' + Math.round(flipRoi) + '% ROI on cash deployed.</div>' +
      '</div>' +
    '</div>';
  } else if (flipProfit > 0 && !stressPasses) {
    verdict = '<div style="margin-top:10px; padding:10px 14px; background:#fef3e2; border-radius:8px; border-left:4px solid var(--accent-warn);">' +
      '<div style="font-size:14px; font-weight:700; color:var(--accent-warn); margin-bottom:2px;">Tight deal \u2014 thin margin.</div>' +
      '<div style="font-size:12px; color:var(--text-muted);">Profitable at your GDV, but doesn\'t survive a 10% haircut. Sharpen your numbers or negotiate harder.</div>' +
    '</div>';
  } else if (flipProfit <= 0) {
    verdict = '<div style="margin-top:10px; padding:10px 14px; background:#fdf0ee; border-radius:8px; border-left:4px solid var(--accent-danger);">' +
      '<div style="font-size:14px; font-weight:700; color:var(--accent-danger); margin-bottom:2px;">This deal doesn\'t stack.</div>' +
      '<div style="font-size:12px; color:var(--text-muted);">Costs exceed GDV. Walk away or rework the numbers.</div>' +
    '</div>';
  } else if (flipProfit > 0 && flipRoi < 20) {
    verdict = '<div style="margin-top:10px; padding:10px 14px; background:#fef3e2; border-radius:8px; border-left:4px solid var(--accent-warn);">' +
      '<div style="font-size:14px; font-weight:700; color:var(--accent-warn); margin-bottom:2px;">Marginal \u2014 worth a closer look.</div>' +
      '<div style="font-size:12px; color:var(--text-muted);">Profitable but ROI under 20%. Factor in your time and opportunity cost.</div>' +
    '</div>';
  }

  // Disclaimer
  var disclaimer = '<p style="font-size:10px; color:var(--text-muted); margin:8px 0 0; line-height:1.4; opacity:0.7;">' +
    'For illustration only \u2014 not financial advice. Figures are estimates based on the inputs you provide and publicly available lender data. ' +
    'Always verify costs independently and seek professional advice before committing to any property purchase.' +
    '</p>';

  el.innerHTML = lenderNote + dayOneBanner + costBreakdown + scenarios + verdict + disclaimer;
}

// Downloads
function dlCSV(){fetch('/api/track/event', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'csv_export'})}).catch(function(){});
if(!window._userTier){$('signupModal').classList.add('show');return;}
  const exportLots = window._filteredLots || LOTS;
  const rows=[['Rank','Lot','Score','Deal','TitleSplit','Units','Address','Guide','Affordability','Type','Beds','Tenure','LeaseYrs','Condition','Sqft','£/Sqft','StreetAvg','BelowMkt%','EstYield%','EstRent/mo','StatedIncomePa','IncomeKind','DealSignals','EPC','FloodZone','House','AuctionDate','DaysSinceAuction','Opps','Risks','URL']];
  exportLots.forEach((l,i)=>{
    rows.push([i+1,l.lot,l.score,l.dealType,l.titleSplit?'YES':'',l.units||'',l.address,l.price||'TBA',l._affTag||'',l.propType,l.beds??'',l.tenure,l.leaseLength||'',l.condition,l.sqft||'',(l.price&&l.sqft)?Math.round(l.price/l.sqft):'',l.streetAvg||'',l.belowMarket||'',l.estGrossYield||'',l.estMonthlyRent||'',l.statedIncomePa||'',l.incomeKind||'',(l.dealSignals||[]).join(' | '),l.epcRating||'',l.floodZone||'',l._house||'',l._auctionDate||'',l.daysSinceAuction??'',(l.opps||[]).join(' | '),(l.risks||[]).join(' | '),l.url])});
  dl(rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n'),'auction_analysis.csv','text/csv');
}
function dlJSON(){if(!window._userTier){$('signupModal').classList.add('show');return;}const exportLots=window._filteredLots||LOTS;dl(JSON.stringify(exportLots,null,2),'auction_analysis.json','application/json')}
function dl(c,n,t){const b=new Blob([c],{type:t}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=n;a.click()}

// ═══════════════════════════════
// STATS COUNT-UP ANIMATION
// ═══════════════════════════════
(function(){
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      document.querySelectorAll('.ls-val[data-target]').forEach(el => {
        const target = parseInt(el.dataset.target);
        const suffix = el.dataset.suffix || '';
        const start = performance.now();
        const duration = 800;
        function tick(now) {
          const t = Math.min((now - start) / duration, 1);
          const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
          const current = Math.round(target * ease);
          el.textContent = current.toLocaleString() + (t >= 1 ? suffix : '');
          if (t < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
    });
  }, { threshold: 0.3 });
  const stats = document.getElementById('landingStats');
  if (stats) observer.observe(stats);
})();

// ═══════════════════════════════
// EXPANDED CARD STATE + FINANCE WIDGET
// ═══════════════════════════════
let expandedLotId = null;
var _expandedPanelCache = new Map(); // lot._idx → DOM node

// Stable identity for an open lot, persisted across renders + page navigations.
// _idx is page-relative and changes whenever the filter/sort changes, so we
// pin to (house, lot, address-prefix) — same shape used for analytics dedup.
function _lotKey(lot) {
  return (lot._house || '') + ':' + (lot.lot || '') + ':' + (lot.address || '').slice(0, 40);
}
function _setOpenLotKey(key) {
  try { if (key) sessionStorage.setItem('ab_open_lot', key); else sessionStorage.removeItem('ab_open_lot'); } catch {}
}
function _getOpenLotKey() {
  try { return sessionStorage.getItem('ab_open_lot') || null; } catch { return null; }
}

function getPropertyTypeIcon(type) {
  const icons = {
    house: '<svg viewBox="0 0 24 24" width="48" height="48"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>',
    flat: '<svg viewBox="0 0 24 24" width="48" height="48"><path d="M17 11V3H7v4H3v14h8v-4h2v4h8V11h-4zM7 19H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5V9h2v2zm4 4H9v-2h2v2zm0-4H9V9h2v2zm0-4H9V5h2v2zm4 8h-2v-2h2v2zm0-4h-2V9h2v2zm0-4h-2V5h2v2zm4 12h-2v-2h2v2zm0-4h-2v-2h2v2z"/></svg>',
    land: '<svg viewBox="0 0 24 24" width="48" height="48"><path d="M14 6l-3.75 5 2.85 3.8-1.6 1.2C9.81 13.75 7 10 7 10l-6 8h22L14 6z"/></svg>',
    commercial: '<svg viewBox="0 0 24 24" width="48" height="48"><path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/></svg>'
  };
  return icons[type] || icons.house;
}

function optimImg(url, width) {
  if (!url || typeof url !== 'string') return url;
  try {
    // Skip proxy for images already on CDNs that serve optimised formats
    if (/eigcdn\.co\.uk|savills\.com\/content|cdn\.sdlauctions|auction\.assets|cloudfront\.net/i.test(url)) return url;
    return 'https://wsrv.nl/?url=' + encodeURIComponent(url) + '&w=' + (width || 400) + '&q=75&output=webp&maxage=1d&default=1';
  } catch { return url; }
}

function getPlaceholderHtml(type) {
  return '<div class="card-image-placeholder">' + getPropertyTypeIcon(type || 'house') + '<span class="ph-label">No photo available</span></div>';
}

// Two-stage image error handler — gives the underlying URL a chance to render
// before the card flips to a placeholder. If the failed src is a wsrv.nl-wrapped
// URL, retry once with the direct underlying URL extracted from the `url` query
// param. On the second failure (or for non-wsrv URLs), mark the URL broken and
// either replace the <img> with a placeholder ('placeholder' mode, single image)
// or hide it ('hide' mode, carousel item).
function handleImgError(img, mode) {
  if (document.hidden) { img.dataset.needsReload = '1'; return; }
  if (!img.dataset.directRetried && /wsrv\.nl\/\?url=/.test(img.src)) {
    img.dataset.directRetried = '1';
    img.dataset.originalSrc = img.src; // remember the wsrv URL so we mark the right key on second failure
    try {
      var u = new URL(img.src);
      var direct = u.searchParams.get('url');
      if (direct) { img.src = direct; return; }
    } catch (e) { /* fall through to placeholder */ }
  }
  // Mark the wsrv-wrapped URL (the one that goes through the render gate via optimImg)
  // when we retried, so re-renders short-circuit to the placeholder. For non-wsrv
  // first failures, just mark the failed src.
  _brokenImageUrls.add(img.dataset.originalSrc || img.src);
  if (mode === 'hide') {
    img.style.display = 'none';
    img.dataset.broken = '1';
  } else {
    img.outerHTML = getPlaceholderHtml(img.dataset.proptype);
  }
}

function getCardImageBadges(lot) {
  let html = '';
  if (lot._house) {
    var meta = (window._houseMeta || {})[lot._house];
    var logoImg = meta && meta.logoUrl ? '<img class="badge-house-logo" src="' + esc(meta.logoUrl) + '" width="16" height="16" alt="" onerror="this.style.display=\'none\'">' : '';
    html += '<div class="card-badge badge-house">' + logoImg + esc(lot._house) + '</div>';
  }
  if (_searchCentre && lot._lat && lot._lng) {
    const dist = haversine(_searchCentre.lat, _searchCentre.lng, lot._lat, lot._lng);
    html += '<div class="card-badge badge-dist">' + (dist < 1 ? dist.toFixed(1) : Math.round(dist)) + ' mi</div>';
  }
  if (lot.anonGated) {
    // Anonymous user — show teaser badge instead of score
    // Passive label — tapping the badge bubbles up to the card so the
    // user opens the lot (per "click to view = free" policy). The
    // expanded view renders inline upgrade nudges where the user can
    // explicitly choose to sign in. Was: cursor:pointer + onclick that
    // stopPropagation'd to the signup modal — surfaced as a hidden
    // sign-in wall on mobile because tap targets overlap with the card.
    html += '<div class="card-badge badge-score mid" style="font-size:.65rem">Sign up for AI scores</div>';
  } else {
    const rawScore = lot.score ?? 0;
    const clampedScore = Math.max(0, Math.min(10, rawScore));
    const sc = clampedScore >= 3 ? 'high' : clampedScore >= 1 ? 'mid' : 'low';
    const sign = clampedScore > 0 ? '+' : '';
    html += '<div class="card-badge badge-score ' + sc + '" style="cursor:pointer;position:relative" onclick="event.stopPropagation();toggleScorePopup(this,' + lot._idx + ')" onmouseenter="showScoreTip(this,' + lot._idx + ')" onmouseleave="hideScoreTip(this)">' + sign + clampedScore + '</div>';
  }
  if (lot.vacant) html += '<div class="badge-vacant">Vacant possession</div>';
  // Photo-count badge — tells investors "more inside, don't bounce out"
  // (PR A3.3). Only render when there's actually more than the hero to
  // see: 2+ photos in the gallery, or a floor plan, or both.
  const photoCount = (typeof _galleryPhotos === 'function') ? _galleryPhotos(lot).length : 0;
  if (photoCount >= 2 || lot.floorPlanUrl) {
    let label = '';
    if (photoCount >= 2 && lot.floorPlanUrl) label = photoCount + ' photos · floor plan';
    else if (photoCount >= 2) label = photoCount + ' photos';
    else label = 'Floor plan';
    html += '<div class="card-badge badge-photos">' + label + '</div>';
  }
  // Urgency / ended badge
  if (lot._auctionDate) {
    const days = Math.ceil((new Date(lot._auctionDate) - new Date()) / 86400000);
    if (days < 0) {
      html += '<div class="badge-ended">Auction ended</div>';
    } else if (days <= 14) {
      const text = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days + ' days left';
      html += '<div class="badge-urgency">' + text + '</div>';
    }
  }
  return html;
}

// Image URL validation. The allowlist (extension + CDN regex) lives in the
// shared module public/img-validator.js (loaded by index.html) so server and
// client cannot drift. We keep the client-side JUNK pre-filter here — that's
// a rendering concern (skip logos, floorplans, EPC charts, .svg, maps), not
// a URL validity concern, and the server pipeline already strips most of
// these earlier via routes/search.js's junkImg regex.
function isValidImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  // Reject floor plans, logos, icons, maps, and other non-property images.
  // `\.ico(\?|$|#)` catches favicon files where the URL doesn't say "favicon"
  // literally — e.g. cdnx.livechatinc.com/website/media/img/fav.ico.
  if (/floor[\s_-]?plan|floorplan|site[\s_-]?plan|epc[\s_-]?chart|logo|icon|\.svg|\.ico(\?|$|#)|placeholder|map[\s_-]?view/i.test(url)) return false;
  // Defer to shared validator (set by public/img-validator.js). Module is
  // type="module" so it's deferred — by the time any caller runs, the
  // window global is populated. Defensive: if for any reason it isn't yet,
  // fall back to the previous client-only allowlist so the page doesn't go
  // blank.
  if (window.imgValidator && typeof window.imgValidator.isValidImageUrl === 'function') {
    return window.imgValidator.isValidImageUrl(url);
  }
  if (!/^https:\/\//i.test(url)) return false;
  if (/\.(jpe?g|png|webp)(\?.*)?$/i.test(url)) return true;
  if (/cloudinary\.com|imgix\.net|cdn\.sanity\.io|amazonaws\.com|cloudfront\.net|googleusercontent\.com|wp-content\/uploads|supabase\.co\/storage|i\.imgur\.com|eigpropertyauctions\.co\.uk|auction|property|lot|catalogue|catalog/i.test(url)) return true;
  if (/\/(image|images|media|uploads|cdn|gallery|photo|resize)/i.test(url)) return true;
  return false;
}

function unwrapProxyImageUrl(url) {
  if (window.imgValidator && typeof window.imgValidator.unwrapProxyImageUrl === 'function') {
    return window.imgValidator.unwrapProxyImageUrl(url);
  }
  return url;
}

function getStatusOverlay(lot) {
  if (!lot.status || lot.status === 'available') return '';
  return '<div class="lot-status-overlay lot-status-' + lot.status + '"></div>';
}

// ── Score hover tooltip (lightweight preview) ──
function showScoreTip(badgeEl, idx) {
  if (badgeEl.querySelector('.score-popup') || badgeEl.querySelector('.score-tip')) return;
  const lot = LOTS[idx]; if (!lot) return;
  const sb = lot.scoreBreakdown || [];
  const total = lot.score ?? 0;
  const top = sb.length ? sb.reduce((a, b) => Math.abs(b.pts) > Math.abs(a.pts) ? b : a) : null;
  let text = (total > 0 ? '+' : '') + total + '/10';
  if (top) text += ' · ' + (top.pts > 0 ? '+' : '') + top.pts + ' ' + top.signal;
  if (sb.length > 1) text += ' +' + (sb.length - 1) + ' more';
  text += '\nClick for full breakdown';
  const tip = document.createElement('div');
  tip.className = 'score-tip';
  tip.textContent = text;
  tip.style.whiteSpace = 'pre-line';
  badgeEl.appendChild(tip);
}
function hideScoreTip(badgeEl) {
  const tip = badgeEl.querySelector('.score-tip');
  if (tip) tip.remove();
}

// ── Score breakdown popup ──
function toggleScorePopup(badgeEl, idx) {
  hideScoreTip(badgeEl);
  // Close any existing popup
  const existing = document.querySelector('.score-popup');
  if (existing) { existing.remove(); return; }

  const lot = LOTS[idx];
  if (!lot) return;
  const sb = lot.scoreBreakdown || [];
  const total = lot.score ?? 0;
  const maxPts = Math.max(3, ...sb.map(s => Math.abs(s.pts)));

  // Category rank — how this lot ranks within its propType
  const sameType = LOTS.filter(l => l.propType === lot.propType);
  const rank = sameType.filter(l => (l.score || 0) > total).length + 1;
  const catLabel = (lot.propType || 'all').charAt(0).toUpperCase() + (lot.propType || 'all').slice(1);

  let html = '<div class="score-popup-title"><span>Score breakdown</span><button class="close-x" onclick="event.stopPropagation();this.closest(\'.score-popup\').remove()">&times;</button></div>';
  html += '<div class="score-popup-cat">#' + rank + ' of ' + sameType.length + ' ' + catLabel + (sameType.length !== 1 ? 's' : '') + '</div>';

  if (sb.length === 0) {
    html += '<div style="color:var(--text3);padding:4px 0">No signals detected</div>';
  } else {
    sb.forEach(s => {
      const isPos = s.pts > 0;
      const color = isPos ? 'var(--signal-pos,#2e7d32)' : 'var(--accent-danger,#8B0000)';
      const pct = Math.round((Math.abs(s.pts) / maxPts) * 100);
      html += '<div class="score-popup-row">' +
        '<span class="score-popup-label">' + esc(s.signal) + '</span>' +
        '<div class="score-popup-bar"><div class="score-popup-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
        '<span class="score-popup-pts" style="color:' + color + '">' + (isPos ? '+' : '') + s.pts + '</span>' +
      '</div>';
    });
  }
  html += '<div class="score-popup-total"><span>Total</span><span>' + (total > 0 ? '+' : '') + total + ' / 10</span></div>';

  const popup = document.createElement('div');
  popup.className = 'score-popup';
  popup.innerHTML = html;
  badgeEl.appendChild(popup);

  // Close on outside click
  const close = (e) => { if (!popup.contains(e.target) && e.target !== badgeEl) { popup.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 0);
}

var _imgRenderCount = 0; // reset per renderLots() call — first 6 images load eagerly
function getCardImageHtml(lot) {
  _imgRenderCount++;
  var loadAttr = _imgRenderCount <= 6 ? 'eager' : 'lazy';
  const overlay = getStatusOverlay(lot);
  if (!lot.imageUrl || !isValidImageUrl(lot.imageUrl) || _brokenImageUrls.has(optimImg(lot.imageUrl, 400))) {
    return '<div class="card-image-wrapper">' +
      getPlaceholderHtml(lot.propType) +
      overlay +
      getCardImageBadges(lot) +
    '</div>';
  }
  // Filter out known-broken images from carousel arrays
  if (lot.images && lot.images.length > 1) {
    var cleanImages = lot.images.filter(function(u){ return !_brokenImageUrls.has(optimImg(u, 400)); });
    if (cleanImages.length === 0) {
      return '<div class="card-image-wrapper">' +
        getPlaceholderHtml(lot.propType) +
        overlay +
        getCardImageBadges(lot) +
      '</div>';
    }
    if (cleanImages.length < lot.images.length) lot = Object.assign({}, lot, {images: cleanImages, imageUrl: cleanImages[0]});
  }
  // Multi-image carousel (cascading crossfade)
  if (lot.images && lot.images.length > 1) {
    var imgs = lot.images;
    var imgsHtml = '';
    var dotsHtml = '<div class="carousel-dots">';
    for (var ci = 0; ci < imgs.length; ci++) {
      imgsHtml += '<img src="' + esc(optimImg(imgs[ci], 400)) + '" alt="' + esc((lot.address || 'Auction property') + ' ' + (ci+1)) + '" loading="' + loadAttr + '" decoding="async"' + (ci === 0 ? ' class="carousel-active"' : '') + ' onerror="handleImgError(this,\'hide\')">';
      dotsHtml += '<span class="carousel-dot' + (ci === 0 ? ' dot-active' : '') + '"></span>';
    }
    dotsHtml += '</div>';
    return '<div class="card-image-wrapper">' +
      '<div class="card-carousel" data-idx="0" data-count="' + imgs.length + '">' +
        imgsHtml + dotsHtml +
      '</div>' +
      overlay +
      getCardImageBadges(lot) +
    '</div>';
  }
  // Single image fallback
  return '<div class="card-image-wrapper">' +
    '<div class="card-image-shimmer"></div>' +
    '<img class="card-image" src="' + esc(optimImg(lot.imageUrl, 400)) + '" alt="' + esc((lot.address || 'Auction property') + ' — ' + (lot._house || 'auction lot')) + '" loading="' + loadAttr + '" decoding="async" width="400" height="300" ' +
    'onload="this.previousElementSibling.style.display=\'none\';if(this.naturalWidth<120||this.naturalHeight<90){this.outerHTML=getPlaceholderHtml(this.dataset.proptype)}" ' +
    'onerror="handleImgError(this)"' +
    ' data-proptype="' + esc(lot.propType || 'house') + '">' +
    overlay +
    getCardImageBadges(lot) +
  '</div>';
}

function getSignalChips(lot) {
  if (lot.anonGated) return '';  // No AI chips for anonymous users
  let chips = [];
  (lot.opps || []).forEach(o => chips.push({text: '+ ' + o, type: 'pos'}));
  (lot.risks || []).forEach(r => chips.push({text: '\u26a0 ' + r, type: 'neg'}));
  if (lot.titleSplit) chips.unshift({text: '+ Title Split', type: 'pos'});
  const max = 3;
  let html = '';
  chips.slice(0, max).forEach(c => {
    html += '<span class="chip chip-' + c.type + '">' + esc(c.text) + '</span>';
  });
  if (chips.length > max) {
    html += '<span class="chip chip-more">+' + (chips.length - max) + ' more</span>';
  }
  return html;
}

// ─── Magazine-style Lot Detail panel helpers (handoff: lot-detail.jsx) ───
//
// These compose the new 2-column expanded panel. Each returns an HTML
// string for one section. The assembler in expandCard() wires them into
// the .exp-v2 grid. Premium-feature gating + deal-stack widget + lender
// summary all flow through unchanged — only the chrome around them is new.

// Friendly display names for auction-house slugs that have no natural word
// boundary (futureauctions, hollismorgan, …). Server-side lib/houses.js has
// a richer lookup but isn't reachable from the frontend; mirror the most
// common entries here so the strip header reads "FUTURE AUCTIONS" rather
// than "FUTUREAUCTIONS".
const _HOUSE_DISPLAY = {
  hollismorgan: 'Hollis Morgan',
  maggsandallen: 'Maggs & Allen',
  mchughandco: 'McHugh & Co',
  futureauctions: 'Future Property Auctions',
  bondwolfe: 'Bond Wolfe',
  auctionhouselondon: 'Auction House London',
  auctionhouseeastanglia: 'Auction House East Anglia',
  auctionhousescotland: 'Auction House Scotland',
  auctionhousenorthwest: 'Auction House North West',
  auctionhousesouthwest: 'Auction House South West',
  auctionhousewestyorkshire: 'Auction House West Yorkshire',
  auctionhousecumbria: 'Auction House Cumbria',
  auctionhousenortheast: 'Auction House North East',
  auctionhousecoventry: 'Auction House Coventry',
  auctionhouseteesvalley: 'Auction House Tees Valley',
  auctionhousebirmingham: 'Auction House Birmingham',
  auctionhousenorthamptonshire: 'Auction House Northamptonshire',
  auctionhousebedsandbucks: 'Auction House Beds & Bucks',
  auctionhousekent: 'Auction House Kent',
  auctionhousemanchester: 'Auction House Manchester',
  auctionhousenational: 'Auction House National',
  tcpa: 'Town & Country Property Auctions',
  scargillmann: 'Scargill Mann',
  edwardmellor: 'Edward Mellor',
  paulfosh: 'Paul Fosh',
  brutonknowles: 'Bruton Knowles',
  cleetompkinson: 'Cleeton Tompkinson',
  markjenkinson: 'Mark Jenkinson',
  harmanhealy: 'Harman Healy',
  barnettross: 'Barnett Ross',
  clarkesimpson: 'Clarke & Simpson',
  knightfrank: 'Knight Frank',
  johnfrancis: 'John Francis',
  pattinson: 'Pattinson',
  loveitts: 'Loveitts',
  cottons: 'Cottons',
  landwood: 'Landwood',
  seelauctions: 'SEEL Auctions',
  austingray: 'Austin Gray',
  purplebricksgoto: 'Purplebricks GoTo',
  futuregroup: 'Future Group',
};
function getHouseDisplay(slug) {
  if (!slug) return '';
  const lower = String(slug).toLowerCase();
  return _HOUSE_DISPLAY[lower] || String(slug);
}

function buildExpV2Header(lot, dealStackHtmlRef) {
  const slug = lot._house || lot.house || '';
  const houseLabel = getHouseDisplay(slug).toUpperCase();
  const lotNum = lot.lot != null ? String(lot.lot).padStart(2, '0') : '—';
  const status = (typeof statusForStrip === 'function') ? statusForStrip(lot) : { dot: 'green', label: 'LIVE' };

  // Date formatting: prefer the full long form for the header strip
  // (e.g. "FRIDAY 22 MAY 2026 · 11:00") since this card is the headline,
  // unlike the search card which uses the compact "22 MAY".
  let dateLong = '';
  if (lot._auctionDate && typeof lot._auctionDate === 'string' && lot._auctionDate.length >= 10) {
    const days = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const d = new Date(lot._auctionDate + 'T12:00:00');
    if (!isNaN(d.getTime())) {
      dateLong = days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
      if (lot._auctionTime) dateLong += ' · ' + lot._auctionTime;
    }
  }

  const parsed = (typeof splitAddressPostcode === 'function')
    ? splitAddressPostcode(lot.address)
    : { addr: lot.address || 'Address not available', pc: '' };

  // Eyebrow: PROPTYPE · MID-TERRACE · TENURE  (mid-terrace etc. only when
  // we have a building-style field; tenure shown when known)
  const eyebrowParts = [];
  if (lot.propType) eyebrowParts.push(String(lot.propType).toUpperCase());
  if (lot.buildingStyle) eyebrowParts.push(String(lot.buildingStyle).toUpperCase());
  if (lot.tenure) eyebrowParts.push(String(lot.tenure).toUpperCase());
  const eyebrow = eyebrowParts.length ? eyebrowParts.join(' · ') : 'AUCTION LOT';

  // Description: prefer lot.description, fall back to first 2 bullets
  let description = '';
  if (lot.description && lot.description.length > 30) description = lot.description;
  else if (lot.bullets && lot.bullets.length) description = lot.bullets.slice(0, 2).join(' ');

  // Guide price + below-market badge
  let guideText = 'TBA';
  if (lot.priceText && !lot.price) guideText = lot.priceText;
  else if (lot.price) guideText = '£' + lot.price.toLocaleString();
  if (isNilReserveLot(lot)) guideText = 'Nil Reserve';

  let belowMktHtml = '';
  if (lot.belowMarket != null && lot.price) {
    const b = lot.belowMarket;
    if (b > 0) {
      belowMktHtml = '<div class="below-mkt">▼ ' + Math.round(b) + '% below local median sold</div>';
    } else if (b < 0) {
      belowMktHtml = '<div class="below-mkt over">▲ ' + Math.round(Math.abs(b)) + '% above local median sold</div>';
    }
  }

  const favActive = (typeof isFavourite === 'function') && isFavourite(lot);
  const favBtn = '<button class="exp-v2-fav' + (favActive ? ' fav-active' : '') + '" onclick="toggleFav(' + lot._idx + ',event)" aria-pressed="' + (favActive ? 'true' : 'false') + '" aria-label="' + (favActive ? 'Remove from saved' : 'Save lot') + '"><span class="exp-v2-fav-icon" aria-hidden="true">' + (favActive ? '♥' : '♡') + '</span><span class="exp-v2-fav-label">' + (favActive ? 'Saved' : 'Save') + '</span></button>';

  const bidHref = lot.url ? safeHref(lot.url) : '#';
  const bidBtn = lot.url
    ? '<a class="exp-v2-bid" href="' + bidHref + '" target="_blank" rel="noopener noreferrer" onclick="if(window.umami)umami.track(\'lot_outbound_click\',{lot:' + (lot.lot || 0) + ',house:\'' + esc((lot._house || '').replace(/\'/g, '')) + '\'})"><span class="exp-v2-bid-label">View on ' + esc(houseLabel || 'auction site') + '</span><span class="exp-v2-bid-arr" aria-hidden="true">↗</span></a>'
    : '<span class="exp-v2-bid disabled">No external link</span>';

  // Hero image at the top of the expanded panel — review 2026-05-10
  // L3 flagged this missing entirely (the panel was text-only, while
  // the list card right above it carried the photo). Use the first item
  // from lot.images if present (multi-image-sweep / Phase 4), else the
  // single lot.imageUrl. Goes through optimImg() so wsrv.nl resizes for
  // the larger 220px hero. Falls back to nothing if no image at all.
  const heroSrc = (Array.isArray(lot.images) && lot.images.length && lot.images[0])
    ? lot.images[0]
    : (lot.imageUrl || '');
  const heroImg = heroSrc && (typeof isValidImageUrl !== 'function' || isValidImageUrl(heroSrc))
    ? '<img class="exp-v2-hero" src="' + esc(typeof optimImg === 'function' ? optimImg(heroSrc, 800) : heroSrc) + '" alt="' + esc(parsed.addr || 'Lot photo') + '" loading="eager" decoding="async">'
    : '';

  return '<div class="exp-v2-header">' +
    heroImg +
    '<div class="strip">' +
      '<span>' + esc(houseLabel || 'AUCTION HOUSE') + ' · LOT ' + lotNum + (dateLong ? ' · ' + dateLong : '') + '</span>' +
      '<span style="display:inline-flex;align-items:center;gap:6px"><span class="dot ' + status.dot + '"></span>' + status.label + ' LOT</span>' +
    '</div>' +
    '<div class="body">' +
      '<div class="left">' +
        '<div class="eyebrow">' + esc(eyebrow) + '</div>' +
        '<h1>' + esc(parsed.addr) + '</h1>' +
        (parsed.pc ? '<div class="pc">' + esc(parsed.pc) + '</div>' : '') +
        buildLotDescHtml(description) +
      '</div>' +
      '<div class="right">' +
        '<div>' +
          '<div class="eyebrow">Guide price</div>' +
          '<div class="num-xl">' + esc(guideText) + '</div>' +
          belowMktHtml +
        '</div>' +
        '<div class="ctas">' + bidBtn + favBtn + '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

// Narrative block for the expanded-panel header. The narrative sweep stores
// multi-paragraph source-site descriptions (paragraphs separated by blank
// lines); render them as real <p> elements, clamped to ~6 lines with a
// Read-more toggle when there's more than a screenful. Short single-line
// descriptions (legacy bullets fallback) render exactly as before.
function buildLotDescHtml(description) {
  if (!description) return '';
  const paras = String(description).split(/\n\n+/).map(function (p) { return p.trim(); }).filter(Boolean);
  const inner = paras.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
  const needsClamp = description.length > 420 || paras.length > 3;
  if (!needsClamp) return '<div class="desc">' + inner + '</div>';
  return '<div class="desc desc-clamp">' + inner + '</div>' +
    '<button class="desc-toggle" type="button" onclick="toggleLotDesc(this)" aria-expanded="false">Read full description</button>';
}

// Read-more toggle for the narrative block. The clamped div sits immediately
// before the button; flip the clamp class and the label in place.
function toggleLotDesc(btn) {
  const desc = btn.previousElementSibling;
  if (!desc) return;
  const expanded = desc.classList.toggle('desc-expanded');
  desc.classList.toggle('desc-clamp', !expanded);
  btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  btn.textContent = expanded ? 'Show less' : 'Read full description';
}

// The "Due diligence checks" section was removed 2026-07-10. Every item it
// could show was either a restatement of a field already on the panel (flood
// zone, tenure, EPC) or, far more often, a "TBD" amber warning that merely
// announced our own missing enrichment data. It read as a checklist of the
// property's risks when it was really a checklist of our gaps — so it was
// noise at best and misleading at worst. Enrichment gaps belong in
// `lots.enrichment_manifest`, not in the investor's face.

function buildExpV2Scores(lot) {
  const sb = Array.isArray(lot.scoreBreakdown) ? lot.scoreBreakdown : [];
  const opps = (lot.opps || []).slice(0, 8);
  const risks = (lot.risks || []).slice(0, 6);
  if (!sb.length && !opps.length && !risks.length) return '';

  const total = lot.score;
  const totalLabel = total != null ? (total > 0 ? '+' : '') + total + ' / 10' : '';

  // Opps/risks not explained by a scoreBreakdown row (e.g. "Listed building"
  // is a risk with no points). Render them as text labels under the bars.
  const sbLabels = new Set(sb.map(function (s) { return s.signal; }));
  const extraOpps = opps.filter(function (o) { return !sbLabels.has(o); });
  const extraRisks = risks.filter(function (r) { return !sbLabels.has(r); });

  let bodyHtml = '';

  if (sb.length) {
    const maxPts = Math.max(2, ...sb.map(function (s) { return Math.abs(s.pts); }));
    const rows = sb.map(function (s) {
      const isPos = s.pts > 0;
      const color = isPos ? 'var(--signal-pos,#2e7d32)' : 'var(--accent-danger,#8B0000)';
      const pct = Math.round((Math.abs(s.pts) / maxPts) * 100);
      return '<div class="score-popup-row">' +
        '<span class="score-popup-label" style="max-width:none;flex:0 0 auto">' + esc(s.signal) + '</span>' +
        '<div class="score-popup-bar"><div class="score-popup-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
        '<span class="score-popup-pts" style="color:' + color + '">' + (isPos ? '+' : '') + s.pts + '</span>' +
      '</div>';
    }).join('');
    bodyHtml += '<div class="score-breakdown" style="margin-bottom:' + (extraOpps.length || extraRisks.length ? '14px' : '0') + '">' + rows + '</div>';
  }

  if (extraOpps.length) {
    const oppHtml = extraOpps.map(function (o) {
      return '<li><span class="ws-mark opp">+</span><span>' + esc(o) + '</span></li>';
    }).join('');
    bodyHtml += '<div class="eyebrow ink" style="margin-bottom:8px">Also noted</div><ul class="ws-list" style="margin-bottom:' + (extraRisks.length ? '14px' : '0') + '">' + oppHtml + '</ul>';
  }
  if (extraRisks.length) {
    const riskHtml = extraRisks.map(function (r) {
      return '<li><span class="ws-mark risk">!</span><span>' + esc(r) + '</span></li>';
    }).join('');
    bodyHtml += '<div class="eyebrow ink" style="margin-bottom:8px">Risks to verify</div><ul class="ws-list">' + riskHtml + '</ul>';
  }

  // Fallback when scoreBreakdown is absent (legacy lots) — keep original opps/risks layout
  if (!sb.length) {
    bodyHtml = '';
    if (opps.length) {
      const oppHtml = opps.map(function (o) {
        return '<li><span class="ws-mark opp">+</span><span>' + esc(o) + '</span></li>';
      }).join('');
      bodyHtml += '<div class="eyebrow ink" style="margin-bottom:8px">Opportunities</div><ul class="ws-list" style="margin-bottom:14px">' + oppHtml + '</ul>';
    }
    if (risks.length) {
      const riskHtml = risks.map(function (r) {
        return '<li><span class="ws-mark risk">!</span><span>' + esc(r) + '</span></li>';
      }).join('');
      bodyHtml += '<div class="eyebrow ink" style="margin-bottom:8px">Risks to verify</div><ul class="ws-list">' + riskHtml + '</ul>';
    }
  }

  const headerLabel = totalLabel
    ? 'Why this lot scores · <span style="font-family:var(--font-mono);color:var(--text)">' + totalLabel + '</span>'
    : 'Why this lot scores';

  return '<section class="sec">' +
    '<div class="head">' +
      '<span class="sec-head"><span class="sec-num-badge">__SEC_NUM__</span><span class="eyebrow ink">' + headerLabel + '</span></span>' +
      '<a href="/scoring" class="eyebrow" style="color:var(--red);text-decoration:none">Scoring methodology →</a>' +
    '</div>' +
    '<div class="body">' + bodyHtml + '</div>' +
  '</section>';
}

function buildExpV2Comparables(lot, premium) {
  if (!premium) {
    return '<section class="sec">' +
      '<div class="head"><span class="sec-head"><span class="sec-num-badge">__SEC_NUM__</span><span class="eyebrow ink">Comparables on this street</span></span></div>' +
      '<div class="body" style="text-align:center;padding:24px">' +
        '<div style="font-family:var(--font-display);font-size:17px;color:var(--ink);margin-bottom:8px">Sign in free to see street-level comparables</div>' +
        '<div style="font-family:var(--font-main);font-size:13px;color:var(--muted);margin-bottom:14px">Median sold price, sales count, and how this guide compares.</div>' +
        '<button class="btn-ed red" onclick="showPaywall(\'comparables\')">Sign in free</button>' +
      '</div>' +
    '</section>';
  }

  const sa = lot.streetAvg;
  const sales = lot.streetSalesCount || lot.salesCount || 0;
  const bm = lot.belowMarket;
  const guide = lot.price;

  if (!sa || !sales) {
    return '<section class="sec">' +
      '<div class="head"><span class="sec-head"><span class="sec-num-badge">__SEC_NUM__</span><span class="eyebrow ink">Comparables on this street</span></span></div>' +
      '<div class="body" style="font-family:var(--font-display);font-size:15px;color:var(--ink-2)">No comparable sales found for this street in the last 12 months.</div>' +
    '</section>';
  }

  // Range bar — without min/max we can't draw a true range, but we can
  // show guide-vs-median as two ticks on a guideline. If we have a range
  // (lot.streetRange = [lo, hi]), use it; otherwise fall back to a
  // ±20% window around the median.
  let lo, hi;
  if (lot.streetRange && lot.streetRange.length === 2) {
    lo = lot.streetRange[0];
    hi = lot.streetRange[1];
  } else {
    lo = Math.round(sa * 0.8);
    hi = Math.round(sa * 1.25);
  }
  const span = Math.max(hi - lo, 1);
  const guidePct = guide ? Math.max(0, Math.min(100, ((guide - lo) / span) * 100)) : null;
  const medianPct = Math.max(0, Math.min(100, ((sa - lo) / span) * 100));

  const fmt = function (n) { return '£' + Math.round(n / 1000) + 'K'; };
  const fmtFull = function (n) { return '£' + n.toLocaleString(); };

  const verdictLine = (bm != null && guide)
    ? (bm > 0
        ? 'Guide is <span class="red">' + Math.round(bm) + '% below the local median</span> — closest comparables sold around ' + fmtFull(sa) + '.'
        : 'Guide is <span class="red">' + Math.round(Math.abs(bm)) + '% above the local median</span> — verify exit price carefully.')
    : 'Guide ' + fmtFull(guide || 0) + ' vs local median ' + fmtFull(sa) + '.';

  return '<section class="sec">' +
    '<div class="head"><span class="sec-head"><span class="sec-num-badge">__SEC_NUM__</span><span class="eyebrow ink">Comparables on this street</span></span></div>' +
    '<div class="body">' +
      '<div class="cmp-top">' +
        '<div>' +
          '<div class="cmp-num">' + sales + '</div>' +
          '<div class="cmp-cap">SOLD · LAST 12 MONTHS</div>' +
        '</div>' +
        '<div class="cmp-bar-wrap">' +
          '<div class="cmp-bar">' +
            '<div class="band" style="left:0;right:0"></div>' +
            (guidePct != null ? '<div class="tick guide" style="left:' + guidePct.toFixed(1) + '%"></div>' : '') +
            '<div class="tick" style="left:' + medianPct.toFixed(1) + '%"></div>' +
            (guidePct != null ? '<span class="mono" style="position:absolute;left:' + guidePct.toFixed(1) + '%;top:-16px;font-size:10px;color:var(--red);transform:translateX(-50%);font-family:var(--font-mono)">GUIDE ' + fmt(guide) + '</span>' : '') +
            '<span class="mono" style="position:absolute;left:' + medianPct.toFixed(1) + '%;bottom:-16px;font-size:10px;color:var(--ink);transform:translateX(-50%);font-family:var(--font-mono)">MEDIAN ' + fmt(sa) + '</span>' +
          '</div>' +
          '<div class="cmp-bar-labels"><span>' + fmt(lo) + '</span><span>' + fmt(hi) + '</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="cmp-verdict">' +
        '<div class="text">' + verdictLine + '</div>' +
      '</div>' +
    '</div>' +
  '</section>';
}

function buildExpV2DealStackChrome(innerHtml) {
  // Wraps the existing dealStackHtml (with its scenario picker, inputs,
  // and results) inside the editorial deal-stack card chrome.
  return '<div class="sec bold">' +
    '<div class="head bold"><span class="eyebrow" style="color:var(--bg)">The deal stack</span></div>' +
    '<div class="body">' + innerHtml + '</div>' +
  '</div>';
}

function buildExpV2Fundability(lot) {
  // Hooks into the existing #lender-summary-{idx} that gets populated
  // asynchronously by fetchLenderSummary(). On first paint we show
  // the cached fundability if present, else a loading state.
  const cached = lot.fundability;
  let countDisplay = '<span class="num-lg">…</span>';
  let statusHtml = '<span class="mono" style="color:var(--muted);font-size:11px">Checking lenders</span>';
  if (cached && cached.lenderCount != null) {
    countDisplay = '<span class="num-lg">' + cached.lenderCount + '</span>';
    statusHtml = cached.lenderCount > 0
      ? ''
      : '<span class="mono" style="color:var(--red);font-size:11px">No bridging matches at 70% LTV</span>';
  }

  const bmUrl = (cached && cached.bridgematchUrl) ? safeHref(cached.bridgematchUrl) : 'https://www.bridgematch.co.uk';

  // Lead-out CTA — captures a bridging-finance lead into Auction's own
  // /api/leads. Sits in its own block AFTER #lender-summary so the async
  // fetchLenderSummary() repaint (which replaces that div's innerHTML)
  // can't wipe it. Shown only when there's a guide price to quote against.
  const quoteCta = (lot.price > 0)
    ? '<div class="body" style="padding-top:8px">' +
        '<button type="button" class="btn-ed" onclick="openBridgingQuoteModal(LOTS[' + lot._idx + '])" ' +
          'style="width:100%;justify-content:space-between;background:var(--ink);color:var(--paper);border-color:var(--ink)">' +
          'Get a bridging quote <span class="arr">→</span></button>' +
        '<div class="mono" style="color:var(--muted);font-size:10px;margin-top:6px;text-align:center">Free · no obligation · a specialist reviews this lot</div>' +
      '</div>'
    : '';

  return '<div class="sec">' +
    '<div class="head"><span class="eyebrow ink">Fundability</span></div>' +
    '<div class="body" id="lender-summary-' + lot._idx + '">' +
      '<div class="fund-row"><span class="lbl">Bridging matches</span>' + countDisplay + '</div>' +
      (statusHtml ? '<div style="margin:10px 0">' + statusHtml + '</div>' : '') +
      '<a href="' + bmUrl + '" target="_blank" rel="noopener noreferrer" class="btn-ed" onclick="var h=_bmHref(' + lot._idx + ',\'lot_panel\');if(h.indexOf(\'bridgematch.co.uk\')!==-1)this.href=h" style="width:100%;justify-content:space-between;background:var(--paper);color:var(--ink);border-color:var(--ink)">See all matches on BridgeMatch <span class="arr">→</span></a>' +
    '</div>' +
    quoteCta +
  '</div>';
}

// ═══════════════════════════════════════════════════════════════
// LOT GALLERY + LIGHTBOX (PR A3)
// ═══════════════════════════════════════════════════════════════
// Goal: keep users on-platform by surfacing every photo + the floor plan
// inside the expanded panel, so they don't bounce out to the auction
// house's site to see the rest of the gallery.
//
// Data sources:
//   - lot.imageUrl    — primary hero (also shown big in buildExpV2Header)
//   - lot.images      — array populated by lib/pipeline/multi-image-sweep
//   - lot.floorPlanUrl — newly persisted via PR A3.1 (Firecrawl extracts it)
//
// Skip the section entirely when there's only one photo and no floor plan
// — duplicating the hero adds nothing.

function _galleryPhotos(lot) {
  // Build a deduped photo list with imageUrl first (when present),
  // followed by lot.images in order. multi-image-sweep already filters
  // out junk (logos, banners) so we trust the list as-is.
  const seen = new Set();
  const out = [];
  const push = (u) => { if (u && !seen.has(u)) { seen.add(u); out.push(u); } };
  if (lot.imageUrl && (typeof isValidImageUrl !== 'function' || isValidImageUrl(lot.imageUrl))) push(lot.imageUrl);
  if (Array.isArray(lot.images)) {
    lot.images.forEach((u) => {
      if (u && (typeof isValidImageUrl !== 'function' || isValidImageUrl(u))) push(u);
    });
  }
  return out;
}

// Floor plans for the gallery + lightbox. `floorPlans` is the canonical array
// (lots.floor_plans); `floorPlanUrl` is the legacy first-plan alias. A property
// often publishes one plan per storey, so render them all rather than the first.
// These bypass isValidImageUrl deliberately — that filter exists to keep plans
// OUT of the photo carousel, and would reject the very URLs we want here.
function _galleryFloorPlans(lot) {
  if (Array.isArray(lot.floorPlans) && lot.floorPlans.length) return lot.floorPlans.filter(Boolean);
  return lot.floorPlanUrl ? [lot.floorPlanUrl] : [];
}

// The extractor legitimately captures .pdf plans (some houses only publish the
// plan as a PDF). Those can't render in an <img> or the lightbox — they get a
// document link tile instead. Suffix test ignores querystring/hash.
function _isPdfFloorPlan(url) {
  return /\.pdf($|[?#])/i.test(String(url || ''));
}

function buildExpV2Gallery(lot) {
  const photos = _galleryPhotos(lot);
  const plans = _galleryFloorPlans(lot);
  // Single hero + no floor plan → the header already shows everything we have
  if (photos.length <= 1 && plans.length === 0) return '';

  const MAX_VISIBLE = 8;
  const visiblePhotos = photos.slice(0, MAX_VISIBLE);
  const overflowCount = Math.max(0, photos.length - MAX_VISIBLE);

  const tiles = visiblePhotos.map(function (src, i) {
    const isLastVisible = i === visiblePhotos.length - 1;
    const overlay = (isLastVisible && overflowCount > 0)
      ? '<span class="exp-gallery-more">+' + overflowCount + ' more</span>'
      : '';
    const optimSrc = (typeof optimImg === 'function') ? optimImg(src, 400) : src;
    return '<button type="button" class="exp-gallery-tile" ' +
      'onclick="openLotLightbox(' + lot._idx + ',' + i + ')" ' +
      'aria-label="Photo ' + (i + 1) + ' of ' + photos.length + '">' +
      '<img src="' + esc(optimSrc) + '" alt="" loading="lazy" decoding="async">' +
      overlay +
    '</button>';
  }).join('');

  // Plans follow the photos in the lightbox, so an image plan's lightbox index
  // is photos.length + its position among IMAGE plans — openLotLightbox skips
  // PDFs when it builds its item list. PDF plans render as document link tiles
  // (an <img src="…pdf"> would just be a broken tile) opening in a new tab.
  let imgPlanIdx = 0;
  const floorPlanTiles = plans.map(function (src, j) {
    const label = plans.length > 1 ? 'Floor plan ' + (j + 1) + ' of ' + plans.length : 'Floor plan';
    if (_isPdfFloorPlan(src)) {
      return '<a class="exp-gallery-tile exp-gallery-floorplan exp-gallery-fp-doc" ' +
        'href="' + esc(src) + '" target="_blank" rel="noopener" ' +
        'aria-label="' + esc(label + ' (PDF, opens in new tab)') + '">' +
        '<span class="exp-gallery-fp-doc-text">View floor plan (PDF)</span>' +
        '<span class="exp-gallery-fp-label">Floor plan</span>' +
      '</a>';
    }
    const optimSrc = (typeof optimImg === 'function') ? optimImg(src, 400) : src;
    return '<button type="button" class="exp-gallery-tile exp-gallery-floorplan" ' +
      'onclick="openLotLightbox(' + lot._idx + ',' + (photos.length + imgPlanIdx++) + ')" ' +
      'aria-label="' + esc(label) + '">' +
      '<img src="' + esc(optimSrc) + '" alt="" loading="lazy" decoding="async">' +
      '<span class="exp-gallery-fp-label">Floor plan</span>' +
    '</button>';
  }).join('');

  const parts = [];
  if (photos.length) parts.push(photos.length === 1 ? '1 photo' : photos.length + ' photos');
  if (plans.length) parts.push(plans.length === 1 ? '1 floor plan' : plans.length + ' floor plans');

  return '<section class="exp-gallery">' +
    '<div class="exp-gallery-head">' +
      '<span class="eyebrow ink">Gallery · ' + parts.join(' · ') + '</span>' +
    '</div>' +
    '<div class="exp-gallery-grid">' + tiles + floorPlanTiles + '</div>' +
  '</section>';
}

// ── Lightbox (singleton overlay, created on first open) ──
let _lightboxItems = [];   // [{ src, label }]
let _lightboxIdx = 0;
let _lightboxEl = null;

function _ensureLightboxEl() {
  if (_lightboxEl) return _lightboxEl;
  // Build via createElement (no innerHTML on the root — keeps the
  // security-reminder hook quiet). Structure is static, all text is set
  // via textContent / setAttribute.
  const el = document.createElement('div');
  el.className = 'exp-lightbox';
  el.id = 'exp-lightbox';
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Image viewer');

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'exp-lightbox-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×'; // ×
  closeBtn.addEventListener('click', closeLotLightbox);

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'exp-lightbox-nav exp-lightbox-prev';
  prevBtn.setAttribute('aria-label', 'Previous');
  prevBtn.textContent = '‹'; // ‹
  prevBtn.addEventListener('click', function () { navLotLightbox(-1); });

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'exp-lightbox-nav exp-lightbox-next';
  nextBtn.setAttribute('aria-label', 'Next');
  nextBtn.textContent = '›'; // ›
  nextBtn.addEventListener('click', function () { navLotLightbox(1); });

  const stage = document.createElement('div');
  stage.className = 'exp-lightbox-stage';

  const img = document.createElement('img');
  img.className = 'exp-lightbox-img';
  img.alt = '';
  stage.appendChild(img);

  const cap = document.createElement('div');
  cap.className = 'exp-lightbox-caption';
  cap.setAttribute('aria-live', 'polite');
  stage.appendChild(cap);

  el.appendChild(closeBtn);
  el.appendChild(prevBtn);
  el.appendChild(stage);
  el.appendChild(nextBtn);

  // Click on backdrop (not on img/buttons) closes
  el.addEventListener('click', function (e) {
    if (e.target === el || e.target === stage) closeLotLightbox();
  });

  document.body.appendChild(el);
  _lightboxEl = el;
  return el;
}

function _renderLightbox() {
  if (!_lightboxEl || !_lightboxItems.length) return;
  const item = _lightboxItems[_lightboxIdx];
  const img = _lightboxEl.querySelector('.exp-lightbox-img');
  const cap = _lightboxEl.querySelector('.exp-lightbox-caption');
  // Full-size: pass 1600 through optimImg (wsrv.nl handles the resize)
  img.src = (typeof optimImg === 'function') ? optimImg(item.src, 1600) : item.src;
  img.alt = item.label || ('Image ' + (_lightboxIdx + 1));
  cap.textContent = item.label
    ? item.label + ' · ' + (_lightboxIdx + 1) + ' of ' + _lightboxItems.length
    : (_lightboxIdx + 1) + ' of ' + _lightboxItems.length;
  // Hide nav arrows when only one item
  const single = _lightboxItems.length <= 1;
  _lightboxEl.querySelector('.exp-lightbox-prev').style.display = single ? 'none' : '';
  _lightboxEl.querySelector('.exp-lightbox-next').style.display = single ? 'none' : '';
}

function _lightboxKeyHandler(e) {
  if (!_lightboxEl || _lightboxEl.getAttribute('aria-hidden') === 'true') return;
  if (e.key === 'Escape') { e.preventDefault(); closeLotLightbox(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); navLotLightbox(1); }
  else if (e.key === 'ArrowLeft')  { e.preventDefault(); navLotLightbox(-1); }
}

function openLotLightbox(lotIdx, itemIdx) {
  const lot = (typeof LOTS !== 'undefined' && LOTS) ? LOTS[lotIdx] : null;
  if (!lot) return;
  const photos = _galleryPhotos(lot);
  const items = photos.map(function (src, i) {
    return { src: src, label: 'Photo ' + (i + 1) };
  });
  // PDF plans are excluded — the lightbox renders <img>, which a PDF breaks.
  // They stay in the data and get a document link tile in the gallery instead.
  _galleryFloorPlans(lot).filter(function (src) { return !_isPdfFloorPlan(src); })
    .forEach(function (src, j, arr) {
      items.push({ src: src, label: arr.length > 1 ? 'Floor plan ' + (j + 1) : 'Floor plan' });
    });
  if (!items.length) return;
  _lightboxItems = items;
  _lightboxIdx = Math.max(0, Math.min(items.length - 1, itemIdx || 0));
  const el = _ensureLightboxEl();
  el.setAttribute('aria-hidden', 'false');
  el.classList.add('open');
  document.body.style.overflow = 'hidden';
  _renderLightbox();
  document.addEventListener('keydown', _lightboxKeyHandler);
  // Move focus to close button for screen-reader users
  const closeBtn = el.querySelector('.exp-lightbox-close');
  if (closeBtn) closeBtn.focus();
  if (window.umami) try { umami.track('lightbox_open', { lot: lot.lot || '', house: lot._house || '' }); } catch (_) {}
}

function closeLotLightbox() {
  if (!_lightboxEl) return;
  _lightboxEl.setAttribute('aria-hidden', 'true');
  _lightboxEl.classList.remove('open');
  document.body.style.overflow = '';
  document.removeEventListener('keydown', _lightboxKeyHandler);
}

function navLotLightbox(delta) {
  if (!_lightboxItems.length) return;
  const n = _lightboxItems.length;
  _lightboxIdx = ((_lightboxIdx + delta) % n + n) % n;
  _renderLightbox();
}

// ═══════════════════════════════════════════════════════════════
// BRIDGING-QUOTE LEAD CAPTURE (lead-out funnel)
// ═══════════════════════════════════════════════════════════════
// The "Get a bridging quote" CTA in an expanded lot's Fundability
// section opens this modal. On submit it POSTs the lot's deal essentials
// to Auction's own /api/leads, which records the lead and emails the
// bridging team. No cross-repo dependency. The modal DOM is built with
// createElement / textContent (no raw HTML strings) so it is XSS-safe
// by construction.
let _bqLot = null;

function _bqMoney(n) {
  return (n != null && Number.isFinite(+n) && +n > 0)
    ? '£' + Math.round(+n).toLocaleString('en-GB')
    : null;
}

// Tiny DOM builder — props: text / class / style / on{event:fn} / <attr>;
// children: an array of nodes. Avoids raw HTML injection entirely.
function _bqMake(tag, props, children) {
  const el = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'on') { for (const ev in v) el.addEventListener(ev, v[ev]); }
      else el.setAttribute(k, v);
    }
  }
  if (children) { for (let i = 0; i < children.length; i++) { if (children[i]) el.appendChild(children[i]); } }
  return el;
}

function _bqField(labelText, inputId, inputType, autocomplete) {
  return [
    _bqMake('label', { class: 'bq-field-label', for: inputId, text: labelText }),
    _bqMake('input', { type: inputType, id: inputId, autocomplete: autocomplete, required: '' }),
  ];
}

function openBridgingQuoteModal(lot) {
  if (!lot) return;
  _bqLot = lot;

  let modal = document.getElementById('bqModal');
  if (!modal) {
    const closeBtn = _bqMake('button', {
      type: 'button', id: 'bqClose', 'aria-label': 'Close', text: '×',
      style: 'position:absolute;top:8px;right:12px;background:none;border:none;font-size:24px;line-height:1;color:var(--text4,#999);cursor:pointer;padding:4px',
      on: { click: closeBridgingQuoteModal },
    });
    const consentLabel = _bqMake('label', { class: 'bq-consent' }, [
      _bqMake('input', { type: 'checkbox', id: 'bqConsent' }),
      _bqMake('span', { text: 'I’m happy for a bridging specialist to contact me about this enquiry.' }),
    ]);
    const form = _bqMake('form', { id: 'bqForm', novalidate: '', on: { submit: submitBridgingQuote } }, [
      ..._bqField('Your name', 'bqName', 'text', 'name'),
      ..._bqField('Email', 'bqEmail', 'email', 'email'),
      ..._bqField('Phone', 'bqPhone', 'text', 'tel'),
      consentLabel,
      _bqMake('button', { type: 'submit', id: 'bqSubmit', class: 'cta-primary',
        style: 'width:100%;justify-content:center', text: 'Request my quote' }),
      _bqMake('div', { class: 'bq-status', id: 'bqStatus', role: 'status' }),
    ]);
    const box = _bqMake('div', { class: 'modal' }, [
      closeBtn,
      _bqMake('div', { class: 'modal-icon', text: '🏦' }),
      _bqMake('h2', { text: 'Get a bridging quote' }),
      _bqMake('p', { text: 'Free and no-obligation — a bridging specialist reviews this lot and comes back to you.' }),
      _bqMake('div', { class: 'bq-summary', id: 'bqSummary' }),
      form,
      _bqMake('div', { id: 'bqSuccess', style: 'display:none' }),
      _bqMake('p', { class: 'modal-note', text: 'Auction Brain passes this enquiry to its bridging partner so they can prepare your quote.' }),
    ]);
    modal = _bqMake('div', {
      class: 'modal-bg bq-modal', id: 'bqModal',
      on: { click: function (e) { if (e.target === modal) closeBridgingQuoteModal(); } },
    }, [box]);
    document.body.appendChild(modal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('show')) closeBridgingQuoteModal();
    });
  }

  // Per-lot deal summary (textContent only — no HTML parsing)
  const summary = document.getElementById('bqSummary');
  while (summary.firstChild) summary.removeChild(summary.firstChild);
  const rows = [
    ['Property', lot.address || '—'],
    ['Guide price', _bqMoney(lot.price) || lot.priceText || 'TBC'],
    ['Type', lot.propType || '—'],
  ];
  const loan = lot.fundability && _bqMoney(lot.fundability.loanAmount);
  if (loan) rows.push(['Est. bridging loan', loan]);
  const works = lot.suggested && _bqMoney(lot.suggested.worksCost);
  if (works) rows.push(['Est. works budget', works]);
  for (let i = 0; i < rows.length; i++) {
    summary.appendChild(_bqMake('div', { class: 'bq-summary-row' }, [
      _bqMake('span', { class: 'k', text: rows[i][0] }),
      _bqMake('span', { class: 'v', text: rows[i][1] }),
    ]));
  }

  // Reset to form state (clears any prior success panel); prefill email
  document.getElementById('bqForm').style.display = '';
  const succ = document.getElementById('bqSuccess');
  succ.style.display = 'none';
  while (succ.firstChild) succ.removeChild(succ.firstChild);
  const status = document.getElementById('bqStatus');
  status.textContent = '';
  status.className = 'bq-status';
  const submitBtn = document.getElementById('bqSubmit');
  submitBtn.disabled = false;
  submitBtn.textContent = 'Request my quote';
  if (typeof currentUser !== 'undefined' && currentUser && currentUser.email) {
    document.getElementById('bqEmail').value = currentUser.email;
  }

  modal.classList.add('show');
  if (window.umami) { try { umami.track('bridging_quote_open', { house: lot._house || '', guide_price: lot.price || 0 }); } catch (e) {} }
}

function closeBridgingQuoteModal() {
  const m = document.getElementById('bqModal');
  if (m) m.classList.remove('show');
}

async function submitBridgingQuote(e) {
  e.preventDefault();
  const lot = _bqLot;
  if (!lot) return;
  const status = document.getElementById('bqStatus');
  const submitBtn = document.getElementById('bqSubmit');
  const name = document.getElementById('bqName').value.trim();
  const email = document.getElementById('bqEmail').value.trim();
  const phone = document.getElementById('bqPhone').value.trim();
  const consent = document.getElementById('bqConsent').checked;

  if (!name || !email || !phone) {
    status.className = 'bq-status err';
    status.textContent = 'Please add your name, email and phone.';
    return;
  }
  if (!consent) {
    status.className = 'bq-status err';
    status.textContent = 'Please tick the consent box so we can contact you.';
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending…';
  status.className = 'bq-status';
  status.textContent = '';

  const f = lot.fundability || {};
  const s = lot.suggested || {};
  const payload = {
    name: name, email: email, phone: phone, consent: true,
    source: 'auction-lot',
    isRegulated: false,
    propertyPrice: lot.price || null,
    propertyType: lot.propType || null,
    propertyAddress: lot.address || null,
    loanAmount: (f.loanAmount != null ? f.loanAmount : null),
    ltvPercent: (f.ltv != null ? f.ltv : null),
    worksBudget: (s.worksCost != null ? s.worksCost : null),
    matchingLenders: (f.lenderCount != null ? f.lenderCount : null),
    auctionUrl: lot.url || null,
    dealData: {
      lotId: lot.id || null,
      house: lot._house || null,
      lotNumber: lot.lot || null,
      score: (lot.score != null ? lot.score : null),
      condition: lot.condition || null,
      gdv: (s.gdv != null ? s.gdv : null),
      beds: (lot.beds != null ? lot.beds : null),
    },
  };

  try {
    const r = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(typeof getAuthHeaders === 'function' ? getAuthHeaders() : {}) },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(function () { return {}; });
    if (r.ok && data && data.ok) {
      document.getElementById('bqForm').style.display = 'none';
      const succ = document.getElementById('bqSuccess');
      succ.style.display = '';
      succ.appendChild(_bqMake('p', {
        class: 'bq-status ok',
        style: 'text-align:center;font-size:.92rem;margin:6px 0 14px',
        text: 'Thanks, ' + (name.split(' ')[0] || 'there') + ' — a bridging specialist will be in touch shortly.',
      }));
      succ.appendChild(_bqMake('button', {
        type: 'button', class: 'cta-primary', style: 'width:100%;justify-content:center',
        text: 'Done', on: { click: closeBridgingQuoteModal },
      }));
      if (window.umami) { try { umami.track('bridging_quote_submit', { house: lot._house || '', guide_price: lot.price || 0 }); } catch (e2) {} }
    } else {
      status.className = 'bq-status err';
      status.textContent = (data && data.error)
        ? data.error
        : 'Something went wrong. Email hello@bridgematch.co.uk and we will pick it up.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Request my quote';
    }
  } catch (err) {
    status.className = 'bq-status err';
    status.textContent = 'Network error — please try again, or email hello@bridgematch.co.uk.';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Request my quote';
  }
}

function buildExpandedPanelHTML(lot) {
  // Build deal stacking calculator HTML
  var dealStackHtml = (isPremium() ? (function() {
        var sug = suggestWorksAndGdv(lot);
        var worksAttr = sug.worksCost ? ' value="' + sug.worksCost + '"' : '';
        var gdvAttr = sug.gdv ? ' value="' + sug.gdv + '"' : '';
        var worksHint = sug.worksCost
          ? '<div class="ds-hint">Auto-suggested from condition \u2014 override any time</div>'
          : '';
        var gdvHint = sug.gdv
          ? '<div class="ds-hint">Estimated as price + works + 15% \u2014 override with a real comp</div>'
          : '';
        return '<div class="deal-stack-widget" id="deal-stack-' + lot._idx + '">' +
          // ── Scenario picker ──
          '<div class="ds-scenarios" style="display:flex; gap:6px; align-items:center; margin-bottom:10px; flex-wrap:wrap;">' +
            '<select id="ds-scenario-select-' + lot._idx + '" class="ds-input" style="flex:1; min-width:180px; padding:6px 8px;" onchange="selectScenario(' + lot._idx + ', this.value)">' +
              '<option value="">\u2014 New scenario \u2014</option>' +
            '</select>' +
            '<button type="button" class="ds-btn" onclick="saveScenario(' + lot._idx + ')" title="Save this scenario">Save</button>' +
            '<button type="button" class="ds-btn" onclick="saveScenario(' + lot._idx + ', { saveAs: true })" title="Save as new scenario">Save as\u2026</button>' +
            '<button type="button" id="ds-scenario-delete-' + lot._idx + '" class="ds-btn ds-btn-danger" disabled onclick="deleteScenario(' + lot._idx + ')" title="Delete scenario">Delete</button>' +
          '</div>' +
          '<div class="ds-grid">' +
            '<div>' +
              '<label class="ds-label">Purchase Price</label>' +
              '<input type="number" id="ds-price-' + lot._idx + '" value="' + (lot.price || '') + '" placeholder="e.g. 150000" class="ds-input" oninput="debounceDealStack(' + lot._idx + ')">' +
            '</div>' +
            '<div>' +
              '<label class="ds-label">Works Cost</label>' +
              '<input type="number" id="ds-works-' + lot._idx + '"' + worksAttr + ' placeholder="e.g. 30000" class="ds-input" oninput="debounceDealStack(' + lot._idx + ')">' +
              worksHint +
            '</div>' +
            '<div>' +
              '<label class="ds-label">GDV (after works)</label>' +
              '<input type="number" id="ds-gdv-' + lot._idx + '"' + gdvAttr + ' placeholder="e.g. 350000" class="ds-input" oninput="debounceDealStack(' + lot._idx + ')">' +
              gdvHint +
            '</div>' +
            '<div>' +
              '<label class="ds-label">Monthly Rent <span class="ds-label-note">(hold scenario)</span></label>' +
              '<input type="number" id="ds-rental-' + lot._idx + '" placeholder="e.g. 1200" class="ds-input" oninput="debounceDealStack(' + lot._idx + ')">' +
            '</div>' +
          '</div>' +
          '<div class="ds-options">' +
            '<label class="ds-check"><input type="checkbox" id="ds-needs-finance-' + lot._idx + '" checked onchange="debounceDealStack(' + lot._idx + ')"> Needs bridging finance</label>' +
            '<label class="ds-check"><input type="checkbox" id="ds-surcharge-' + lot._idx + '" checked onchange="debounceDealStack(' + lot._idx + ')"> Additional property SDLT</label>' +
            '<label class="ds-check"><input type="checkbox" id="ds-commercial-' + lot._idx + '"' + ((lot.propType === 'commercial' || (lot.units && lot.units >= 6)) ? ' checked' : '') + ' onchange="debounceDealStack(' + lot._idx + ')"> Commercial / 6+ units</label>' +
          '</div>' +
          // Hidden inputs to keep debounceDealStack() working (uses fixed defaults)
          '<input type="hidden" id="ds-sdlt-' + lot._idx + '">' +
          '<input type="hidden" id="ds-buyerprem-' + lot._idx + '" value="0">' +
          '<input type="hidden" id="ds-contingency-' + lot._idx + '" value="10">' +
          '<input type="hidden" id="ds-legalpack-' + lot._idx + '" value="300">' +
          '<input type="hidden" id="ds-insurance-' + lot._idx + '" value="500">' +
          '<div id="ds-results-' + lot._idx + '"></div>' +
        '</div>';
      })() :
        '<div class="deal-stack-widget" style="padding:20px; background:var(--bg-card); border-radius:12px; border:1px solid rgba(0,0,0,0.08); text-align:center;">' +
          '<h4 style="margin:0 0 8px; font-family:var(--font-main); font-size:15px; font-weight:600; color:var(--text);">' +
            'Deal Stacking Calculator' +
          '</h4>' +
          '<p style="color:var(--text-muted); font-size:13px; margin:0 0 12px;">' +
            'Analyse Flip vs Hold scenarios with live lender data' +
          '</p>' +
          '<button onclick="showPaywall(\'deal_stacking\')" ' +
            'style="padding:10px 24px; background:var(--accent); color:#fff; border:none; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer;">' +
            'Sign in free' +
          '</button>' +
        '</div>');

  const premiumNow = (typeof isPremium === 'function') ? isPremium() : false;

  // The deal-stack widget (input form + scenario picker) only renders
  // for premium users. Wrap it in the editorial chrome regardless.
  const dealStackPanelHtml = buildExpV2DealStackChrome(
    dealStackHtml +
    (lot.price ? '<div id="finance-summary-' + lot._idx + '" style="margin-top:10px"></div>' : '')
  );

  // Number visible left-column sections sequentially. Previously the
  // builders emitted hard-coded "1" / "2" / "3" — fine when all three
  // rendered, but buildExpV2Scores returns '' when a lot has no opps
  // and no risks, leaving 1 → 3 with a missing badge in between.
  // Each builder now emits __SEC_NUM__ and we substitute as we walk
  // the surviving non-empty fragments.
  const _leftSectionsRaw = [
    buildExpV2Scores(lot),
    buildExpV2Comparables(lot, premiumNow),
  ];
  let _secCounter = 0;
  const _leftSections = _leftSectionsRaw
    .filter(Boolean)
    .map(function (html) {
      return html.indexOf('__SEC_NUM__') >= 0
        ? html.replace(/__SEC_NUM__/, function () { return String(++_secCounter); })
        : html;
    })
    .join('');

  return (
    '<button class="exp-close-btn" onclick="closeExpandedPanel()" aria-label="Close panel" title="Close">&times;</button>' +
    buildExpV2Header(lot) +
    // Gallery sits above the analysis grid and spans both columns —
    // photos are the primary "stay on platform" anchor. Returns '' when
    // the lot has no extra photos and no floor plan.
    buildExpV2Gallery(lot) +
    '<div class="exp-v2-left">' +
      _leftSections +
    '</div>' +
    '<div class="exp-v2-right">' +
      dealStackPanelHtml +
      buildExpV2Fundability(lot) +
    '</div>' +
    // The "what happens next" buyer's guide stays as an opt-in details
    // disclosure below the magazine grid.
    '<details class="whn-section" style="grid-column:1 / -1;margin-top:24px;border:1px solid var(--border-strong);border-radius:0;background:var(--paper)">' +
      '<summary style="padding:12px 18px;font-family:var(--font-mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;color:var(--ink);list-style:none;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border-strong)">' +
        'What happens next — auction buying guide' +
        '<span style="margin-left:auto;font-family:var(--font-mono);font-size:14px;color:var(--muted)">+</span>' +
      '</summary>' +
      '<div style="padding:18px;font-family:var(--font-display);font-size:15px;color:var(--ink-2);line-height:1.6">' +
        '<div style="display:grid;gap:12px">' +
          '<div><strong style="font-family:var(--font-main);font-weight:600;color:var(--ink)">1. Get the legal pack.</strong> Download from the auction house website (usually free). Have a solicitor review it before you bid — budget ~£500–£1,000.</div>' +
          '<div><strong style="font-family:var(--font-main);font-weight:600;color:var(--ink)">2. Arrange a survey.</strong> Building survey or HomeBuyer report before auction day. Budget ~£400–£700, more for distressed properties.</div>' +
          '<div><strong style="font-family:var(--font-main);font-weight:600;color:var(--ink)">3. Arrange finance.</strong> Get a Decision in Principle for bridging before bidding. Most bridging lenders complete in 5–10 working days.</div>' +
          '<div><strong style="font-family:var(--font-main);font-weight:600;color:var(--ink)">4. Register to bid.</strong> Photo ID, proof of address, proof of funds, solicitor details. Allow 24–48 hours for verification.</div>' +
          '<div><strong style="font-family:var(--font-main);font-weight:600;color:var(--ink)">5. Set your maximum bid.</strong> Use the deal stack above. Set a firm cap and do not exceed it. Factor SDLT, legals, survey, bridging, refurb.</div>' +
          '<div><strong style="font-family:var(--font-main);font-weight:600;color:var(--ink)">6. After the hammer falls.</strong> 10% deposit immediately + buyer’s premium. Exchange at the fall of the hammer is legally binding. Completion typically 28 days.</div>' +
        '</div>' +
        '<div style="margin-top:14px;padding:8px 12px;background:var(--bg-2);border-left:2px solid var(--red);font-family:var(--font-display);font-size:13px;line-height:1.4;color:var(--ink-2)">' +
          'At auction, the fall of the hammer creates a binding contract. Do your due diligence before bidding, not after.' +
        '</div>' +
      '</div>' +
    '</details>'
  );
}

function wireExpandedPanel(lot) {
  loadScenariosForLot(lot, lot._idx);
  if (lot.price) {
    setTimeout(function () { triggerFinanceCheck(lot._idx); }, 200);
    fetchLenderSummary(lot);
  }
}

function expandCard(lot) {
  // Anonymous users can OPEN any lot card — address, price, image, house,
  // status, auction date, bullets are all visible. Sensitive AI fields
  // (score, opps, risks, yield, deal type) are stripped server-side for
  // anon (routes/search.js:1449) and surface as inline "Sign in for AI"
  // nudges. Saving a lot, saving a search, running AI analysis, paying —
  // those still trigger requireSignup(). That's where friction is welcome,
  // because that's where commitment is. (Was: full sign-in wall on click.)
  if (window.umami) umami.track('lot_expand', {
    lot_number: lot.lot || '', house: lot._house || '', guide_price: lot.price || 0
  });
  // Anonymous-browsing nudge — counts unique lot views and shows a soft
  // signup prompt at 10 (toast) and 25 (modal). Skipped for signed-in
  // users so we don't badger people who have already converted.
  try { if (typeof trackAnonViewNudge === 'function') trackAnonViewNudge(lot); } catch {}
  // Server-side activity event for the admin Intel dashboard. De-dupe per
  // session so a user toggling a lot open/closed doesn't inflate the count.
  try {
    window.__viewedLots = window.__viewedLots || new Set();
    const key = (lot._house || '') + ':' + (lot.lot || '') + ':' + (lot.address || '').slice(0, 40);
    if (!window.__viewedLots.has(key)) {
      window.__viewedLots.add(key);
      fetch('/api/track/event', {
        method: 'POST',
        headers: {'Content-Type':'application/json', ...(typeof getAuthHeaders === 'function' ? getAuthHeaders() : {})},
        body: JSON.stringify({
          action: 'lot_view',
          detail: {
            house: lot._house || '',
            lot: lot.lot || '',
            price: lot.price || 0,
            score: lot.score || null,
            deal_type: lot.dealType || null,
            prop_type: lot.propType || null
          }
        })
      }).catch(function(){});
    }
  } catch {}
  // Mobile: present the lot as a full-screen drawer. Desktop keeps the inline
  // path below. Uses _drawerLotKey (not expandedLotId) for the re-tap guard.
  if (_isMobileDrawer()) {
    if (_drawerOpen && _drawerLotKey === _lotKey(lot)) { closeLotDrawer(); return; }
    openLotDrawer(lot);
    return;
  }
  // Hide any existing expanded panel (cached — not removed)
  const existing = document.querySelector('.expanded-panel-visible');
  if (existing) {
    existing.style.display = 'none';
    existing.classList.remove('expanded-panel-visible');
  }
  // Bug fix (handoff §): clear stale .expanded class from any previously
  // expanded card before applying it to the new one. Without this, a
  // click on card B left card A's red border / outline showing because
  // the old card never had its class removed.
  document.querySelectorAll('.lot-card.expanded, .lot-card-v2.expanded').forEach(function(el){
    el.classList.remove('expanded');
  });

  const cardEl = document.getElementById('lot-' + lot._idx);
  if (!cardEl) return;

  if (expandedLotId === lot._idx) {
    expandedLotId = null;
    _setOpenLotKey(null);
    cardEl.classList.remove('expanded');
    var _cached = _expandedPanelCache.get(lot._idx);
    if (_cached) { _cached.style.display = 'none'; _cached.classList.remove('expanded-panel-visible'); }
    return;
  }
  expandedLotId = lot._idx;
  _setOpenLotKey(_lotKey(lot));
  cardEl.classList.add('expanded');
  try { sessionStorage.setItem('ab_scroll_y', window.scrollY.toString()); } catch(e) {}

  // Check if we have a cached panel for this lot
  var cachedPanel = _expandedPanelCache.get(lot._idx);
  if (cachedPanel) {
    // Re-use cached panel — just show it
    cachedPanel.style.display = '';
    cachedPanel.classList.add('expanded-panel-visible');
    // Make sure it's positioned after the correct card
    cardEl.after(cachedPanel);
    cachedPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    // Refresh saved scenarios in case they changed elsewhere
    loadScenariosForLot(lot, lot._idx);
    return;
  }

  // Build expanded panel — image, AI prose, EPC/flood badges, and the property
  // strip have been moved off the panel; the card already shows them.
  const panel = document.createElement('div');
  panel.className = 'expanded-panel expanded-panel-visible exp-v2';
  panel.id = 'expanded-' + lot._idx;
  panel.innerHTML = buildExpandedPanelHTML(lot);

  cardEl.after(panel);
  _expandedPanelCache.set(lot._idx, panel);
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  wireExpandedPanel(lot);
}

function closeExpandedPanel() {
  const existing = document.querySelector('.expanded-panel-visible');
  if (existing) {
    existing.style.display = 'none';
    existing.classList.remove('expanded-panel-visible');
  }
  if (expandedLotId !== null) {
    const cardEl = document.getElementById('lot-' + expandedLotId);
    if (cardEl) cardEl.classList.remove('expanded');
    expandedLotId = null;
    _setOpenLotKey(null);
  }
}

// ═══════════════════════════════
// MOBILE LOT DRAWER (≤640px) — own state, decoupled from expandedLotId so a
// background re-render can't orphan it. Dormant until expandCard forks to it.
// ═══════════════════════════════
function _isMobileDrawer() {
  try { return window.matchMedia('(max-width: 640px)').matches; } catch (e) { return false; }
}

var _lotDrawerEl = null, _lotDrawerScrim = null, _lotDrawerBody = null, _lotDrawerTitle = null;
var _drawerOpen = false, _drawerLotKey = null, _drawerFocusReturn = null, _drawerPushedState = false; // _drawerLotKey: read by the expandCard mobile fork (re-tap-to-close guard), added in the activation task

function _ensureLotDrawerEl() {
  if (_lotDrawerEl) return;
  _lotDrawerScrim = document.createElement('div');
  _lotDrawerScrim.id = 'lotDrawerScrim';
  _lotDrawerScrim.addEventListener('click', function () { closeLotDrawer(); });

  _lotDrawerEl = document.createElement('div');
  _lotDrawerEl.id = 'lotDrawer';
  _lotDrawerEl.setAttribute('role', 'dialog');
  _lotDrawerEl.setAttribute('aria-modal', 'true');
  _lotDrawerEl.setAttribute('aria-labelledby', 'lotDrawerTitle');
  _lotDrawerEl.setAttribute('aria-hidden', 'true');
  try { _lotDrawerEl.setAttribute('inert', ''); } catch (e) {}
  _lotDrawerEl.innerHTML =
    '<div class="ld-head">' +
      '<span class="ld-title" id="lotDrawerTitle"></span>' +
      '<button type="button" class="ld-close" aria-label="Close lot">CLOSE <span aria-hidden="true">&times;</span></button>' +
    '</div>' +
    '<div class="ld-body"></div>';
  _lotDrawerBody = _lotDrawerEl.querySelector('.ld-body');
  _lotDrawerTitle = _lotDrawerEl.querySelector('.ld-title');
  _lotDrawerEl.querySelector('.ld-close').addEventListener('click', function () { closeLotDrawer(); });
  _lotDrawerEl.addEventListener('keydown', _lotDrawerKeydown);

  // Keyboard-aware: scroll a focused input clear of the on-screen keyboard.
  _lotDrawerBody.addEventListener('focusin', function (e) {
    var t = e.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) {
      setTimeout(function () { try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {} }, 300);
    }
  });

  // Left-edge swipe-to-dismiss (handlers defined below).
  _lotDrawerEl.addEventListener('touchstart', _ldTouchStart, { passive: true });
  _lotDrawerEl.addEventListener('touchmove', _ldTouchMove, { passive: false });
  _lotDrawerEl.addEventListener('touchend', _ldTouchEnd);
  _lotDrawerEl.addEventListener('touchcancel', _ldTouchCancel);

  document.body.appendChild(_lotDrawerScrim);
  document.body.appendChild(_lotDrawerEl);
}

function _drawerFocusables() {
  if (!_lotDrawerEl) return [];
  return Array.prototype.slice.call(_lotDrawerEl.querySelectorAll(
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
  )).filter(function (el) { return el.getClientRects().length > 0 || el === document.activeElement; });
}

function _lotDrawerKeydown(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeLotDrawer(); return; }
  if (e.key !== 'Tab') return;
  var f = _drawerFocusables(); if (!f.length) return;
  var first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function openLotDrawer(lot) {
  _ensureLotDrawerEl();
  _drawerLotKey = _lotKey(lot);
  _setOpenLotKey(_drawerLotKey);

  var houseLabel = (typeof getHouseDisplay === 'function' ? getHouseDisplay(lot._house || lot.house || '') : (lot._house || '')) || 'Auction house';
  var lotNum = lot.lot != null ? String(lot.lot).padStart(2, '0') : '—';
  _lotDrawerTitle.textContent = (houseLabel + ' · LOT ' + lotNum).toUpperCase();

  _lotDrawerBody.scrollTop = 0;
  _lotDrawerBody.innerHTML =
    '<div class="expanded-panel expanded-panel-visible exp-v2" id="expanded-' + lot._idx + '">' +
    buildExpandedPanelHTML(lot) + '</div>';

  _drawerFocusReturn = document.activeElement;
  try { _lotDrawerEl.removeAttribute('inert'); } catch (e) {}
  var _mw = document.querySelector('main.wrap'); if (_mw) { try { _mw.setAttribute('inert', ''); } catch (e) {} }
  _lotDrawerEl.setAttribute('aria-hidden', 'false');
  _lotDrawerEl.style.transform = '';
  document.body.classList.add('drawer-open');
  _drawerOpen = true;
  var closeBtn = _lotDrawerEl.querySelector('.ld-close');
  if (closeBtn) closeBtn.focus();

  if (window.umami) { try { umami.track('lot_drawer_open', { lot: lot.lot || '', house: lot._house || '' }); } catch (e) {} }

  _drawerPushUrl(lot);
  wireExpandedPanel(lot);
}

// opts.fromPopstate=true → invoked by Back; do NOT call history.back.
function closeLotDrawer(opts) {
  opts = opts || {};
  if (!_drawerOpen) return;
  _drawerOpen = false;
  _drawerLotKey = null;
  document.body.classList.remove('drawer-open');
  if (_lotDrawerEl) { _lotDrawerEl.setAttribute('aria-hidden', 'true'); try { _lotDrawerEl.setAttribute('inert', ''); } catch (e) {} }
  var _mw = document.querySelector('main.wrap'); if (_mw) { try { _mw.removeAttribute('inert'); } catch (e) {} }
  _setOpenLotKey(null);

  if (!opts.fromPopstate && _drawerPushedState) { _drawerPushedState = false; history.back(); }
  else { _drawerPushedState = false; _drawerStripLotParam(); }

  var ret = _drawerFocusReturn; _drawerFocusReturn = null;
  // if the originating card was detached by a background re-render, .focus() is a harmless no-op (focus falls to body) — acceptable for v1
  if (ret && typeof ret.focus === 'function') { try { ret.focus(); } catch (e) {} }
}

function _drawerPushUrl(lot) {
  // lot._dbId is the UUID, populated server-side by dbRowToLot (lib/types/lot.js:295) and serialized to the client (only _searchText is stripped in routes/search.js); the activation task adds the fork that calls this.
  var id = lot._dbId || null;   // UUID; null → skip URL integration gracefully
  if (!id) { _drawerPushedState = false; return; }
  var existing = new URLSearchParams(window.location.search).get('lot');
  if (existing === id) { _drawerPushedState = false; return; }
  try {
    var p = new URLSearchParams(window.location.search);
    p.set('lot', id);
    history.pushState({ lotDrawer: id }, '', window.location.pathname + '?' + p.toString());
    _drawerPushedState = true;
  } catch (e) { _drawerPushedState = false; }
}

function _drawerStripLotParam() {
  try {
    var p = new URLSearchParams(window.location.search);
    if (!p.has('lot')) return;
    p.delete('lot');
    var qs = p.toString();
    history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
  } catch (e) {}
}

window.addEventListener('popstate', function () {
  var hasLot = new URLSearchParams(window.location.search).has('lot');
  if (_drawerOpen && !hasLot) { closeLotDrawer({ fromPopstate: true }); }
});

// Left-edge swipe-to-dismiss (iOS-style interactive back). Only starts within
// _ldEdge px of the left edge, so it doesn't conflict with the image gallery's
// horizontal swipe or the deal-stack inputs. On Android the OS edge-back fires
// popstate → closeLotDrawer already, so this is primarily the iOS complement.
var _ldEdge = 24, _ldDragging = false, _ldStartX = 0, _ldStartY = 0, _ldDX = 0, _ldW = 0;

function _ldTouchStart(e) {
  if (!_drawerOpen || !e.touches || e.touches.length !== 1) return;
  var t = e.touches[0];
  if (t.clientX > _ldEdge) return;
  _ldDragging = true; _ldStartX = t.clientX; _ldStartY = t.clientY; _ldDX = 0;
  _ldW = (_lotDrawerEl.getBoundingClientRect().width) || window.innerWidth || 1;
  _lotDrawerEl.style.transition = 'none';
}
function _ldTouchMove(e) {
  if (!_ldDragging) return;
  var t = e.touches[0];
  var dx = t.clientX - _ldStartX, dy = t.clientY - _ldStartY;
  if (_ldDX === 0 && Math.abs(dy) > Math.abs(dx)) { _ldDragging = false; _lotDrawerEl.style.transition = ''; return; }
  if (dx < 0) dx = 0;
  _ldDX = dx;
  e.preventDefault();
  _lotDrawerEl.style.transform = 'translateX(' + dx + 'px)';
  if (_lotDrawerScrim) _lotDrawerScrim.style.opacity = String(Math.max(0, 1 - dx / _ldW));
}
function _ldTouchEnd() {
  if (!_ldDragging) return;
  _ldDragging = false;
  _lotDrawerEl.style.transition = '';
  if (_lotDrawerScrim) _lotDrawerScrim.style.opacity = '';
  if (_ldDX > _ldW * 0.33) { _lotDrawerEl.style.transform = 'translateX(100%)'; closeLotDrawer(); }
  else { _lotDrawerEl.style.transform = ''; }
  _ldDX = 0;
}
// touchcancel is an ABORT (OS interrupt: incoming call/notification) — snap back, never commit a close.
function _ldTouchCancel() {
  if (!_ldDragging) return;
  _ldDragging = false;
  _lotDrawerEl.style.transition = '';
  _lotDrawerEl.style.transform = '';
  if (_lotDrawerScrim) _lotDrawerScrim.style.opacity = '';
  _ldDX = 0;
}

function updateLTV(idx, val) {
  const el = document.getElementById('ltv-val-' + idx);
  if (el) el.textContent = val + '%';
  debounceDealStack(idx);
}

let _financeDebounce = null;
function triggerFinanceCheck(idx) {
  clearTimeout(_financeDebounce);
  const lot = LOTS.find(l => l._idx === idx);
  if (!lot || !lot.price) return;

  const ltv = parseInt(document.getElementById('ltv-slider-' + idx)?.value ?? '70', 10);
  const resultsEl = document.getElementById('fw-results-' + idx);
  if (!resultsEl) return;

  resultsEl.innerHTML = '<div class="fw-loading"><div class="fw-count fw-pulse">...</div><div class="fw-count-label">Checking lenders</div></div>';

  const loanAmount = Math.round(lot.price * ltv / 100);
  const propType = (lot.propType || 'house').toLowerCase();
  const apiType = /flat|apartment|maisonette/.test(propType) ? 'flat' : /commercial|mixed/.test(propType) ? 'commercial' : /land/.test(propType) ? 'land' : 'house';

  _financeDebounce = setTimeout(async () => {
    try {
      const r = await fetch('https://www.bridgematch.co.uk/api/filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loan_amount: loanAmount, market_value: lot.price, property_type: apiType, transaction_type: 'purchase', charge_position: '1st', loan_term_months: 12 })
      });
      if (!r.ok) throw new Error('API error');
      const data = await r.json();
      const count = data.summary?.eligible || data.eligible?.length || 0;
      const lenders = (data.eligible || []).slice(0, 3);

      let html = '<div class="fw-results">' +
        '<div class="fw-count">' + count + '</div>' +
        '<div class="fw-count-label">lender' + (count !== 1 ? 's' : '') + ' match at ' + ltv + '% LTV</div>';
      if (lenders.length) {
        html += '<div class="fw-lenders">' + lenders.map(l => '<span class="fw-lender-chip">' + esc(l.name || l.lender || l) + '</span>').join('') + '</div>';
      }
      html += '</div>';
      html += '<a class="fw-cta" href="/check?price=' + encodeURIComponent(lot.price) + '&type=' + encodeURIComponent(lot.propType || 'house') + (lot.address ? '&address=' + encodeURIComponent(lot.address) : '') + '" target="_blank">See all ' + count + ' matches on BridgeMatch →</a>';
      resultsEl.innerHTML = html;
    } catch (e) {
      resultsEl.innerHTML = '<div class="fw-error">Unable to check finance — try again later</div>';
    }
  }, 400);
}

// Lender summary cache (avoid re-fetching for same lot)
const _lenderSummaryCache = {};
async function fetchLenderSummary(lot) {
  const el = document.getElementById('lender-summary-' + lot._idx);
  if (!el) return;

  const cacheKey = lot.price + '_' + (lot.propType || 'house');
  if (_lenderSummaryCache[cacheKey]) {
    renderLenderSummary(el, _lenderSummaryCache[cacheKey], lot);
    return;
  }

  const loanAmount = Math.round(lot.price * 0.70); // default 70% LTV
  const propType = (lot.propType || 'house').toLowerCase();
  const apiType = /flat|apartment|maisonette/.test(propType) ? 'flat' : /commercial|mixed/.test(propType) ? 'commercial' : /land/.test(propType) ? 'land' : 'house';

  try {
    const r = await fetch('https://www.bridgematch.co.uk/api/filter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loan_amount: loanAmount, market_value: lot.price, property_type: apiType, transaction_type: 'purchase', charge_position: '1st', loan_term_months: 12 })
    });
    if (!r.ok) throw new Error('API error');
    const data = await r.json();
    _lenderSummaryCache[cacheKey] = data;
    renderLenderSummary(el, data, lot);
  } catch (e) {
    el.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">Lender data unavailable</span>';
  }
}

function renderLenderSummary(el, data, lot) {
  const count = data.summary?.eligible || data.eligible?.length || 0;
  const lenders = data.eligible || [];
  // Compute typical rate range (median of low ends, not the absolute minimum)
  const rates = lenders.map(l => parseFloat((l.interest_rate_band || '').match(/[\d.]+/)?.[0] || 0)).filter(r => r > 0).sort((a, b) => a - b);
  const typicalRate = rates.length >= 3 ? rates[Math.floor(rates.length * 0.25)] : (rates[0] || null); // 25th percentile
  const maxLtv = lenders.length ? lenders.reduce((max, l) => {
    const ltv = parseFloat(l.max_gross_ltv || 0);
    return ltv > max ? ltv : max;
  }, 0) : null;

  if (count === 0) {
    el.innerHTML = '<span style="font-size:12px;color:var(--accent-warn)">No bridging lenders match at 70% LTV — try adjusting in the Finance Check below</span>';
    return;
  }

  el.innerHTML =
    '<div class="ls-count">' + count + '</div>' +
    '<div class="ls-text">' +
      '<strong>bridging lender' + (count !== 1 ? 's' : '') + ' match</strong> at 70% LTV' +
      (typicalRate ? ' · rates from <strong>' + typicalRate.toFixed(2) + '%</strong>/mo' : '') +
      (maxLtv && maxLtv > 0 ? ' · up to <strong>' + maxLtv + '%</strong> LTV' : '') +
    '</div>';
}

function bridgeMatchLot(idx, event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  const lot = LOTS.find(l => l._idx === idx);
  if (!lot) return;
  if (window.umami) umami.track('finance_click', {
    lot_id: lot._dbId || '', lot_number: lot.lot || '', house: lot._house || '', guide_price: lot.price || 0
  });
  fetch('/api/track/event', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'bridgematch_open', detail:{lot_id: lot._dbId||'', lot_number: lot.lot||'', house: lot._house||'', guide_price: lot.price||0}})}).catch(function(){});

  const isExpanded = expandedLotId === idx;
  if (!isExpanded) {
    expandCard(lot);
    setTimeout(() => {
      const widget = document.getElementById('finance-widget-' + idx);
      if (widget) widget.scrollIntoView({ behavior: 'smooth', block: 'center' });
      triggerFinanceCheck(idx);
    }, 300);
  } else {
    const widget = document.getElementById('finance-widget-' + idx);
    if (widget) widget.scrollIntoView({ behavior: 'smooth', block: 'center' });
    triggerFinanceCheck(idx);
  }
}

// toggleSection() removed — flat dividers, no collapse/expand

// ═══════════════════════════════
// SHAREABLE FILTER URLs (#65)
// ═══════════════════════════════
const FILTER_PARAMS=['smartQuery','fSort','fMinPrice','fMaxPrice','fBeds','fType','fLocation','fDeal','fCondition','fTenure','fSoldTop','fTown','fPostcode','fRadius','fExcludePOA','fMinYield','fMinBmv','fMinScore','fSignal','fEpc','fFlood','fRedFlag','fMinRoce','fBidTarget'];
function restoreFiltersFromURL(){
  const p=new URLSearchParams(window.location.search);
  for(const id of FILTER_PARAMS){const v=p.get(id);if(v&&$(id))$(id).value=v}
  // A past-implying LOT STATUS in a shared/reloaded URL needs past auctions
  // in the dataset — tick the checkbox so the initial load fetches includePast.
  const _rs=p.get('fSoldTop');
  if(_rs&&PAST_STATUS_VALUES.has(_rs)&&$('fShowPast')) $('fShowPast').checked=true;
  updatePriceBtn();
  // Trigger geocoding for any restored town/postcode — setting .value directly
  // doesn't fire the oninput handler, so onLocationInput() never runs and the
  // radius search falls through to literal address-includes (the 'Bristol
  // returns 2 lots' bug). Run async after DOM is ready.
  if((p.get('fTown')||p.get('fPostcode')) && typeof onLocationInput==='function'){
    setTimeout(onLocationInput, 0);
  }
}
function syncFiltersToURL(){
  const p=new URLSearchParams();
  for(const id of FILTER_PARAMS){const el=$(id);if(el&&el.value&&el.value!==el.querySelector('option')?.value)p.set(id,el.value)}
  if($('fShowPast')?.checked) p.set('showPast','true');
  const curLot=new URLSearchParams(window.location.search).get('lot');
  if(curLot) p.set('lot', curLot);
  const qs=p.toString();
  const url=qs?window.location.pathname+'?'+qs:window.location.pathname;
  if(url!==window.location.pathname+window.location.search) history.replaceState(null,'',url);
}

// Restore the URL we were on before the OAuth round-trip. Supabase's callback
// appends #access_token=… to the bare-origin redirectTo, so any filters that
// were in the query string are gone by the time the page loads. We saved the
// search-string in handleGoogleSignIn / handleSendMagicLink — pull it back
// before restoreFiltersFromURL() reads window.location.search. Only fires
// when the URL hash carries auth tokens (i.e. we just bounced through OAuth)
// so a fresh tab without an OAuth round-trip doesn't accidentally inherit a
// stale search from a prior session.
(function restoreSearchAfterOAuth(){
  try {
    const saved = sessionStorage.getItem('ab_post_auth_search');
    if (!saved) return;
    const justAuthed = (window.location.hash || '').includes('access_token=')
      || (window.location.hash || '').includes('refresh_token=');
    if (!justAuthed) {
      sessionStorage.removeItem('ab_post_auth_search');
      return;
    }
    if (saved && saved !== window.location.search) {
      const restored = window.location.pathname + saved + window.location.hash;
      history.replaceState(null, '', restored);
    }
    sessionStorage.removeItem('ab_post_auth_search');
  } catch {}
})();

restoreFiltersFromURL();

// Preferred investment location: apply the stored preference as the default
// location filter (URL-restored filters above win), then — for anonymous
// first-time visitors with no preference — ask for one. Delayed so auth has a
// chance to resolve first; signed-in first-timers get the full wizard via
// maybeShowOnboarding() instead.
(function initPreferredLocation(){
  const pref = getStoredPrefLocation();
  if (pref) setTimeout(() => applyPreferredLocationIfUnset(pref), 0);
  else setTimeout(maybeAskLocation, 2500);
})();

// Read showPast and status URL params on page load. ?status=unsold
// activates the unsold view for Pro users (the alert email links land
// here). For non-Pro the param is read but the toggle stays off — the
// gating in toggleUnsoldView() also blocks any attempt to flip it on,
// and the post-auth pass below force-clears stale state defensively.
(function(){
  const p=new URLSearchParams(window.location.search);
  if(p.get('showPast')==='true'&&$('fShowPast')) $('fShowPast').checked=true;
  const statusParam=p.get('status');
  if(statusParam&&$('fSoldTop')){
    if(statusParam==='unsold'){
      // Defer the activation until the tier resolves — only Pro users
      // get the unsold filter applied. window._userTier may not be set
      // yet at IIFE time, so we route through onSignIn's enforce step.
      window.__pendingUnsoldFromUrl = true;
    } else {
      $('fSoldTop').value=statusParam;
    }
  }
})();

// Run after every tier change to keep the unsold view honest. If the URL
// said ?status=unsold and the user turned out to be Pro, activate it
// here (now that the toggle's gate would pass). If they're not Pro and
// somehow the state got set (legacy localStorage, manual fiddle), wipe
// it and re-render so they don't see a sticky filter they can't disable.
function enforceUnsoldGating() {
  const isPro = window._userTier === 'premium';
  if (isPro && window.__pendingUnsoldFromUrl) {
    window.__pendingUnsoldFromUrl = false;
    if ($('fSoldTop')) $('fSoldTop').value = 'unsold';
    if ($('fShowPast')) $('fShowPast').checked = true;
    if ($('fSort')) $('fSort').value = 'days_unsold';
    _unsoldViewActive = true;
    $('unsoldToggle')?.classList.add('active');
    if (typeof renderLots === 'function') renderLots();
  } else if (!isPro && _unsoldViewActive) {
    _unsoldViewActive = false;
    $('unsoldToggle')?.classList.remove('active');
    if ($('fSoldTop')) $('fSoldTop').value = 'all';
    if (typeof hideUnsoldAlertBar === 'function') hideUnsoldAlertBar();
    if (typeof renderLots === 'function') renderLots();
  }
}

// Init
loadCalendar();
loadAllLots();
renderCuratorWidget();

// ═══════════════════════════════════════════════════════════════
// CURATOR WIDGET — "Today's top deals" homepage section
// ═══════════════════════════════════════════════════════════════
// Self-contained: fetches /api/curator/today and renders into #curatorWidget.
// Marked for future extraction once public/app.js is split.
// All user-supplied strings rendered via textContent / setAttribute — no
// innerHTML for dynamic data, no XSS surface.
async function renderCuratorWidget() {
  const container = document.getElementById('curatorWidget');
  if (!container) return;
  let data;
  try {
    const r = await fetch('/api/curator/today');
    if (!r.ok) return;
    data = await r.json();
  } catch (e) {
    return;
  }
  if (!data || !Array.isArray(data.picks) || data.picks.length === 0) return;

  // Build header
  const headEl = document.createElement('div');
  headEl.className = 'curator-head';
  const headH2 = document.createElement('h2');
  headH2.textContent = "Today's top deals";
  headEl.appendChild(headH2);
  const meta = document.createElement('div');
  meta.className = 'curator-meta';
  meta.textContent = `${data.picks.length} hand-picked, scored 7+/10`;
  if (data.isStale) {
    const tag = document.createElement('span');
    tag.className = 'curator-stale-tag';
    tag.textContent = "Yesterday's";
    meta.appendChild(tag);
  }
  headEl.appendChild(meta);

  // Build grid
  const grid = document.createElement('div');
  grid.className = 'curator-grid';
  for (const p of data.picks) {
    grid.appendChild(_buildCuratorCard(p));
  }

  // Build email signup
  const signup = _buildCuratorSignup();

  // Mount
  while (container.firstChild) container.removeChild(container.firstChild);
  container.appendChild(headEl);
  container.appendChild(grid);
  container.appendChild(signup);
  container.style.display = 'block';
}

function _buildCuratorCard(pick) {
  const lot = pick.lot || {};
  const card = document.createElement('a');
  card.className = 'curator-card';
  card.setAttribute('href', lot.url || '#');
  card.setAttribute('aria-label', `${pick.headline || lot.address || 'Auction lot'} — open analysis`);

  // Image area with rank + score
  const imgWrap = document.createElement('div');
  imgWrap.className = 'curator-card-img';
  if (lot.imageUrl) {
    const img = document.createElement('img');
    img.setAttribute('src', lot.imageUrl);
    img.setAttribute('alt', '');
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
    imgWrap.appendChild(img);
  }
  const rank = document.createElement('span');
  rank.className = 'curator-rank';
  rank.textContent = `#${pick.rank}`;
  imgWrap.appendChild(rank);
  if (lot.score != null) {
    const score = document.createElement('span');
    score.className = 'curator-score';
    score.textContent = `${Number(lot.score).toFixed(1)}`;
    imgWrap.appendChild(score);
  }
  card.appendChild(imgWrap);

  // Body
  const body = document.createElement('div');
  body.className = 'curator-card-body';

  const headline = document.createElement('div');
  headline.className = 'curator-card-headline';
  headline.textContent = pick.headline || lot.address || 'Auction lot';
  body.appendChild(headline);

  const price = document.createElement('div');
  price.className = 'curator-card-price';
  const priceText = lot.price ? `£${Number(lot.price).toLocaleString('en-GB')}` : (lot.priceText || 'Guide TBA');
  price.appendChild(document.createTextNode(priceText));
  if (lot.houseDisplay || lot.house) {
    const house = document.createElement('span');
    house.className = 'curator-card-house';
    house.textContent = ` · ${lot.houseDisplay || lot.house}`;
    price.appendChild(house);
  }
  body.appendChild(price);

  const hook = document.createElement('p');
  hook.className = 'curator-card-hook';
  hook.textContent = pick.hook || '';
  body.appendChild(hook);

  const cta = document.createElement('span');
  cta.className = 'curator-card-cta';
  cta.textContent = 'Read full analysis →';
  body.appendChild(cta);

  card.appendChild(body);
  return card;
}

function _buildCuratorSignup() {
  const wrap = document.createElement('div');
  wrap.className = 'curator-signup';

  const copy = document.createElement('div');
  copy.className = 'curator-signup-copy';
  const strong = document.createElement('strong');
  strong.textContent = 'Want this in your inbox at noon?';
  const span = document.createElement('span');
  span.textContent = 'One short email a day with the day’s top 8 lots. Free, unsubscribe anytime.';
  copy.appendChild(strong);
  copy.appendChild(span);
  wrap.appendChild(copy);

  const form = document.createElement('form');
  form.setAttribute('novalidate', 'true');

  const input = document.createElement('input');
  input.setAttribute('type', 'email');
  input.setAttribute('placeholder', 'you@example.com');
  input.setAttribute('aria-label', 'Email address');
  input.setAttribute('required', 'true');
  form.appendChild(input);

  const btn = document.createElement('button');
  btn.setAttribute('type', 'submit');
  btn.textContent = 'Get daily picks';
  form.appendChild(btn);

  const msg = document.createElement('div');
  msg.className = 'curator-signup-msg';
  msg.setAttribute('role', 'status');
  msg.setAttribute('aria-live', 'polite');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      msg.className = 'curator-signup-msg err';
      msg.textContent = 'Please enter a valid email.';
      return;
    }
    btn.disabled = true;
    msg.className = 'curator-signup-msg';
    msg.textContent = '';
    try {
      const r = await fetch('/api/digest/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, cadence: 'daily', source: 'curator_homepage' }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok) {
        msg.className = 'curator-signup-msg';
        msg.textContent = data.message || 'Subscribed.';
        input.value = '';
        if (typeof umami !== 'undefined' && umami.track) {
          try { umami.track('curator_signup', { source: 'homepage' }); } catch (e) {}
        }
      } else {
        msg.className = 'curator-signup-msg err';
        msg.textContent = data.error || 'Subscription failed. Try again.';
      }
    } catch (err) {
      msg.className = 'curator-signup-msg err';
      msg.textContent = 'Network error. Try again.';
    } finally {
      btn.disabled = false;
    }
  });

  wrap.appendChild(form);
  wrap.appendChild(msg);
  return wrap;
}
let _searchDebounce;
function debouncedSearch(){
  clearTimeout(_searchDebounce);
  _searchDebounce=setTimeout(()=>{ handleSearch(); },300);
}
$('smartQuery').addEventListener('input',()=>{
  $('mainBtn').textContent=$('smartQuery').value.trim()?'AI Search':'Browse';
});
$('smartQuery').addEventListener('keydown',(e)=>{
  if(e.key==='Enter'){e.preventDefault();hideSuggestions();debouncedSearch();}
});

// ── AI search suggestions & rotating placeholder ──
const AI_SUGGESTIONS=[
  {q:'3 bed houses under 100k in the North West',tag:'Location'},
  {q:'Freehold blocks of flats I could title split',tag:'Strategy'},
  {q:'Vacant properties that need refurbishment',tag:'Condition'},
  {q:'High yield BTL under 150k',tag:'Investment'},
  {q:'Repossessions and receivership lots',tag:'Motivated'},
  {q:'Commercial properties with conversion potential',tag:'Development'},
  {q:'Properties near Manchester with EPC D or worse',tag:'Value-add'},
  {q:'Lots with no price listed that auction this week',tag:'Timing'},
  {q:'Land with planning permission under 200k',tag:'Development'},
  {q:'Executor sales — probate properties under 120k',tag:'Motivated'},
];
const PLACEHOLDER_LINES=[
  'Try: "3 bed houses under 100k in the North West"',
  'Try: "Freehold blocks I could title split"',
  'Try: "Vacant refurb projects near Leeds"',
  'Try: "High yield BTL under 150k"',
  'Try: "Repossessions auctioning this week"',
  'Search by address, postcode, or ask AI anything...',
];
let _phIdx=0,_phTimer=null;
function rotatePlaceholder(){
  const el=$('smartQuery');
  if(!el||el.value.trim()||document.activeElement===el) return;
  _phIdx=(_phIdx+1)%PLACEHOLDER_LINES.length;
  el.setAttribute('placeholder',PLACEHOLDER_LINES[_phIdx]);
}
_phTimer=setInterval(rotatePlaceholder,4000);

function showSuggestions(){
  const q=$('smartQuery').value.trim().toLowerCase();
  if(q.length>20) return; // user is typing a real query, don't show
  const suggest=$('aiSuggest');
  const list=$('aiSuggestList');
  // Filter suggestions matching partial input
  const matches=q?AI_SUGGESTIONS.filter(s=>s.q.toLowerCase().includes(q)||s.tag.toLowerCase().includes(q)):AI_SUGGESTIONS;
  const show=matches.slice(0,5);
  if(!show.length){suggest.classList.remove('open');return}
  list.innerHTML=show.map(s=>
    '<div class="ai-suggest-item" onmousedown="event.preventDefault();pickSuggestion(\''+s.q.replace(/'/g,"\\'")+'\')">' +
    '<svg class="ai-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z"/></svg>' +
    '<span class="ai-q">'+s.q+'</span>' +
    '<span class="ai-tag">'+s.tag+'</span>' +
    '</div>'
  ).join('');
  suggest.classList.add('open');
}
function hideSuggestions(){$('aiSuggest').classList.remove('open')}
function updateSuggestions(){
  const q=$('smartQuery').value.trim();
  if(!q){showSuggestions();return}
  if(q.length>20){hideSuggestions();return}
  showSuggestions();
}
function pickSuggestion(q){
  hideSuggestions();
  $('smartQuery').value=q;
  $('mainBtn').textContent='AI Search';
  handleSearch();
}
// Close suggestions on outside click
document.addEventListener('click',(e)=>{
  if(!$('aiSuggest').contains(e.target)&&e.target!==$('smartQuery')) hideSuggestions();
});
// Also close on blur with delay (so click on suggestion registers)
$('smartQuery').addEventListener('blur',()=>setTimeout(hideSuggestions,200));

// ═══════════════════════════════
// EMAIL CAPTURE FORM
// ═══════════════════════════════
function submitEmailCapture(e) {
  e.preventDefault();
  const form = $('ecForm');
  const btn = $('ecSubmitBtn');
  const errEl = $('ecError');
  const successEl = $('ecSuccess');
  const name = form.name.value.trim();
  const email = form.email.value.trim();

  errEl.style.display = 'none';
  if (!name || !email) { errEl.textContent = 'Please fill in both fields.'; errEl.style.display = 'block'; return false; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { errEl.textContent = 'Please enter a valid email.'; errEl.style.display = 'block'; return false; }

  btn.disabled = true;
  btn.textContent = 'Subscribing...';

  fetch('/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, source: 'landing-page', consent: true })
  })
  .then(r => { if(!r.ok) return r.json().then(d=>{throw new Error(d.error||'Something went wrong')}).catch(()=>{throw new Error('Something went wrong')}); return r.json().then(d=>({ok:true,data:d})); })
  .then(({ ok, data }) => {
    if (!ok) throw new Error(data.error || 'Something went wrong');
    form.style.display = 'none';
    successEl.style.display = 'block';
    document.querySelector('.ec-note').style.display = 'none';
    if (typeof umami !== 'undefined') umami.track('lead_submit', { source: 'landing-page' });
  })
  .catch(err => {
    errEl.textContent = err.message || 'Something went wrong. Please try again.';
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Subscribe';
  });
  return false;
}

// ═══════════════════════════════
// ADMIN DEBUG WIDGET v5 — minimal
// Win+Shift+S → describe → save & copy path
// ═══════════════════════════════
(function initDebugWidget() {
  const ADMIN_EMAIL = 'simon.deeming@gmail.com';
  const DL_PATH = 'C:\\Users\\SimonDeeming\\Downloads\\';
  let _imgDataUrl = null;

  function boot() {
    if (!currentUser || (currentUser.email || '').toLowerCase() !== ADMIN_EMAIL) return;
    if (document.getElementById('debugWidget')) return;

    const fab = document.createElement('button');
    fab.id = 'debugWidget';
    fab.innerHTML = '&#x1F41B;';
    fab.title = 'Bug report';
    fab.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;width:48px;height:48px;border-radius:50%;border:2px solid var(--border);background:var(--white);font-size:1.4rem;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.12);transition:transform .15s';
    fab.onmouseenter = () => fab.style.transform = 'scale(1.1)';
    fab.onmouseleave = () => fab.style.transform = '';
    fab.onclick = openPanel;
    document.body.appendChild(fab);
  }

  function openPanel() {
    const existing = document.getElementById('debugPanel');
    if (existing) { existing.remove(); return; }
    _imgDataUrl = null;

    const panel = document.createElement('div');
    panel.id = 'debugPanel';
    panel.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:9999;width:340px;background:var(--white);border:1px solid var(--border);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.15);padding:16px;font-family:var(--font-main)';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px';
    header.innerHTML = '<b style="font-size:.9rem">Bug Report</b>';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u2715';
    closeBtn.style.cssText = 'background:none;border:none;font-size:1.1rem;cursor:pointer;color:var(--text3)';
    closeBtn.onclick = () => { panel.remove(); document.removeEventListener('paste', handlePaste); };
    header.appendChild(closeBtn);

    const info = document.createElement('div');
    info.style.cssText = 'font-size:.78rem;color:var(--text3);margin-bottom:10px;line-height:1.4';
    info.innerHTML = '1. <b>Win+Shift+S</b> to screenshot the issue<br>2. <b>Ctrl+V</b> here (or Upload)<br>3. Describe the bug, then <b>Save</b>';

    const desc = document.createElement('textarea');
    desc.id = 'debugDesc';
    desc.placeholder = 'What\u2019s the bug?';
    desc.style.cssText = 'width:100%;height:60px;border:1px solid var(--border);border-radius:8px;padding:8px;font-family:inherit;font-size:.85rem;resize:vertical;margin-bottom:8px;box-sizing:border-box';

    const preview = document.createElement('div');
    preview.id = 'debugPreview';
    preview.style.cssText = 'display:none;margin-bottom:8px;border:1px solid var(--border);border-radius:8px;overflow:hidden;max-height:180px';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save & Copy Path';
    saveBtn.style.cssText = 'flex:1;padding:10px;border:none;border-radius:8px;background:var(--green);color:white;font-weight:600;font-size:.85rem;cursor:pointer';
    saveBtn.onclick = doSave;

    const uploadLabel = document.createElement('label');
    uploadLabel.style.cssText = 'padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--cream);cursor:pointer;font-size:.82rem;font-weight:600;text-align:center;white-space:nowrap';
    uploadLabel.textContent = 'Upload';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    fileInput.onchange = function() {
      const f = this.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => setPreview(r.result);
      r.readAsDataURL(f);
    };
    uploadLabel.appendChild(fileInput);

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(uploadLabel);

    const status = document.createElement('div');
    status.id = 'debugStatus';
    status.style.cssText = 'font-size:.78rem;color:var(--text3);margin-top:8px;text-align:center';

    panel.appendChild(header);
    panel.appendChild(info);
    panel.appendChild(desc);
    panel.appendChild(preview);
    panel.appendChild(btnRow);
    panel.appendChild(status);
    document.body.appendChild(panel);

    document.addEventListener('paste', handlePaste);
    desc.focus();
  }

  function handlePaste(e) {
    if (!document.getElementById('debugPanel')) return;
    const items = (e.clipboardData || {}).items || [];
    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault();
        const blob = item.getAsFile();
        const r = new FileReader();
        r.onload = () => setPreview(r.result);
        r.readAsDataURL(blob);
        return;
      }
    }
  }

  function setPreview(dataUrl) {
    _imgDataUrl = dataUrl;
    const preview = document.getElementById('debugPreview');
    if (preview) {
      preview.style.display = '';
      preview.innerHTML = '';
      const img = document.createElement('img');
      img.src = dataUrl;
      img.style.cssText = 'width:100%;display:block';
      preview.appendChild(img);
    }
    const status = document.getElementById('debugStatus');
    if (status) status.textContent = 'Screenshot loaded.';
  }

  function doSave() {
    const status = document.getElementById('debugStatus');
    const descEl = document.getElementById('debugDesc');
    const desc = descEl ? descEl.value.trim() : '';
    if (!desc) { if (status) status.textContent = 'Please describe the bug.'; return; }
    if (!_imgDataUrl) { if (status) status.textContent = 'No screenshot — Win+Shift+S then Ctrl+V here.'; return; }
    if (status) status.textContent = 'Saving...';

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const bh = 50;
      canvas.width = img.width;
      canvas.height = img.height + bh;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#1a1714';
      ctx.fillRect(0, 0, canvas.width, bh);
      ctx.fillStyle = '#ff4444';
      ctx.font = 'bold ' + Math.max(14, Math.round(canvas.width / 50)) + 'px sans-serif';
      ctx.fillText('BUG: ' + desc, 10, bh / 2 + 5);
      ctx.fillStyle = '#999';
      ctx.font = Math.max(10, Math.round(canvas.width / 70)) + 'px sans-serif';
      ctx.fillText(location.href + '  ' + new Date().toLocaleString(), 10, bh - 6);
      ctx.drawImage(img, 0, bh);

      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = 'debug-' + ts + '.png';
      const filepath = DL_PATH + filename;

      canvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);

        navigator.clipboard.writeText(filepath).then(() => {
          if (status) status.innerHTML = '<span style="color:var(--green)">Saved! Path copied — Ctrl+V in Claude Code.</span>';
        }).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = filepath; document.body.appendChild(ta); ta.select();
          document.execCommand('copy'); ta.remove();
          if (status) status.innerHTML = '<span style="color:var(--green)">Saved! Path copied — Ctrl+V in Claude Code.</span>';
        });
        setTimeout(() => {
          document.removeEventListener('paste', handlePaste);
          document.getElementById('debugPanel')?.remove();
          _imgDataUrl = null;
        }, 3000);
      }, 'image/png');
    };
    img.src = _imgDataUrl;
  }

  // Restore scroll position after bfcache restore or page revisit
  window.addEventListener('pageshow', function(e) {
    const savedY = parseInt(sessionStorage.getItem('ab_scroll_y') || '0');
    if (savedY > 0) {
      // Defer slightly so render completes before scroll
      requestAnimationFrame(() => window.scrollTo({ top: savedY, behavior: 'instant' }));
    }
  });

  // ── Fix Edge/Chrome sleeping-tab image intervention ──
  // When a tab is backgrounded, Edge replaces lazy images with placeholders.
  // onerror handlers now set data-needsReload=1 instead of destroying the element.
  // On return, restore those images or force a full re-render if needed.
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) return;
    var grid = document.getElementById('lotsOut');
    if (!grid) return;
    // Restore any images that Edge/Chrome replaced while tab was backgrounded
    var broken = grid.querySelectorAll('img[data-needs-reload="1"]');
    broken.forEach(function(img) {
      img.removeAttribute('data-needs-reload');
      var src = img.getAttribute('src');
      if (src) { img.src = ''; img.src = src; }
    });
    // Never do a full re-render on tab return — image restore above handles it
  });

  // Boot when auth state changes
  const _origSignIn = onSignIn;
  window.onSignIn = function(session) {
    _origSignIn(session);
    setTimeout(boot, 500);
  };
  setTimeout(boot, 2000);
})();
