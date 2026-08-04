#!/usr/bin/env node
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const stockLight = read("server/routes/stock/stockLightRoutes.ts");
const itemDetail = read("server/routes/stock/groups-items/item-detail.ts");
const locationRoutes = read("server/routes/location/locationInventoryRoutes.ts");
const locationPaging = read("server/routes/location/locationInventoryPaging.ts");
const inventoryContext = read("server/routes/inventory/inventoryRequestContext.ts");
const inventoryQuery = read("server/routes/inventory/inventoryQueryService.ts");
const posRoutes = read("server/routes/stock/transfer-adj/price-list.ts");
const posPaging = read("server/routes/stock/transfer-adj/posPriceListPaging.ts");
const stockTransfer = read("client/src/pages/vouchers/StockTransferForm.tsx");
const inventoryQueries = read("client/src/pages/location-inventory/useLocationInventoryQueries.ts");
const combinedRows = read("client/src/pages/location-inventory/useCombinedStockRows.ts");
const posPage = read("client/src/pages/pos/POSPriceList.tsx");
const indexes = read("server/startup-schema/011-bandwidth-search-indexes.ts");
const startupIndex = read("server/startup-schema/index.ts");

const failures = [];
const requireText = (source, value, label) => {
  if (!source.includes(value)) failures.push(label);
};
const forbidText = (source, value, label) => {
  if (source.includes(value)) failures.push(label);
};

// Phase 3 — bounded lightweight stock-item identity/search endpoint.
requireText(stockLight, "MAX_STOCK_ITEM_PAGE_SIZE = 100", "stock-items/light page-size cap is missing");
requireText(stockLight, "parsePagination", "stock-items/light does not parse pagination");
requireText(stockLight, "parseSearchQuery", "stock-items/light does not support server search");
requireText(stockLight, "stock_item_code_aliases", "stock-items/light does not search or return aliases");
requireText(stockLight, 'req.query.locationId', "stock-items/light location filter is missing");
requireText(stockLight, 'req.query.ids', "stock-items/light selected-ID hydration is missing");
requireText(stockLight, '"Deprecation"', "legacy stock-items/light callers are not explicitly deprecated");
requireText(itemDetail, 'app.get("/api/stock-items/:id"', "dedicated full item-details endpoint is missing");
forbidText(stockLight, "openingQty", "stock-items/light leaks opening quantity");
forbidText(stockLight, "openingRate", "stock-items/light leaks opening rate");
forbidText(stockLight, "sellingPrice:", "stock-items/light leaks selling price");
forbidText(stockLight, "totalValue:", "stock-items/light leaks total value");
requireText(indexes, "stock_items_company_active_name_idx", "stock item company/name index is missing");
requireText(indexes, "stock_items_name_trgm_idx", "stock item searchable-name index is missing");
requireText(indexes, "stock_items_code_trgm_idx", "stock item code search index is missing");
requireText(indexes, "stock_item_aliases_alias_trgm_idx", "stock item alias search index is missing");

// Phase 4 — current location inventory uses one canonical route with page/summary profiles.
requireText(locationRoutes, "getPaginatedLocationInventory", "canonical location inventory route is not paginated");
requireText(locationRoutes, "getLocationInventorySummary", "location inventory summary profile is missing");
requireText(locationPaging, "maxPageSize: 100", "location inventory page-size cap is missing");
requireText(locationPaging, 'query.search', "location inventory server search is missing");
requireText(locationPaging, 'query.groupId', "location inventory group filter is missing");
requireText(locationPaging, 'query.categoryId', "location inventory category filter is missing");
requireText(locationPaging, 'averageRate: null', "POS inventory cost fields are not protected");
requireText(inventoryContext, "Math.min(100", "company inventory page-size cap is missing");
requireText(inventoryQuery, 'filters.profile === "combined"', "combined inventory profile is missing");
requireText(inventoryQuery, ".limit(filters.pageSize)", "combined inventory is not page bounded");
requireText(inventoryQuery, "qtyByLocationName", "combined inventory does not return visible table quantities");
requireText(inventoryQueries, 'summary: "true"', "inventory screen does not load summary first");
requireText(inventoryQueries, 'pageSize: "50"', "inventory screen does not request bounded pages");
requireText(inventoryQueries, 'profile: "combined"', "all-stock screen does not use combined server profile");
forbidText(inventoryQueries, "PAGE_SIZE = 5000", "inventory screen still requests 5,000-row pages");
forbidText(inventoryQueries, "remaining.flat()", "inventory screen still downloads every page automatically");
requireText(combinedRows, "qtyByLocationName", "combined stock rows do not consume server aggregates");

// POS price list: server paging/search and visible-page-only cost queries.
requireText(posRoutes, "getPaginatedPosPriceList", "POS price-list route is not paginated");
requireText(posPaging, "maxPageSize: 100", "POS price-list page-size cap is missing");
requireText(posPaging, "stock_item_code_aliases", "POS alias search is missing");
requireText(posPaging, "pli.stock_item_id = ANY($2::int[])", "POS cost lookup is not limited to visible item IDs");
requireText(posPage, "PaginatedPriceListResponse", "POS screen does not consume paginated responses");
requireText(posPage, "useDebouncedValue(search, 250)", "POS search is not debounced");
requireText(posPage, 'pageSize: String(pricePageSize)', "POS screen does not send a page size");
requireText(posPage, "<PaginationBar", "POS screen pagination controls are missing");

// Stock-transfer selectors/rates must not load a complete source inventory per row.
requireText(stockTransfer, "useStockItemSearch", "stock transfer does not use server-backed stock search");
requireText(stockTransfer, "inventory-rates?stockItemIds=", "stock transfer selected-rate batching is missing");
requireText(stockTransfer, 'pageSize: "100"', "stock transfer source inventory is not page bounded");
forbidText(
  stockTransfer,
  "fetch(`/api/locations/${entry.sourceLocationId}/inventory`)",
  "stock transfer still downloads a full location inventory per selected row"
);

// Runtime schema registration and original-name safety.
requireText(startupIndex, '"./011-bandwidth-search-indexes"', "bandwidth search indexes are not registered");
forbidText(stockLight, "translate", "stock-items/light attempts to translate original item names");
forbidText(posPaging, "translate", "POS paging attempts to translate original item/group names");

if (failures.length) {
  console.error("Bandwidth phases 3-4 contract failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      phases: [3, 4],
      status: "complete",
      stockItems: { maxPageSize: 100, serverSearch: true, aliases: true, fullDetailsOnDemand: true },
      inventory: { canonicalRoute: true, serverPagination: true, summaryFirst: true },
      pos: { serverPagination: true, serverSearch: true, visiblePageCostLookups: true },
      sqlRequired: true,
    },
    null,
    2
  )
);
