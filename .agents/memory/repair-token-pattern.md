---
name: Signed confirmation-token pattern for admin financial repairs
description: Reusable dry-run/apply token design for admin-only repair endpoints (FX resolution, raw-stock recalc, and future ones).
---

Admin-only "preview now / apply later" repair endpoints (raw-material FX rate
resolution, raw-stock landed-cost recalculation) use a shared, generic signed
token instead of a bare hash: base64url JSON payload + HMAC-SHA256 signature
keyed by `SESSION_SECRET`, with an `expiresAt` field. See
`server/services/factory/repairToken.ts` (`signRepairToken`/`verifyRepairToken`).

**Why:** a bare hash of a few fields can't carry enough state to detect
staleness or bind to the requesting user, and can't expire. A self-describing
signed payload lets the token embed exactly what each repair needs
(companyId, target id, new value, old stored value, old confirmed/version
state, requesting user, expiry) without a server-side token store.

**How to apply:** verification only proves the token is unforged and unexpired.
The caller must separately re-derive fresh DB state at apply time and compare
it against the token's embedded old-value/version fields — that's what
catches staleness. Critical subtlety: if the fresh state already matches the
requested target (i.e. a previous apply of this exact token already
succeeded), treat that as a safe idempotent replay, NOT staleness — only
reject as stale when the row differs from both the token's snapshot AND the
target state. Getting this exception wrong makes idempotent replay
indistinguishable from real staleness and breaks legitimate retries.
