export type ErpDaybookRow =
  | { _type: "voucher"; data: Record<string, unknown> }
  | { _type: "offload"; data: Record<string, unknown> };

export interface ErpDaybookPage {
  items: ErpDaybookRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

const ENDPOINT = "/api/daybook";
const EXPORT_PAGE_SIZE = 250;

function pageUrl(baseParams: URLSearchParams, page: number, limit: number): string {
  const params = new URLSearchParams(baseParams);
  params.set("pagination", "1");
  params.set("page", String(page));
  params.set("limit", String(limit));
  return `${ENDPOINT}?${params.toString()}`;
}

export async function fetchErpDaybookPage(
  baseParams: URLSearchParams,
  page: number,
  limit: number
): Promise<ErpDaybookPage> {
  const response = await fetch(pageUrl(baseParams, page, limit), { credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to load Daybook page");
  }
  return response.json();
}

export async function fetchAllErpDaybookRows(baseParams: URLSearchParams): Promise<ErpDaybookRow[]> {
  const first = await fetchErpDaybookPage(baseParams, 1, EXPORT_PAGE_SIZE);
  const rows = Array.isArray(first.items) ? [...first.items] : [];
  for (let page = 2; page <= Math.max(1, first.totalPages || 1); page += 1) {
    const next = await fetchErpDaybookPage(baseParams, page, EXPORT_PAGE_SIZE);
    if (Array.isArray(next.items)) rows.push(...next.items);
  }
  return rows;
}
