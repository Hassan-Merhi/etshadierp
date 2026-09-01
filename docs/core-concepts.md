# Core Concepts

## Multi-Tenancy (Companies)
Every piece of data belongs to a company. When you log in, you choose which company to work in. Users can belong to multiple companies and switch between them. Data never leaks across companies — the only exception is suppliers, which are shared globally.

---

## Two Modes: ERP and Factory
The system has two separate operational modes with distinct sidebars and access controls:

- **ERP mode** — for office/accounting work: inventory, purchasing, accounting, payroll, POS.
- **Factory mode** — for production work: bale creation, worker management, factory financials.

Both modes share the same database. A "Factory" account or employee is just an entity flagged for factory use.

---

## Double-Entry Accounting
All financial transactions use double-entry bookkeeping. Every voucher must have debits equal to credits. Account balances flow from vouchers — there is no shortcut to manually set a balance (except via opening balance entries).

**Dr/Cr convention used here:**
- Asset & Expense accounts → positive balance = Dr (you own it / you spent it)
- Liability, Equity & Income accounts → positive balance = Cr (you owe it / you earned it)
- Employee accounts → Cr (company owes the employee)
- Supplier accounts → Cr (company owes the supplier)

---

## Vouchers
A voucher is the atomic unit of any financial transaction. It contains one or more journal lines (account + amount + Dr/Cr side). Examples: payment voucher, purchase voucher, salary voucher.

---

## Locations
Stock and sales are tied to locations (warehouses, shops, factories). A user can be locked to a specific location (used for POS users). Inventory levels are tracked per-item per-location.

---

## Page Access Control
Rather than broad roles, the system uses per-user, per-page access. An admin grants individual users access to specific sidebar pages. This applies independently to ERP and Factory modes.

---

## Salary Advances
A salary advance is a loan from the company to an employee. It has an original amount and a remaining balance. When payroll is run, outstanding advances are shown as deductions. The advance is marked **Fully Paid** automatically once the remaining balance reaches zero.

---

## Real-Time Updates
When any user saves or deletes data, all other connected users see the change immediately — no manual page refresh needed. This is powered by a WebSocket connection that triggers a data refresh in the background.

---

## Date Format
Each user can choose their preferred date format (DD/MM/YYYY or MM/DD/YYYY) in Settings → Preferences. This affects all date displays across the entire app for that user only.
