# Agent Mission: Auth, Access Control & Stripe

You are a bug-checking agent working on the BridgeMatch auction tool (bridgematch.co.uk).
Your sole job is to find bugs, document them clearly, and NOT fix them.

## Your Focus Area
Authentication, free vs paid tier gating, "Coming Soon" label placement, and the Stripe subscription flow.

## Codebase Context
- Frontend: HTML + Tailwind CSS
- Stripe used for paid tier subscriptions (~£15/month)
- Free tier: basic listings, guide price, location, auction date, BridgeMatch enquiry form access
- Paid tier: full listing data, auction calendar, saved searches/alerts, deal analysis (when ready)
- Analytics features (yield, comparables, deal stacking) MUST be hidden behind "Coming Soon" — not shown to any tier yet
- Stripe keys MUST come from environment variables — never hardcoded
- Repo: monlamltd-collab/Auction
- Do NOT fix bugs, do NOT modify .env, do NOT hardcode anything

## What to Check

### Free vs Paid Gating
- Is the correct subset of data shown to unauthenticated / free tier users?
- Are any paid-tier fields leaking through to unauthenticated users (full address, auction pack links, legal docs)?
- Are "Coming Soon" labels correctly in place on: yield calculations, comparables, deal stacking tool, analytics dashboard?
- Does clicking any "Coming Soon" label do anything unexpected — errors, partial data showing through?
- Is there any way to access gated content by manipulating URLs directly?

### "Coming Soon" Label Audit
Walk every page that has analytics or deal analysis features and confirm:
- Yield calculation section → "Coming Soon" label present, no data visible
- Comparables section → "Coming Soon" label present, no data visible
- Deal stacking tool → "Coming Soon" label present, no data visible
- Analytics dashboard → fully hidden or "Coming Soon", no broken numbers visible
- Report any case where a "Coming Soon" section is also rendering partial broken data underneath

### Stripe Subscription Flow
- Does the checkout flow initiate correctly from the upgrade/subscribe button?
- Is the correct Stripe price/product ID being passed?
- Are Stripe keys loaded from environment variables (grep the codebase — flag any hardcoded sk_ or pk_ strings immediately as Critical)?
- Is the app correctly in test mode during development (look for test key prefixes: sk_test_, pk_test_)?
- After a test payment, does subscription status update correctly in the database/session?
- Is there a success page or confirmation shown after payment?
- Is there a cancel/failure path handled gracefully?

### Webhook Handling
- Is there a Stripe webhook endpoint defined?
- Does it validate the Stripe-Signature header before processing?
- What events does it handle — at minimum it should handle: checkout.session.completed, customer.subscription.deleted
- Is there error handling if the webhook payload is malformed?
- Are webhook secret keys coming from environment variables?

### Security Audit
- Grep for any hardcoded API keys, Stripe keys, or secrets in non-.env files — flag every instance as Critical
- Is sensitive borrower/user data ever rendered in client-side code or exposed in API responses beyond what's needed?
- Are there any unprotected API routes that should require auth?

## How to Log Bugs
Append each bug found to `bugs/bugs-auth-stripe.md` in this format:

```
## BUG [increment number]
**File:** [filename and line number if known]
**Area:** [e.g. Gating / Stripe Webhook / Hardcoded Secret / Coming Soon Label]
**Severity:** [Critical / High / Medium / Low]
**Description:** [What is wrong]
**Reproduction steps:** [How to trigger it]
**Suggested fix:** [Your recommendation, but do NOT implement it]
---
```

## Loop Behaviour
When you have fully checked everything above:
1. Write a short summary line to `bugs/bugs-auth-stripe.md`: `## Sweep completed at [timestamp]`
2. Then stop. The loop script will restart you automatically.
