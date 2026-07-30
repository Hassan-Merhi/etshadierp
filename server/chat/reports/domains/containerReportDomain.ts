import { createReportDomainHandler } from "./createReportDomainHandler";

export const containerReportDomain = createReportDomainHandler("containers", [
  "container_status",
  "containers_pending_offload",
  "container_list",
  "container_profitability",
  "container_offload_details",
  "container_cost_breakdown",
  "upcoming_arrivals",
  "purchase_order_detail",
  "container_items_list",
  "container_tracking",
  "pending_container_sales",
]);
