---
name: Storage refactor missing functions
description: After storage.ts was split into domain modules, several functions were missing or had broken schema references. Documents the patterns found and fixed.
---

## The problem
`server/storage.ts` was split into domain files under `server/storage/`. The barrel (`server/storage.ts`) assembles them via spread: `...inventory, ...stockOps, ...accounting, ...`. Routes import `{ storage }` from `"../storage"` which resolves to the barrel.

## Broken schema references in inventory.ts
`inventory.ts` referenced `schema.codeAliases`, `schema.locationPrices`, `schema.CodeAlias`, `schema.LocationPrice`, `schema.InsertCodeAlias`, `schema.InsertLocationPrice` — **none of which exist** in the schema barrel. The real table names are:
- `schema.stockItemCodeAliases` / `schema.StockItemCodeAlias` / `schema.InsertStockItemCodeAlias`
- `schema.stockItemLocationPrices` / `schema.StockItemLocationPrice` / `schema.InsertStockItemLocationPrice`

Note: `stockItemLocationPrices` has **no `companyId` column** — filter by locationId or join via locations for company scoping.

## Function signature mismatches (call sites vs implementation)
- `upsertLocationPrice(stockItemId, locationId, sellingPrice)` — called with positional args, not an object
- `deleteLocationPrice(priceId)` — called with a single price row ID, not `(locationId, stockItemId)`

## Genuinely missing functions added to stockOps.ts
- `bulkGetStockItemsByIds(ids, companyId)` — filter stockItems by array of IDs scoped to company
- `bulkDeleteStockItems(ids)` — soft-delete (set deletedAt) multiple stock items
- `getAllCompanyCodeAliases(companyId)` — all stockItemCodeAliases for a company
- `createStockItemCodeAlias(data)` — insert into stockItemCodeAliases
- `deleteStockItemCodeAlias(aliasId)` — delete by aliasId

## Missing functions added to inventory.ts
- `getLocationByCode(code, companyId)` — lookup location by code + companyId
- `getStockGroupByCode(code, companyId)` — lookup stockGroup by code + companyId
- `getStockItemCodeAliases(stockItemId)` — alias for getCodeAliasesByStockItem
- `getStockItemCodeAliasById(aliasId)` — lookup single alias by ID
- `getAllLocationPrices(companyId)` — all location prices for company (joins via locations)
- `getStockItemLocationPrices(stockItemId, companyId)` — alias for getLocationPricesByStockItem
- `updateInventory(locationId, stockItemId, quantity, averageRate, totalValue, companyId?)` — upsert inventory row; derives companyId from location if not passed

## Audit method
```bash
grep -rn "storage\.\w\+" server/routes/ --include="*.ts" | grep -oP "storage\.\w+" | sort -u | while read fn; do
  funcname="${fn#storage.}"; found=$(grep -rn "export.*function $funcname\b" server/storage/ | head -1)
  if [ -z "$found" ]; then echo "MISSING: $funcname"; fi
done
```
**Why:** tsx transpiles without type-checking, so broken storage references crash at runtime (500 errors) not build time. Always audit after storage domain splits.
