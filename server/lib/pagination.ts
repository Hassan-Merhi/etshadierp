export interface PaginationOptions {
  defaultPageSize?: number;
  maxPageSize?: number;
}

export interface PaginationResult {
  page: number;
  pageSize: number;
  offset: number;
}

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

export function parseBoundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Number.parseInt(String(firstValue(value) ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function parsePagination(query: Record<string, unknown>, options: PaginationOptions = {}): PaginationResult {
  const defaultPageSize = options.defaultPageSize ?? 50;
  const maxPageSize = options.maxPageSize ?? 100;
  const page = parseBoundedInteger(query.page, 1, 1, 1_000_000);
  const pageSize = parseBoundedInteger(query.pageSize ?? query.limit, defaultPageSize, 1, maxPageSize);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function parseSearchQuery(value: unknown, maxLength = 100): string {
  return String(firstValue(value) ?? "")
    .trim()
    .slice(0, maxLength);
}

export function parseIdList(value: unknown, maximum = 100): number[] {
  const raw = Array.isArray(value) ? value.join(",") : String(value ?? "");
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((part) => Number.parseInt(part.trim(), 10))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  ).slice(0, maximum);
}

export function buildPaginationMeta(total: number, page: number, pageSize: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
