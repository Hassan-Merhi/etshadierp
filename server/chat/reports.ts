import { dispatchDataQuery } from "./reports/domains/reportDomainDispatcher";
import type { DataQueryContext, DataQueryResult } from "./reports/types";

export type { DataQueryContext, DataQueryResult } from "./reports/types";
export { findReportDomain, reportDomains } from "./reports/domains/reportDomainDispatcher";

/**
 * Stable chat reporting entry point.
 *
 * chatService.ts continues to call this function with the same context and receives
 * the same report payloads. Domain selection is isolated from the preserved
 * read-only SQL execution engine.
 */
export function runDataQuery(ctx: DataQueryContext): Promise<DataQueryResult> {
  return dispatchDataQuery(ctx);
}
