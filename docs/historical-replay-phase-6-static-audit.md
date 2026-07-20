# Historical Replay — Phase 6 Static Safety Audit

Date: 2026-07-20  
Branch: `fix/historical-replay-phase-1-executor`

## Audit boundary

This is a source-level audit only. No test runner, type checker, build, linter, server, CI workflow, database migration, endpoint, replay, undo, deployment, or production write was executed.

The review covered the active Historical Replay route/service chain, opening-balance assignment, prepared client requests, offline queue policy, migration registration, exact undo, and the focused regression files under `tests/`.

## Static findings

### 1. Transaction, executor and input locks

The active facade points to the final `applyExactHistoricalCostReplayV6` implementation. Apply uses one PostgreSQL client, starts a serializable transaction, takes the company replay advisory lock, rebuilds the exact scope through that executor, recomputes the authoritative digest/fingerprint, locks the literal approved rows, writes, validates, persists undo/audit state, and commits on the same client.

Before apply calculations, the selected suppliers, their containers, raw-stock rows, receipt rows, landed-cost charges, commissions, other charges, raw-material adjustments and legacy offload-daybook evidence are locked through that transaction executor. Supplier-first lock ordering matches normal supplier-rate write flows. Serializable isolation protects the read snapshot and detects conflicting predicate changes.

Prepare uses one repeatable-read transaction snapshot for supplier selection, preview, scope, digest, fingerprint, frozen options, and token creation. No active final apply calculation intentionally falls back to the global pool after the transaction client is acquired.

### 2. Exact supplier dependency closure

The correction plan starts from selected suppliers' `SUPPLIER_LOCKED_RATE` sources and follows downstream `sourceBatchId` dependencies. Repeated source rows from one upstream batch are deduplicated as one graph edge. Unrelated company batches are not added.

Corrected downstream `BATCH` rows are included. `CONTAINER_DIRECT` rows inside the selected closure use canonical landed cost and block with `UNRESOLVED_FX` when that value cannot be proven. Missing, cyclic, manual-review, unresolved, and excluded-completed dependencies block the affected chain.

A parent batch is also included when corrected source rows offset one another and leave its aggregate cost numerically unchanged; this keeps every source write under an exact signed, locked batch parent.

### 3. Chronology and signed quantity

Receipts and batch consumptions use real event timestamps. A same-day receipt/consumption pair with missing or equal timestamps blocks rather than using receipt-first ordering. Receipt-relative ADD, REMOVE and DEDUCT adjustments receive the same protection: a same-day receipt/adjustment pair whose order cannot be proven marks that supplier unsafe with `TIMELINE_ORDER_AMBIGUOUS`.

Consumption and removals preserve signed remaining quantity. Only the old quantity contribution in the next receipt moving-average formula is floored with `max(0, oldRemainingKg)`; the stored replay quantity itself is not clamped.

### 4. Persisted container and raw-stock targets

Container mismatch detection compares against the actual persisted write targets:

- `factory_containers.rate_per_kg_usd`;
- `factory_containers.final_payable_amount_usd`.

The stored total is not reconstructed as received kilograms multiplied by stored rate, which would omit freight, commission, duty, and other landed charges. Preview and exact scope use the same persisted-target normalization.

Raw-stock mismatches are calculated independently from container mismatches. A stale raw-stock USD rate remains in the exact signed scope even when the container target is already correct, and vice versa.

### 5. Prepared scope and token binding

Prepare rejects malformed or empty supplier selections; an empty list no longer means “all safe suppliers.” A token-backed request cannot be reinterpreted as another dry run. The signed token is bound to company, issuing user, selected safe suppliers, completed/finalized options, exact container/raw-stock/source/batch/bale IDs, blocked reasons, algorithm version, authoritative digest, scope fingerprint, and expiration.

Apply derives authority from the verified token. The client request layer replaces current checkbox/selection values with the server-returned prepared state. After a reload, it sends only the signed token so the server remains the authority.

Historical replay, repair/undo, and opening-balance bale assignment requests are explicitly excluded from the offline queue. They cannot be stored in localStorage and replayed later after a token expires or the database changes.

### 6. Exact writes

