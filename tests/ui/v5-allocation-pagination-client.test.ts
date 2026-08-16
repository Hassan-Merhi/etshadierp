/**
 * Stock-allocation paging: browse a page, export everything.
 *
 * This module does two opposite things to the same endpoint. It patches
 * window.fetch so the on-screen allocation table asks for one page at a time,
 * and it exports fetchAllV5AllocationData for the paths that genuinely need
 * every row — the export button and the proforma drawers. Neither had a test.
 *
 * The expensive failure is the export quietly returning page one. Stock
 * allocation is what tells a planner whether a container can be filled, and a
 * spreadsheet holding the first fifty articles of two hundred does not look
 * truncated: it looks like a short catalogue. So the multi-page walk is pinned
 * here row by row, along with its refusal to return a partial result when a
 * later page fails.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ENDPOINT = "/api/factory/v5/stock-allocation";

let underlyingFetch: ReturnType<typeof vi.fn>;
let fetchAllV5AllocationData: (params?: URLSearchParams) => Promise<{ rows: unknown[]; [key: string]: unknown }>;

function sentUrl(call: unknown[]): URL {
  const input = call[0];
  const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  return new URL(raw, "http://localhost");
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    clone() {
      return this;
    },
    json: async () => body,
  } as unknown as Response;
}

function allocationPage(overrides: Record<string, unknown> = {}) {
  return {
    rows: [{ articleCode: "A-1" }],
    totals: {},
    productNames: { "A-1": "Article One" },
    total: 1,
    page: 1,
    limit: 50,
    totalPages: 1,
    ...overrides,
  };
}

beforeAll(async () => {
  window.history.replaceState({}, "", "/factory/stock-allocation-v5");
  underlyingFetch = vi.fn(async () => jsonResponse(allocationPage()));
  window.fetch = underlyingFetch as unknown as typeof window.fetch;

  const module = await import("../../client/src/lib/v5AllocationPaginationClient");
  fetchAllV5AllocationData = module.fetchAllV5AllocationData as typeof fetchAllV5AllocationData;
});

beforeEach(() => {
  underlyingFetch.mockClear();
  underlyingFetch.mockImplementation(async () => jsonResponse(allocationPage()));
});

afterEach(() => {
  document.querySelector("#erp-v5-allocation-pagination")?.remove();
});

describe("v5 allocation full-data fetch", () => {
  it("walks every server page and returns the rows joined", async () => {
    underlyingFetch.mockImplementation(async (input: unknown) => {
      const page = sentUrl([input]).searchParams.get("page");
      return jsonResponse(
        allocationPage({
          rows: [{ articleCode: `A-${page}` }, { articleCode: `B-${page}` }],
          productNames: { [`A-${page}`]: `Article ${page}` },
          totalPages: 3,
          page: Number(page),
        })
      );
    });

    const result = await fetchAllV5AllocationData(new URLSearchParams({ companyId: "1" }));

    // Three pages of two rows. Stopping after page one is the failure this
    // whole test exists for, and six rows is the only proof it did not.
    expect(result.rows).toHaveLength(6);
    expect(underlyingFetch).toHaveBeenCalledTimes(3);
    expect(Object.keys(result.productNames as Record<string, string>)).toHaveLength(3);
  });

  it("asks for the full-action limit, not the on-screen one", async () => {
    await fetchAllV5AllocationData(new URLSearchParams({ companyId: "1" }));

    const url = sentUrl(underlyingFetch.mock.calls[0]);
    expect(url.searchParams.get("fullAction")).toBe("1");
    expect(url.searchParams.get("limit")).toBe("250");
    expect(url.searchParams.get("companyId")).toBe("1");
  });

  it("reports the joined result as a single complete page", async () => {
    const result = await fetchAllV5AllocationData();

    // Callers pass this straight into an export. Leaving hasNextPage true would
    // invite a second, duplicating walk over data already collected.
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPreviousPage).toBe(false);
    expect(result.page).toBe(1);
  });

  it("throws rather than returning the pages it managed to collect", async () => {
    underlyingFetch.mockImplementation(async (input: unknown) => {
      const page = Number(sentUrl([input]).searchParams.get("page"));
      if (page === 2) return jsonResponse({ message: "Allocation page unavailable" }, false, 503);
      return jsonResponse(allocationPage({ rows: [{ articleCode: `A-${page}` }], totalPages: 3, page }));
    });

    // A partial return here is worse than an error: the caller cannot tell an
    // export of every article from an export of the first fifty.
    await expect(fetchAllV5AllocationData()).rejects.toThrow("Allocation page unavailable");
  });

  it("throws when the very first page fails", async () => {
    underlyingFetch.mockImplementation(async () => jsonResponse({}, false, 500));

    await expect(fetchAllV5AllocationData()).rejects.toThrow(/complete stock allocation/i);
  });
});

describe("v5 allocation on-screen interception", () => {
  it("pages the table query", async () => {
    await window.fetch(`${ENDPOINT}?companyId=1`);

    const url = sentUrl(underlyingFetch.mock.calls[0]);
    expect(url.searchParams.get("pagination")).toBe("1");
    expect(url.searchParams.get("limit")).toBe("50");
  });

  it("leaves an explicit full-action request alone", async () => {
    await window.fetch(`${ENDPOINT}?companyId=1&fullAction=1&limit=250`);

    // fetchAllV5AllocationData goes through this same patched fetch, so an
    // interceptor that paged full actions would page the export walk itself.
    expect(sentUrl(underlyingFetch.mock.calls[0]).searchParams.get("limit")).toBe("250");
  });

  it("leaves other endpoints alone", async () => {
    await window.fetch("/api/factory/v5/something-else?companyId=1");

    expect(sentUrl(underlyingFetch.mock.calls[0]).searchParams.has("pagination")).toBe(false);
  });

  it("lands on a real page when the server reports fewer than requested", async () => {
    underlyingFetch.mockImplementation(async () => jsonResponse(allocationPage({ page: 7, totalPages: 2, total: 60 })));
    await window.fetch(`${ENDPOINT}?companyId=1&filter=clamp`);

    underlyingFetch.mockImplementation(async () => jsonResponse(allocationPage({ page: 2, totalPages: 2, total: 60 })));
    await window.fetch(`${ENDPOINT}?companyId=1&filter=clamp`);

    expect(sentUrl(underlyingFetch.mock.calls[1]).searchParams.get("page")).toBe("2");
  });

  it("passes a failed response through unread", async () => {
    underlyingFetch.mockImplementation(async () => jsonResponse({}, false, 502));

    const response = await window.fetch(`${ENDPOINT}?companyId=1&filter=error`);
    expect(response.status).toBe(502);
  });
});
