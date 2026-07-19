# Program 8A — Incomplete Workflow Audit

## Status

Implementation-complete as a repository audit and prevention layer.

This phase does not implement business features that were deliberately left unfinished. It identifies them, classifies their current behavior, records their user impact, assigns the next owner phase, and prevents new placeholders from entering silently.

## Audit scope

Reviewed the prior no-op handler audit and searched the client, server, and shared source areas for:

- empty click, submit, and change handlers;
- TODO, FIXME, placeholder, stub, no-op, coming-soon, and not-implemented markers;
- unreachable dialogs and dead callback props;
- deterministic mock data presented through otherwise functional screens;
- structured server responses for unsupported workflow types.

The previous audit found no accidental callback breakage. The remaining findings are deliberate product gaps, dead legacy props, unreachable legacy UI, or structured/mock implementations.

## Classified workflows

### Opening raw stock manual import

`client/src/pages/factory/FactoryImport.tsx`

The opening-raw-stock chooser exposes a manual option whose callback is empty. CSV import remains the supported path. This is classified as an intentional placeholder and transferred to Program 8B for an explicit product decision: implement the complete manual workflow or remove/disable the unavailable action with clear user messaging.

### Supplier statement payment-edit prop

`client/src/pages/factory/FactorySuppliers.tsx`

The empty `onEditPayment` callback is passed through a prop that is not invoked by the visible statement rows. This is classified as a dead prop, not a broken user action. Program 8B owns removal or wiring after confirming the intended approval/edit policy.

### Accounts overview edit dialogs

`client/src/pages/Accounts.tsx`

The legacy bank and ledger edit dialogs receive empty callbacks but cannot be opened from this page. The Alter Account tab is the active edit path. This is classified as unreachable legacy UI and transferred to Program 8B for cleanup or explicit consolidation.

### Unsupported AI validation types

`server/routes/aiValidationRoutes.ts`

Unsupported validation types return a structured warning and do not report success. This is classified as a structured server stub. Program 8B owns either completing supported validation types or constraining the selectable options so users cannot choose unavailable work.

### Factory status linked-source values

`server/routes/factory/factoryStatusBuilderRoutes.ts`

Linked source values currently use deterministic mock data. This is classified as a deterministic mock source and must not be treated as authoritative operational information. Program 8B owns replacing it with real source queries or clearly restricting the feature to manual values.

## Added controls

### Explicit baseline

`scripts/program8a-incomplete-workflow-baseline.json`

Every accepted incomplete workflow now records:

- a stable identifier;
- classification;
- source path and marker;
- user impact;
- the owning follow-on phase.

### Regression guard

`scripts/verify-program8a-incomplete-workflows.mjs`

The verifier checks that:

- classifications are approved;
- IDs are unique;
- required metadata exists;
- source files and expected markers still exist;
- newly introduced empty handlers, coming-soon responses, not-implemented messages, or mock-source markers are classified rather than silently accepted.

## Safety boundary

No feature behavior was changed in 8A. In particular, this phase does not:

- implement or remove the opening-stock manual import;
- enable unreachable account dialogs;
- change supplier payment editing;
- alter AI validation results;
- replace factory status mock values with database queries;
- change accounting, stock, costing, posting, approval, reconciliation, permissions, APIs, or schema.

## Completion decision

Program 8A is complete because the known incomplete workflows are now explicit, reviewable, owned, and guarded against silent expansion. Behavior-changing resolution belongs to Program 8B, where approval and exception semantics can be considered before any workflow is enabled or removed.
