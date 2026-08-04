# Stock items bandwidth: lightweight callers

## Default behavior

`/api/stock-items/light` is paginated by default, capped at 100 records, and supports server-side search by original item name, code, barcode alias, selected IDs, and location. It returns only selector identity fields. Original stock item and stock group names are never translated or modified.

## Selector flows

Stock transfer, stock adjustment, and transfer-order workflows use server search or already-loaded location summaries. Selected/edit items are hydrated by ID, so opening a normal voucher screen no longer downloads the full company item list.

## Explicit full-list flows

Management, import, repair, and bulk-edit pages that genuinely require every lightweight identity record opt in with `all=true`. These are explicit on-demand operations rather than ordinary selector navigation.

## Full records

Full stock item data remains available from `/api/stock-items/:id` only after an item is selected or opened.

## Verification

The Phase 3–4 bandwidth contract verifies default pagination, the 100-record cap, original-name preservation, alias/location search, selected-ID hydration, and the absence of full-company item downloads from ordinary voucher selector flows.
