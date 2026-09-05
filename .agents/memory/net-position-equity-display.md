---
name: Net Position equity display
description: Partner equity remains outside asset/liability totals and is displayed only for Supplier Partner Net Position views.
---

Partner-capital accounts must remain typed as Equity and must not be folded into
What We Have or What We Owe.

The separate Partner Capital / Equity section is a Supplier Partner presentation
only. Normal ERP Net Position and Factory Net Position must not display that
section. Hiding it in those modes is a presentation rule only and must not
reclassify or delete the underlying Equity ledger accounts.

**Why:** Reclassifying partner capital as an asset or liability inflates or
misstates the balance-sheet totals and can break specialized Golden Coast
posting rules. Showing the partner-capital presentation in normal ERP or Factory
also exposes a Supplier Partner-specific view where it does not belong.

**How to apply:** Keep canonical Golden Coast types (`Equity` and `Loans`) in
the database. In shared/generic Net Position UI, gate the Partner Capital /
Equity section to `companyType === "supplier_partner"`. Keep normal ERP and
Factory Net Position views focused on What We Have, What We Owe, and Net
Position. The displayed Supplier Partner equity section remains excluded from
the ordinary asset/liability totals except where Supplier Partner accounting
explicitly includes an equity contribution in its specialized formula.
