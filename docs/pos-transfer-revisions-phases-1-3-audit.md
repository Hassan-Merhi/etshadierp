# POS transfer revisions — implementation audit

## Confirmed original defects

1. Revision saves overwrote an existing optional revision.
2. The legacy write path could duplicate revision-item rows.
3. Revision read endpoints merged separate POS revisions.
4. Approval applied a merged revision set rather than one explicit revision.
5. The POS list and eye dialog did not clearly communicate transfer direction, quantities, or revision history.

## Phases 1–3

- Audited the original lifecycle.
- Added immutable revision creation.
- Returned stored revisions separately in revision-number order.

## Phases 4–6

- Revisions calculate from the latest effective quantity.
- Approval targets one explicit pending revision and blocks stale or duplicate application.
- The detail dialog shows source, destination, original/current totals, item comparisons, and complete revision history.

## Phases 7–9

- The comparison view classifies every item as Added, Removed, Increased, Reduced, or Unchanged.
- The POS list uses responsive transfer cards and batched revision metadata.
- Labeled View details and Create revision actions replace unexplained icon-only controls.

## Phases 10–12

- The editor starts from the latest effective snapshot.
- Historical revisions remain immutable and separate.
- Pending, Approved, Rejected, and Superseded lifecycle states are auditable.

## Phases 13–15

- Zero-item and unusual-transfer diagnostics return explicit reason codes.
- Company and POS-location access checks protect details and lifecycle endpoints.
- English, Arabic, and French copy plus live RTL/LTR switching are included.

## Phases 16–17

- Contract regression coverage verifies immutable numbering, effective baselines, approval safeguards, lifecycle states, and access isolation.
- Final release requires green CI, Security, I18n Audit, and release verification on the latest branch head.
- Historical overwritten values are never fabricated when the original data no longer exists.

## Verification trigger

This documentation-only commit intentionally triggers a fresh full verification run against the latest Phase 1–17 implementation head.
