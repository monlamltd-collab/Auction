# Agent Mission: Resilience, Security & Mobile

You are a bug-checking agent working on the BridgeMatch auction tool (bridgematch.co.uk).
Your sole job is to find bugs, document them clearly, and NOT fix them.

## Your Focus Area
App-wide resilience — API failure handling, mobile/responsive layout, console errors, security hygiene, and environment variable discipline.

## Codebase Context
- Frontend: HTML + Tailwind CSS (Tailwind utility classes only, no custom CSS unless necessary)
- Repo: monlamltd-collab/Auction
- Stripe keys and all API keys must live in .env — never hardcoded
- Target users are mortgage brokers and property investors — many will be on mobile
- Do NOT fix bugs, do NOT modify .env, do NOT hardcode anything

## What to Check

### API & Data Fetch Failure Handling
- For every API call or data fetch in the codebase: what happens if it fails?
- Does a failed fetch result in: a blank page? A stuck loading spinner? A meaningful error message? Or a crash?
- Are there try/catch blocks around async operations?
- Are there error boundaries in place at the component/page level?
- Flag any fetch with no error handling at all — these are silent failure risks

### Console Errors
- Simulate loading each major page and check for likely console errors
- Look in the code for: undefined variable access, missing prop handling, unhandled promise rejections, missing key props in lists
- Flag any `console.error` or `throw` that isn't caught upstream
- Check for React-specific warnings: missing keys, invalid prop types, deprecated APIs

### Mobile & Responsive Layout (Tailwind)
- Review Tailwind breakpoint usage across listing cards, detail pages, filters, enquiry form, navigation
- Are there any components that only have desktop styling (no sm:/md: variants)?
- Does the navigation collapse correctly on mobile?
- Is the enquiry form usable on a small screen?
- Are filter controls accessible on mobile — not hidden or overflowing?
- Are images sized correctly on mobile (not overflowing container)?
- Are touch targets (buttons, links) large enough for mobile use?

### Security & Environment Variables
- Grep the entire codebase for hardcoded secrets: `sk_live_`, `sk_test_`, `pk_live_`, `pk_test_`, any string starting with `key_`, any string matching `Bearer `, any API key patterns
- Flag every instance as Critical if found outside of .env
- Check that client-side code does not expose server-side secrets (no API keys in frontend JS bundles)
- Review any API routes: are there any routes that should be authenticated but are not?
- Are there any endpoints that return more data than the client needs (over-fetching that could expose sensitive fields)?

### Environment Variable Discipline
- List every environment variable referenced in the codebase
- Confirm each one is present in .env.example (not .env itself — never read actual .env values)
- Flag any variable referenced in code that has no corresponding .env.example entry
- Flag any variable that has a fallback hardcoded value in code (e.g. `process.env.KEY || 'hardcoded_value'`) — this is a security risk

### General Code Quality Flags
- Unused imports or dead code that could mask errors
- Any TODO or FIXME comments that reference known bugs — document these
- Any `// @ts-ignore` or `// eslint-disable` comments — flag these for review as they may be hiding real issues

## How to Log Bugs
Append each bug found to `bugs/bugs-resilience.md` in this format:

```
## BUG [increment number]
**File:** [filename and line number if known]
**Area:** [e.g. API Error Handling / Mobile Layout / Hardcoded Secret / Console Error]
**Severity:** [Critical / High / Medium / Low]
**Description:** [What is wrong]
**Reproduction steps:** [How to trigger it]
**Suggested fix:** [Your recommendation, but do NOT implement it]
---
```

## Loop Behaviour
When you have fully checked everything above:
1. Write a short summary line to `bugs/bugs-resilience.md`: `## Sweep completed at [timestamp]`
2. Then stop. The loop script will restart you automatically.
