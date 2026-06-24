# Factory Flow

## Overview

The factory module manages bale production, scanning, customer orders, worker payroll, and raw material stock. It operates under company types `factory` and `factory_v2`. Factory routes are in `server/routes/factory/` and registered via `server/routes/factoryRoutes.ts`.

---

## Bales

A **bale** is the primary production output unit. Each bale has:
- A barcode / label identifier
- A `baleProduct` (the product category it belongs to)
- Weight (kg)
- Production date, worker attribution
- Status (in stock, allocated, loaded, dispatched)

Bales are stored in the `bales` table (`shared/schema/factory.ts`).

### Scanning Flow

1. A worker scans a barcode at the production station.
2. The scan is recorded via `POST /api/factory/bales/scan` (or daily scan routes).
3. The bale is created or updated in the `bales` table.
4. If the bale is associated with a customer order, it is reserved against that order's allocation.

The **Bale Stock Entry** page (`client/src/pages/factory/bale-stock-entry/`) provides keyboard-driven scanning:
- Type or scan a barcode into the search input.
- Arrow key navigation (↑/↓) moves through the product dropdown.
- Enter selects a product; Escape clears the selection.

### Barcode Lookup

The Bales Hub has a barcode lookup tab (`tab_bales_barcode`). Scanning a barcode resolves the bale's current location, status, and history.

---

## Customer Orders

Factory customer orders track shipments of bales to buyers. The flow:

1. **Order created** (`orderCrudRoutes.ts`) — associates a customer, requested products, and quantities.
2. **Stock allocated** (`factoryStockAllocationV3Routes.ts` / V5) — bales are reserved for the order.
3. **Loading** (`orderFinalizeLoadingRoutes.ts`) — allocated bales are marked as loaded onto a container/truck.
4. **Proforma invoice** (`factoryCustomerProformaRoutes.ts`) — pricing document generated for the customer.
5. **Dispatch** (`factoryDispatchBatchRoutes.ts`) — final dispatch record created.
6. **Tracking** (`orderTrackingRoutes.ts`) — shipment tracking updates.

Order charges (freight, handling, etc.) are managed via `orderChargesRoutes.ts`.

---

## Loading / Proforma

- A **loading** finalizes which bales are leaving in a given container or truck.
- A **proforma** is the pre-invoice pricing document sent to the customer before shipment.
- Proforma pricing can be per-kg or per-bale (`orderPricingRoutes.ts`). (Needs verification — confirm both modes exist and which is default.)
- The proforma PDF is generated via `factoryCustomerProformaRoutes.ts` using a PDF generator.

---

## Pricing / Per-KG

Factory order pricing supports:
- Per-bale flat pricing
- Per-kg pricing

The pricing mode is stored on the order line items. The proforma and invoice PDFs reflect the selected pricing mode.

---

## Mix Batches

Mix batches (`factoryMixBatchRoutes.ts`) combine multiple raw material inputs to produce bale outputs. The mix batch records:
- Input materials consumed (raw stock deducted)
- Output bales produced
- Efficiency metrics

---

## Raw Stock

Raw material stock is tracked separately from finished bales:

| Route module | Covers |
|---|---|
| `raw-stock/rawStockCrudRoutes.ts` | Create/read/update raw stock records |
| `raw-stock/rawStockReceiptRoutes.ts` | Record incoming raw material |
| `raw-stock/rawStockAdjRoutes.ts` | Adjustments |
| `raw-stock/rawStockOffloadRoutes.ts` | Raw stock offloaded from containers |
| `raw-stock/rawStockContainerRoutes.ts` | Link raw stock to container receipts |
| `raw-stock/rawStockBalanceRoutes.ts` | Balance / valuation queries |

---

## Factory Workers

Workers are separate from ERP employees. They are tracked in factory-specific tables:
- Attendance is recorded per day (`factoryAttendanceRoutes.ts`).
- Payroll is calculated based on bale output and/or daily rate (`factoryWorkerPayrollRoutes.ts`, `payroll/` sub-module).
- Salary advances are tracked (`payroll/advanceManagementRoutes.ts`).
- Worker statements and PDFs are generated via `server/lib/workerBalesPdfGenerator.ts` and `server/lib/factoryCustomerLedger.ts`.

Worker permissions are tab-gated: `tab_workers_payroll`, `tab_workers_attendance`, `tab_workers_report`, `tab_workers_advances`, `tab_workers_bonuses`.

---

## Factory Customers / Suppliers

Factory has its own customer and supplier entities, separate from ERP customers/suppliers:
- `factoryCustomersRoutes.ts` — factory customer CRUD and ledger
- `factoryCustomerOrderRoutes.ts` — order management
- `factory/suppliers/` — supplier CRUD, balance, statement, broker, FX rate routes

Factory supplier balances are updated when containers linked to factory suppliers are offloaded.

---

## Factory Daybook

Factory has its own daybook (`factoryDaybookRoutes.ts`) which shows financial entries originating from `sourceModule = "FACTORY"` vouchers.

---

## Shipping Containers (Factory)

Factory containers (`factoryShippingContainerRoutes.ts`) track the physical shipping containers used to export bales. These are distinct from the ERP containers (OTW / import) module.

Factory container tracking is handled by `factoryContainerTrackingService.ts` (separate from the ERP container tracking service).

---

## Production Planner

The production planner (`factoryProductionPlannerRoutes.ts`) allows scheduling and tracking of production targets. (Needs verification — exact schema and endpoints.)

---

## Status Builder

The factory status builder (`factoryStatusBuilderRoutes.ts`, `factoryStatusBuilderSheetsRoutes.ts`) generates status summary sheets for factory operations. (Needs verification — exact output format.)

---

## WhatsApp (Factory)

`factoryWhatsappRoutes.ts` provides factory-specific WhatsApp endpoints for sending production reports and documents.
