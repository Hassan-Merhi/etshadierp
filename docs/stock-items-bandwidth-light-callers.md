# Stock items bandwidth: lightweight voucher callers

## Scope

Voucher creation and voucher editing only require stock item identity fields (`id`, `code`, `name`, `uom`). They now use `/api/stock-items/light` instead of downloading the full stock item payload.

## Cache behavior

Both flows use the same query-key prefix and company id:

```ts
["/api/stock-items/light", selectedCompanyId]
```

This lets React Query share the lightweight response across voucher create/edit screens while preserving company-specific cache isolation.

## Safety

The full `/api/stock-items` endpoint remains unchanged for screens that require prices, costs, aliases, location pricing, tax fields, or other extended stock-item data.
