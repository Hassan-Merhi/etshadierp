---
name: Company-wide "once per day" shared state must be backend-derived, atomic, and use a business date
description: Pattern for any "has X been set today for this company" popup/gate shared across users/devices (e.g. daily exchange rate) — avoids per-user reappearance bugs.
---

For a record that should be set once per (company, day) and visible to every user of that company (e.g. "Set Today's Exchange Rate" popup), three things must all hold or the popup/gate reappears inconsistently across users/devices:

1. **DB uniqueness + atomic upsert** on (companyId, date, ...other dimensions). Use `INSERT ... ON CONFLICT (...) DO UPDATE` (Drizzle: `.onConflictDoUpdate({ target: [...], set: {...} })`), not a plain insert, or concurrent saves from two users create duplicate rows and the "has rate" check can flip-flop depending on which row `ORDER BY ... LIMIT 1` picks.
2. **"Today" must be a server-computed company business date** (from the company's own configured timezone), never each request's client-sent date header/browser clock — otherwise two users in different timezones/devices disagree about what "today" is for the shared company record, and the row a save lands on doesn't match the row the check queries.
3. **Every UI path that can dismiss the prompt without saving is a bug** unless explicitly a true no-op skip. A "fallback/use-default" button that only closes the dialog without persisting means no row ever gets created, so the check keeps returning false for every user.

**Why:** exact bug class found in a daily exchange-rate popup: no unique constraint (race → duplicates), the popup's "Use Previous Rate" button only closed the dialog, and the save endpoint used the browser's local date instead of a company-timezone-derived date.

**How to apply:** when building/debugging any shared "once per period" company-wide UI gate, check for these three properties explicitly — dedupe migration + unique index, a `getCompanyBusinessDate(timezone)`-style helper reused by both the check and the save endpoints, and audit every dismiss/skip button for an actual persist call.
