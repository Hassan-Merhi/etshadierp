# Inventory Flow

## Data Model

```
stockGroups     → categories for stock items
stockItems      → individual product definitions (name, unit, code, company-scoped)
inventory       → one row per (companyId, locationId, stockItemId)
                  tracks: quantity (decimal), totalValue, averageRate
locations       → physical or logical warehouse locations (company-scoped)
```

Each `inventory` row represents the current balance of one stock item at one location within one company.

---

## `adjustInventory()` — Central Mutation Point

**All inventory changes go through `server/inventoryHelper.ts: adjustInventory()`**. This function is called inside a database transaction and:

1. Locks the `inventory` row for the `(locationId, stockItemId)` combination with a `SELECT FOR UPDATE`.
2. If the quantity delta is positive (stock in), applies weighted-average cost:
   - `newTotalValue = existingTotalValue + (qty * rate)`
   - `newAverageRate = newTotalValue / newQty`
3. If the quantity delta is negative (stock out):
   - Reduces `quantity` and `totalValue` proportionally at the existing average rate.
   - If the result would go negative, a **negative layer** is recorded in `inventory_negative_layers` with a provisional rate, to be settled when matching stock arrives (FIFO settlement via `settleNegativeLayers()`).
4. Returns `{ previousQuantity, newQuantity, previousTotalValue, newTotalValue, averageRate, created }`.

**Do not mutate `inventory` rows directly via raw SQL or Drizzle outside this function.** Bypassing `adjustInventory()` breaks the weighted-average cost calculation and negative-layer tracking.

---

## Stock Movements

| Source | Mechanism |
|---|---|
| POS sale | `adjustInventory()` called for each sale item (negative delta) |
| Purchase (container offload) | `adjustInventory()` called for each offload item (positive delta) |
| Stock Transfer voucher | `adjustInventory()` called twice: negative at source location, positive at destination |
| Stock Adjustment voucher | `adjustInventory()` called once with the signed delta |
| Manual inventory adjustment | Route calls `adjustInventory()` with explicit type (add/remove) |
| Container offload reversal | `reverseInventoryByExactValue()` called first, then fresh `adjustInventory()` |

---

## Stock Transfers

A Stock Transfer moves items between two locations within the same company (or across companies for intercompany transfers). The flow:

1. A `stockTransferVouchers` row is created with `status` (draft → confirmed).
2. `stockTransferItems` rows record each line (stockItemId, quantity).
3. On confirmation, `adjustInventory()` is called for each item:
   - Negative delta at the source location.
   - Positive delta at the destination location.
4. A `Stock Transfer` voucher is posted in the accounting layer linking source and destination accounts.

**POS users** can update the `date` field of a Stock Transfer voucher (added in a prior fix), but cannot update items or confirm new transfers.

---

## Stock Adjustments

A Stock Adjustment modifies inventory at a single location without a matching counter-location. Types:

- `Production` — stock in (e.g. finished goods produced)
- `Consumption` — stock out (e.g. raw materials consumed)
- `Mixed` — combination (Needs verification)

Adjustments are recorded in `stockAdjustmentVouchers` and `stockAdjustmentItems`. `adjustInventory()` is called for each item with the signed delta.

---

## Location Inventory Endpoint

`GET /api/inventory` (in `server/routes/inventoryRoutes.ts`):

- Requires `requireAuth`.
- Scoped to `req.session.currentCompanyId`.
- Query params:
  - `locationId` (optional) — filter to a specific location
  - `stockGroupId` (optional) — filter to a stock group
  - `search` (optional) — text search on item name/code
  - `page` / `pageSize` — pagination
- **Always filters to `quantity > 0` by default** — zero-balance rows are suppressed unless explicitly included (Needs verification — `includeZero` param not found in the route; zero rows may simply be absent from the DB for inactive items).

---

## `includeZero` Behavior

The inventory query in `inventoryRoutes.ts` does not show an explicit `includeZero` parameter — it appears to return only rows that exist in the `inventory` table. If a `(locationId, stockItemId)` combination has never had stock, no row exists and no zero appears. If stock reaches zero via `adjustInventory()`, the row remains with `quantity = 0`. Whether those zero-quantity rows appear in API results depends on query filters — **Needs verification**.

---

## Company / Location Filtering Risk

- Every inventory query uses `req.session.currentCompanyId` for the company filter.
- A user who switches company context (via the company selector) gets a new `currentCompanyId` in their session; queries immediately reflect the new company.
- If a location `companyId` does not match the session `currentCompanyId`, the route rejects it with a 403. This is enforced in the inventory adjustment route but **Needs verification** for all inventory read paths.
- POS users additionally must pass `checkPOSLocation` middleware, which verifies the user is assigned to the requested location.

---

## Stock Items

`stockItems` are company-scoped. Key fields:
- `name`, `code` — display name and barcode/SKU
- `unit` — unit of measure (e.g. kg, pcs)
- `stockGroupId` — category
- `companyId` — tenant scoping

Stock item codes can have aliases (`stockItemCodeAliases`) for barcode scanning.

Location-specific prices are stored in `stockItemLocationPrices` (used by POS price lists).
