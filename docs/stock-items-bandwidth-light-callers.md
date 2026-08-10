# Stock items bandwidth: lightweight voucher callers

## Scope

Voucher creation and voucher editing only require stock item identity fields (`id`, `code`, `name`, `uom`). They use the dedicated identity profile instead of downloading the richer stock-item payload:

```text
GET /api/stock-items/light?profile=identity
```

The response contains only:

- `id`
- `code`
- `name`
- `uom`

The server marks this contract with:

```text
X-ERP-Payload-Profile: stock-items-identity-v1
```

## Cache behavior

The high-frequency voucher flows use the shared company-scoped query key:

```ts
stockItemKeys.identity(selectedCompanyId)
// ["/api/stock-items/light?profile=identity", selectedCompanyId]
```

This keeps the real compact request URL in query-key element zero, allowing the shared query function to fetch the correct profile while React Query shares the response across voucher create/edit screens. The identity response is treated as stable reference data with a 30-minute stale period and two-hour garbage-collection window.

Factory Customer Proformas uses the same identity profile for Add Item and does not enable that query until the Add Item dialog is open.

## Safety

The default `/api/stock-items/light` contract remains available for callers that need `active`, `stockGroupId`, `categoryId`, or `gradeId` in addition to identity fields.

The full `/api/stock-items` endpoint remains unchanged for screens that require prices, costs, aliases, location pricing, tax fields, or other extended stock-item data.

Routine workflow writes such as vouchers, orders, scans, and customer-proforma edits do not evict the identity/reference catalog cache. Writes that actually change stock items or other reference datasets still invalidate reference caches.