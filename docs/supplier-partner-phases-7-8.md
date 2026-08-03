# Supplier Partner Phases 7-8

Phase 7 adds named SP permissions, exact confirmation and reason requirements for sensitive actions, company-scoped authorization, idempotency protection, and audit events.

Phase 8 adds a full reconciliation endpoint and matching CSV export for stock, Goods-OTW, supplier balances, profit, profit split, opening stock, container cost, prepaid, parent-agent, and migration balances.

The application creates its supporting permission, audit, and idempotency tables automatically. No manual SQL is required. CI and GitHub Actions remain deferred to Phase 10.
