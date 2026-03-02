# Appendix: Bridging Finance Domain Knowledge

**Purpose:** This appendix provides the Auction project (and specifically bridgematch-lite.html) with foundational bridging finance knowledge drawn from the full Bridgematch broker tool. Do NOT use this to change bridgematch-lite right now — it works. This exists so that future enhancements are grounded in correct domain logic.

---

## 1. How Bridging Finance Works (For Context)

A bridging loan is short-term secured lending (typically 3-24 months) used to buy property quickly — often at auction, in chain-break scenarios, or for refurbishment projects. The borrower pays it back by either selling the property or refinancing onto a long-term mortgage.

Key parameters of any bridge loan:
- **LTV (Loan-to-Value):** How much the lender will advance as a % of the property's value. Typically 65-80%.
- **Interest rate:** Charged monthly (e.g. 0.75% per month = 9% p.a.). Can be retained (deducted from loan upfront) or serviced (paid monthly).
- **Arrangement fee:** Typically 1-2.5% of the gross loan, deducted from the advance on day 1.
- **Exit fee:** Some lenders charge 1-2% when the loan is repaid. Others don't.
- **Proc fee:** The broker's commission. Higher = better for the broker. This is NOT a cost to the borrower — the borrower's arrangement fee is the same regardless.
- **Loan term:** The agreed duration. Lenders have minimum interest periods (e.g. 3 months minimum even if you repay in 1 month).

---

## 2. Gross vs Net LTV — The Critical Distinction

Most lenders quote **gross LTV** — this is the headline figure. But the borrower doesn't receive the gross amount. Fees and retained interest are deducted upfront, so the **net advance** (what actually hits the borrower's solicitor account) is lower.

### The Formula
```
Net LTV ≈ Gross LTV × (1 - total_deduction%)

Where total_deduction% = arrangement_fee% + (monthly_rate × months_retained)
```

### Example
- Gross LTV: 75%
- Property value: £400,000
- Gross loan: £300,000
- Arrangement fee: 2% = £6,000
- Interest: 0.85% pm × 12 months retained = 10.2% = £30,600
- Net advance: £300,000 - £6,000 - £30,600 = **£263,400**
- Effective net LTV: **65.9%** (not 75%)

### Why This Matters for bridgematch-lite
If the investor tool only shows gross LTV, users will overestimate how much cash they'll receive. The full broker tool calculates estimated net LTV per lender using their specific rates, fees, and minimum interest periods. Bridgematch-lite should eventually do the same, or at minimum show a warning that net advance will be lower than headline LTV.

### Net Lenders
Some lenders quote net LTV directly — what they quote is what the borrower gets. When comparing lenders, a "70% net" lender may give MORE money than a "75% gross" lender.

---

## 3. Valuation Basis — Hidden Impact on Effective Advance

Lenders don't all value property the same way. The valuation basis dramatically affects how much money the borrower actually gets, even at the same headline LTV:

| Basis | Meaning | Typical Discount from OMV |
|---|---|---|
| **Market Value (OMV)** | Open market value — best for borrower | 0% (baseline) |
| **180-day value** | Forced sale within 6 months | 5-10% below OMV |
| **90-day value** | Forced sale within 3 months | 10-20% below OMV |
| **Conditional OMV** | Normally OMV but may revert to 180/90-day | Variable |

### Example Impact
Property OMV: £450,000
- 75% LTV on OMV = **£337,500** loan
- 75% LTV on 180-day (£405k) = **£303,750** loan
- Difference: **£33,750 less cash** at the same headline LTV

### Why This Matters for bridgematch-lite
When showing matched lenders, always pair LTV with valuation basis. "75% gross (on 180-day)" is materially different from "75% gross (on MV)". A lender at 75% on MV often gives MORE money than a lender at 80% on 180-day.

---

## 4. LTGDV — The Refurbishment Constraint

LTGDV (Loan-to-Gross-Development-Value) is the ratio of the lender's **total exposure** to the property's **end value after works**. This is the key constraint on refurb deals.

### The Correct LTGDV Formula (Per-Lender)
```
LTGDV = (Day-1 Loan + Works Funded by Lender + Rolled-Up Interest + Fees) / GDV × 100
```

**CRITICAL: This must be calculated per-lender**, not as a single project-level metric, because each lender's exposure differs based on their:
- Day-1 advance rate
- Interest rate
- Loan term
- Whether they fund works (and how)

