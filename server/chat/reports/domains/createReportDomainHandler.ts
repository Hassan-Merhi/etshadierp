import { runDataQuery as runLegacyDataQuery } from "../legacyReportEngine";
import type { DataQueryContext, DataQueryResult, ReportDomainHandler } from "../types";

export function createReportDomainHandler(domain: string, queryTypes: readonly string[]): ReportDomainHandler {
  const owned = new Set(queryTypes);
  return {
    domain,
    queryTypes,
    handles(queryType: string): boolean {
      return owned.has(queryType);
    },
    run(ctx: DataQueryContext): Promise<DataQueryResult> {
      return runLegacyDataQuery(ctx as any);
    },
  };
}
