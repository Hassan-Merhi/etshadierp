# Supplier Partner Finalization — Phases 3 and 4

Approved: 2026-08-03

## Phase 3 — Full sale reversal

Supplier Partner sales are corrected through a full compensating reversal. Partial returns remain outside the approved release scope.

The reversal workflow:

- is restricted to Admin and Developer roles;
- requires a written reason between 5 and 500 characters;
- locks the selected sale before validation so two requests cannot reverse it twice;
- accepts only a `posted` sale and changes it to `reversed` without deleting its history;
- refuses reversal when the sale month has a finalized Supplier Partner profit split;
- restores the exact original FIFO quantities to each `sp_stock_movements` lot;
- restores ERP location inventory through the Phase 2 atomic inventory guard;
- creates a new compensating journal voucher by swapping every debit and credit from the original sale voucher;
- preserves ledger, bank, supplier, customer, employee, asset and dual-currency entry references;
- appends the reason, date and acting user to the sale notes;
- rolls back the entire operation when any stock lot, inventory mapping, voucher or entry is missing.

The original sale and voucher remain immutable evidence. A reversal never edits or deletes them.

## Phase 4 — Open-container cancellation

Container cancellation is intentionally narrower than reverse offload. It applies only before offload or stock activity begins.

The cancellation workflow:

- is restricted to Admin and Developer roles;
- requires a written reason between 5 and 500 characters;
- locks the selected container before validation;
- accepts only a container whose status is `open`;
- refuses cancellation when an offload, SP stock movement or used prepaid amount exists;
- creates a compensating journal voucher that exactly reverses the original Goods OTW voucher;
- refuses a non-zero container that is missing its Goods OTW voucher;
- detaches unused prepaid charges so they remain available and auditable instead of deleting them;
- changes the container status to `cancelled` and appends the reason, date and acting user to its notes;
- prevents cancelled and offloaded containers from being edited through the existing PATCH endpoint;
- retains the original container, lines, voucher and prepaid-charge history.

An offloaded container must use the later reverse-offload workflow; it can never be routed through cancellation.

## User interface

- The Supplier Partner overview lists recent native SP sales and provides a reason-gated Reverse action for posted sales.
- The Supplier Partner container list shows cancelled status, prevents navigation into cancelled rows and provides a reason-gated Cancel action for open native SP containers.
- Both actions refresh stock, voucher and Supplier Partner report queries after completion.

## SQL

No SQL schema migration or data migration is required for Phases 3 and 4. Existing status and notes fields store the lifecycle state and audit explanation, while compensating vouchers preserve accounting history.
