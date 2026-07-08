---
name: No per-location OTW data source
description: There is no reliable way to know how much of a stock item is "on the way" to a specific destination location in this codebase today.
---

`containers` (status='OTW') and `purchase_orders`/`po_line_items` track quantities per stock item per container/PO, but neither table links to a destination `location_id`. The only place OTW is aggregated today is client-side in CombinedInventory.tsx, and it is company-wide, not location-scoped.

**Why:** a feature that needs "in-transit quantity for item X headed to location Y" (e.g. stock-transfer suggestion analysis) cannot answer that question from current data without guessing which container is going where.

**How to apply:** when a feature needs per-item, per-destination-location OTW/in-transit quantity, return `otwQty: null` with an explicit reason string (e.g. "OTW not available from current data source.") rather than approximating from company-wide container totals. Revisit only if a future schema change adds a destination-location FK to containers or PO line items.
