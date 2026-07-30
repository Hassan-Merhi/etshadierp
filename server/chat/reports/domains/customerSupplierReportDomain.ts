import { createReportDomainHandler } from "./createReportDomainHandler";

export const customerSupplierReportDomain = createReportDomainHandler("customers-suppliers", [
  "customer_statement", "supplier_statement", "top_customers", "outstanding_suppliers",
  "customer_aging", "supplier_aging", "customer_order_status", "customer_payment_history",
  "customer_list", "supplier_list", "customer_proformas", "supplier_proformas",
  "supplier_spend", "supplier_container_history",
]);
