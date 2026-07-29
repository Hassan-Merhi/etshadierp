import { createReportDomainHandler } from "./createReportDomainHandler";

export const salesReportDomain = createReportDomainHandler("sales", [
  "top_selling_items", "pos_sales_summary", "weekly_sales", "profit_by_location",
]);
