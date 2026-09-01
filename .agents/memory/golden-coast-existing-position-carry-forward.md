---
name: Golden Coast cutover removal
description: Current Golden Coast behavior after removing the opening cutover prerequisite.
---

Golden Coast no longer requires a one-time opening cutover or FIFO bridge before POS, container operations, or monthly close can run. POS creates a transactional cost layer from the current ERP inventory quantity and average rate when no canonical sale-cost layer exists, then posts COGS and deducts stock atomically. Monthly close uses the canonical itemized sale records for revenue/COGS plus ledger shared charges, so it matches the SP report even when legacy POS vouchers only carry cash/payable entries.

Historical carry-forward routes and migration-owned container handling remain available for already-migrated data, but they are not part of the active setup path.

**Why:** The user does not need a cutover. Requiring a balancing opening journal would block ordinary operation, while silently posting a sale without a cost source would break COGS and stock integrity.

**How to apply:** Do not restore the POS/Phase 8/Phase 11 cutover prerequisite or expose the carry-forward panel in active setup UI. Preserve current inventory quantities/rates and fail closed when the current quantity or average rate cannot support a sale. Keep monthly close setup, confirmation, idempotency, and atomic posting protections.

Golden Coast partner equity accounts are credit-normal. A profit close must credit each partner’s equity account; if an account was provisioned with openingBalanceSide `Dr`, repair that side instead of reversing the close journal.

**Why:** The Accounts screen calculates ledger balances as opening side plus debits minus credits, so a Dr-normal partner equity account makes a correct profit credit appear to reduce the balance.

**How to apply:** Golden Coast setup must create and repair `gc_partner_capital` and `gc_owner_capital` with opening side `Cr`; existing posted profit-close vouchers should remain credit entries.