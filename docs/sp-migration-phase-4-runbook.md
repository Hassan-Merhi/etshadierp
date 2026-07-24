# Supplier Partner Migration — Phase 4 Final Verification and Cutover Runbook

## Scope

This runbook applies to the staged ERP → Supplier Partner migration implemented by Phases 1–4. It does not delete source ERP business data. The source becomes read-only only after cutover preparation.

## Required merge order

1. Phase 1 — Supplier Partner correctness
2. Phase 2 — Migration completeness
3. Phase 3 — Production cutover controls
4. Phase 4 — Final verification and recovery hardening

Do not merge a later stacked PR before its base PR.

## Pre-cutover sequence

1. Run the staged migration steps in order:
   - Stock master
   - Stock opening by location
   - Historical sales read-only copy
   - Containers and Goods-OTW copy
   - Profit-share opening
2. Resolve every Migration Suspense entry.
3. Approve or map every container-charge review row.
4. Confirm all POS users have target location and cash-account mappings.
5. Call:

   `GET /api/sp/migration/final-verification?sourceCompanyId=<SOURCE>&targetCompanyId=<TARGET>`

6. A `FAIL` result must be resolved before preparation. A `WARN` result represents a safe final delta that Phase 4 can synchronize while both companies are locked.

## Prepare

Call `POST /api/sp/migration/cutover/prepare` with:

```json
{
  "sourceCompanyId": 1,
  "targetCompanyId": 2,
  "companyNameConfirm": "EXACT SOURCE COMPANY NAME",
  "confirmation": "PREPARE CUTOVER",
  "rollbackWindowHours": 72
}
```

Preparation locks writes to both source and target. Reads remain available. Authentication and cutover/review-mapping endpoints remain usable. Other staged migration writes and migration-run rollback are blocked until the cutover is cancelled or rolled back.

## Finalize

Call `POST /api/sp/migration/cutover/finalize` with:

```json
{
  "sourceCompanyId": 1,
  "targetCompanyId": 2,
  "companyNameConfirm": "EXACT SOURCE COMPANY NAME",
  "confirmation": "FINALIZE CUTOVER"
}
```

Finalization performs:

- final historical-sale copy and provenance repair;
- final container header, line, supplier and Goods-OTW reconciliation;
- exact inventory quantity, average-rate and stored-value synchronization;
- zeroing of target-only inventory rows for migrated stock items across every target location;
- final verification;
- user role, location, cash mapping, session and presence switch.

Activation occurs only when final verification is `PASS`.

## Automatic recovery

If finalization throws after inventory or user changes begin, Phase 4 attempts to restore:

- source roles and all source user mappings;
- pre-existing target roles and target mappings;
- target inventory values captured before final synchronization.

The cutover remains prepared and locked for review. Partial sales/container delta work is recorded; cancelling after any finalization work keeps the target read-only so an incomplete migration copy cannot become operational.

## Controlled rollback

Rollback is available only before the configured deadline and only if the target has no genuine post-cutover activity.

Call `POST /api/sp/migration/cutover/rollback` with:

```json
{
  "cutoverId": 123,
  "companyNameConfirm": "EXACT SOURCE COMPANY NAME",
  "confirmation": "ROLLBACK CUTOVER"
}
```

After rollback:

- source users and inventory state are restored;
- the old source becomes writable again;
- the target migration copy remains read-only to prevent split-brain operation.

A new cutover may be prepared later. To abandon the migration copy entirely, a Developer may explicitly release the target hold only after confirming that the target has no genuine transactions.

## Release target hold

Call `POST /api/sp/migration/cutover/release-target-hold` with:

```json
{
  "cutoverId": 123,
  "companyNameConfirm": "EXACT SOURCE COMPANY NAME",
  "confirmation": "RELEASE TARGET HOLD"
}
```

## Required smoke checks after activation

- Open the Supplier Partner dashboard and reports.
- Confirm opening stock by location.
- Confirm aliases resolve the expected stock items.
- Create and reverse one test container in a non-production rehearsal company.
- Create and reverse one test sale in a non-production rehearsal company.
- Confirm supplier statement and Goods-OTW voucher supplier filters.
- Confirm POS users open the correct target location and cash account.
- Confirm the old ERP rejects writes with `SP_SOURCE_READ_ONLY`.
- Confirm the post-activation verification areas remain `PASS`; legitimate post-cutover activity is reported but no longer treated as a preparation blocker.

## Production warning

No production cutover should be started until the four stacked PRs are merged in order and the application has successfully built against a test PostgreSQL database.
