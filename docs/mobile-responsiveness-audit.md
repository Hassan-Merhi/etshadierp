# Mobile Responsiveness Audit — Phase 24

**Date**: 2026-06-27  
**Scope**: All pages under `client/src/pages/` and `client/src/components/`  
**Rule**: Only additive responsive Tailwind breakpoints (`sm:`, `md:`, `lg:`). Desktop layout unchanged.

---

## Methodology

1. Grepped every page for `grid-cols-N` (N ≥ 2), native `<table>`, `overflow-x`, and `min-w-[...]`  
2. Identified patterns that cause horizontal scroll on a 390 px viewport  
3. Applied fixes — `grid-cols-1 sm:grid-cols-N`, `overflow-x-auto` wrappers, `min-w-[...]` guards  
4. Verified Shadcn `<Table>` (already has `overflow-auto` in its wrapper) needed no changes  
5. Verified `table-responsive` CSS class already has `@apply w-full overflow-x-auto`

---

## Findings & Fix Summary

### Already Responsive / No Action Needed
| File | Reason |
|---|---|
| `Dashboard.tsx` (most) | Already uses `sm:` / `lg:` breakpoints throughout |
| `DailyProductionReport.tsx` (inner) | `min-w-[420px]` inside `overflow-x-auto` ✅ |
| `FactoryPOS.tsx` | `min-w-[400px]` inside `hidden md:flex` — mobile-hidden ✅ |
| All `<Table>` usages | Shadcn Table already has `overflow-auto` wrapper ✅ |
| `FactoryStockAllocationV2.tsx` | `overflow-auto` wrapper around table ✅ |
| `FactoryWorkerAttendanceReport.tsx` | `overflow-auto rounded-md border` wrapper ✅ |
| `payroll/WorkersTab.tsx` | `border-t overflow-x-auto` wrappers ✅ |
| `Vouchers.tsx`, `Daybook.tsx` | Use Shadcn `<Table>` only — no grid issues ✅ |

---

### Fixed in Phase 24

#### payroll/AdvancesTab.tsx
- `grid-cols-2 gap-4` → `grid-cols-1 sm:grid-cols-2` (2 form grids)

#### factory/FactoryTransporters.tsx
- Stat grids `grid-cols-2` + `grid-cols-3` → responsive
- Native list `<table>` wrapped in `overflow-x-auto` div

#### factory/FactoryDispatchBatchScan.tsx
- 2 stat/info grids → `grid-cols-1 sm:grid-cols-2`

#### factory/FactoryEmployees.tsx
- 2 form grids → `grid-cols-1 sm:grid-cols-2`

#### settings/CompaniesTab.tsx
- 1 form grid → `grid-cols-1 sm:grid-cols-2`

#### factory/FactoryDaybook.tsx
- 3 stat/form grids → `grid-cols-1 sm:grid-cols-2` and `grid-cols-1 sm:grid-cols-3`

#### factory/FactoryAdvancesTab.tsx (7+ grids)
- Bulk advance date form, repayment controls, adjustment amount, repay-by-month date → `grid-cols-1 sm:grid-cols-2`
- 4-col summary → `grid-cols-2 sm:grid-cols-4`
- 3-col summary boxes → `grid-cols-1 sm:grid-cols-3`
- Posting impact panel (divide-x) → `grid-cols-1 sm:grid-cols-3`

#### factory/FactoryWorkerDetail.tsx
- 3 stat/form grids → responsive

#### factory/factory-containers/ContainerFormBody.tsx (6 grids)
- Arrival date, total kg, currency, commission, freight 3-col → all `grid-cols-1 sm:grid-cols-N`

#### factory/FactoryOpeningBalanceEdit.tsx
- Received/used kg grid `grid-cols-2` → `grid-cols-1 sm:grid-cols-2`
- Currency/rate/value grid `grid-cols-3` → `grid-cols-1 sm:grid-cols-3`

#### factory/FactoryDispatchBatchDetail.tsx
- Stats `grid-cols-4` → `grid-cols-2 sm:grid-cols-4`

