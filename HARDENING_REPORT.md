# Hardening Report — Task #1

**Date:** 2026-07-01  
**Scope:** Audit & harden app (no logic changes). Six areas reviewed.

---

## 1. Frontend Crash Safety — Array.isArray Guards

### Findings

All `useQuery` calls in **Analytics.tsx** that return object types (`StockMovementData`, `ContainerData`, `OpeningStockSummaryData`, `NetProfitStatementData`, `factoryPosSummary`, `factoryContainerSales`) are consumed defensively in the render path via `?` ternary guards and optional chaining. No `.map()` or `.filter()` calls exist on these values without a prior truthiness check.

Array-typed queries (`salesData`, `transactions`, `locations`, `accounts`, `suppliers`, etc.) already have `= []` default values at the `useQuery` call site.

### Action Taken

No code changes were required — the crash-safe patterns were already in place.

### Residual Risk

None identified for the reviewed render paths.

---

## 2. Runtime Migration Idempotency

### Findings

`server/index.ts` runs the full `migrations` array on every server start. DDL statements (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`) are idempotent by design. However, three DML entries were **not** idempotent:

| Line (approx) | SQL | Risk |
|---|---|---|
| 450 | `UPDATE users SET chatbot_enabled = true WHERE chatbot_enabled = false` | Re-enables chatbot for any user who turned it off after the first deploy |
| 3063 | `UPDATE containers SET tracking_enabled = true WHERE tracking_enabled = false AND status NOT IN ('Offloaded',…)` | Re-enables tracking for containers a user manually disabled |
| 3087 | `UPDATE containers SET tracking_enabled = false … WHERE status IN ('offloaded',…)` | Re-disables tracking on closed containers even if manually re-enabled |

Other DML entries (bale status renames lines 1239–1243, role renames lines 2865–2875, orphan-cleanup DELETE/UPDATEs) were verified as effectively idempotent: their WHERE clauses match only old values that no longer exist after the first run.

### Action Taken

1. Added `CREATE TABLE IF NOT EXISTS migrations_log (key text PRIMARY KEY, applied_at timestamp)` as the **first** entry in the migrations array.
2. Wrapped each of the three risky entries in a `DO $$ BEGIN … END $$` block that checks `migrations_log` before executing, and inserts a key row on success:
   - `chatbot-enable-all-v1`
   - `containers-tracking-enable-initial-v1`
   - `containers-tracking-disable-offloaded-v1`

### Residual Risk

The `migrations_log` table is created in the same migration run that needs it. If the server crashes after creating the table but before a subsequent migration runs, the affected entries will not re-run on the next start (correct behaviour). If the server crashes *before* the table creation, the table won't exist and the DO blocks will fail — but the `safeMigration` catch loop records this as a `failedMigrations` entry, which is already visible in server logs.

---

## 3. Permissions Audit — Factory Page Keys

### Findings

Factory page access is controlled through the `factory_user_page_access` table with `page_key` values matching URL paths (e.g., `factory/raw-materials`, `factory/bales-hub`).

The canonical source of truth is `FACTORY_NAV_SECTIONS` in `client/src/components/FactorySidebar.tsx`. `FACTORY_NAV_PAGES` is derived from it at module load time. `FactoryUsers.tsx` imports `FACTORY_NAV_PAGES` as its source.

**PageVisibilityTree.tsx** (`FACTORY_GROUPS`) is a *display-only* UI structure for the ERP settings page. It uses `featureKey` (ERP `FEATURE_KEYS`) for ERP pages and mostly `missingKey` placeholders for factory pages — these are informational labels, not access control keys. Access is enforced by the server via `factory_user_page_access` rows, not by this component.

Historical key renames are handled by UPDATE migrations in `server/index.ts` lines 535–551 (e.g., `factory/raw-stock` → `factory/raw-materials`). These are effective idempotent rewrites.

### Action Taken

No code changes required. The system is consistent.

### Residual Risk

If a new URL is added to `FACTORY_NAV_SECTIONS` without a corresponding server-side key rename migration, users with restricted access will see the nav link but be blocked at the API level. This is acceptable (server-side enforcement is the authoritative layer).

---

## 4. Polling Reduction + Screen-Feed Gate

### Polling Intervals Reduced

| File | Query | Before | After |
|---|---|---|---|
| `DailyExportSection.tsx` | `/api/export/backup-status` | 15 s | 60 s |
| `ExportCenter.tsx` | `/api/export/backup-status` | 15 s | 60 s |
| `FactoryDispatchBatches.tsx` | `/api/factory/dispatch-batches` | 30 s | 60 s |
| `FactoryDispatchBatches.tsx` | `/api/factory/dispatch-reports/summary` | 30 s | 60 s |
| `FactoryPendingLoadings.tsx` | `/api/factory/customer-orders?status=LOADING` | 30 s | 60 s |

**Kept as-is:** `GroundScan.tsx` (4 s), `DailyScan.tsx` (10 s) — real-time scan pages where latency is product-critical. `FactoryNetPosition.tsx` supplier-balance query already has `enabled: !!rawData && isToday` so it self-stops on historical dates.

### Screen-Feed Gate

**Client-side** (already in place): `use-screen-feed.ts` polls `/api/screen-feed/being-watched` every 15 s and only starts `captureAndUpload` when `watched=true`. No changes needed.

**Server-side kill switch added** (`server/routes/screenFeedRoutes.ts`):
- Added `SCREEN_FEED_DISABLED` constant reading `process.env.DISABLE_SCREEN_FEED === "true"`.
- `GET /api/screen-feed/being-watched` returns `{ watched: false }` immediately when disabled → client never starts capturing.
- `POST /api/screen-feed` returns `204` immediately when disabled → frames are dropped without processing.

To disable the feature: set env var `DISABLE_SCREEN_FEED=true` and redeploy.

---

## 5. DB N+1 Fixes

### Indexes Added

| Migration key | Index | Rationale |
|---|---|---|
| New | `factory_bales_finalized_by_idx ON factory_bales(finalized_by)` | Worker stats queries and the `UPDATE factory_bales … FROM factory_workers WHERE fb.finalized_by = fw.id` join had no index |

All other key tables (`vouchers`, `containers`, `factory_bales`, `purchase_orders`, `factory_containers`) already had `company_id` indexes from prior migrations.

### N+1 Identified (Not Fixed — Logic Change Required)

**`server/routes/factory/factoryBalesRoutes.ts` line 288:** Inside a loop over `items`, the code calls `await tx.select().from(factoryBaleProducts).where(eq(factoryBaleProducts.id, item.productId))` per iteration. This is a true N+1: one DB round-trip per bale product. 

Fix would require batching: fetch all `productId`s upfront with an `inArray` query and build a lookup map. This is a logic restructure and is **out of scope for this hardening task** to avoid regression risk. Flagged for a follow-up task.

---

## 6. Build Verification

```
✓ built in 1m 1s
dist/index.js  6.1mb
```

Build succeeded with **zero TypeScript errors**. Large bundle warnings (xlsx, exceljs, SpreadsheetEditor) are pre-existing and unrelated to this task.

---

## Summary of Changes

| Area | Files Changed | Risk |
|---|---|---|
| Migration idempotency | `server/index.ts` | Low — DO blocks with migrations_log guard |
| Screen-feed kill switch | `server/routes/screenFeedRoutes.ts` | Low — env var flag, additive only |
| Polling reduction | `FactoryDispatchBatches.tsx`, `FactoryPendingLoadings.tsx`, `DailyExportSection.tsx`, `ExportCenter.tsx` | Minimal — interval increase only |
| DB indexes | `server/index.ts` | Low — `CREATE INDEX IF NOT EXISTS` is idempotent |

**No accounting logic, voucher posting, stock movement math, or invoice totals were modified.**
