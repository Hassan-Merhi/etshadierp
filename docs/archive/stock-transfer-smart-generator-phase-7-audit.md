# Smart Multi-Source Stock Transfer — Phase 7 Audit

Branch: `feature/smart-multi-source-transfer`

## Scope audited

- Smart preview read path
- Optional voucher creation
- Optional voucher editing
- Voucher finalization / explicit approval
- Reopening a posted transfer as optional
- POS transfer revisions
- Admin revision approval
- Multi-source item and header persistence
- Company and location isolation
- Concurrent inventory mutations

## Lifecycle invariants

| State | `vouchers.optional` | `stock_transfer_vouchers.inventory_applied` | Inventory effect |
|---|---:|---:|---|
| Draft | true | false | None |
| Posted | false | true | Applied exactly once |
| Legacy mismatch: pending apply | false | false | Apply once and repair flag |
| Legacy mismatch: stale optional flag | true | true | Repair status without applying twice |

All state changes that move inventory lock the voucher and transfer rows in a database transaction.

## Mutation-path findings and disposition

### Optional transfer edit

**Finding:** The historical edit path reversed and reapplied inventory regardless of draft status.

**Disposition:** Shadowed by `stockTransferLifecycleRoutes`. Draft edits replace transfer rows only. Posted edits reverse old rows and apply new rows within one transaction.

### Draft finalization

**Finding:** The editor could previously change the optional flag before saving edited lines, creating a split-posting window.

**Disposition:** Direct draft-to-posted PATCH is rejected with `STOCK_TRANSFER_FINALIZE_REQUIRED`. Finalize locks the transfer and all source inventory, revalidates current quantities and applies the complete saved order once.

### Repeated finalization

**Finding:** Duplicate requests could move the same stock more than once.

**Disposition:** The locked lifecycle flags make repeated finalization an idempotent `no-op`.

### Multi-source headers

**Finding:** A multi-source transfer could display the first source as though it were the only source.

**Disposition:** Lifecycle updates and revision approval store `source_location_id = NULL` when more than one source is present. Every transfer item retains its exact source location.

### Pending POS revision updates

**Finding:** The legacy optional-revision route updated matching rows and then inserted the same payload again, producing duplicate revision items.

**Disposition:** Optional revisions are now exact per-user pending snapshots. Saving again locks the pending revision, deletes its old item rows and inserts the complete current snapshot once.

### Removed pending lines

**Finding:** The merge-style persistence retained omitted extra items, so a user could not reliably remove a previously added pending line.

**Disposition:** Exact snapshot replacement removes omitted lines correctly.

### POS source isolation

**Finding:** The backend trusted the revision payload's source location.

**Disposition:** POS revision items must match the user's assigned source location. All source and destination locations and stock items are revalidated against the current company.

### Concurrent revision approval

**Finding:** Two approval requests could read the same optional revisions and both apply their inventory deltas.

**Disposition:** Approval locks the requested revision, transfer, voucher and all pending revisions. The first request marks all pending revisions non-optional in the same transaction; the next request returns `no-op`.

### Changed stock after revision submission

**Finding:** Revision approval did not revalidate the latest source quantities.

**Disposition:** Positive deltas lock and validate each source/item balance. Negative deltas lock and validate destination stock before reversing quantities. Conflicts roll back the entire approval.

### Stale pending revisions

**Finding:** A pending revision could be approved after the base transfer was edited separately.

**Disposition:** Approval compares the revision's original quantity with the current transfer line. A mismatch returns `STOCK_TRANSFER_REVISION_STALE` and changes nothing.

### Audit trail

Pending revision saves and approvals now write audit-log records with transfer/revision identifiers, item counts, status transitions and recalculated totals. Audit logging is non-fatal after the inventory transaction succeeds.

## Regression coverage

- Smart historical transfer selection and sales windows
- Allocation math and source reserves
- Preview company isolation and read-only behavior
- UI preview validation and line merging
- Optional draft editing without inventory movement
- Atomic finalization and repeated-finalize no-op
- Reopen/unpost exactly once
- Insufficient-stock finalization rollback
- Pending revision exact replacement without duplicates
- Revision merge ordering
- Atomic revision approval and repeated-approval no-op
- Revision approval insufficient-stock rollback
- POS source-location enforcement

## Deployment notes

- No new database columns are required.
- New lifecycle routes must remain registered before the legacy voucher and fiscal-transfer handlers.
- The feature branch must be synchronized with current `main` before merge because it has diverged.
- Focused tests are included in the branch. They still require execution in an environment with the project database and test dependencies.
