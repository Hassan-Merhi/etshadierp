import { createReportDomainHandler } from "./createReportDomainHandler";

export const inventoryReportDomain = createReportDomainHandler("inventory", [
  "inventory_check", "low_stock_items", "stock_movement", "stock_valuation",
  "location_stock_summary", "stock_transfers", "stock_item_detail", "stock_adjustments",
  "location_list",
]);
