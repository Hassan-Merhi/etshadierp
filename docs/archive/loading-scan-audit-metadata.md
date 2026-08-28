# Loading scan audit metadata

The Factory container loading scanner now records an exact database-server timestamp for new `customer_order_bales` rows and exposes it alongside the existing `scanned_by` value.

The detailed Scanned Bales list displays the scanner name plus the user's local date/time under each reference. Historical rows are not backfilled with an invented timestamp. Cancellation/restoration preserves the original timestamp through `customer_order_bales_history`.

The UI reads audit metadata through the existing `GET /api/factory/customer-orders/:id/bale-removals` route with `includeScanAudit=1`, so the route manifest does not gain a new endpoint.
