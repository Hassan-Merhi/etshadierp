import { runReportImplementation } from "../implementations/reportImplementationRegistry";
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
      return runReportImplementation(ctx);
    },
  };
}
