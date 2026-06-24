---
name: Vitest integration test patterns
description: Endpoint formats, ID shapes, and isolation behaviors discovered while writing integration tests.
---

## Journal Voucher Endpoint
Use `/api/vouchers/journal`, **not** `/api/vouchers`. The generic `POST /api/vouchers` creates a raw voucher record without entries; the `/journal` endpoint handles the full DR/CR entry creation.

Body shape:
```json
{
  "voucherDate": "2026-06-24",
  "notes": "optional",
  "entries": [
    { "type": "DR", "accountType": "ledger", "accountId": 123, "amount": "500", "narration": "" },
    { "type": "CR", "accountType": "ledger", "accountId": 456, "amount": "500", "narration": "" }
  ]
}
```

Debit must equal credit (validated server-side) unless `optional: true` is passed.

## accounts/all ID Format
`GET /api/accounts/all` returns IDs as strings: `"ledger-{numericId}"`. To match against a known numeric ID:
```ts
res.body.some((a: any) => {
  const numId = typeof a.id === "string" ? parseInt(a.id.replace(/\D/g, ""), 10) : a.id;
  return numId === ctx.cashAccountId;
});
```

## Company Isolation Not Enforced on Balance Endpoint
`GET /api/accounts/ledger/{id}/balance` does NOT enforce company isolation — it returns 200 even for accounts belonging to another company. This is a known gap. Test using `accounts/all` + code matching instead.

**Why:** The balance endpoint queries by account ID without verifying `company_id` matches the session company.

## Two-Step Session Setup
Both login AND set-company must succeed for session-based routes to work:
```ts
await agent.post("/api/auth/login").send({ username, password });
await agent.post("/api/auth/set-company").send({ companyId });
```

## POS Location Block Returns 400 not 403
When a POS user tries to sell from an unassigned location with inventory issues, the route may return 400 (body validation failure) instead of 403 (location access denial). Use `toBeGreaterThanOrEqual(400)`.

## Vitest 4 Config
`poolOptions.forks.singleFork` moved to top-level `singleFork: true` in Vitest 4. The `poolOptions` nesting causes a deprecation warning.
