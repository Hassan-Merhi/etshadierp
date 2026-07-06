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
```

---

## Backend Tests (`tests/*.test.ts`)

Run with **Vitest + Node** (`vitest.config.ts`). No browser or DOM.

| File | What it covers |
|------|----------------|
| `accounting.test.ts` | Voucher debit/credit balance, journal posting rules |
| `api-smoke.test.ts` | Every registered route returns a response (not 500) |
| `excel-export.test.ts` | ExcelJS workbook generation (writeBuffer pattern) |
| `factory-container-lifecycle.test.ts` | Container create → offload → duty payment flow |
| `import-regression.test.ts` | Stock-transfer import CSV parsing |
| `inventory.test.ts` | Stock movement, location transfer |
| `permissions.test.ts` | Role-based access checks |
| `pos.test.ts` | POS shift open/close, sale recording |
| `reports.test.ts` | Balance-sheet, profit-loss, net-position accuracy |
| `vouchers.test.ts` | Voucher CRUD with entries |
| `whatsapp-triggers.test.ts` | WhatsApp send-trigger conditions |

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
Uses a minimal harness component mirroring the dialog structure in `JournalForm.tsx` (lines 1646–1672).

| Test | Assertion |
|------|-----------|
| `prompt = true` | `data-testid="dialog-whatsapp-prompt"` is in the document |
| `prompt = false` | dialog is not in the document |
| Click Skip | dialog closes (removed from DOM) |
| Click Send | `onSend` callback fires; dialog closes |
| Open imperatively | simulates API response returning `prompt=true` |

---

## Remaining TODOs

- [ ] Add `@testing-library/user-event` interaction tests (form typing, dropdown selection)
- [ ] Add error-boundary tests (what renders when a query fails)
- [ ] Add POS shift open/close render flow test
- [ ] Add factory container status-change render test
- [ ] Snapshot tests for key KPI cards (once stable)
- [ ] Coverage threshold enforcement (`c8` or `istanbul`)
