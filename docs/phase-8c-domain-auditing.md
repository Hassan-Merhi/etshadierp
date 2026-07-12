# Phase 8C — Inventory, Transfer, and Container Auditing

Phase 8C verifies that the principal inventory, stock-transfer, stock-adjustment, container lifecycle, container offload, and container freight mutation routes remain connected to the shared audit framework introduced in Phase 8A.

## Covered mutation areas

- inventory mutations in `server/routes/inventoryRoutes.ts`;
- stock transfers and stock adjustments in `server/routes/stock/stockTransferAdjRoutes.ts`;
- container create, update, and delete flows in `server/routes/containers/containerCrudRoutes.ts`;
- container offload and offload-edit flows in `server/routes/containers/containerOffloadRoutes.ts`;
- container freight and related write flows in `server/routes/containers/containerFreightWriteRoutes.ts`.

These routes use the established `logAudit` API. Phase 8B routed that API through `writeAuditEvent`, so Phase 8C domain events receive the same sanitization, redaction, payload bounds, actor normalization, and safe failure logging as voucher and POS events.

## Regression guard

`server/services/audit/domainAuditCoverage.test.ts` fails if any covered mutation file loses its awaited audit call or if the compatibility adapter stops delegating to the shared audit framework.

## Safety

This package does not alter inventory quantities, transfer posting, container accounting, offload calculations, transaction boundaries, or production data. It adds coverage verification and documentation only.
