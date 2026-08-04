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
const stockTransferBandwidth = read("client/src/pages/vouchers/stocktransferform/bandwidth.ts");
const stockAdjustment = read("client/src/pages/vouchers/StockAdjustmentForm.tsx");
const stockTransferOrder = read("client/src/pages/StockTransferOrder.tsx");
const stockTransferOrderItems = read("client/src/pages/stocktransferorder/useStockTransferOrderItems.ts");
const voucherQueries = read("client/src/pages/vouchers/useVoucherQueries.ts");
const inventoryQueries = read("client/src/pages/location-inventory/useLocationInventoryQueries.ts");
const combinedRows = read("client/src/pages/location-inventory/useCombinedStockRows.ts");
const combinedView = read("client/src/pages/location-inventory/CombinedStockView.tsx");
const stockGroupSummaries = read("client/src/pages/location-inventory/useStockGroupSummaries.ts");
const posPage = read("client/src/pages/pos/POSPriceList.tsx");
const posClientPaging = read("client/src/pages/pos/pospricelist/usePaginatedPriceList.ts");
const posTypes = read("client/src/pages/pos/pospricelist/types.ts");
const paginationBar = read("client/src/components/PaginationBar.tsx");
const queryKeys = read("client/src/lib/queryKeys.ts");
const program6cTest = read("tests/program-6c-stock-light-route.test.ts");
const indexes = read("server/startup-schema/011-bandwidth-search-indexes.ts");
const startupIndex = read("server/startup-schema/index.ts");

const failures = [];
const requireText = (source, value, label) => {
  if (!source.includes(value)) failures.push(label);
};
const forbidText = (source, value, label) => {
  if (source.includes(value)) failures.push(label);
};
const requireLineCap = (source, cap, label) => {
  const count = source.split(/\r?\n/).length;
  if (count > cap) failures.push(`${label}: ${count} lines exceeds ${cap}`);
};

// Phase 3 — bounded lightweight stock-item identity/search endpoint.
requireText(stockLight, "MAX_STOCK_ITEM_PAGE_SIZE = 100", "stock-items/light page-size cap is missing");
requireText(stockLight, "parsePagination", "stock-items/light does not parse pagination");
requireText(stockLight, "parseSearchQuery", "stock-items/light does not support server search");
requireText(stockLight, "stock_item_code_aliases", "stock-items/light does not search or return aliases");
requireText(stockLight, "req.query.locationId", "stock-items/light location filter is missing");
requireText(stockLight, "req.query.ids", "stock-items/light selected-ID hydration is missing");
requireText(stockLight, 'req.query.all === "true"', "explicit full-list opt-in is missing");
requireText(stockLight, "paginated = !explicitFullList", "stock-items/light is not paginated by default");
requireText(stockLight, '"Deprecation"', "explicit full-list callers are not marked as deprecated");
requireText(itemDetail, 'app.get("/api/stock-items/:id"', "dedicated full item-details endpoint is missing");
forbidText(stockLight, "openingQty", "stock-items/light leaks opening quantity");
forbidText(stockLight, "openingRate", "stock-items/light leaks opening rate");
forbidText(stockLight, "sellingPrice:", "stock-items/light leaks selling price");
forbidText(stockLight, "totalValue:", "stock-items/light leaks total value");
requireText(indexes, "stock_items_company_active_name_idx", "stock item company/name index is missing");
requireText(indexes, "stock_items_name_trgm_idx", "stock item searchable-name index is missing");
requireText(indexes, "stock_items_code_trgm_idx", "stock item code search index is missing");
requireText(indexes, "stock_item_aliases_alias_trgm_idx", "stock item alias search index is missing");
requireText(queryKeys, '["/api/stock-items/light", companyId]', "canonical lightweight stock query key changed");
requireText(queryKeys, "allLight", "explicit all-record stock query key is missing");

// Ordinary voucher selectors must not request the explicit full company list.
forbidText(voucherQueries, "/api/stock-items/light", "voucher shell still downloads a full stock-item list");
requireText(stockTransfer, "useStockItemSearch", "stock transfer does not use server-backed stock search");
requireText(stockTransferBandwidth, "inventory-rates?stockItemIds=", "stock transfer selected-rate batching is missing");
requireText(stockTransfer, 'pageSize: "100"', "stock transfer source inventory is not page bounded");
forbidText(
  stockTransfer,
  "fetch(`/api/locations/${entry.sourceLocationId}/inventory`)",
  "stock transfer still downloads a full location inventory per selected row"
);
requireText(stockAdjustment, "effectiveAdjustmentLocationId", "stock adjustment location-scoped search is missing");
requireText(stockAdjustment, 'includeZero: "true"', "stock adjustment cannot search zero-stock production items");
requireText(stockAdjustment, 'params.set("ids"', "stock adjustment selected/edit item hydration is missing");
forbidText(stockAdjustment, "/api/stock-items/light", "stock adjustment still downloads a full item list");
requireText(stockTransferOrder, "useStockTransferOrderItems", "transfer order bandwidth loading was not extracted");
requireText(stockTransferOrderItems, "useStockItemSearch", "transfer order edit hydration is not bounded");
requireText(stockTransferOrderItems, "summaryQuery.data?.stockGroups", "transfer order does not reuse location-summary identity");
forbidText(stockTransferOrder, 'queryKey: ["/api/stock-items/light"', "transfer order still downloads a full item list");