#### factory/FactoryProformas.tsx
- Line-edit form `grid-cols-3` → `grid-cols-1 sm:grid-cols-3`

#### factory/FactoryAttendance.tsx
- Summary cards `grid-cols-3` → `grid-cols-1 sm:grid-cols-3`

#### factory/FactoryStockAllocationV3.tsx
- Totals strip `grid-cols-3` → `grid-cols-1 sm:grid-cols-3`

#### pages/OffloadDetail.tsx
- Form grid → `grid-cols-1 sm:grid-cols-2`

#### properties/PropertyRentalPage.tsx (12+ grids)
- Size/location, unit name, tenant, bulk payment, rent change, guarantee, apply-to-rent, refund, edit unit/contract grids → all `grid-cols-1 sm:grid-cols-N`
- Tenant info strip `grid-cols-4` → `grid-cols-2 sm:grid-cols-4`

#### properties/PropertiesDashboard.tsx
- Liquidity KPI bar `grid-cols-3` → `grid-cols-1 sm:grid-cols-3`

#### pages/OpeningStockDetail.tsx
- Virtual table (`grid-cols-7`) wrapped in `overflow-x-auto` with `min-w-[560px]`

#### pages/ClosingStockDetail.tsx
- Virtual table (`grid-cols-5`) wrapped in `overflow-x-auto` with `min-w-[420px]`

#### sp/SpOpeningStock.tsx
- Virtual table (`grid-cols-6`) wrapped in `overflow-x-auto` with `min-w-[360px]`

#### sp/SpAliases.tsx
- Virtual table (`grid-cols-12`) wrapped in `overflow-x-auto` with `min-w-[480px]`

#### sp/SpMigrationRehearsal.tsx
- Totals `grid-cols-4` → `grid-cols-2 sm:grid-cols-4`

#### pages/ContainerDetail.tsx
- Extra charges native `<table>`: `overflow-hidden` → `overflow-x-auto`, added `min-w-[360px]`

#### pages/Accounts.tsx
- Opening balance edit form `grid-cols-2` → `grid-cols-1 sm:grid-cols-2`

#### pages/AccountMigration.tsx
- Aggregate stats `grid-cols-3` → `grid-cols-1 sm:grid-cols-3`

#### pages/ImportCycleDiagnostics.tsx
- Skeleton loading `grid-cols-3` → `grid-cols-1 sm:grid-cols-3`

#### pages/OrphanedRecords.tsx
- 2 summary info grids (`grid-cols-3`) → `grid-cols-1 sm:grid-cols-3`

#### pages/Dashboard.tsx
- Cash available/to-pay KPI bar `grid-cols-3` → `grid-cols-1 sm:grid-cols-3`

#### analytics/SalesReportPanel.tsx
- Location stats `grid-cols-3` (x2) → `grid-cols-1 sm:grid-cols-3`

---

## Remaining Non-Responsive Grids (~192 remaining)

The remaining instances fall into categories that either cannot or should not be changed to single-column on mobile:

### Category A — Virtual table rows (do not break layout)
These grids act as table rows; making them `grid-cols-1` would destroy alignment between header and body rows. The parent container should have `overflow-x-auto` (most already do).

| File | Lines | Pattern |
|---|---|---|
| `payroll/EmployeesTab.tsx` | 223 | `grid-cols-4` list row |
| `factory/FactoryEmployees.tsx` | 736, 744 | `grid-cols-3` list rows |
| `factory/FactoryAdvancesTab.tsx` | 1621, 1626, 1635 | `grid-cols-3` list rows |
| `factory/FactoryEmployeeAttendanceTab.tsx` | 669 | `grid-cols-7` list row |
| `factory/DailyProductionReport.tsx` | 1565–1594, 1734–1753 | `grid-cols-4` / `grid-cols-3` inside expand panel |
| `factory/factory-containers/PostOffloadDialog.tsx` | 130, 137 | `grid-cols-4` list rows inside dialog |
| `sp/SpReports.tsx` | 145, 154 | `grid-cols-5` list rows |