### The Bug That Was Fixed
Previously the tool calculated LTGDV as `(purchase_price + works) / GDV`. This was fundamentally wrong because:
1. It used purchase price instead of the loan amount (the lender's actual exposure)
2. It ignored rolled-up interest
3. It ignored arrangement fees
4. It was the same for every lender when it should differ

The fix changed matching from 10 lenders to 32 lenders for the same test scenario — the old method was unfairly excluding lenders.

### Interest Accrual in LTGDV
```python
# Interest on day-1 loan for full term
interest_on_day1 = day1_loan × (monthly_rate / 100) × loan_term_months

# Interest on works — assume average drawn at midpoint of term
interest_on_works = works_funded × (monthly_rate / 100) × (loan_term_months / 2)

# Arrangement fee on total facility
arrangement_fee = (day1_loan + works_funded + interest) × (fee% / 100)

# Total exposure
total = day1_loan + works_funded + interest_on_day1 + interest_on_works + arrangement_fee
```

### Typical LTGDV Caps
- Light works: 65-75% LTGDV
- Medium works: 65-70% LTGDV
- Heavy works: 60-70% LTGDV
- Very heavy / development: 55-65% LTGDV

If a lender's calculated LTGDV exceeds their cap, their effective day-1 LTV is constrained downward even if their headline LTV is higher.

---

## 5. The Three Funding Models

How lenders handle refurbishment costs. This is critical for matching and for showing investors what cash they'll need.

### Model 1: Upfront / Enhanced Day-1
**How it works:** Lender includes works costs in the day-1 advance. Borrower gets a larger cheque on completion.
**Example:** MS Lending at 85% gross, Mint at 90% gross — these headline figures INCLUDE works.
**Cash needed:** Less — the loan covers purchase + works (minus fees/interest).
**Best for:** Investors with limited cash reserves.

### Model 2: In Arrears / Staged / Tranched
**How it works:** Lender advances the purchase loan on day 1, then releases works funding in stages as refurbishment progresses. A Quantity Surveyor (QS) inspects after each stage before the next tranche is released.
**Example:** Octane at 75% net day-one, plus works funded in arrears.
**Cash needed:** More — borrower must fund each works stage upfront, then get reimbursed after QS sign-off. There's a cash flow gap between spending on works and receiving the next tranche.
**Best for:** Experienced developers with cash reserves.
**Key detail:** Minimum drawdown per tranche varies by lender (some require £5k+, others no minimum).

### Model 3: Self-Fund
**How it works:** Lender provides the purchase loan only. They know works are happening but don't fund them at all.
**Cash needed:** Most — borrower funds all refurbishment from their own pocket.
**Best for:** Very light cosmetic works where the cost is minor relative to the deal.

### "Multiple Models" Lenders
Some lenders offer different models for different scenarios (e.g. upfront for light works, arrears for heavy). In matching, treat these as upfront since that's the best outcome for the borrower.

### Why This Matters for bridgematch-lite
The funding model determines how much cash the investor needs beyond the loan. Showing "75% LTV" without explaining whether works are funded upfront, in arrears, or not at all gives an incomplete picture. The "cash needed on day 1" calculation differs dramatically:
- **Upfront:** Cash needed = purchase price - net advance (works included in advance)
- **Arrears:** Cash needed = purchase price - net advance + first works stage
- **Self-fund:** Cash needed = purchase price - net advance + ALL works costs

---

## 6. Works Intensity Bands

Lenders have different appetite and terms depending on how heavy the refurbishment is relative to the property's value:

| Band | Works Ratio (works ÷ property value) | Typical Appetite |
|---|---|---|
| **Light** | < 30% | Most refurb lenders will do this |
| **Medium** | 30-50% | Fewer lenders, may need experience |
| **Heavy** | 50-100% | Specialist lenders, experience required |
| **Very Heavy / Dev** | > 100% | Development finance territory, strict criteria |

Each band has its own:
- Max day-1 LTV (often lower for heavier works)
- Max LTGDV cap
- Minimum developer experience requirement
- Monitoring/QS requirements

### Calculating Works Ratio
```
works_ratio = (cost_of_works / current_property_value) × 100
```

This is calculated from the auction lot's data: if purchase price is £100k and estimated works are £40k, the works ratio is 40% → Medium band.

---

## 7. Knockout Rules (What Disqualifies a Lender)

The matching engine applies these hard filters before showing any results:

| Check | Rule |
|---|---|
| Loan below minimum | lender.min_loan > deal.loan_amount → EXCLUDE |
| Loan above maximum | lender.max_loan < deal.loan_amount → EXCLUDE |
| LTV exceeded | calculated_ltv > lender.max_ltv for property type → EXCLUDE |
| LTGDV exceeded | estimated_ltgdv > lender.ltgdv_cap for intensity band → EXCLUDE |
| Geography excluded | deal.region in lender.geo_exclusions → EXCLUDE |
| Property type unavailable | lender's LTV column for type = "not available" → EXCLUDE |
| Entity not accepted | lender doesn't accept individual/SPV/trading co → EXCLUDE |
| Regulated mismatch | deal is regulated & lender doesn't do regulated → EXCLUDE |
| Works too heavy | deal intensity band not offered by lender → EXCLUDE |
| Appetite = 0 | lender has zero appetite for the scenario (e.g. auction) → EXCLUDE |

---

## 8. Deal Appetite Scoring

Each lender has appetite scores (0-3) across 15 scenarios:

| Score | Meaning |
|---|---|
| 0 | Won't do it / exclude |
| 1 | Will consider reluctantly |
| 2 | Comfortable |
| 3 | Actively wants this business |

Relevant scenarios for auction lots include:
- `appetite_auction_purchases` — critical for this tool
- `appetite_hmo_conversions`
- `appetite_commercial_to_resi`
- `appetite_properties_in_probate` (executor/probate lots)
- `appetite_fire_flood_damaged`
- `appetite_subsidence_repairs`
- `appetite_sitting_tenant_purchases`

### Why This Matters for bridgematch-lite
When scoring auction lots for fundability, a lot flagged as "executor/probate" should boost the match count for lenders with appetite_probate ≥ 2. A lot with sitting tenants should filter to only lenders with appetite_sitting_tenant > 0. The scoring system in the auction tool maps directly to these appetite columns.

---

## 9. Lender Ranking Logic

When multiple lenders match, the broker tool ranks by:
1. **Deal appetite** (higher = better fit for this specific deal type)
2. **Interest rate** (lower = cheaper for borrower)
3. **Valuation basis** (MV > 180-day > 90-day)
4. **LTV headroom** (more headroom = less risk of surveyor down-val killing the deal)
5. **Proc fee** (higher = more broker income — neutral for investor tool)
6. **Speed** (dual legal rep, AVM available, low min term = faster completion)

For the investor tool, proc fee ranking should be dropped (investors don't care about broker commission). Speed may be more important for auction purchases with 28-day completion deadlines.

---

## 10. Property Type LTV Columns

Different property types have different max LTV columns in the lender database:

- Standard residential (1st charge, unregulated)
- Standard residential (regulated)
- Semi-commercial
- Commercial
- HMO
- MUFB (Multi-Unit Freehold Block)
- Land with planning
- Land without planning
- 2nd charge

A lender might offer 75% on residential but only 65% on commercial, or not lend on land at all. The matching engine selects the correct column based on the deal's property type.

### Why This Matters for bridgematch-lite
Auction lots have a property type field. This must map correctly to the right LTV column when matching. If a lot is tagged as "commercial" but the tool checks the residential LTV column, it'll show incorrect matches.

---

## 11. Common Auction + Bridging Scenarios

These pairings from the ontology are especially relevant for auction lot analysis:

| Scenario | What to Check |
|---|---|
| **Auction + Refurb** | Most common. Need speed AND refurb capability. Prioritise dual legal rep, indemnity accepted, appetite_auction ≥ 2 |
| **Auction + 28-day deadline** | Speed is everything. Dual legal rep, AVM available, private/family fund lenders (faster than institutional) |
| **BMV purchase** | Some lenders have specific BMV LTV columns. Below-market-value purchases are common at auction |
| **Executor/probate** | Common at auction. Check appetite_probate. Usually straightforward for lenders |
| **Sitting tenant** | Red flag at auction. Many lenders won't touch it. Filter to appetite_sitting_tenant > 0 |
| **Non-standard construction** | Common in older auction stock. Some lenders exclude entirely |
| **Commercial to resi conversion** | Needs planning permission awareness. Check appetite_comm_to_resi |
