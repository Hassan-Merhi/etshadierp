import { createReportDomainHandler } from "./createReportDomainHandler";

export const operationsReportDomain = createReportDomainHandler("operations", [
  "open_purchase_orders",
  "rental_summary",
  "employee_list",
  "audit_trail",
  "intercompany_transfers",
]);
