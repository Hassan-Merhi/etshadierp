# Releases & Updates

## March 2026

### Stock Entry History
- New tab in Factory → Bales Hub showing all bales created via stock entry.
- Grouped by date, location, worker, and product.
- Filters: date range, worker, product, location, status, search, include-unassigned.
- Expandable rows with inline bale detail. Excel export (Summary + Bale Details sheets).
- Worker lock: bales created via stock entry cannot have their worker changed after creation.

### Wipers Re-Entry by Date
- New factory page for creating wipers bales under a back-dated entry date.
- Supports qty/weight per product row, bulk cleanup of existing wipers bales, and full label printing after confirmation.

### Payroll Advance Deduction Fix
- Fixed: advance deductions in payroll preview were always showing $0 due to an incorrect filter.
- Now correctly reads `fullyPaid` flag from the database.
- Added "Remaining: $X" / "Fully deducted" indicator when editing deduction amounts.

### Employee Statement Fixes
- Fixed: PDF export showed "Account Statement: Employee" instead of the employee's name.
- Fixed: employee balances showed "Dr" instead of "Cr" in statements and opening balance calculations.
- Fixed: "This Month" filter returned incorrect opening balance for employee accounts.

### Bonus Calculator
- New two-tab bonus dialog in Payroll: Sales % bonus and Bales-based bonus.
- New columns on employees table: `salesBonusPct`, `balesBonusRate`.

---

## February 2026

### Factory Container Offload Charges
- Container costing now supports freight, other charges, commission (with ledger account), and duty.
- Duty has NONE / PENDING / CONFIRMED status — pending duty excluded from cost until confirmed.
- Duty confirmations logged in audit table with old/new values, user, and notes.

### Per-User Date Format
- Users can choose DD/MM/YYYY or MM/DD/YYYY in Settings → Preferences.
- Applied globally across all pages via `DateFormatContext`.

### ERP Page Access Control
- Replaced broad roles with per-user, per-page access for ERP (mirroring existing Factory access system).
- Managed via Settings → User Access Management (unified panel for ERP + Factory).

---

## Earlier

- Multi-company support with full data isolation.
- Double-entry accounting, vouchers, daybook, account statements.
- Inventory, stock transfers, purchase orders, container tracking.
- POS terminal with location-based user locking.
- Factory bale production, worker groups, factory financials.
- WebSocket real-time cache invalidation across all connected clients.
- AI chatbot for ERP data queries.