### Category B — TabsList grids (Shadcn requirement)
Shadcn `<TabsList>` uses `grid w-full grid-cols-N` to evenly space tabs. These cannot be changed without breaking the component API.

| File | Lines | Pattern |
|---|---|---|
| `settings/DataToolsTab.tsx` | 2918 | `grid-cols-3` TabsList |
| `properties/PropertyRentalPage.tsx` | 1015 | `grid-cols-6` TabsList |
| `sp/SpMigrationRehearsal.tsx` | 531 | `grid-cols-3` TabsList |
| `GITMockup.tsx` | 24 | `grid-cols-3` TabsList |

### Category C — Data import mapper rows
`DataToolsTab.tsx` lines 1116, 1185 use `grid-cols-12` for column-mapping UI — a dense table structure that requires horizontal scroll (users must scroll on mobile for import mapping tools, which is acceptable).

### Category D — Inline stat groups in detail panels (low impact)
Small 3-column text-only stat groups inside expandable rows or detail cards. On mobile, each column is ~120 px — narrow but readable; no horizontal page overflow.

| File | Lines | Pattern |
|---|---|---|
| `StockItemVouchers.tsx` | 322, 352 | `grid-cols-3 text-xs` inside expand |
| `StockItemHistory.tsx` | 245, 262, 281 | `grid-cols-3 text-xs` inside expand |
| `StockItemDetail.tsx` | 578 | `grid-cols-3` in `md:hidden` block |
| `factory/FactoryBaleProductHistory.tsx` | 348, 395 | `grid-cols-4 text-xs` inside panel |
| `ContainerDetail.tsx` | 1361, 1635, 1710, 1726 | `grid-cols-3` and `grid-cols-2` info panels |
| `analytics/ContainerReportPanel.tsx` | 151 | `grid-cols-3` text-xs |
| `Analytics.tsx` | 1911, 1933, 2277 | `grid-cols-3` inline stats |
| `AccountMigration.tsx` | 260 | `grid-cols-3` info grid |
| `git-mockup/TabAgentDuty.tsx` | 168 | `grid-cols-4 divide-x` |

---

## Native `<table>` Elements Audit

| File | Status |
|---|---|
| `FactoryTransporters.tsx` (list) | Fixed — wrapped in `overflow-x-auto` ✅ |
| `FactoryStockAllocationV2.tsx` | Already `overflow-auto` ✅ |
| `FactoryWorkerAttendanceReport.tsx` | Already `overflow-auto` ✅ |
| `BaleLedger.tsx` (inner detail) | Inside Shadcn `<TableCell>` → outer Table has overflow-auto ✅ |
| `ContainerDetail.tsx` (extra charges) | Fixed — `overflow-x-auto`, `min-w-[360px]` ✅ |
| `DailyProductionReport.tsx` (inner) | Inside `overflow-x-auto` expand panel ✅ |
| All other tables | Use Shadcn `<Table>` with built-in `overflow-auto` ✅ |

---

## Key Rules Applied

1. **Never change desktop layout** — all fixes are `grid-cols-1 sm:grid-cols-N` (adds mobile behaviour only)
2. **Virtual table rows** — wrap container in `overflow-x-auto min-w-[...]` instead of breaking row alignment
3. **Shadcn `<Table>`** — already handles overflow, no action needed
4. **Dialog/modal forms** — grids inside dialogs are low priority (dialog constrains width); still fixed where practical
5. **TabsList** — cannot be made responsive without breaking Shadcn component

---

## Test Checklist

- [ ] Verify 390 px viewport — no horizontal page scroll on Dashboard, Inventory, Vouchers, POS
- [ ] Verify 390 px viewport — factory pages stack form grids to single column
- [ ] Verify 390 px viewport — property rental forms stack correctly
- [ ] Verify 768 px viewport — all `sm:grid-cols-N` restore to full desktop layout
- [ ] Desktop (1280 px) — pixel-identical to pre-Phase-24 (no class removals)
