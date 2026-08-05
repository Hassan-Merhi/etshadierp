export type BandwidthCacheScope = "live" | "reference";
export type BandwidthInvalidationScope = "live" | "all";

export type BandwidthInvalidationMessage = {
  type: "invalidate";
  scope: BandwidthInvalidationScope;
};

export const BANDWIDTH_INVALIDATION_CHANNEL = "erp-bandwidth-cache-invalidation";

const FULL_INVALIDATION_WRITE_PATHS: readonly RegExp[] = [
  /^\/api\/auth(?:\/|$)/,
  /^\/api\/csrf-token\/?$/,
  /^\/api\/admin(?:\/|$)/,
  /^\/api\/companies(?:\/|$)/,
  /^\/api\/user\/companies(?:\/|$)/,
  /^\/api\/user-preferences(?:\/|$)/,
  /^\/api\/company-settings(?:\/|$)/,
  /^\/api\/factory\/settings(?:\/|$)/,
  /^\/api\/factory\/my-access(?:\/|$)/,
  /^\/api\/locations(?:\/|$)/,
  /^\/api\/ledger-accounts(?:\/|$)/,
  /^\/api\/stock-items(?:\/|$)/,
  /^\/api\/employees(?:\/|$)/,
  /^\/api\/factory\/(?:employees|workers|users)(?:\/|$)/,
  /^\/api\/(?:customers|suppliers)(?:\/|$)/,
  /^\/api\/factory\/(?:customers|suppliers)(?:\/|$)/,
  /^\/api\/factory\/customer-proforma(?:s|-lines)(?:\/|$)/,
  /(?:^|\/)(?:set|switch|select|current)[-_]?(?:company|location)(?:\/|$)/i,
  /(?:^|\/)(?:company|location)[-_]?(?:switch|selection)(?:\/|$)/i,
];

/**
 * Ordinary vouchers, scans, transfers and order writes invalidate live balances
 * and workflow snapshots but preserve unrelated reference/catalog responses.
 * Authentication, company/location changes, settings/access changes and edits
 * to the reference data itself must clear every client read snapshot.
 */
export function getBandwidthInvalidationScope(pathname: string): BandwidthInvalidationScope {
  return FULL_INVALIDATION_WRITE_PATHS.some((pattern) => pattern.test(pathname)) ? "all" : "live";
}

export function shouldClearBandwidthEntry(
  entryScope: BandwidthCacheScope,
  invalidationScope: BandwidthInvalidationScope
): boolean {
  return invalidationScope === "all" || entryScope === "live";
}
