# Vouchers Flow

## Voucher Lifecycle

```
Draft (optional flag) ──► Active ──► (no explicit void state — deletion is the void mechanism)
```

Vouchers do not have a formal state machine beyond `optional: boolean`. Deletion is soft (Needs verification — confirm soft-delete column on vouchers table).

---

## Create

**Route**: `POST /api/vouchers` → `server/routes/vouchers/voucherCreateRoutes.ts`

**Validation**:
1. Zod schema validates the incoming payload (voucherType, voucherDate, voucherNumber, totalAmount, entries[]).
2. For non-optional vouchers: `SUM(debitAmount) == SUM(creditAmount)` is enforced. HTTP 400 if unbalanced.
3. The `voucherDate` is checked against `canModifyDate` rules for the requesting user's role.

**DB writes** (inside a transaction):
1. Insert into `vouchers`.
2. Insert each entry into `voucherEntries`.
3. For `Stock Transfer` vouchers: insert `stockTransferVouchers` + `stockTransferItems`, call `adjustInventory()` for each item.
4. For `Sales` vouchers (POS): insert `salesItems`, call `adjustInventory()`.
5. Audit log entry is written.

---

## Edit

Voucher editing is split by type:

| Route file | Handles |
|---|---|
| `voucherPurchaseUpdateRoutes.ts` | Purchase voucher edits (line items, amounts, date) |
| `voucherSalesUpdateRoutes.ts` | Sales/POS voucher edits; POS users allowed for StockTransfer date-only |
| `voucherJournalRoutes.ts` | Journal entry edits |
| `voucherTransferRoutes.ts` | Stock transfer voucher confirmation / item edits |
| `voucherPaymentRoutes.ts` | Payment / Receipt voucher edits |

All edit routes re-validate the updated entries for balance (non-optional vouchers only).

---

## Supported Voucher Types

| Type | Create route | Notes |
|---|---|---|
| `Payment` | `POST /api/vouchers` | Money out |
| `Receipt` | `POST /api/vouchers` | Money in |
| `Journal` | `POST /api/vouchers` | Manual ledger adjustment |
| `Sales` | POS sale endpoint or `POST /api/vouchers` | Reduces inventory |
| `Purchase` | `POST /api/vouchers` or PO flow | Increases supplier payable |
| `Contra` | `POST /api/vouchers` | Cash ↔ bank transfer |
| `Stock Transfer` | `POST /api/vouchers` or dedicated endpoint | Moves inventory between locations |
| `Credit Note` | Dedicated credit note routes | Reduces customer balance |
| `Debit Note` | `POST /api/vouchers` | Needs verification — confirm separate route exists |

---

## Voucher Entries (Double Entry)

Each voucher line in `voucherEntries`:
- `ledgerAccountId` — which account
- `debitAmount` — amount in debit column (`"0"` if credit side)
- `creditAmount` — amount in credit column (`"0"` if debit side)
- `narration` — memo

The daybook is simply all `voucherEntries` joined to `vouchers` for a given date range and company.

---

## Print / Export

- **PDF invoice**: generated server-side via `server/helpers/generateInvoicePdf.ts` (uses Puppeteer or a PDF library — Needs verification on renderer).
- **Account statement PDF**: `server/lib/accountStatementPdfGenerator.ts`.
- **Stock PDF**: `server/helpers/generateStockPdf.ts`.
- **Excel**: various export routes use ExcelJS (see `server/excelHelper.ts`). `wb.xlsx.writeBuffer()` must be used — `write(stream)` is broken in ExcelJS 3.x (see memory note).

Print endpoints are gated by `exp_pdf` and `exp_excel` permission keys.

---

## Accounting Posting Flow (Summary)

```
POST /api/vouchers
  │
  ├─ Zod validation
  ├─ canModifyDate check
  ├─ BEGIN TRANSACTION
  │    ├─ INSERT vouchers
  │    ├─ INSERT voucherEntries  (debit/credit lines)
  │    ├─ [if Stock Transfer] INSERT stockTransferVouchers + items
  │    │    └─ adjustInventory() × N items
  │    ├─ [if Sales] INSERT salesItems
  │    │    └─ adjustInventory() × N items
  │    └─ INSERT auditLog
  └─ COMMIT
```

---

## Optional Vouchers

Setting `optional: true` on a voucher:
- Skips the debit = credit balance check
- These vouchers are excluded from some report totals (Needs verification — confirm which reports filter by `optional`)
- Visible in the "Optional Vouchers" page (`page_optional_vouchers` permission)

---

## Voucher Numbers

Voucher numbers are generated client-side or from `referenceSequences` table (Needs verification — confirm auto-numbering source). Duplicate voucher numbers within a company are not enforced at the database unique-constraint level (Needs verification).
