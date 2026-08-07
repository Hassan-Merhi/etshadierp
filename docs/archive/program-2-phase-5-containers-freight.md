# Program 2 — Phase 5: Containers, Freight, Commissions, and Post-Offload Charges

Status: complete

## Scope

Phase 5 formalizes the current-source accounting and costing boundaries for Factory containers without replacing the specialized container lifecycle.

Covered workflows:

- raw-stock container creation and offload;
- supplier and broker liability effects;
- freight and commission currency handling;
- post-offload charges and their linked vouchers;
- own-account versus supplier-paid freight;
- landed-cost and raw-material recalculation;
- historical and closed-container repair boundaries.

## Protected invariants

1. Every container, supplier, broker, ledger, currency, and Factory company reference must remain company-owned.
2. Container business currency, freight currency, commission currency, and stored historical exchange rates remain explicit and are never silently replaced by a current rate.
3. Supplier-paid freight may affect supplier or broker liabilities; own-account freight must not be added to the supplier or broker statement.
4. Post-offload charges require an owned supplier or ledger target before a voucher is created.
5. Voucher debits and credits remain balanced and use distinct debit and credit targets.
6. Container landed cost, raw-material value, and downstream mix-batch cost repairs must use the approved recalculation services rather than direct ad hoc balance edits.
7. Recalculation and repair operations remain admin-controlled, dry-run capable where implemented, idempotent, audit logged, and fail closed for unresolved historical currency data.
8. Closed, completed, or already-offloaded historical records remain protected from automatic mutation unless an explicit reviewed repair path permits the operation.
9. Fully used and zero-remaining containers remain included in reconciliation evidence and are not silently omitted.
10. No repair may change supplier cost-per-kilogram because of mix-batch consumption; supplier cost changes only through approved new offload or reviewed historical repair inputs.

## Compatibility boundaries

The specialized Factory routes remain authoritative for container lifecycle, offload, raw stock, supplier balances, broker statements, post-offload charges, and costing recalculation. Phase 5 does not route these workflows through the generic voucher endpoint.

The following remain isolated:

- container tracking and carrier ETA updates;
- physical offload quantities and bale production;
- mix-batch production formulas;
- Supplier Partner container conversion;
- Historical Replay Apply/Undo;
- manual production-database repair.

## Evidence files

- `server/routes/factory/raw-stock/rawStockContainerRoutes.ts`
- `server/routes/factory/raw-stock/rawStockOffloadRoutes.ts`
- `server/routes/factory/suppliers/supplierCrudRoutes.ts`
- `server/routes/factory/suppliers/supplierBrokerRoutes.ts`
- `server/routes/factory/suppliers/supplierBalanceRoutes.ts`
- `server/services/factory/currencyConversion.ts`
- `docs/archive/program-2-accounting-convergence.md`

## Scope protection

This completion slice adds documentation and static verification only. It changes no live container amount, supplier balance, freight formula, commission formula, exchange rate, landed cost, raw-stock quantity, mix-batch cost, voucher, database schema, permission, or user interface.

No database schema or historical record changed.
