# Testing Guide

## Overview

The test suite is split into two tiers:

| Tier | Config | Environment | Scope |
|------|--------|-------------|-------|
| Backend / Node | `vitest.config.ts` | Node (`forks`) | API routes, accounting logic, DB integration, static analysis |
| Frontend / jsdom | `vitest.config.frontend.ts` | jsdom + React Testing Library | React component render tests |

---

## Running Tests

```bash
# Run both tiers (backend then frontend)
npm test

# Run only backend/node tests
npm run test:backend

# Run only frontend/jsdom render tests
npm run test:frontend

# Watch mode (backend)
npm run test:watch

# TypeScript type check (uses npx tsc --noEmit in practice; see TypeScript section below)
npx tsc --noEmit

# Production build
npm run build
```

---

## Backend Tests (`tests/*.test.ts`)

Run with **Vitest + Node** (`vitest.config.ts`). No browser or DOM.

| File | What it covers |
|------|----------------|
| `accounting.test.ts` | Voucher debit/credit balance, journal posting rules |
| `api-smoke.test.ts` | Every registered route returns a non-500 response (broken imports, missing routes, schema renames) |
| `excel-export.test.ts` | SP Sales Form ExcelJS workbook generation — date clearing, closing stock, opening stock, stale formula prevention |
| `excel-helper.test.ts` | ExcelJS/SheetJS compatibility shim (`excelHelper.ts`) |
| `factory-container-lifecycle.test.ts` | SP container create → offload → duty payment; ledger DR=CR; inventory cost-basis |
| `import-regression.test.ts` | Stock-transfer import CSV parsing |
| `inventory.test.ts` | Stock movement, location transfer, adjustInventory, reverseInventoryByExactValue |
| `permissions.test.ts` | Role-based access checks |
| `pos.test.ts` | POS shift open/close, sale recording, inventory deduction, voucher creation |
| `reports.test.ts` | Balance-sheet, profit-loss, net-position accuracy |
| `vouchers.test.ts` | Voucher CRUD with entries |
| `whatsapp-triggers.test.ts` | WhatsApp send-trigger conditions, field presence, settings API |
| `workflow.test.ts` | End-to-end multi-subsystem workflows (Phase 5) |
| `xlsx-export.test.ts` | Real XLSX buffer validation for factory and SP export endpoints |
| `xlsx-import.test.ts` | XLSX file import parsing |

### Static / Pure-logic Frontend Tests (also in backend tier)

These run in Node but test frontend code without DOM:

| File | What it covers |
|------|----------------|
| `frontend-lazy-imports.test.ts` | All `React.lazy()` paths in `lazyPages.ts` resolve to real files |
| `frontend-keyboard.test.ts` | `handlePaymentKeyDown` pure-function keyboard logic |
| `frontend-whatsapp.test.ts` | `resolveWhatsAppPrompt()` decision logic (no DOM) |
| `frontend-layout.test.ts` | Static source-code analysis: table layout classes, data-testid presence |

---

## Frontend Tests (`tests/ui/*.test.{ts,tsx}`)

Run with **Vitest + jsdom + @testing-library/react** (`vitest.config.frontend.ts`).

### Setup

- `tests/ui/setup.ts` — imports `@testing-library/jest-dom` matchers
- `tests/ui/helpers.tsx` — `renderWithProviders()` (wraps with `QueryClientProvider`) and `stubFetch()`

### Render Tests (`renders.test.tsx`)

Each test imports and renders a page component in jsdom, asserting it mounts without crashing.

| Component | File | Key mock |
|-----------|------|----------|
| Dashboard | `@/pages/Dashboard` | All context hooks, fetch |
| Accounts | `@/pages/Accounts` | All context hooks, fetch |
| JournalForm | `@/pages/vouchers/JournalForm` | All context hooks, fetch |
| POS | `@/pages/pos/POS` | LocationContext, CompanyContext, fetch |
| StockHub | `@/pages/StockHub` | wouter |
| InventoryHub | `@/pages/InventoryHub` | wouter |
| SalesReport | `@/pages/SalesReport` | DateFormat, Currency, fetch |
| Settings | `@/pages/Settings` | ConnectivityContext, fetch |
| FactoryWorkersHub | `@/pages/factory/FactoryWorkersHub` | All context hooks, fetch |

**Mock strategy:**
- `wouter` → stub `useLocation`, `useRoute`, `Link`
- All custom context hooks → return deterministic safe values
- `global.fetch` → stubbed to return `[]` (no real DB calls)
- `QueryClient` → `retry: false`, `staleTime: Infinity`

### WhatsApp Dialog Tests (`whatsapp-dialog.test.tsx`)

Tests the `AlertDialog` component that appears after a voucher save when `whatsapp.prompt = true`.
Uses a minimal harness component mirroring the dialog structure in `JournalForm.tsx`.

