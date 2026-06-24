# Accounting Flow

## Voucher Types

Vouchers are the core accounting documents. The `voucherType` field accepts these values (defined in `shared/schema/erp.ts`):

| Type | Purpose |
|---|---|
| `Payment` | Money paid out (e.g. pay a supplier) |
| `Receipt` | Money received (e.g. collect from customer) |
| `Journal` | General ledger adjustment — two or more offsetting entries |
| `Sales` | POS or ERP sale creating a customer receivable |
| `Purchase` | Purchase order receipt creating a supplier payable |
| `Contra` | Transfer between cash/bank accounts |
| `Stock Transfer` | Inventory movement between locations (posts inventory changes) |
| `Credit Note` | Reduction of a customer receivable |
| `Debit Note` | Reduction of a supplier payable (Needs verification — confirm usage) |

Vouchers also carry:
- `optional: boolean` — optional vouchers bypass the debit = credit balance check and are excluded from some reports
- `currency: "USD" | "CFA"` — reporting currency for the entry
- `shiftId` — links a POS sale voucher to the open shift
- `sourceModule: "ERP" | "FACTORY"` — distinguishes ERP-originated vs factory-originated vouchers

---

## Voucher Entries (Daybook Lines)

Each voucher has one or more `voucherEntries` rows. Each entry records:
- `ledgerAccountId` — the account debited or credited
- `debitAmount` — positive value when this entry is a debit, `"0"` otherwise
- `creditAmount` — positive value when this entry is a credit, `"0"` otherwise
- `narration` — free-text description

**Balance rule**: For active (non-optional) vouchers, `SUM(debitAmount) == SUM(creditAmount)` is enforced server-side in `voucherCreateRoutes.ts` before inserting. Unbalanced payloads are rejected with HTTP 400.

The collection of all voucher entries across all vouchers on a given date forms the **daybook** for that date.

---

## Ledger Accounts

Defined in `ledgerAccounts` table (`shared/schema/accounting.ts`). Each account has:
- `accountType` — asset, liability, equity, income, expense, etc. (exact enum: Needs verification — read `ledgerAccounts` table def)
- `subType` — used for special account detection (e.g. `"sp_prepaid_expenses"`)
- `companyId` — scoped per company

The ledger view for an account aggregates all `voucherEntries` rows for that account over a date range, showing running debit/credit totals and a running balance.

---

## POS Accounting

When a POS sale is completed:
1. A `Sales` voucher is created and linked to the active shift (`shiftId`).
2. `salesItems` rows record each line item (quantity, unit price, stock item).
3. Inventory is reduced via `adjustInventory()` for each sale item.
4. The voucher entries debit the customer/cash account and credit the sales income account.

The daybook endpoint returns POS sales vouchers alongside ERP vouchers when filtered by date and company.

---

## Container / Offload Accounting

When a container is offloaded (`POST /api/containers/:id/offload`):
1. Existing inventory from the offload is reversed via `reverseInventoryByExactValue()`.
2. New inventory is added via `adjustInventory()` for each offload item.
3. Accounting vouchers are posted:
   - **Voucher A**: records the supplier cost (debit stock asset, credit supplier payable), plus freight and duty lines if applicable.
   - **Agent charge journals**: if `agentChargeLines` are provided, additional journal entries are posted for agent fees.
4. For supplier-partner (SP) containers: an intercompany voucher is posted to the SP company crediting the SP intercompany account.

**Prepaid logic**: If a container has prepaid expenses (account subType `"sp_prepaid_expenses"`), those balances are drawn down during offload accounting. (Needs verification — confirm exact clearing entry.)

---

## Net Position

The net position calculation (`server/netPositionHelper.ts`) aggregates ledger account balances across all companies. Accounts with type `"Intercompany"` are excluded from the net position total to avoid double-counting intercompany balances.

---

## Known Risk Areas

- **Orphaned data**: Several foreign key constraints exist as `NOT VALID`. Rows that reference deleted parents are not automatically caught by the DB. Application-level lookups may return unexpected nulls for orphaned rows.
- **Cross-company queries without tenant isolation at DB level**: All company scoping is in application code. A bug in `currentCompanyId` resolution could expose another company's vouchers.
- **Optional voucher bypass**: Optional vouchers skip the debit=credit check. Incorrectly marking a voucher as optional allows unbalanced entries to post silently.
- **No double-entry enforcement for POS Sales vouchers**: The server posts entries using values computed from sale items; if the computed entries are unbalanced, no explicit check catches it (Needs verification).
- **Currency conversion**: Multi-currency entries (USD / CFA) rely on exchange rates stored per voucher. Stale rates are not auto-corrected.
