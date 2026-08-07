# Phase 4 — Customer Route Extraction

Phase 4 removes the final customer compatibility ownership from `customerRoutesLegacy.ts`.

## Focused ownership

- `customers/customerMasterRoutes.ts`: customer picker, list, stats, transactions, read, create, update, and delete.
- `containers/containerSalesRoutes.ts`: container-sale listing, customer filtering, and sale creation.
- `transfers/companyTransferRoutes.ts`: inter-company transfers, simple transfers, and cross-company account access.

## Compatibility boundary

`customerRoutesLegacy.ts` is now a no-op registrar with no HTTP handlers. Its line ceiling is reduced from 1,073 to 12, with a deletion target of zero.

## Contract

`tests/customer-route-composition.test.ts` requires every focused registrar, prohibits the legacy import from the production composition root, and prevents HTTP handlers from returning to the compatibility file.

Runtime and CI checks were intentionally not executed as part of this structural phase.