| Test | Assertion |
|------|-----------|
| `prompt = true` | `data-testid="dialog-whatsapp-prompt"` is in the document |
| `prompt = false` | dialog is not in the document |
| Click Skip | dialog closes (removed from DOM) |
| Click Send | `onSend` callback fires; dialog closes |
| Open imperatively | simulates API response returning `prompt=true` |

---

## Phase 5 — End-to-End Workflow Tests (`tests/workflow.test.ts`)

These tests verify that **multiple subsystems work correctly together** — not just that individual
endpoints return 200, but that the full data chain (API → DB writes → ledger → reports) is coherent.

### What `workflow.test.ts` protects

| Workflow | Assertions |
|----------|-----------|
| **POS sale** | Cash ledger balance increases by exact sale total; ledger transaction entry references sale voucher; delete reverses both inventory and ledger; voucher entries DR = CR in DB |
| **Payment / Receipt** | Payment shifts account balance; delete reverts it; receipt entries balanced; voucher retrievable by ID; payment appears in voucher list |
| **Journal edit + delete** | PATCH updates DB entries to new amount; delete sets `deletedAt`; voucher no longer active |
| **Reports (strengthened)** | Ledger balance API matches DB net (DR − CR); P&L `totalIncome` equals exact POS sale amount; balance-sheet cash account balance matches known receipt (exact value); no NaN strings anywhere |
| **Stock transfer** | Source inventory decreases; destination inventory increases; "Stock Transfer" voucher created; `inventoryApplied = true`; entries balanced; source = destination → 400; qty = 0 → 400 with no partial write |
| **Daybook** | Payment, receipt, and journal all appear in `GET /api/vouchers?startDate&endDate`; deleted voucher no longer returned as active |
| **Company isolation** | Voucher list excludes another company's voucher by exact DB ID; ledger balance ignores another company's 88888 entry; inventory endpoint excludes another company's stock item |

---

## Phase 6 — Final Hardening + Cleanup

### Test counts (as of Phase 6)

| Tier | Passed | Skipped | Todo | Failed |
|------|--------|---------|------|--------|
| Backend | 705 | 12 | 3 | 0 |
| Frontend | 14 | 0 | 0 | 0 |
| **Total** | **719** | **12** | **3** | **0** |

---

### Skipped Tests (`it.skip`) — all intentional, documented

**`tests/inventory.test.ts` — 6 skips (pre-existing production bugs)**

All six skips share a common root cause: `inventoryHelper.ts` does not enforce the invariant
"qty ≤ 0 → totalValue = 0, averageRate = 0". Until that production fix is made, these tests
cannot pass. Each skip has a detailed `// TODO (production fix needed): ...` comment in the file.

| Test | Root cause |
|------|-----------|
| `should handle sequential adjustments correctly` | In-memory session store drops company selection between rapid sequential requests in test mode |
| `should enforce qty <= 0 implies total_value = 0 and rate = 0 (Bug 4 fix)` | `adjustInventory` does not zero `totalValue`/`averageRate` when qty goes negative |
| `should subtract exact value and normalize invariants` | `reverseInventoryByExactValue` leaves non-zero `averageRate` when qty crosses zero |
| `should produce idempotent results across reverse/re-offload cycles` | Same `averageRate` normalization gap as Bug 4 |
| `should handle negative-stock offload reversal without value inflation` | Same root cause as Bug 4 |
| `should handle concurrent quick adjustments without lost updates` | (1) supertest serializes requests; (2) no `SELECT FOR UPDATE` in production inventory read-modify-write |

**Production fix path:** In `server/inventoryHelper.ts`, after any operation that leaves `qty ≤ 0`,
unconditionally set `totalValue = 0` and `averageRate = 0`. Then unskip all five Bug 4-related tests.

---

**`tests/factory-container-lifecycle.test.ts` — 3 `it.todo`**

All three are in "Phase 4: Reverse and re-offload" and share the same root causes as the
inventory skips above.

| Todo | Reason |
|------|--------|
| Reverse offload restores container + inventory | Same `averageRate` normalization bug |
| Re-offload idempotency | Same bug |
| Offload with partial charge lines | Requires `sp_prepaid_charges` rows in test setup (not yet seeded) |

---

**`tests/xlsx-export.test.ts` — 5 conditional `t.skip()`**

These skip when the test database has a different session company than expected. This happens
in shared-database environments where the session company is a production company that already
has bale data. The structural tests (XLSX magic bytes, sheet names, headers) still pass; only
the "seeded bale appears in export" data assertions are skipped.

Flag: `baleAppearsInSessionCompany` (computed in `beforeAll`). All skips have inline comments.

---

**`tests/excel-export.test.ts` — `ctx.skip()` guards (template-file dependency)**

The SP Sales Form template file (`server/templates/supplier_partner_sales_form_template.xlsx`)
must exist for these tests to run. If it is missing, the entire test group skips gracefully.
`maybeIt = templateExists ? it : it.skip.bind(it, "template missing")`.
These are **not unexplained skips** — they are infrastructure guards.

