import { runDataQuery as runLegacyDataQuery } from "../legacyReportEngine";
import type { DataQueryContext, DataQueryResult, ReportDomainHandler } from "../types";
import { accountingReportDomain } from "./accountingReportDomain";
import { containerReportDomain } from "./containerReportDomain";
import { customerSupplierReportDomain } from "./customerSupplierReportDomain";
import { factoryReportDomain } from "./factoryReportDomain";
import { inventoryReportDomain } from "./inventoryReportDomain";
import { operationsReportDomain } from "./operationsReportDomain";
import { salesReportDomain } from "./salesReportDomain";

export const reportDomains: readonly ReportDomainHandler[] = [
  accountingReportDomain,
  customerSupplierReportDomain,
  inventoryReportDomain,
  factoryReportDomain,
  containerReportDomain,
  salesReportDomain,
  operationsReportDomain,
];

export function findReportDomain(queryType: string): ReportDomainHandler | undefined {
  return reportDomains.find((domain) => domain.handles(queryType));
}

export async function dispatchDataQuery(ctx: DataQueryContext): Promise<DataQueryResult> {
  const queryType = typeof ctx.params.queryType === "string" ? ctx.params.queryType : "";
  const domain = findReportDomain(queryType);
  if (domain) return domain.run(ctx);

  // Compatibility fallback for historical or newly classified report names.
  // The result remains byte-for-byte owned by the preserved read-only engine.
  return runLegacyDataQuery(ctx as any);
}