The final writer iterates only literal signed IDs. Updates are company/relationship scoped and require `rowCount === 1`. Container totals use canonical total USD. Raw stock requires the exact raw-stock-to-container mapping and canonical rate, without requiring a separate container write. Supplier, direct-container, and downstream-batch source corrections come from the exact map. Bale writes use only signed IDs and require continued ownership by an approved batch.

The supplier ending rate may legitimately be zero and is persisted as `0.00000000`, distinguishing it from historical `NULL`. Negative rates are rejected. Consumption paths remain unable to create, average, or change the supplier rate.

### 7. Bale finalization

The company-scoped classifier uses only schema-supported signals:

- finalized/sold/dispatched/reserved lifecycle status;
- `finalized_at`;
- a live company customer-order relationship;
- invoice-loading ownership.

The current `factory_bales` schema has no `dispatch_batch_id`, so dispatch ownership is represented by lifecycle status. The schema also has no direct POS-sale-item-to-bale foreign key; `SOLD` status is the supported POS signal. Finalized IDs are written only when the frozen token option includes them.

### 8. Cost-only invariants

Exact snapshots retain a JSONB image of every persisted column except the specific cost fields replay may change and `updated_at`. Post-write validation compares these complete non-cost images for containers, raw stock, sources, batches, bales, and suppliers.

This protects quantities, signed negative stock, used kilograms, ownership, source dependencies, statuses, locations, finalization relationships, deletion state, and future non-cost columns. Persisted batch totals must equal `SUM(factory_mix_batch_sources.total_cost)`, and each source total must agree with `weight_kg × cost_per_kg` within tolerance.

### 9. Undo

Exact undo is admin/developer protected and company scoped. It locks the undo log and literal affected rows, rejects already-undone or different-version snapshots, proves current non-cost and cost state still matches the post-replay snapshot, restores only captured cost fields with exact row-count checks, re-verifies restoration, and writes the undo marker/audit in the same transaction. A stale undo cannot overwrite later changes.

### 10. Opening-balance bale assignment

The active assignment route takes the replay lock and assignment lock, then locks the opening-balance raw-stock row, container, selected bales, and supplier rate in one serializable transaction. It revalidates company, deletion, opening-balance status, bale availability/linkage, and weight under lock.

Supplier-linked stock reads the already-persisted authoritative rate and writes `SUPPLIER_LOCKED_RATE`; it never derives or changes the supplier rate. Non-supplier opening stock remains `CONTAINER_DIRECT` and must have an explicit stored USD cost—native currency is never treated as USD.

### 11. Persistent schema and legacy compatibility

Migration `0007_factory_historical_replay_safety.sql` is registered and owns consumed-token and exact-undo schema. The active wrapper suppresses the preserved legacy module's old synchronous startup `CREATE TABLE` call and immediately restores `pool.query`. Exact replay handlers register first; unrelated legacy recalculation/history/non-replay undo routes remain available.

Older replay implementation files remain only for compatibility. The active facade and route ordering select the final implementation. Cleanup should happen separately after controlled runtime validation.

## Regression code written

Focused tests now cover production functions and wiring for receipt/consumption and receipt/adjustment chronology, signed negative stock, selected closure, duplicate dependency edges, `BATCH` and `CONTAINER_DIRECT` corrections, offsetting source-only parents, persisted container targets, independent raw-stock scope, fingerprint/scope changes, schema-supported bale classification, finalized option gating, complete non-cost invariants, stale undo, persisted source totals, authoritative input locks, prepared client state, offline exclusion, opening-balance safety, migration ownership, and route/algorithm wiring.

These tests were written but not executed.

## Static verdict

No known source-level blocker remains in the inspected Phase 1–6 Historical Replay path.

This is **not** runtime verification and is **not authorization to apply Historical Replay**. Before apply can be considered, the branch must be reviewed and merged only with explicit approval, migration 0007 must be applied through the controlled release process, tests/typecheck/build must run in an appropriate environment, the deployed read-only preview must be reviewed, and a newly prepared dry run must show an acceptable exact scope.

Until then: **DO NOT RUN OR APPLY HISTORICAL REPLAY.**
