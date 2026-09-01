---
name: Supplier Partner ledger subtypes
description: Compatibility rule for editing Supplier Partner chart-of-accounts records through generic ledger screens.
---

Supplier Partner chart-of-accounts roles use special subtypes that are valid accounting metadata, not ordinary UI subtype choices. Generic ledger create/edit validation must preserve those subtype values for their matching account types; `sp_payable` also has legacy `Accounts Payable` records.

**Why:** the Accounts edit form submits the existing subtype even when the generic subtype selector cannot display it. Rejecting that value makes harmless opening-balance edits fail.

**How to apply:** keep SP subtype values visible/preservable in the edit UI and allow them in the server validator without changing the account’s role or silently clearing the subtype.