---

**`tests/frontend-layout.test.ts` and `tests/frontend-whatsapp.test.ts` — commented-out `// it.todo`**

These are commented-out notes about future work (lines 226–239 and 213–231 respectively).
They are not active test cases and do not appear in the skip count.

---

### Weak Assertions — Classification and Status

The term "weak assertion" refers to assertions like `toBeLessThan(500)` or `[200,300)` range
checks. Each category is classified and justified below.

#### Category A — Intentionally flexible (keep as-is, documented)

These use `toBeLessThan(500)` for APIs where non-500 non-200 responses are **valid** in the
test environment:

| File | Assertion | Reason |
|------|-----------|--------|
| `api-smoke.test.ts` WhatsApp settings | `toBeLessThan(500)` | Settings row may not exist in test DB → 404 is acceptable |
| `api-smoke.test.ts` WhatsApp recipients | `toBeLessThan(500)` | Same — recipients table may be empty (title updated to match) |
| `api-smoke.test.ts` Factory routes (5 tests) | `toBeLessThan(500)` | Factory company context not set up → 400/403 are correct non-crash responses |
| `whatsapp-triggers.test.ts` Settings API (5 tests) | `toBeLessThan(500)` | Same as smoke — settings may not exist in test DB |
| `whatsapp-triggers.test.ts` journal edit conditional | `toBeLessThan(500)` in else | Edit endpoint may not be implemented; else-branch fails if 5xx |

#### Category B — Success-range `[200, 300)` checks (acceptable, strong downstream assertions)

These use `toBeGreaterThanOrEqual(200)` + `toBeLessThan(300)` for creation endpoints. The
range is correct because different routes may return HTTP 200 (with body) or HTTP 201 (Created)
depending on their implementation. The **real protection** in these tests comes from the
follow-up DB-level assertions (DR=CR balance, inventory qty change, voucher row existence),
not the status code.

Files using this pattern (all acceptable):
`accounting.test.ts`, `vouchers.test.ts`, `pos.test.ts`, `inventory.test.ts`,
`whatsapp-triggers.test.ts` (voucher-create operations)

#### Category C — Strengthened in Phase 6

| File | Was | Now | Reason |
|------|-----|-----|--------|
| `api-smoke.test.ts` inventory without `locationId` | `toBeLessThan(500)` | `expect([200, 400]).toContain(res.status)` | Title already said "400 or 200"; `< 500` was too permissive |
| `api-smoke.test.ts` WhatsApp settings title | "returns 200 (not 500)" | "returns non-500 (may be 404 when no row exists in test DB)" | Title/assertion mismatch corrected |

---

### TypeScript Check

`npm run check` (`tsc` without options) is currently **not runnable on Replit** due to heap
exhaustion (OOM) — the full incremental type-check exceeds the container's available memory.

**Workaround in use:** `npx tsc --noEmit` (avoids certain allocation paths) — **passes with
zero errors** and is used in pre-commit checks and CI.

**Known pre-existing TypeScript issues:** None. `npx tsc --noEmit` is clean.

If `npm run check` is needed in CI, add `NODE_OPTIONS=--max-old-space-size=4096` or pin
`"check": "tsc --noEmit"` explicitly in `package.json` to ensure `noEmit` is always used.

---

### CI Hardening

All required scripts exist in `package.json`:

```bash
npm run check           # tsc (type check) — use npx tsc --noEmit on memory-constrained hosts
npm run build           # vite build + esbuild server bundle
npm run test:backend    # vitest run (backend/node tier only)
npm run test:frontend   # vitest run --config vitest.config.frontend.ts (jsdom tier)
npm test                # both tiers sequentially
```

**Rule: do not merge if `npm run build`, `npm run test:backend`, or `npm run test:frontend` fail.**

Exception: tests that are `it.skip` or `it.todo` with documented reasons (see skipped list
above) are allowed to remain in that state pending production fixes.

---

### Remaining TODOs (future work, not blocking)

- [ ] Fix `inventoryHelper.ts` qty ≤ 0 normalization bug → enables 5 inventory skips + 2 factory todos
- [ ] Seed `sp_prepaid_charges` in factory test setup → enables 1 factory todo
- [ ] Switch test session store to persistent (`connect-pg-simple`) → enables sequential-adjustment skip
- [ ] Add `SELECT FOR UPDATE` lock to inventory read-modify-write → enables concurrent-adjustment skip
- [ ] Add `@testing-library/user-event` interaction tests (form typing, dropdown selection)
- [ ] Add error-boundary tests (what renders when a query fails)
- [ ] Add POS shift open/close render flow test
- [ ] Add factory container status-change render test
- [ ] Snapshot tests for key KPI cards (once stable)
- [ ] Coverage threshold enforcement (`c8` or `istanbul`)
- [ ] Fix `npm run check` OOM on Replit (add `--max-old-space-size` or pin `--noEmit` in package.json)
