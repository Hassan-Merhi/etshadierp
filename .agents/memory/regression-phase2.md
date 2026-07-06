---
name: Regression test suite — Phase 2
description: Smoke, import, report-accuracy, and WhatsApp trigger test patterns; endpoint quirks found during implementation.
---

# Regression Test Suite Phase 2 — Endpoint Gotchas

## Rules

**GET /api/inventory/movement** — requires `stockItemId` (not locationId alone). Without it → 400. `startDate`/`endDate` optional; omitting them returns empty months (200).

**GET /api/pos/shifts/history** — requires `?locationId=N`. Without it → 400 "Location ID is required".

**POST /api/pos-import/validate** — returns 200 on empty items array. Only returns 400 when `locationId` OR `items` field is absent entirely. Do not test "empty items = 400".

**POST /api/whatsapp/send-net-position** — in test env (no Green API credentials), returns 502 (Bad Gateway from upstream WhatsApp proxy). This is expected graceful failure, not a code crash. Assert `!= 500` not `< 500`.

**WhatsApp prompt assertion** — in a clean test DB with no WhatsApp settings configured, `res.body.whatsapp.prompt` must be exactly `false`. Testing only "is a boolean" is too weak.

**Report accuracy balance** — always use signed delta (`after - before`) not `Math.abs()`. The DR/CR polarity is part of what we're testing.

**Inline DB cleanup** — any test that inserts ad-hoc rows (cross-company isolation checks) must wrap the API call in `try/finally` so cleanup runs even on assertion failure.

**Why:** Each of these caused a test failure when naively asserting the "obvious" behavior. The endpoint behavior is correct in all cases; the tests needed to match reality.
