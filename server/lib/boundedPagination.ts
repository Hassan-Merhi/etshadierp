export interface BoundedPaginationOptions {
  defaultLimit?: number;
  maxLimit?: number;
}

export interface BoundedPagination {
  page: number;
  limit: number;
  offset: number;
}

function parsePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Returns true only when a caller explicitly opts into a paginated response.
 * Existing endpoints can therefore add bounded pagination without changing
 * the legacy response shape for current screens and integrations.
 */
export function wantsBoundedPagination(query: Record<string, unknown>): boolean {
  return (
    query.pagination === "1" ||
    query.page !== undefined ||
    query.limit !== undefined ||
    query.pageSize !== undefined ||
    query.offset !== undefined
  );
}

/**
 * Parses page/limit or offset/limit with conservative server-side bounds.
 * The returned offset is always non-negative and the limit can never exceed
 * maxLimit, preventing accidental full-table responses from migrated callers.
 */
export function parseBoundedPagination(
  query: Record<string, unknown>,
  options: BoundedPaginationOptions = {}
): BoundedPagination {
  const defaultLimit = Math.max(1, options.defaultLimit ?? 100);
  const maxLimit = Math.max(defaultLimit, options.maxLimit ?? 250);
  const limit = Math.min(maxLimit, parsePositiveInteger(query.limit ?? query.pageSize, defaultLimit));

  if (query.offset !== undefined) {
    const parsedOffset = Number.parseInt(String(query.offset), 10);
    const offset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;
    return { page: Math.floor(offset / limit) + 1, limit, offset };
  }

  const page = parsePositiveInteger(query.page, 1);
  return { page, limit, offset: (page - 1) * limit };
}
