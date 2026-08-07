# Bandwidth Phase 4 — remaining heavy pages

This phase removes the remaining mounted-page request loops after the shared caching and payload phases.

- Pending Loadings refreshes at most once per visible minute.
- Daily Scan refreshes only the current day, at most once per visible minute; historical dates stop polling entirely.
- Successful daily scans and removals update the local query cache instead of downloading the full day again.
- Ground Scan moves from a four-second loop to a visible-tab thirty-second reconciliation interval.
- Dispatch Batches uses visible-tab polling, loads report summaries only while the Reports tab is open, and requests compact proforma summaries only while the create dialog is open.
- Mutation invalidations are limited to active affected query families.

No accounting, costing, inventory quantity, permission, database schema, or migration behavior changes.
