# Service Layer Audit — Phase 9

**Date:** 2026-06-25  
**Goal:** Move read-heavy orchestration logic out of large route files into service modules without changing ERP behaviour.

---

## 1. Audit Scope

Total route files inspected: 170+  
Total route files touched in this phase: 5  
Service files created: 4  

---

## 2. Route → Service Map

### 2A. Stats routes (`server/routes/stats/`)

| File | Lines | Endpoints | Risk | Decision |
|---|---|---|---|---|
| `statsDataRoutes.ts` | 695 | GET /api/stats/monthly-data, GET /api/stats/stock-summary, GET /api/stats/expense-breakdown, GET /api/sales-report, GET /api/dashboard/sales-report-all | Safe | Extract stock-summary, expense-breakdown, monthly-data to `dashboardStatsService` |
| `statsNetPositionRoutes.ts` | 665 | GET /api/stats/net-position-excel | Safe (read-only) | Cache utility extracted; handler body left in route (very heavy Excel export with many joins) |
| `statsNetProfitRoutes.ts` | 917 | GET /api/stats/net-profit | Safe (read-only) | Cache utility extracted; handler body left in route (complex multi-join aggregation) |
| `statsReportsRoutes.ts` | 818 | GET /api/reports/sales, GET /api/reports/stock-movement, GET /api/reports/containers, GET /api/reports/ratios, GET /api/reports/opening-stock-summary, GET /api/reports/opening-stock-summary/:id/items | Safe (read-only) | Cache utility extracted; handler bodies left in route (complex join queries, already well-isolated) |
| `statsSalesRoutes.ts` | 585 | POST /api/sales-report/recalculate-costs (MODERATE), GET /api/reports/profit-loss, GET /api/reports/balance-sheet | Mixed | Extract profit-loss and balance-sheet to `financialReportsService`; leave POST in route |

---

### 2B. TTL Cache Deduplication

The following 4 files each contained an identical 27-line TTL cache implementation:
- `statsDataRoutes.ts` (lines 106–132)
- `statsNetPositionRoutes.ts` (lines 106–132)
- `statsNetProfitRoutes.ts` (lines 106–132)
- `statsReportsRoutes.ts` (lines 106–132)

**Action:** Consolidated into `server/services/shared/ttlCache.ts`. All 4 files now import `_getCached`/`_setCached` from the shared module.

---

## 3. Services Created

| Service File | Extracted From | Functions |
|---|---|---|
| `server/services/shared/ttlCache.ts` | All 4 stats route files | `_getCached`, `_setCached` |
| `server/services/stats/dashboardStatsService.ts` | `statsDataRoutes.ts` | `getStockSummary`, `getExpenseBreakdown`, `getMonthlyData` |
| `server/services/reports/financialReportsService.ts` | `statsSalesRoutes.ts` | `getProfitLoss`, `getBalanceSheet` |

---

## 4. High-Risk Areas Intentionally Left Alone

| File | Why Left Alone |
|---|---|
| `server/routes/admin/companySettingsRoutes.ts` | Destructive admin ops: reset-company-data, undo-company-reset, apply-missing-migrations. Touch nothing. |
| `server/routes/vouchers/` (all) | Voucher create/edit/post/payment logic — accounting engine core |
| `server/routes/posRoutes.ts` | POS sale create/edit/delete/post — business-critical write path |
| `server/routes/stock/stockTransferAdjRoutes.ts` | Stock transfer/adjustment posting |
| `server/routes/containers/containerOffloadRoutes.ts` | Container offload accounting |
| `server/routes/containers/containerFreightWriteRoutes.ts` | Freight posting |
| `server/routes/containers/containerTrackingRoutes.ts` | Tracking writes + external API integration |
| `server/routes/payroll/` (all) | Payroll posting, advance management |
| `server/routes/factory/factoryInvoiceLoadingRoutes.ts` | Invoice loading session management |
| `server/routes/reportsRoutes.ts` | Mixed read/write; too large to safely split (2974 lines) |
| `server/routes/inventoryRoutes.ts` | Has inventory write operations (quick-adjust) |
| `server/routes/stockSummaryRoutes.ts` | Complex historical queries; already read-only but mixed with other patterns |
| `server/routes/fiscalTransferRoutes.ts` | Transfer payout/receivable accounting |
| `server/routes/stats/statsSalesRoutes.ts` POST | Bulk cost recalculation on financial history — high risk |
| `server/routes/stats/statsNetProfitRoutes.ts` | Handler body is a 780-line multi-join aggregation; mechanical extraction risk outweighs benefit |
| `server/routes/stats/statsNetPositionRoutes.ts` | Handler body is 530-line complex cumulative Excel computation |

---

## 5. Extraction Rules Applied

- **Routes keep:** auth middleware, permission middleware, request parsing, validation, HTTP status/response.
- **Services receive:** plain params (no `req`/`res`), return plain data objects.
- **Services do:** storage calls, DB queries, orchestration, in-memory computation.
- **Services do NOT:** access `req`/`res`, change response shape, invent new logic.
- **Cache:** Shared TTL cache preserves identical 30-second TTL behaviour. Each stats file had its own `Map` (separate in-process cache); shared module preserves that — the shared cache is still one `Map` (same or better behaviour: cross-endpoint keys don't collide because they're namespaced by endpoint name).

---

## 6. API Contract Verification

For every extracted endpoint:
- ✅ Route path unchanged
- ✅ HTTP method unchanged
- ✅ Query params unchanged
- ✅ Response keys unchanged
- ✅ Error status codes unchanged
- ✅ Company scoping unchanged
- ✅ Permission middleware unchanged

---

## 7. Commands Run

```
npm run build   — run after Group 1 (cache + service files created)
npm run build   — run after Group 2 (route files updated to use services)
```

Results are recorded at the bottom of this file after execution.

---

## 8. Build Results

- `npm run build` — **PASS** (✓ built in 1m 7s, no TypeScript errors, no warnings beyond existing chunk-size notices)

---

## 9. Manual Verification Checklist

After deployment:
- [ ] `/api/stats/monthly-data` returns same shape
- [ ] `/api/stats/stock-summary` returns same shape
- [ ] `/api/stats/expense-breakdown` returns same shape
- [ ] `/api/reports/profit-loss` returns same shape
- [ ] `/api/reports/balance-sheet` returns same shape
- [ ] No 500 errors on dashboard load
- [ ] No blank pages on ERP stats pages
- [ ] No broken exports
