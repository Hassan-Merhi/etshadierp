# Factory Module — Navigation & Permission Visibility Audit

**Date:** 2026-05-05
**Scope:** Factory module only (`/factory/*`)
**Purpose:** Audit every route, tab, and page against sidebar visibility and user-permission controls. No code changed.

---

## Table of Contents

1. [Permission System Overview](#1-permission-system-overview)
2. [Complete Route & Page Audit Table](#2-complete-route--page-audit-table)
3. [Tab-Level Audit](#3-tab-level-audit)
4. [Summary Lists](#4-summary-lists)
   - 4A Missing from User Permissions
   - 4B Missing from Sidebar
   - 4C Duplicate / Legacy Routes
   - 4D Permission Key Exists But No Route
5. [Recommended Fix — Centralized Navigation Registry](#5-recommended-fix--centralized-navigation-registry)
6. [Implementation Plan](#6-implementation-plan)

---

## 1. Permission System Overview

The Factory module uses **two independent permission mechanisms**:

### Mechanism 1 — Page Keys (`factory_user_page_access` table)
- Each row stores `{ companyId, userId, pageKey }`.
- `pageKey` is the URL path **without the leading slash** (e.g. `"factory/stock-entry"`).
- When a user has **zero rows** → they get `fullAccess: true` (see all pages).
- When a user has **any rows** → they only see the pages whose keys are in their list.
- **Admins, Owners, Developers always receive `fullAccess: true`** and bypass the check entirely.
- The frontend uses `/api/factory/my-access` to retrieve `{ fullAccess, pageKeys, hiddenCostFields }`.
- The sidebar filters itself using `useFactoryVisibleSections()`.

### Mechanism 2 — Hidden Cost/Tab Fields (`factoryUserProfiles.hiddenCostFields` array)
- A `text[]` column storing string keys like `"hide_tab_workers_payroll"`.
- Used to hide **individual tabs and column-level cost data** within a page.
- Also uses `hideAllCosts` boolean to shortcut hiding all cost columns.
- Controlled via the **Settings → Users** drawer (FactoryUsers.tsx).

### Hard-wired Guards (JSX conditions in App.tsx)
Some routes only render when `user?.role === "Admin" || "Developer"`:
- `/factory/settings`, `/factory/deleted-items`, `/factory/orphaned-records`
- `/factory/chatbot-settings`, `/factory/import-cycle-diagnostics`
- `/factory/inventory-repair`, `/factory/company-data-reset`
- `/factory/spreadsheet` (Developer only)

### `FACTORY_NAV_PAGES` — The Permission UI Registry
Defined in `FactorySidebar.tsx`, imported by `FactoryUsers.tsx`.
This is the **only** list that appears in the user-permissions checkbox UI.
It is built by flattening all `FACTORY_NAV_SECTIONS` items plus 4 manually added entries:
`factory/dashboard`, `factory/daybook`, `factory/chat`, `factory/settings`.

**Total registered permission keys: 41**

### Backend API Protection
All factory API routes use `requireAuth` middleware. There is **no per-route backend permission check** beyond authentication — page-level access is enforced only on the frontend. Any authenticated factory user who knows the URL can call any `/api/factory/*` endpoint directly.

---

## 2. Complete Route & Page Audit Table

**Column guide:**
- **Sidebar?** — Is there a sidebar nav link visible to non-admin users?
- **In Permissions?** — Does this key appear in the Users → permissions checkbox list?
- **Permission Key** — The `pageKey` string used in `factory_user_page_access`.
- **Route Guard?** — Conditional JSX (`user?.role`) or explicit `hasDashboardAccess` check.
- **Backend Guard?** — API endpoints enforced beyond `requireAuth`.
- **Status** — See legend below.

**Status Legend:**
- `OK` — Sidebar entry, permission key, and route are all aligned.
- `MISSING FROM PERMISSIONS` — Route exists and/or sidebar entry exists but no permission key.
- `MISSING FROM SIDEBAR` — Route and/or permission key exists but no sidebar entry.
- `ADMIN/DEV ONLY` — Protected by JSX role condition; intentionally hidden from regular users.
- `LEGACY/REDIRECT` — Old route that redirects to a new one; no own page.
- `SUB-PAGE` — Drilldown detail page; access derived from parent.
- `ORPHANED FILE` — Page file exists but route is dead or redirected away.
- `TAB NOT CONTROLLED` — Page is accessible but individual tabs cannot be toggled per-user.
- `NEEDS REVIEW` — Unclear or conflicting state.

---

### 2A — Primary Page Routes

| # | Display Name | Route / Path | Component File | Sidebar Section | Sidebar? | In Permissions? | Permission Key | Route Guard? | Backend Guard? | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Dashboard | `/factory/dashboard` | `FactoryDashboardIntel.tsx` | Pinned (manual) | Yes (pinned) | Yes | `factory/dashboard` | Yes — `hasDashboardAccess` | No | **OK** |
| 2 | Daybook | `/factory/daybook` | `FactoryDaybook.tsx` | Pinned (manual) | Yes (pinned) | Yes | `factory/daybook` | No (hiddenKey: `hide_tab_daybook`) | No | **OK** |
| 3 | Production Analytics | `/factory/production-report` | `DailyProductionReport.tsx` | Overview | Yes | Yes | `factory/production-report` | No | No | **OK** |
| 4 | Factory Sheets | `/factory/sheets` | `FactorySheets.tsx` | Overview | Yes | Yes | `factory/sheets` | No | No | **OK** |
| 5 | New Status Builder | `/factory/status-builder` | `FactoryStatusBuilder.tsx` | Overview | Yes (admin only) | Yes | `factory/status-builder` | No (sidebar adminOnly) | No | **OK** (adminOnly in sidebar) |
| 6 | Stock Entry | `/factory/stock-entry` | `BaleStockEntry.tsx` | Operations | Yes | Yes | `factory/stock-entry` | No | No | **OK** |
| 7 | Raw Materials | `/factory/raw-materials` | `FactoryRawMaterialsHub.tsx` | Operations | Yes | Yes | `factory/raw-materials` | No | No | **OK** |
| 8 | Waste Dispatch | `/factory/waste-dispatch` | `WasteDispatch.tsx` | Operations | Yes | Yes | `factory/waste-dispatch` | No | No | **OK** |
| 9 | Bale Explorer (Bales Hub) | `/factory/bales-hub` | `FactoryBalesHub.tsx` | Bales | Yes | Yes | `factory/bales-hub` | No | No | **OK** |
| 10 | Factory POS | `/factory/pos` | `FactoryPOS.tsx` | Sales | Yes | Yes | `factory/pos` | No | No | **OK** |
| 11 | Customers | `/factory/customers` | `FactoryCustomers.tsx` | Sales | Yes | Yes | `factory/customers` | No | No | **OK** |
| 12 | Invoicing | `/factory/invoicing` | `FactoryInvoicing.tsx` | Sales | Yes | Yes | `factory/invoicing` | No | No | **OK** |
| 13 | Stock Allocation (current) | `/factory/stock-allocation-v5` | `FactoryStockAllocationV5.tsx` | Sales | Yes | Yes | `factory/stock-allocation-v5` | No | No | **OK** |
| 14 | Loadings | `/factory/sales/loadings` | `FactoryLoadingsHub.tsx` | Sales | Yes | Yes | `factory/sales/loadings` | No | No | **OK** |
| 15 | Location Inventory | `/factory/location-inventory` | `FactoryLocationInventory.tsx` | Inventory | Yes | Yes | `factory/location-inventory` | No | No | **OK** |
| 16 | Factory Stock OTW | `/factory/stock-otw` | `FactoryStockOTW.tsx` | Inventory | Yes | Yes | `factory/stock-otw` | No | No | **OK** |
| 17 | Containers | `/factory/containers` | `FactoryContainers.tsx` | Inventory | Yes | Yes | `factory/containers` | No | No | **OK** |
| 18 | Workers Hub | `/factory/workers` | `FactoryWorkersHub.tsx` | Finance | Yes | Yes | `factory/workers` | No | No | **OK** |
| 19 | Employees Hub | `/factory/employees` | `FactoryEmployeesHub.tsx` | Finance | Yes | Yes | `factory/employees` | No | No | **OK** (tabs not controlled — see §3) |
| 20 | Suppliers | `/factory/suppliers` | `FactorySuppliers.tsx` | Finance | Yes | Yes | `factory/suppliers` | No | No | **OK** |
| 21 | Vouchers | `/factory/vouchers` | `FactoryVouchers.tsx` | Finance | Yes | Yes | `factory/vouchers` | No | No | **OK** |
| 22 | Accounts | `/factory/accounts` | `FactoryAccounts.tsx` | Finance | Yes | Yes | `factory/accounts` | No | No | **OK** |
| 23 | Analytics (old) | `/factory/analytics` | `Analytics.tsx` | Reports | Yes (admin only) | Yes | `factory/analytics` | No (sidebar adminOnly) | No | **OK** (adminOnly in sidebar) |
| 24 | Financial Snapshot | `/factory/financial-snapshot` | `FactoryFinancialSnapshot.tsx` | Reports | Yes (admin only) | Yes | `factory/financial-snapshot` | No (sidebar adminOnly) | No | **OK** (adminOnly in sidebar) |
| 25 | Rental Shops | `/factory/rental/shops` | `FactoryRentalShops.tsx` | Rentals | Yes | Yes | `factory/rental/shops` | No | No | **OK** |
| 26 | Chat | `/factory/chat` | `Chat.tsx` | Footer (flat) | Yes | Yes | `factory/chat` | No | No | **OK** |
| 27 | Settings | `/factory/settings` | `Settings.tsx` | Footer (flat) | Yes (admin only) | Yes | `factory/settings` | Yes — role Admin/Developer | No | **OK** |
| 28 | Intel Dashboard | `/factory/intelligence/dashboard` | `FactoryDashboardIntel.tsx` | Intelligence | Yes (devOnly+flag) | Yes | `factory/intelligence/dashboard` | No (section devOnly) | No | **OK** (devOnly section) |
| 29 | KPIs | `/factory/intelligence/kpis` | `FactoryKpis.tsx` | Intelligence | Yes (devOnly+flag) | Yes | `factory/intelligence/kpis` | No | No | **OK** (devOnly) |
| 30 | Profitability | `/factory/intelligence/profitability` | `FactoryProfitability.tsx` | Intelligence | Yes (devOnly+flag) | Yes | `factory/intelligence/profitability` | No | No | **OK** (devOnly) |
| 31 | Waste Tracking | `/factory/intelligence/waste` | `FactoryWaste.tsx` | Intelligence | Yes (devOnly+flag) | Yes | `factory/intelligence/waste` | No | No | **OK** (devOnly) |
| 32 | Alerts | `/factory/intelligence/alerts` | `FactoryAlerts.tsx` | Intelligence | Yes (devOnly+flag) | Yes | `factory/intelligence/alerts` | No | No | **OK** (devOnly) |
| 33 | Supplier Scores | `/factory/intelligence/supplier-scores` | `FactorySupplierScoreboard.tsx` | Intelligence | Yes (devOnly+flag) | Yes | `factory/intelligence/supplier-scores` | No | No | **OK** (devOnly) |
| 34 | Mix Optimizer | `/factory/intelligence/mix-optimizer` | `FactoryMixOptimizer.tsx` | Intelligence | Yes (devOnly+flag) | Yes | `factory/intelligence/mix-optimizer` | No | No | **OK** (devOnly) |
| 35 | Cash Flow | `/factory/intelligence/cashflow` | `FactoryCashflow.tsx` | Intelligence | Yes (devOnly+flag) | Yes | `factory/intelligence/cashflow` | No | No | **OK** (devOnly) |
| 36 | Net Profit Analytics | `/factory/net-profit-analytics` | `FactoryNetProfitAnalytics.tsx` | Intelligence | Yes (devOnly+flag) | Yes | `factory/net-profit-analytics` | No | No | **OK** (devOnly) |
| 37 | Net Position | `/factory/net-position` | `FactoryNetPosition.tsx` | Intelligence | Yes (devOnly+flag) | Yes | `factory/net-position` | No | No | **OK** (devOnly) |
| 38 | Production Summary | `/factory/production-summary` | `ProductionSummary.tsx` | Intelligence | Yes (devOnly+flag) | Yes | `factory/production-summary` | No | No | **OK** (devOnly) |
| 39 | Supplier Report | `/factory/supplier-report` | `FactorySupplierReport.tsx` | Intelligence | Yes (devOnly+flag) | Yes | `factory/supplier-report` | No | No | **MISSING FROM SIDEBAR** (non-devs cannot see it, but if key assigned, no route guard stops them) |
| 40 | Supplier Statement | `/factory/supplier-statement` | `FactorySupplierStatement.tsx` | Intelligence | Yes (devOnly+flag) | Yes | `factory/supplier-statement` | No | No | **MISSING FROM SIDEBAR** (same as above) |
| 41 | Intel Settings | `/factory/intelligence/settings` | `FactoryIntelSettings.tsx` | Intelligence footer | Yes (admin only) | Yes | `factory/intelligence/settings` | No | No | **OK** (devOnly section) |
| 42 | Transporters | `/factory/transporters` | `FactoryTransporters.tsx` | None | **No** | **No** | — | No | No | **MISSING FROM SIDEBAR + MISSING FROM PERMISSIONS** |
| 43 | Agents | `/factory/agents` | `Agents.tsx` | Pinned (manual default) | Yes (pinned) | **No** | — | No (hiddenKey: `hide_tab_agents`) | No | **MISSING FROM PERMISSIONS** (only hiddenKey, not a pageKey) |
| 44 | Raw Stock (Bale Ledger) | `/factory/raw-stock` | `ProductionRawStock.tsx` | None | **No** | **No** | — | No | No | **MISSING FROM SIDEBAR + MISSING FROM PERMISSIONS** |
| 45 | Bale Products (standalone) | `/factory/bale-products` | `BaleProducts.tsx` | None | **No** | **No** | — | No | No | **MISSING FROM SIDEBAR + MISSING FROM PERMISSIONS** |
| 46 | Bales History | `/factory/bales-history` | `BalesHistory.tsx` | None | **No** | **No** | — | No | No | **MISSING FROM SIDEBAR + MISSING FROM PERMISSIONS** |
| 47 | Reprint Labels | `/factory/reprint-labels` | `FactoryReprintLabels.tsx` | None | **No** | **No** | — | No | No | **MISSING FROM SIDEBAR + MISSING FROM PERMISSIONS** |
| 48 | Stock Query | `/factory/stock-query` | `StockQuery.tsx` | None | **No** | **No** | — | No | No | **MISSING FROM SIDEBAR + MISSING FROM PERMISSIONS** |
| 49 | Barcode Lookup | `/factory/barcode-lookup` | `BarcodeLookup.tsx` | None | **No** | **No** | — | No | No | **MISSING FROM SIDEBAR + MISSING FROM PERMISSIONS** (also embedded as tab in BalesHub) |
| 50 | Price List | `/factory/price-list` | `FactoryPriceList.tsx` | None | **No** | **No** | — | No | No | **MISSING FROM SIDEBAR + MISSING FROM PERMISSIONS** |
| 51 | Broker Visual Statement | `/factory/broker-visual-statement` | `FactoryBrokerVisualStatement.tsx` | None | **No** | **No** | — | No | No | **MISSING FROM SIDEBAR + MISSING FROM PERMISSIONS** |
| 52 | Import | `/factory/import` | `FactoryImport.tsx` | None | **No** | **No** | — | No | No | **MISSING FROM SIDEBAR + MISSING FROM PERMISSIONS** |
| 53 | Bale Relabeling | `/factory/bale-relabeling` | `FactoryBaleRelabeling.tsx` | None | **No** | **No** | — | No | No | **MISSING FROM SIDEBAR + MISSING FROM PERMISSIONS** |
| 54 | Merge Bale Products | `/factory/merge-bale-products` | `MergeBaleProducts.tsx` | None | **No** | **No** | — | No | No | **MISSING FROM SIDEBAR + MISSING FROM PERMISSIONS** |
| 55 | Bale Product Images | `/factory/bale-product-images` | `BaleProductImages.tsx` | None | **No** | **No** | — | No | No | **MISSING FROM SIDEBAR + MISSING FROM PERMISSIONS** |
| 56 | Wipers Re-Entry | `/factory/bale-relabeling/wipers-re-entry` | `WipersReEntry.tsx` | None | **No** | **No** | — | No | No | **MISSING FROM SIDEBAR + MISSING FROM PERMISSIONS** |
| 57 | Customer Logos | `/factory/customer-logos` | `CustomerLogosSettings.tsx` | None | **No** | **No** | — | No | No | **MISSING FROM SIDEBAR + MISSING FROM PERMISSIONS** |
| 58 | Net Position Details | `/factory/net-position-details` | `FactoryNetPositionDetails.tsx` | None | **No** | **No** | — | No | No | **MISSING FROM SIDEBAR + MISSING FROM PERMISSIONS** |
| 59 | Rental Warehouses | `/factory/rental/warehouses` | `FactoryRentalWarehouses.tsx` | None | **No** | **No** | — | No | No | **MISSING FROM SIDEBAR + MISSING FROM PERMISSIONS** |
| 60 | Rental Payments | `/factory/rental/payments` | `FactoryRentalPayments.tsx` | None | **No** | **No** | — | No | No | **MISSING FROM SIDEBAR + MISSING FROM PERMISSIONS** |
| 61 | Conflicts | `/factory/conflicts` | `ConflictCenter.tsx` | Footer (conditional) | Yes (conflict count > 0) | **No** | — | No | No | **MISSING FROM PERMISSIONS** |
| 62 | Spreadsheet Editor | `/factory/spreadsheet` | `SpreadsheetEditor.tsx` | Footer (flat, devOnly) | Yes (dev only) | **No** | — | Yes — role Developer | No | **ADMIN/DEV ONLY** (acceptable) |
| 63 | Settings | `/factory/deleted-items` | `DeletedItems.tsx` | None | **No** | **No** | — | Yes — role Admin/Dev | No | **ADMIN/DEV ONLY** |
| 64 | Orphaned Records | `/factory/orphaned-records` | `OrphanedRecords.tsx` | None | **No** | **No** | — | Yes — role Admin/Dev | No | **ADMIN/DEV ONLY** |
| 65 | Chatbot Settings | `/factory/chatbot-settings` | `ChatbotSettings.tsx` | None | **No** | **No** | — | Yes — role Admin/Dev | No | **ADMIN/DEV ONLY** |
| 66 | Import Cycle Diagnostics | `/factory/import-cycle-diagnostics` | `ImportCycleDiagnostics.tsx` | None | **No** | **No** | — | Yes — role Admin/Dev | No | **ADMIN/DEV ONLY** |
| 67 | Inventory Repair | `/factory/inventory-repair` | `InventoryRepair.tsx` | None | **No** | **No** | — | Yes — role Admin/Dev | No | **ADMIN/DEV ONLY** |
| 68 | Company Data Reset | `/factory/company-data-reset` | `CompanyDataReset.tsx` | None | **No** | **No** | — | Yes — role Admin/Dev | No | **ADMIN/DEV ONLY** |

---

### 2B — Sub-Pages (Drilldown / Detail Routes)

These are derived from a parent page. Permissions controlling the parent implicitly restrict access, but there is no independent permission key for these.

| # | Display Name | Route / Path | Component File | Parent Page | In Permissions? | Status |
|---|---|---|---|---|---|---|
| S1 | Customer Statement | `/factory/customers/:id` | `FactoryCustomerStatement.tsx` | Customers | No (derived) | SUB-PAGE — OK |
| S2 | Employee Detail | `/factory/employees/:id` | `FactoryEmployeeDetail.tsx` | Employees | No (derived) | SUB-PAGE — OK |
| S3 | Worker Detail | `/factory/workers/:id` | `FactoryWorkerDetail.tsx` | Workers | No (derived) | SUB-PAGE — OK |
| S4 | Bale Product History | `/factory/bale-product-history/:productId/:locationId` | `FactoryBaleProductHistory.tsx` | Bales Hub | No (derived) | SUB-PAGE — OK |
| S5 | Bale Product All Months | `/factory/bale-product-history/:productId/:locationId/:year/all` | (inline component) | Bale Product History | No (derived) | SUB-PAGE — OK |
| S6 | Bale Product Month Detail | `/factory/bale-product-history/:productId/:locationId/:year/:month` | (inline component) | Bale Product History | No (derived) | SUB-PAGE — OK |
| S7 | Stock Item Detail | `/factory/stock-query/:id` | `FactoryStockItemDetail.tsx` | Stock Query | No (parent not controlled) | SUB-PAGE (parent uncontrolled) |
| S8 | New Container | `/factory/containers/new` | `FactoryContainerCreate.tsx` | Containers | No (derived) | SUB-PAGE — OK |
| S9 | Opening Balance Edit | `/factory/raw-stock/opening-balance/:id/edit` | `FactoryOpeningBalanceEdit.tsx` | Raw Stock | No (parent uncontrolled) | SUB-PAGE (parent uncontrolled) |
| S10 | New Invoice / Sale | `/factory/sales/new` | `FactoryInvoiceCreate.tsx` | Invoicing | No (derived) | SUB-PAGE — OK |
| S11 | Invoice Detail | `/factory/sales/invoices/:id` | `FactoryInvoiceDetail.tsx` | Invoicing | No (derived) | SUB-PAGE — OK |
| S12 | Invoice Loading Scan | `/factory/invoices/:id/loading-scan` | `FactoryInvoiceLoadingScan.tsx` | Invoicing | No (derived) | SUB-PAGE — OK |
| S13 | Add Proforma Line | `/factory/sales/proformas/:proformaId/add-line` | `ProformaAddLine.tsx` | Invoicing | No (derived) | SUB-PAGE — OK |
| S14 | New Container Loading | `/factory/sales/loading/new` | `FactoryContainerLoadingScan.tsx` | Loadings | No (derived) | SUB-PAGE — OK |
| S15 | Pending Invoice Verify | `/factory/sales/pending-invoices/:id/verify` | `FactoryPendingInvoiceVerify.tsx` | Invoicing | No (derived) | SUB-PAGE — OK |
| S16 | Ledger Monthly Summary | `/factory/ledger-monthly/:accountId` | `LedgerMonthlySummary.tsx` | Accounts / Vouchers | No (derived) | SUB-PAGE — OK |
| S17 | Ledger Vouchers | `/factory/ledger-vouchers/:accountId/:year/:month` | `LedgerVouchers.tsx` | Accounts / Vouchers | No (derived) | SUB-PAGE — OK |
| S18 | Voucher Edit | `/factory/vouchers/:id/edit` | `VoucherEdit.tsx` | Vouchers | No (derived) | SUB-PAGE — OK |
| S19 | Voucher Detail | `/factory/voucher-detail/:voucherId` | `VoucherDetail.tsx` | Vouchers | No (derived) | SUB-PAGE — OK |
| S20 | Accounting Create | `/factory/create` | `AccountingCreate.tsx` | Accounts / Vouchers | No (derived) | SUB-PAGE — OK |

---

### 2C — Legacy / Redirect Routes

| # | Old Route | Redirects To | Status |
|---|---|---|---|
| L1 | `/factory-production` | `/factory/raw-stock` | LEGACY/REDIRECT |
| L2 | `/bales` | `/factory/raw-stock` | LEGACY/REDIRECT |
| L3 | `/production-bales` | `/factory/stock-entry` | LEGACY/REDIRECT |
| L4 | `/bale-products` | `/factory/bale-products` | LEGACY/REDIRECT |
| L5 | `/factory/pressing` | `/factory/stock-entry` | LEGACY/REDIRECT |
| L6 | `/factory/finalize` | `/factory/stock-entry` | LEGACY/REDIRECT |
| L7 | `/factory/finance` | `/factory/workers` | LEGACY/REDIRECT |
| L8 | `/factory/payroll-hub` | `/factory/workers` | LEGACY/REDIRECT |
| L9 | `/factory/worker-payroll` | `/factory/workers?tab=payroll` | LEGACY/REDIRECT |
| L10 | `/factory/users` | `/factory/settings` | LEGACY/REDIRECT |
| L11 | `/factory/bale-ledger` | `/factory/production-report` | LEGACY/REDIRECT |
| L12 | `/factory/stock-allocation` | Renders `FactoryStockAllocationV2` | LEGACY (V1 route uses V2 component) |
| L13 | `/factory/stock-allocation-v3` | Renders `FactoryStockAllocationV3` | LEGACY — accessible, not in sidebar/permissions |
| L14 | `/factory/payroll` | `Payroll.tsx` (old page) | LEGACY — accessible, not in sidebar/permissions |

---

### 2D — Orphaned Page Files (file exists, no live route or route is dead)

| File | Situation |
|---|---|
| `FactoryPayrollHub.tsx` | Imported (lazy) but route `/factory/payroll-hub` immediately redirects to `/factory/workers`. |
| `FactoryFinanceHub.tsx` | `/factory/finance` redirects to `/factory/workers`. File is completely bypassed. |
| `FactoryPayrollTab.tsx` | Sub-component file, used inside `FactoryPayrollHub.tsx` which is itself orphaned. |
| `FactoryWorkers.tsx` | Rendered as the "Workers" tab inside `FactoryWorkersHub.tsx` — not a route, embedded component only. |

---

## 3. Tab-Level Audit

### 3A — Tabs WITH `hiddenCostFields` Permission Control

These tabs can be hidden per-user via the Settings → Users → "Tab Visibility" drawer.

| Page | Tab Label | Permission Key (hiddenCostFields) | Shown in Users Permissions UI? |
|---|---|---|---|
| Sidebar (pinned) | Daybook | `hide_tab_daybook` | **No — not in COST_FIELDS list** |
| Sidebar (pinned) | Agents | `hide_tab_agents` | **No — not in COST_FIELDS list** |
| Stock Entry | Entry | `hide_tab_stockentry_entry` | **No — not in COST_FIELDS list** |
| Stock Entry | History | `hide_tab_stockentry_history` | **No — not in COST_FIELDS list** |
| Bales Hub | Barcode Lookup | `hide_tab_bales_barcode` | **No — not in COST_FIELDS list** |
| Bales Hub | Remove from Stock (sub-tab) | `hide_tab_bales_remove` | **No — not in COST_FIELDS list** |
| Workers Hub | Payroll | `hide_tab_workers_payroll` | **No — not in COST_FIELDS list** |
| Workers Hub | Attendance | `hide_tab_workers_attendance` | **No — not in COST_FIELDS list** |
| Workers Hub | Report | `hide_tab_workers_report` | **No — not in COST_FIELDS list** |
| Workers Hub | Advances | `hide_tab_workers_advances` | **No — not in COST_FIELDS list** |
| Workers Hub | Bonuses | `hide_tab_workers_bonuses` | **No — not in COST_FIELDS list** |
| Workers Hub → Workers tab | Categories | `hide_tab_workers_categories` | **No — not in COST_FIELDS list** |
| Workers Hub → Advances tab | Repayments | `hide_tab_advances_repayments` | **No — not in COST_FIELDS list** |
| Worker Detail | Statement | `hide_tab_workerdetail_statement` | **No — not in COST_FIELDS list** |
| Worker Detail | Advances | `hide_tab_workerdetail_advances` | **No — not in COST_FIELDS list** |
| Worker Detail | Bales | `hide_tab_workerdetail_bales` | **No — not in COST_FIELDS list** |
| Worker Detail | Documents | `hide_tab_workerdetail_documents` | **No — not in COST_FIELDS list** |
| Payroll (old page) | Worker Master | `hide_tab_payroll_worker_master` | **No — not in COST_FIELDS list** |
| Invoicing | Proformas | `hide_invoicing_proformas_tab` | **No — not in COST_FIELDS list** |
| Loadings Hub | Pending Loadings | `hide_tab_loadings_pending` | **No — not in COST_FIELDS list** |
| KPIs | Worker Performance | `hide_tab_kpis_worker_performance` | **No — not in COST_FIELDS list** |
| KPIs | Mix Efficiency | `hide_tab_kpis_mix_efficiency` | **No — not in COST_FIELDS list** |
| Profitability | Containers | `hide_tab_profitability_containers` | **No — not in COST_FIELDS list** |

> **Critical Finding:** Every single `hide_tab_*` key is functional in code (tabs react to them correctly) BUT **none of them appear in the `COST_FIELDS` array in `FactoryUsers.tsx`**. They must be set manually by editing the database directly or via a future admin UI. The current Users drawer only shows 7 cost-column fields.

---

### 3B — Current COST_FIELDS shown in Users Permissions UI

These 7 fields are the **only** ones currently visible in the Settings → Users → drawer:

| Key | Label |
|---|---|
| `inventory_avg_rate` | Location Inventory: Avg Rate |
| `inventory_total_value` | Location Inventory: Total Value |
| `inventory_sell_price` | Location Inventory: Sell Price |
| `inventory_sell_value` | Location Inventory: Sell Value |
| `bale_history_cost_per_kg` | Bale History: Cost/KG |
| `bale_history_total_cost` | Bale History: Total Cost |
| `bales_list_cost_per_kg` | Bales List: Cost/kg |

---

### 3C — Tabs with NO Permission Control (cannot be hidden per-user)

| Page | Uncontrolled Tabs | Notes |
|---|---|---|
| Employees Hub | Employees, Payroll, Attendance, Advances, Bonuses, Withdrawals | No `hiddenKey` on any tab in `TAB_OPTIONS` |
| Finance Hub (`/factory/finance`) | Workers, Employees, Suppliers, Vouchers, Accounts | Route is dead (redirects); tabs also have no hiddenKey |
| Bales Hub | Bales (main), Bale Products, Import History | No hiddenKey; only Barcode and Remove-from-Stock are controlled |
| Factory Sheets | All user-defined sheet tabs | Dynamic, user-created — cannot be system-controlled |
| Raw Materials Hub | (single-view, no tabs) | N/A |
| POS | (single-view, no tabs) | N/A |
| Daybook | (single-view, no tabs) | N/A |

---

## 4. Summary Lists

### 4A — Pages/Routes MISSING FROM USER PERMISSIONS

These routes are accessible to any authenticated factory user but have no permission key that can be toggled in the Users settings.

**High Priority (functional pages users regularly visit):**
1. `/factory/transporters` — Transporters management
2. `/factory/raw-stock` — Raw Stock / Bale Ledger (old but still accessible)
3. `/factory/bale-products` — Bale Products standalone
4. `/factory/bales-history` — Bales History
5. `/factory/reprint-labels` — Reprint Labels
6. `/factory/stock-query` — Stock Query
7. `/factory/barcode-lookup` — Barcode Lookup (also embedded in Bales Hub)
8. `/factory/price-list` — Price List
9. `/factory/broker-visual-statement` — Broker Visual Statement
10. `/factory/import` — Data Import
11. `/factory/bale-relabeling` — Bale Relabeling
12. `/factory/merge-bale-products` — Merge Bale Products
13. `/factory/bale-product-images` — Bale Product Images
14. `/factory/bale-relabeling/wipers-re-entry` — Wipers Re-Entry
15. `/factory/net-position-details` — Net Position Details
16. `/factory/rental/warehouses` — Rental Warehouses
17. `/factory/rental/payments` — Rental Payments

**Medium Priority (admin-adjacent or less-used):**

18. `/factory/customer-logos` — Customer Logos Settings
19. `/factory/agents` — Agents (pinned by default but no pageKey, only `hide_tab_agents` hiddenCostField)
20. `/factory/conflicts` — Conflict Center

**Legacy routes still accessible (no sidebar, no guard):**

21. `/factory/payroll` — Old Payroll page
22. `/factory/stock-allocation-v3` — Legacy Stock Allocation V3
23. `/factory/analytics` — Old Analytics page (sidebar shows adminOnly, but no JSX route guard)

---

### 4B — Pages/Routes MISSING FROM SIDEBAR (not reachable without knowing the URL)

1. `/factory/transporters`
2. `/factory/raw-stock`
3. `/factory/bale-products` (standalone)
4. `/factory/bales-history`
5. `/factory/reprint-labels`
6. `/factory/stock-query`
7. `/factory/barcode-lookup` (standalone URL)
8. `/factory/price-list`
9. `/factory/broker-visual-statement`
10. `/factory/import`
11. `/factory/bale-relabeling`
12. `/factory/merge-bale-products`
13. `/factory/bale-product-images`
14. `/factory/bale-relabeling/wipers-re-entry`
15. `/factory/customer-logos`
16. `/factory/net-position-details`
17. `/factory/rental/warehouses`
18. `/factory/rental/payments`
19. `/factory/payroll` (legacy)
20. `/factory/stock-allocation-v3` (legacy)
21. `/factory/supplier-report` (key exists in permissions, but the sidebar link is only shown to Developer-role users via the Intelligence section's `developerOnly` flag — regular admins cannot see it)
22. `/factory/supplier-statement` (same as above)

---

### 4C — Duplicate / Legacy Routes

| Legacy Route | Current Replacement | Recommendation |
|---|---|---|
| `/factory/stock-allocation` | `/factory/stock-allocation-v5` | Mark as legacy; add JSX adminOnly guard |
| `/factory/stock-allocation-v3` | `/factory/stock-allocation-v5` | Mark as legacy; add JSX adminOnly guard |
| `/factory/payroll` | Workers Hub payroll tab | Mark as legacy; add JSX adminOnly guard |
| `/factory/raw-stock` | Embedded in Bales Hub / Raw Materials | Needs review — may still be required for opening balance edit |
| `/factory/bales-history` | `/factory/bales-hub` (history tab) | Mark as legacy redirect |
| `/factory/bale-ledger` | Already redirects to `/factory/production-report` | OK — redirect is in place |
| `/factory/finance` | Already redirects to `/factory/workers` | OK — redirect is in place |
| `/factory/payroll-hub` | Already redirects to `/factory/workers` | OK — redirect is in place |
| `/factory/users` | Already redirects to `/factory/settings` | OK — redirect is in place |
| `/factory/pressing` | Already redirects to `/factory/stock-entry` | OK — redirect is in place |
| `/factory/finalize` | Already redirects to `/factory/stock-entry` | OK — redirect is in place |

---

### 4D — Permission Key Exists But No Sidebar Route (or route is devOnly)

These keys are registered in `FACTORY_NAV_PAGES` (so they appear in the permissions checkbox UI for users) but the sidebar entry is either `developerOnly` or `adminOnly`, meaning regular users who are granted the key still have no sidebar link to navigate there.

| Permission Key | Sidebar Visibility | Issue |
|---|---|---|
| `factory/intelligence/dashboard` | Developer-role only (section devOnly) | Key in permissions but regular users can't navigate there |
| `factory/intelligence/kpis` | Developer-role only | Same |
| `factory/intelligence/profitability` | Developer-role only | Same |
| `factory/intelligence/waste` | Developer-role only | Same |
| `factory/intelligence/alerts` | Developer-role only | Same |
| `factory/intelligence/supplier-scores` | Developer-role only | Same |
| `factory/intelligence/mix-optimizer` | Developer-role only | Same |
| `factory/intelligence/cashflow` | Developer-role only | Same |
| `factory/net-profit-analytics` | Developer-role only | Same |
| `factory/net-position` | Developer-role only | Same |
| `factory/production-summary` | Developer-role only | Same |
| `factory/supplier-report` | Developer-role only (flag) | Key exists; non-devs can't see sidebar link |
| `factory/supplier-statement` | Developer-role only (flag) | Same |
| `factory/intelligence/settings` | Admin-only (footer link) | Key exists; correct |
| `factory/analytics` | Admin-only (sidebar adminOnly flag) | Key exists but no JSX route guard — URL accessible without guard |
| `factory/financial-snapshot` | Admin-only (sidebar adminOnly flag) | Key exists but no JSX route guard — URL accessible without guard |
| `factory/status-builder` | Admin-only (sidebar adminOnly flag) | Key exists but no JSX route guard — URL accessible without guard |

---

## 5. Recommended Fix — Centralized Navigation Registry

The root problem is that routes, sidebar items, and permission keys are defined in three separate places and are not kept in sync. The fix is a single registry that drives all three.

### Proposed `factoryNavigationRegistry`

```typescript
// shared/factoryNavRegistry.ts

export type NavStatus = "active" | "legacy" | "admin-only" | "dev-only";

export interface FactoryNavTab {
  key: string;             // hiddenCostFields key, e.g. "hide_tab_workers_payroll"
  label: string;           // Display name
  permissionLabel: string; // Label shown in Users permission UI
}

export interface FactoryNavEntry {
  key: string;            // Permission key (pageKey) — matches URL without leading /
  label: string;          // Display name
  route: string;          // Full path, e.g. "/factory/stock-entry"
  component: string;      // Component file name (documentation only)
  sidebarSection: string | null;  // Which sidebar section, or null if no sidebar entry
  sidebarVisible: boolean;         // Should appear in sidebar for regular users
  sidebarCondition?: "admin" | "developer" | "featureFlag"; // Optional restriction
  sidebarFeatureFlag?: string;     // Settings key if featureFlag condition
  permissionToggle: boolean;       // Should appear in user permissions checkbox UI
  status: NavStatus;
  tabs?: FactoryNavTab[];          // Tab-level permissions within the page
  children?: string[];             // Child/sub-page routes (for documentation)
}

export const factoryNavigationRegistry: FactoryNavEntry[] = [
  // ── PINNED / OVERVIEW ──────────────────────────────────────────────────────
  {
    key: "factory/dashboard",
    label: "Dashboard",
    route: "/factory/dashboard",
    component: "FactoryDashboardIntel",
    sidebarSection: "Pinned",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
  },
  {
    key: "factory/daybook",
    label: "Daybook",
    route: "/factory/daybook",
    component: "FactoryDaybook",
    sidebarSection: "Pinned",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
    tabs: [
      { key: "hide_tab_daybook",       label: "Daybook",       permissionLabel: "Daybook: Sidebar Link" },
      { key: "daybook_own_only",        label: "Own Entries Only", permissionLabel: "Daybook: Own Entries Only" },
    ],
  },
  {
    key: "factory/production-report",
    label: "Production Analytics",
    route: "/factory/production-report",
    component: "DailyProductionReport",
    sidebarSection: "Overview",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
  },
  {
    key: "factory/sheets",
    label: "Factory Sheets",
    route: "/factory/sheets",
    component: "FactorySheets",
    sidebarSection: "Overview",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
    // tabs: user-defined — not system-controllable
  },
  {
    key: "factory/status-builder",
    label: "Status Builder",
    route: "/factory/status-builder",
    component: "FactoryStatusBuilder",
    sidebarSection: "Overview",
    sidebarVisible: true,
    sidebarCondition: "admin",
    permissionToggle: true,
    status: "active",
  },

  // ── OPERATIONS ─────────────────────────────────────────────────────────────
  {
    key: "factory/stock-entry",
    label: "Stock Entry",
    route: "/factory/stock-entry",
    component: "BaleStockEntry",
    sidebarSection: "Operations",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
    tabs: [
      { key: "hide_tab_stockentry_entry",   label: "Entry",   permissionLabel: "Stock Entry: Entry Tab" },
      { key: "hide_tab_stockentry_history", label: "History", permissionLabel: "Stock Entry: History Tab" },
    ],
  },
  {
    key: "factory/raw-materials",
    label: "Raw Materials",
    route: "/factory/raw-materials",
    component: "FactoryRawMaterialsHub",
    sidebarSection: "Operations",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
  },
  {
    key: "factory/waste-dispatch",
    label: "Waste Dispatch",
    route: "/factory/waste-dispatch",
    component: "WasteDispatch",
    sidebarSection: "Operations",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
  },
  {
    key: "factory/reprint-labels",
    label: "Reprint Labels",
    route: "/factory/reprint-labels",
    component: "FactoryReprintLabels",
    sidebarSection: "Operations",  // ADD to sidebar
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
  },

  // ── BALES ──────────────────────────────────────────────────────────────────
  {
    key: "factory/bales-hub",
    label: "Bale Explorer",
    route: "/factory/bales-hub",
    component: "FactoryBalesHub",
    sidebarSection: "Bales",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
    tabs: [
      { key: "hide_tab_bales_barcode", label: "Barcode Lookup", permissionLabel: "Bales: Barcode Lookup Tab" },
      { key: "hide_tab_bales_remove",  label: "Remove Stock",   permissionLabel: "Bales: Remove from Stock Tab" },
    ],
  },
  {
    key: "factory/bale-relabeling",
    label: "Bale Relabeling",
    route: "/factory/bale-relabeling",
    component: "FactoryBaleRelabeling",
    sidebarSection: "Bales",       // ADD to sidebar
    sidebarVisible: true,
    sidebarCondition: "admin",
    permissionToggle: true,
    status: "active",
    children: ["/factory/bale-relabeling/wipers-re-entry", "/factory/merge-bale-products", "/factory/bale-product-images"],
  },
  {
    key: "factory/barcode-lookup",
    label: "Barcode Lookup",
    route: "/factory/barcode-lookup",
    component: "BarcodeLookup",
    sidebarSection: "Bales",       // ADD to sidebar (standalone)
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
  },

  // ── SALES ──────────────────────────────────────────────────────────────────
  {
    key: "factory/pos",
    label: "Factory POS",
    route: "/factory/pos",
    component: "FactoryPOS",
    sidebarSection: "Sales",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
  },
  {
    key: "factory/customers",
    label: "Customers",
    route: "/factory/customers",
    component: "FactoryCustomers",
    sidebarSection: "Sales",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
  },
  {
    key: "factory/invoicing",
    label: "Invoicing",
    route: "/factory/invoicing",
    component: "FactoryInvoicing",
    sidebarSection: "Sales",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
    tabs: [
      { key: "hide_invoicing_proformas_tab", label: "Proformas", permissionLabel: "Invoicing: Proformas Tab" },
    ],
  },
  {
    key: "factory/stock-allocation-v5",
    label: "Stock Allocation",
    route: "/factory/stock-allocation-v5",
    component: "FactoryStockAllocationV5",
    sidebarSection: "Sales",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
  },
  {
    key: "factory/sales/loadings",
    label: "Loadings",
    route: "/factory/sales/loadings",
    component: "FactoryLoadingsHub",
    sidebarSection: "Sales",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
    tabs: [
      { key: "hide_tab_loadings_pending", label: "Pending Loadings", permissionLabel: "Loadings: Pending Tab" },
    ],
  },
  {
    key: "factory/price-list",
    label: "Price List",
    route: "/factory/price-list",
    component: "FactoryPriceList",
    sidebarSection: "Sales",       // ADD to sidebar
    sidebarVisible: true,
    sidebarCondition: "admin",
    permissionToggle: true,
    status: "active",
  },

  // ── INVENTORY ──────────────────────────────────────────────────────────────
  {
    key: "factory/location-inventory",
    label: "Location Inventory",
    route: "/factory/location-inventory",
    component: "FactoryLocationInventory",
    sidebarSection: "Inventory",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
  },
  {
    key: "factory/stock-otw",
    label: "Factory Stock OTW",
    route: "/factory/stock-otw",
    component: "FactoryStockOTW",
    sidebarSection: "Inventory",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
  },
  {
    key: "factory/containers",
    label: "Containers",
    route: "/factory/containers",
    component: "FactoryContainers",
    sidebarSection: "Inventory",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
  },
  {
    key: "factory/stock-query",
    label: "Stock Query",
    route: "/factory/stock-query",
    component: "StockQuery",
    sidebarSection: "Inventory",   // ADD to sidebar
    sidebarVisible: true,
    sidebarCondition: "admin",
    permissionToggle: true,
    status: "active",
  },

  // ── PEOPLE / FINANCE ────────────────────────────────────────────────────────
  {
    key: "factory/workers",
    label: "Workers",
    route: "/factory/workers",
    component: "FactoryWorkersHub",
    sidebarSection: "Finance",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
    tabs: [
      { key: "hide_tab_workers_payroll",     label: "Payroll",     permissionLabel: "Workers: Payroll Tab" },
      { key: "hide_tab_workers_attendance",  label: "Attendance",  permissionLabel: "Workers: Attendance Tab" },
      { key: "hide_tab_workers_report",      label: "Report",      permissionLabel: "Workers: Report Tab" },
      { key: "hide_tab_workers_advances",    label: "Advances",    permissionLabel: "Workers: Advances Tab" },
      { key: "hide_tab_workers_bonuses",     label: "Bonuses",     permissionLabel: "Workers: Bonuses Tab" },
      { key: "hide_tab_workers_categories",  label: "Categories",  permissionLabel: "Workers: Categories Sub-Tab" },
      { key: "hide_tab_advances_repayments", label: "Repayments",  permissionLabel: "Workers: Advance Repayments Tab" },
      { key: "hide_tab_workerdetail_statement", label: "Statement", permissionLabel: "Worker Detail: Statement Tab" },
      { key: "hide_tab_workerdetail_advances",  label: "Advances",  permissionLabel: "Worker Detail: Advances Tab" },
      { key: "hide_tab_workerdetail_bales",     label: "Bales",     permissionLabel: "Worker Detail: Bales Tab" },
      { key: "hide_tab_workerdetail_documents", label: "Documents", permissionLabel: "Worker Detail: Documents Tab" },
    ],
  },
  {
    key: "factory/employees",
    label: "Employees",
    route: "/factory/employees",
    component: "FactoryEmployeesHub",
    sidebarSection: "Finance",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
    // FIX NEEDED: No hiddenKey on any tab — add hiddenKey to TAB_OPTIONS
    tabs: [
      { key: "hide_tab_employees_payroll",     label: "Payroll",     permissionLabel: "Employees: Payroll Tab" },
      { key: "hide_tab_employees_attendance",  label: "Attendance",  permissionLabel: "Employees: Attendance Tab" },
      { key: "hide_tab_employees_advances",    label: "Advances",    permissionLabel: "Employees: Advances Tab" },
      { key: "hide_tab_employees_bonuses",     label: "Bonuses",     permissionLabel: "Employees: Bonuses Tab" },
      { key: "hide_tab_employees_withdrawals", label: "Withdrawals", permissionLabel: "Employees: Withdrawals Tab" },
    ],
  },
  {
    key: "factory/suppliers",
    label: "Suppliers",
    route: "/factory/suppliers",
    component: "FactorySuppliers",
    sidebarSection: "Finance",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
  },
  {
    key: "factory/vouchers",
    label: "Vouchers",
    route: "/factory/vouchers",
    component: "FactoryVouchers",
    sidebarSection: "Finance",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
  },
  {
    key: "factory/accounts",
    label: "Accounts",
    route: "/factory/accounts",
    component: "FactoryAccounts",
    sidebarSection: "Finance",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
  },
  {
    key: "factory/transporters",
    label: "Transporters",
    route: "/factory/transporters",
    component: "FactoryTransporters",
    sidebarSection: "Finance",     // ADD to sidebar
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
  },
  {
    key: "factory/broker-visual-statement",
    label: "Broker Statement",
    route: "/factory/broker-visual-statement",
    component: "FactoryBrokerVisualStatement",
    sidebarSection: "Finance",     // ADD to sidebar
    sidebarVisible: true,
    sidebarCondition: "admin",
    permissionToggle: true,
    status: "active",
  },

  // ── REPORTS ────────────────────────────────────────────────────────────────
  {
    key: "factory/analytics",
    label: "Analytics",
    route: "/factory/analytics",
    component: "Analytics",
    sidebarSection: "Reports",
    sidebarVisible: true,
    sidebarCondition: "admin",
    permissionToggle: true,
    status: "active",
  },
  {
    key: "factory/financial-snapshot",
    label: "Financial Snapshot",
    route: "/factory/financial-snapshot",
    component: "FactoryFinancialSnapshot",
    sidebarSection: "Reports",
    sidebarVisible: true,
    sidebarCondition: "admin",
    permissionToggle: true,
    status: "active",
  },
  {
    key: "factory/import",
    label: "Data Import",
    route: "/factory/import",
    component: "FactoryImport",
    sidebarSection: "Reports",     // ADD to sidebar under admin-only
    sidebarVisible: true,
    sidebarCondition: "admin",
    permissionToggle: true,
    status: "active",
  },

  // ── RENTALS ────────────────────────────────────────────────────────────────
  {
    key: "factory/rental/shops",
    label: "Rental Shops",
    route: "/factory/rental/shops",
    component: "FactoryRentalShops",
    sidebarSection: "Rentals",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
  },
  {
    key: "factory/rental/warehouses",
    label: "Rental Warehouses",
    route: "/factory/rental/warehouses",
    component: "FactoryRentalWarehouses",
    sidebarSection: "Rentals",     // ADD to sidebar
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
  },
  {
    key: "factory/rental/payments",
    label: "Rental Payments",
    route: "/factory/rental/payments",
    component: "FactoryRentalPayments",
    sidebarSection: "Rentals",     // ADD to sidebar
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
  },

  // ── OTHER / FOOTER ─────────────────────────────────────────────────────────
  {
    key: "factory/agents",
    label: "Agents",
    route: "/factory/agents",
    component: "Agents",
    sidebarSection: "Pinned",
    sidebarVisible: true,
    permissionToggle: true,        // FIX: add as pageKey (currently only hiddenCostField)
    status: "active",
  },
  {
    key: "factory/chat",
    label: "Chat",
    route: "/factory/chat",
    component: "Chat",
    sidebarSection: "Footer",
    sidebarVisible: true,
    permissionToggle: true,
    status: "active",
  },
  {
    key: "factory/settings",
    label: "Settings",
    route: "/factory/settings",
    component: "Settings",
    sidebarSection: "Footer",
    sidebarVisible: true,
    sidebarCondition: "admin",
    permissionToggle: true,
    status: "admin-only",
  },

  // ── LEGACY (keep routes, mark legacy, admin-gate access) ──────────────────
  {
    key: "factory/raw-stock",
    label: "Raw Stock (Legacy)",
    route: "/factory/raw-stock",
    component: "ProductionRawStock",
    sidebarSection: null,
    sidebarVisible: false,
    permissionToggle: false,
    status: "legacy",
  },
  {
    key: "factory/bale-products",
    label: "Bale Products (Legacy)",
    route: "/factory/bale-products",
    component: "BaleProducts",
    sidebarSection: null,
    sidebarVisible: false,
    permissionToggle: false,
    status: "legacy",
  },
  {
    key: "factory/bales-history",
    label: "Bales History (Legacy)",
    route: "/factory/bales-history",
    component: "BalesHistory",
    sidebarSection: null,
    sidebarVisible: false,
    permissionToggle: false,
    status: "legacy",
  },
  {
    key: "factory/stock-allocation",
    label: "Stock Allocation V2 (Legacy)",
    route: "/factory/stock-allocation",
    component: "FactoryStockAllocationV2",
    sidebarSection: null,
    sidebarVisible: false,
    permissionToggle: false,
    status: "legacy",
  },
  {
    key: "factory/stock-allocation-v3",
    label: "Stock Allocation V3 (Legacy)",
    route: "/factory/stock-allocation-v3",
    component: "FactoryStockAllocationV3",
    sidebarSection: null,
    sidebarVisible: false,
    permissionToggle: false,
    status: "legacy",
  },
  {
    key: "factory/payroll",
    label: "Payroll (Legacy)",
    route: "/factory/payroll",
    component: "Payroll",
    sidebarSection: null,
    sidebarVisible: false,
    permissionToggle: false,
    status: "legacy",
  },
];
```

---

## 6. Implementation Plan

### Priority 1 — Add Missing Permission Keys to the Users UI (LOW RISK)

**Goal:** Allow hiding/showing pages that currently have no permission key.

**What to change:**
1. Add the following keys to `FACTORY_NAV_PAGES` in `FactorySidebar.tsx` (or migrate to the registry):
   - `factory/transporters`, `factory/reprint-labels`, `factory/barcode-lookup`
   - `factory/price-list`, `factory/bale-relabeling`, `factory/merge-bale-products`
   - `factory/bale-product-images`, `factory/stock-query`, `factory/import`
   - `factory/broker-visual-statement`, `factory/customer-logos`
   - `factory/rental/warehouses`, `factory/rental/payments`
   - `factory/net-position-details`
   - `factory/agents` (currently `hide_tab_agents` only — move to pageKey)

2. **No database migration needed** — `factory_user_page_access` stores arbitrary string keys; adding new keys to the UI is sufficient.
3. **No existing user access is broken** — users with `fullAccess: true` see everything; existing restricted users simply won't have the new keys assigned (they'll be hidden by default for restricted users).

---

### Priority 2 — Expose Tab Permission Keys in the Users Settings Drawer (MEDIUM RISK)

**Goal:** Let admins toggle all the `hide_tab_*` keys through the UI instead of via raw DB edits.

**What to change:**
1. Expand `COST_FIELDS` array in `FactoryUsers.tsx` to include all `hide_tab_*` keys (listed in §3A).
2. Group them by page using a `group` field (e.g. "Workers Hub Tabs", "Invoicing Tabs", etc.).
3. Rename the UI section from "Cost Field Visibility" → "Page & Tab Visibility" (two sub-sections).
4. **No schema change needed** — same `hiddenCostFields` array column stores all keys.

---

### Priority 3 — Add Route Guards for Legacy / Admin-Sensitive Pages (MEDIUM RISK)

**Goal:** Prevent unauthorized users from accessing pages by direct URL.

**What to change in App.tsx:**
1. Add `isAdmin` condition to legacy routes:
   ```tsx
   {isAdmin && <Route path="/factory/stock-allocation" component={FactoryStockAllocation} />}
   {isAdmin && <Route path="/factory/stock-allocation-v3" component={FactoryStockAllocationV3} />}
   {isAdmin && <Route path="/factory/payroll" component={Payroll} />}
   {isAdmin && <Route path="/factory/raw-stock" component={ProductionRawStock} />}
   ```
2. Add `isAdmin` guard to pages that are adminOnly in sidebar but lack a JSX route guard:
   - `/factory/analytics`
   - `/factory/financial-snapshot`
   - `/factory/status-builder`

---

### Priority 4 — Add Backend Permission Checks to Sensitive API Endpoints (HIGH EFFORT)

**Goal:** Ensure that users who know the direct API URL cannot bypass frontend hiding.

**Approach:**
1. For highly sensitive data routes (e.g. cost/pricing endpoints, payroll endpoints), add a middleware that calls `/api/factory/my-access` logic and checks the user's `pageKeys` before returning data.
2. This is a larger change — implement per-endpoint as needed, starting with payroll, financial snapshot, and profitability APIs.

---

### Priority 5 — Add Missing Sidebar Entries (LOW RISK)

**Goal:** Make all active pages reachable through navigation.

**Proposed sidebar additions (with section grouping):**
- **Operations:** Reprint Labels
- **Bales:** Bale Relabeling (admin), Barcode Lookup (standalone)
- **Sales:** Price List (admin)
- **Inventory:** Stock Query (admin)
- **Finance:** Transporters, Broker Statement (admin)
- **Reports:** Data Import (admin)
- **Rentals:** Warehouses, Payments

---

### Priority 6 — Implement the Centralized Registry (LONG TERM)

**Goal:** Single source of truth so future additions never fall out of sync.

**Steps:**
1. Create `shared/factoryNavRegistry.ts` with the registry from §5.
2. Refactor `FactorySidebar.tsx` to derive its sections from the registry (filter by `sidebarVisible`, group by `sidebarSection`, apply conditions).
3. Refactor `FactoryUsers.tsx` to derive `FACTORY_NAV_PAGES` and `COST_FIELDS` from the registry (filter by `permissionToggle: true`).
4. Refactor `App.tsx` factory routes to be generated from the registry, with conditions derived from `status` and `sidebarCondition`.
5. Add a test/validation script that asserts every registry entry has a matching route and that no App.tsx route lacks a registry entry.

---

## Quick-Reference Counts

| Category | Count |
|---|---|
| Total factory routes in App.tsx (primary pages) | 68 |
| Total redirects / legacy routes | 14 |
| Total sub-page / drilldown routes | 20 |
| Pages registered in FACTORY_NAV_PAGES (permission UI) | 41 |
| Pages MISSING from permission UI | 20 |
| Pages MISSING from sidebar | 22 |
| Tabs with `hide_tab_*` keys (functional but invisible in UI) | 23 |
| Tabs in COST_FIELDS shown in Users settings drawer | 7 (cost columns only) |
| Orphaned page files (route is dead) | 4 |
| Legacy routes with no sidebar / no guard | 5 |
| Admin/Dev-only via JSX guard | 8 |
