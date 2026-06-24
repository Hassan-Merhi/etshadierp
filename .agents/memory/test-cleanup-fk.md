---
name: Test cleanup FK order
description: Correct deletion order for cleanupTestData to avoid FK constraint violations on audit_log and login_history.
---

## Rule
`cleanupTestData` must clear `audit_log` and `login_history` (by `company_id`) before deleting the company row. `login_history` has **two** FK columns — `user_id` and `company_id` — so deleting by user alone is insufficient; must also delete by company.

**Why:** `audit_log.company_id` and `login_history.company_id` both have FK constraints referencing `companies.id`. Any login or audit event for the test company blocks deletion until these rows are removed first.

**How to apply:** In `tests/setup.ts` `cleanupTestData`, add these two raw pool queries at the top of the per-company cleanup loop, before any Drizzle deletes:

```ts
await pool.query("DELETE FROM audit_log WHERE company_id = $1", [company.id]);
await pool.query("DELETE FROM login_history WHERE company_id = $1", [company.id]);
```

Then after companies are deleted, clean users by deleting login_history by user_id before the user row:

```ts
await pool.query("DELETE FROM login_history WHERE user_id = $1", [u.id]);
await db.delete(schema.users).where(eq(schema.users.id, u.id));
```
