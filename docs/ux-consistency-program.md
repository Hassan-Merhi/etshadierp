# Cross-Module UX Consistency Program

## Completion definition

UX consistency is complete when every authenticated route inherits the same workspace-level safeguards and every filter-heavy operational list uses a versioned, company-scoped filter contract with a visible reset-all action.

The repository enforces this with `npm run audit:ux-consistency` and the Mobile Responsiveness workflow.

## Global module coverage

All lazy-loaded page surfaces render inside one of four authenticated shells:

- ERP
- Factory
- POS
- Properties

Supplier Partner routes use the ERP shell. Each shell must render its route switch inside `WorkspaceRouteBoundary`, which provides:

- mobile touch targets for buttons and fields;
- form, image, dialog, tab, table, and horizontal-scroll containment;
- consistent accessible loading feedback;
- route-level error recovery;
- shared EN, French, and Arabic RTL document behavior through the application language provider.

The audit derives the module inventory directly from `client/src/lazyPages.ts`. New lazy modules are therefore included automatically and cannot bypass the shell contract silently.

## Filter-state coverage

The following high-risk list workflows have versioned persistence, company isolation, pagination reset where applicable, corrupt-storage recovery through the shared hook, and a visible reset-all action:

- Daybook
- All Daybook / Transaction Journal
- Factory Daybook
- Stock Items
- Customers
- Suppliers
- Stock Transfers
- POS Daybook
- POS Customers
- Factory Containers

Use `usePaginatedFilterState` for new list workflows. A page with no pagination may ignore the returned page state, but it must still scope the storage key to the selected company whenever its data is company-owned.

## Rendered release gate

The pull-request browser fixture creates disposable ERP, Factory, Properties, and Supplier Partner companies. The multilingual smoke switches between those companies and visits the primary accounting, inventory, list, dashboard, and operational routes in:

- English, French, and Arabic RTL;
- phone, tablet, and desktop viewports.

The gate rejects root horizontal overflow, missing application shells, missing skip navigation, wrong language or direction metadata, protected business identifiers rendered RTL, failed documents or assets, browser runtime errors, and unexpected permission redirects.

## Adding a module

1. Register the lazy page normally in `client/src/lazyPages.ts` and its workspace router.
2. Keep the route inside the existing shell; do not create another authenticated `<main>` element.
3. Use shared page-state, dialog, table, form, report, and workspace primitives.
4. For filter-heavy lists, use the shared persisted filter hook and add a reset-all control.
5. Add the route to the rendered workspace matrix when it introduces a new interaction pattern rather than duplicating an already-covered list or detail pattern.
6. Run `npm run audit:ux-consistency`, the frontend suite, and the responsive Phase 11 verifier.
