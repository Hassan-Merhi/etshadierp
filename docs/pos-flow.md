# POS Flow

## Overview

The POS module is a separate role-gated experience. Users with role `POS` land on a restricted route set and cannot access ERP-only pages. POS operations are scoped to a specific location assigned to the user.

---

## POS User Flow

1. User logs in → session receives `currentRole = "POS"` and `currentCompanyId`.
2. `checkPOSLocation` middleware verifies the user is assigned to the requested `locationId` via the `userLocations` table.
3. The POS page (`client/src/pages/pos/POS.tsx` or similar) loads stock items and inventory for the assigned location.
4. User scans or searches for items → adds them to a sale basket.
5. On checkout, a `Sales` voucher is posted via `POST /api/vouchers` (or the POS-specific endpoint).
6. Inventory is reduced for each sale item via `adjustInventory()`.
7. The voucher is linked to the active shift via `shiftId`.

---

## Sale Items

Each sale records:
- `salesItems` rows: `stockItemId`, `quantity`, `unitPrice`, `totalAmount`, `locationId`
- The location is the POS user's assigned location
- Price can be overridden if the user has `pos_perm_override_price` permission

---

## Inventory Reduction

On each completed sale:
- `adjustInventory(tx, locationId, stockItemId, -qty, companyId)` is called for each sale item
- The inventory row at the POS location is decremented
- If stock goes below zero and the user does not have negative-stock permission (only Admin/Owner/Manager/Developer can sell negative stock), the sale is blocked

---

## Voucher / Daybook Connection

A completed POS sale creates a `Sales` voucher. This voucher appears in:
- The **Daybook** view when filtered by date and company
- The **Vouchers** list (POS users see a restricted vouchers view filtered to their shifts)
- The **POS Daybook** page (`/pos-daybook`) which shows shift-level summaries

The voucher's `shiftId` links it to the `posShifts` record for the active shift.

---

## Shifts / Cash Accounts

POS shifts are stored in `posShifts`. A shift represents a cashier session:
- Opened by the POS user (if they have `pos_perm_open_shift`)
- Closed at end of day
- Cash accounts per location are configured in `userLocationCashAccounts`
- Dashboard cash account selections are in `dashboardCashAccounts`

The shift summary shows total sales, cash collected, and any variances. (Needs verification — exact shift summary fields depend on `posShifts` schema.)

---

## WhatsApp Invoice / Report

WhatsApp sending is confirmed in `server/routes/posRoutes.ts`. Three WhatsApp endpoints exist:

| Endpoint | Purpose |
|---|---|
| `POST /api/pos/whatsapp/send-pdf` | Frontend-generated PDF forwarded to WhatsApp group |
| `POST /api/pos/whatsapp/send-stock-report` | Server-side stock PDF sent to location's WhatsApp group |
| `POST /api/pos/whatsapp/send-invoice` | Server-side invoice PDF sent (POS users restricted to their own shift's vouchers) |

The WhatsApp group is configured per location. If no group is configured, the endpoint returns 400.

The stock report has a page limit guard — reports exceeding `maxAllowedPages` are not sent to WhatsApp.

---

## POS-Specific Permissions

These are configured via the Advanced Restrictions system (`pos_perm_*` keys in `shared/permissionConfig.ts`):

| Key | Effect |
|---|---|
| `pos_perm_override_price` | Allow changing sale price at checkout |
| `pos_perm_discount` | Allow applying a discount |
| `pos_perm_credit_sale` | Allow creating credit (unpaid) sales |
| `pos_perm_refund` | Allow voiding / refunding a sale |
| `pos_perm_open_shift` | Allow opening and closing a shift |
| `pos_perm_view_shift_summary` | Allow viewing the shift summary |

---

## Draft Sales

Incomplete sales are stored in `draftPosSales` (schema: `insertDraftPosSaleSchema`). The frontend can restore a draft on reload.

---

## POS Date Restriction

POS users are restricted to today's date only. `canModifyDate` middleware enforces this: any attempt to post a POS sale or update a voucher with a date other than today is rejected.

---

## Known Regression Areas

- **`PUT /api/stock-transfers/:id`**: The `requireNonPOS` guard was removed to allow POS users to update stock transfer dates. The route only updates the `date` field for POS users; item-level changes are not applied. Verify this remains correct if the route is modified.
- **`PATCH /api/vouchers/:id`**: POS users are allowed through only for `StockTransfer` type vouchers and only for date updates. Non-StockTransfer vouchers still block POS.
- **Negative stock**: Only Admin/Owner/Manager/Developer roles have `canSellNegativeStock = true`. POS users are blocked at the session-population level in `requireAuth`.
- **Location isolation**: POS users must pass `checkPOSLocation` on routes that accept `locationId`. Routes that don't call this middleware could expose cross-location data to a POS user (Needs verification — audit each POS-accessible route).
