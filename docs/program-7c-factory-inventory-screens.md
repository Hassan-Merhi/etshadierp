# Program 7C — Factory and Inventory Screens

## Status

Implementation-complete on `integration/programs-1-to-6-validation`.

## Scope completed

- Added a shared Factory/Inventory page-header contract with module identity, responsive actions, descriptions, and filter placement.
- Added a shared operational KPI card and responsive KPI grid with tabular numeric presentation.
- Added a shared bordered table shell and horizontal-scroll wrapper for dense stock, bale, container, allocation, and movement tables.
- Reused the Program 7A loading, empty, and error states rather than creating module-specific duplicates.
- Kept all UI primitives presentation-only: no queries, mutations, API routes, calculations, stock quantities, landed costs, supplier rates, mix-batch costing, offload behavior, allocation behavior, transfer behavior, or historical records are changed.
- Preserved progressive adoption: workflow-heavy screens can adopt these primitives during normal maintenance without a broad mechanical rewrite.

## Standard screen composition

1. `OperationsScreenHeader`
2. `OperationsMetricGrid` with `OperationsMetricCard`
3. Program 7A loading/error/empty state when applicable
4. `OperationsTableShell` and `OperationsTableScroll`
5. Existing workflow dialogs and actions unchanged

## Regression guard

`scripts/verify-program7c-factory-inventory-screens.mjs` statically protects the shared contracts, responsive behavior, module token use, numeric alignment, table overflow behavior, and the presentation-only boundary.

## Explicitly unchanged

- Inventory valuation and quantities
- Negative-stock rules
- Container and offload calculations
- Supplier moving-average cost policy
- Mix-batch costing
- Bale allocation and relabeling
- Stock transfers and location separation
- API contracts, permissions, cache invalidation, and database behavior
