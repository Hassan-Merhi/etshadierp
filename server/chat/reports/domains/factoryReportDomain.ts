import { createReportDomainHandler } from "./createReportDomainHandler";

export const factoryReportDomain = createReportDomainHandler("factory", [
  "worker_attendance", "bale_production", "factory_kpi", "worker_productivity",
  "factory_waste_analysis", "worker_document_expiry", "factory_worker_profile", "payroll_summary",
]);