// Phase 4 — current location inventory uses one canonical route with page/summary profiles.
requireText(locationRoutes, "getPaginatedLocationInventory", "canonical location inventory route is not paginated");
requireText(locationRoutes, "getLocationInventorySummary", "location inventory summary profile is missing");
requireText(locationPaging, "maxPageSize: 100", "location inventory page-size cap is missing");
requireText(locationPaging, "query.search", "location inventory server search is missing");
requireText(locationPaging, "query.groupId", "location inventory group filter is missing");
requireText(locationPaging, "query.categoryIds", "location inventory multi-category filter is missing");
requireText(locationPaging, "parseIdList(query.ids)", "location inventory selected-ID hydration is missing");
requireText(locationPaging, '"hasUncategorized"', "location inventory uncategorized summary metadata is missing");
requireText(locationPaging, "averageRate: null", "POS inventory cost fields are not protected");
requireText(inventoryContext, "Math.min(100", "company inventory page-size cap is missing");
requireText(inventoryQuery, 'filters.profile === "combined"', "combined inventory profile is missing");
requireText(inventoryQuery, ".limit(filters.pageSize)", "combined inventory is not page bounded");
requireText(inventoryQuery, "qtyByLocationName", "combined inventory does not return visible table quantities");
requireText(inventoryQuery, "totalQuantity", "combined inventory global quantity totals are missing");
requireText(inventoryQuery, "totalValue", "combined inventory global value totals are missing");
requireText(inventoryQueries, 'summary: "true"', "inventory screen does not load summary first");
requireText(inventoryQueries, 'pageSize: "50"', "inventory screen does not request bounded pages");
requireText(inventoryQueries, 'profile: "combined"', "all-stock screen does not use combined server profile");
requireText(inventoryQueries, 'params.set("categoryIds"', "inventory screen does not send all selected categories");
requireText(inventoryQueries, "allInventoryTotals", "all-stock global totals are not preserved");
forbidText(inventoryQueries, "PAGE_SIZE = 5000", "inventory screen still requests 5,000-row pages");
forbidText(inventoryQueries, "remaining.flat()", "inventory screen still downloads every page automatically");
requireText(combinedRows, "qtyByLocationName", "combined stock rows do not consume server aggregates");
requireText(combinedView, "Number(totals.value ?? 0)", "all-stock value card still uses page-only totals");
requireText(stockGroupSummaries, "hasUncategorized", "uncategorized group filtering is not reliable");

// POS price list: server paging/search, global KPIs, page-scoped costs, and on-demand full export.
requireText(posRoutes, "getPaginatedPosPriceList", "POS price-list route is not paginated");
requireText(posPaging, "maxPageSize: 100", "POS price-list page-size cap is missing");
requireText(posPaging, "stock_item_code_aliases", "POS alias search is missing");
requireText(posPaging, "pli.stock_item_id = ANY($2::int[])", "POS cost lookup is not limited to visible item IDs");
requireText(posPaging, "unpricedByGroup", "POS group-level unpriced counts are missing");
requireText(posPaging, "scopeCountResult", "POS global location KPI counts are missing");
requireText(posPage, "usePaginatedPriceList", "POS screen does not consume the paginated query hook");
requireText(posPage, "useDebouncedValue(search, 250)", "POS search is not debounced");
requireText(posClientPaging, "pageSize: String(posUser ? 30 : 50)", "POS page size is not bounded");
requireText(posPage, "<PaginationBar", "POS screen pagination controls are missing");
requireText(posClientPaging, "firstPage.totalPages", "POS export does not fetch the complete filtered result on demand");
requireText(posPage, 'refetchType: "active"', "POS mutations do not refetch the active paged query family");
requireText(posTypes, "unpricedByGroup", "POS paginated response type is incomplete");

// Architecture, i18n and source-contract safeguards.
requireLineCap(stockTransferOrder, 2150, "StockTransferOrder god-file cap");
requireLineCap(posPage, 1425, "POSPriceList god-file cap");
requireLineCap(stockAdjustment, 1200, "StockAdjustmentForm god-file cap");
requireLineCap(stockTransfer, 2375, "StockTransferForm god-file cap");
forbidText(paginationBar, "Showing", "pagination contains an untranslated literal");
forbidText(paginationBar, "Previous", "pagination contains an untranslated literal");
forbidText(paginationBar, "Page {", "pagination contains an untranslated literal");
forbidText(paginationBar, ">Next<", "pagination contains an untranslated literal");
requireText(program6cTest, "si.company_id = $1", "Program 6C company-isolation contract is stale");
requireText(program6cTest, "si.deleted_at IS NULL", "Program 6C deleted-item contract is stale");
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
      stockItems: {
        maxPageSize: 100,
        paginatedByDefault: true,
        serverSearch: true,
        aliases: true,
        selectedIdHydration: true,
        fullDetailsOnDemand: true,
      },
      inventory: {
        canonicalRoute: true,
        serverPagination: true,
        summaryFirst: true,
        multiCategoryFilters: true,
        globalTotals: true,
      },
      pos: {
        serverPagination: true,
        serverSearch: true,
        visiblePageCostLookups: true,
        globalKpis: true,
        fullExportOnDemand: true,
      },
      architectureCaps: true,
      untranslatedPaginationLiterals: 0,
      sqlRequired: true,
    },
    null,
    2
  )
);
