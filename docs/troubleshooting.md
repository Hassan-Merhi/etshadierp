# Troubleshooting

## Login & Access

**Can't log in**
- Check your username and password (case-sensitive).
- Ask an Admin to reset your password in Settings → Users.

**Page or menu item missing**
- Your account may not have access. Ask an Admin to grant it in Settings → User Access Management.

**"No company selected" error**
- Go to the top-right company selector and choose your company before using any page.

---

## Payroll

**Advance deductions show $0 in payroll preview**
- Confirm the advance record exists in Payroll → Advances and is not marked "Fully Paid".

**Opening balance shows wrong Dr/Cr when filtering by month**
- This was a known bug fixed in March 2026. Refresh the page or clear your browser cache.

---

## Inventory & Stock

**Stock transfer not appearing at destination**
- Confirm the transfer status is "Completed", not still "Pending".

**Barcode not scanning**
- Make sure the bale is finalized. Unfinalized bales have no scannable label.

---

## Accounting

**Balance shows wrong direction (Dr vs Cr)**
- Check that the account's opening balance side is set correctly (Dr/Cr) in the account edit dialog.

**Voucher won't save**
- Debits and credits must balance to zero. Check the journal entries before saving.

---

## POS / Sales

**POS user can't see cost/profit columns**
- By design — POS roles do not have access to cost or profit data. This is controlled in User Access Management.

**Sale not appearing in Daybook**
- Verify the sale voucher is not marked Optional or deleted.

---

## General

**Page loads slowly or shows stale data**
- Hard-refresh: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac).

**"relation does not exist" server error**
- A database migration may be pending. Restart the server to trigger auto-migration.

**Changes not saving**
- Check for a red error toast at the bottom of the screen. Fix the indicated field and retry.
