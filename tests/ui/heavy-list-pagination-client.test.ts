/**
 * The stock-entry pagination interceptor rewrites exactly one request.
 *
 * This module patches window.fetch globally and silently turns the stock-entry
 * history query into a paged one. That is a large thing to do invisibly, and it
 * had no test at all. Two failure modes matter:
 *
 *   Rewriting too much. The page deliberately sends limit=9999 as a sentinel
 *   for the on-screen query, while exports, print, bulk actions and lazy group
 *   details send limit=250 precisely so they keep receiving complete results.
 *   An interceptor that paged those would silently truncate an export — the
 *   user gets a spreadsheet that looks finished and is missing rows.
 *
 *   Trusting the client's page number. If the server reports fewer pages than
 *   the client asked for, the client must land on a real page rather than
 *   display an empty list as though the data were gone.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ENDPOINT = "/api/factory/bales/stock-entry-history";
const SENTINEL = "limit=9999";

let underlyingFetch: ReturnType<typeof vi.fn>;

/** The URL the interceptor actually sent on, as a URL for exact inspection. */
function sentUrl(call: unknown[]): URL {
  const input = call[0];
  const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  return new URL(raw, "http://localhost");
}

function pagePayload(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    clone() {
      return this;
    },
    json: async () => ({
      items: [{ id: 1 }],
      total: 120,
      page: 1,
      limit: 50,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: false,
      ...overrides,
    }),
  } as unknown as Response;
}

beforeAll(async () => {
  window.history.replaceState({}, "", "/factory/stock-entry");
  underlyingFetch = vi.fn(async () => pagePayload());
  window.fetch = underlyingFetch as unknown as typeof window.fetch;

  // The module installs itself on import, capturing the fetch above as the
  // underlying one. Everything below goes through the installed wrapper.
  await import("../../client/src/lib/heavyListPaginationClient");
});

beforeEach(() => {
  underlyingFetch.mockClear();
  underlyingFetch.mockImplementation(async () => pagePayload());
});

afterEach(() => {
  document.querySelector("#erp-stock-entry-pagination")?.remove();
});

describe("heavy list pagination client", () => {
  it("turns the on-screen sentinel query into a paged request", async () => {
    await window.fetch(`${ENDPOINT}?${SENTINEL}&companyId=1`);

    const url = sentUrl(underlyingFetch.mock.calls[0]);
    expect(url.searchParams.get("pagination")).toBe("1");
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("limit")).toBe("50");
  });

  it("leaves the full-data limit alone so exports stay complete", async () => {
    await window.fetch(`${ENDPOINT}?limit=250&companyId=1`);

    const url = sentUrl(underlyingFetch.mock.calls[0]);
    // The whole point of the sentinel: an export that asked for everything must
    // receive everything, or it silently ships a truncated spreadsheet.
    expect(url.searchParams.get("limit")).toBe("250");
    expect(url.searchParams.has("pagination")).toBe(false);
  });

  it("leaves every other endpoint untouched", async () => {
    await window.fetch(`/api/factory/bales/something-else?${SENTINEL}`);

    const url = sentUrl(underlyingFetch.mock.calls[0]);
    expect(url.searchParams.has("pagination")).toBe(false);
    expect(url.searchParams.get("limit")).toBe("9999");
  });

  it("leaves a non-GET request untouched", async () => {
    await window.fetch(`${ENDPOINT}?${SENTINEL}`, { method: "POST" });

    const url = sentUrl(underlyingFetch.mock.calls[0]);
    expect(url.searchParams.has("pagination")).toBe(false);
  });

  it("lands on a real page when the server reports fewer than the client asked for", async () => {
    underlyingFetch.mockImplementation(async () => pagePayload({ page: 9, totalPages: 2, total: 60 }));
    await window.fetch(`${ENDPOINT}?${SENTINEL}&filter=clamp`);

    underlyingFetch.mockImplementation(async () => pagePayload({ page: 2, totalPages: 2, total: 60 }));
    await window.fetch(`${ENDPOINT}?${SENTINEL}&filter=clamp`);

    // Without the clamp the client keeps asking for page 9 of 2 and the user
    // sees an empty list that looks like the data was deleted.
    const url = sentUrl(underlyingFetch.mock.calls[1]);
    expect(url.searchParams.get("page")).toBe("2");
  });

  it("returns to the first page when the filters change", async () => {
    underlyingFetch.mockImplementation(async () => pagePayload({ page: 3, totalPages: 3 }));
    await window.fetch(`${ENDPOINT}?${SENTINEL}&filter=first`);

    underlyingFetch.mockImplementation(async () => pagePayload());
    await window.fetch(`${ENDPOINT}?${SENTINEL}&filter=second`);

    // A different query is a different result set; carrying page 3 into it
    // shows the user page 3 of data they have not seen page 1 of.
    expect(sentUrl(underlyingFetch.mock.calls[1]).searchParams.get("page")).toBe("1");
  });

  it("keeps the server's page when it is within range", async () => {
    underlyingFetch.mockImplementation(async () => pagePayload({ page: 2, totalPages: 3 }));
    await window.fetch(`${ENDPOINT}?${SENTINEL}&filter=inrange`);

    underlyingFetch.mockImplementation(async () => pagePayload({ page: 2, totalPages: 3 }));
    await window.fetch(`${ENDPOINT}?${SENTINEL}&filter=inrange`);

    expect(sentUrl(underlyingFetch.mock.calls[1]).searchParams.get("page")).toBe("2");
  });

  it("passes a failed response through without reading it as pagination metadata", async () => {
    underlyingFetch.mockImplementation(
      async () => ({ ok: false, status: 500, clone: () => ({ json: async () => ({}) }) }) as unknown as Response
    );

    const response = await window.fetch(`${ENDPOINT}?${SENTINEL}&filter=error`);
    expect(response.status).toBe(500);
  });

  it("survives a response body that is not the expected shape", async () => {
    underlyingFetch.mockImplementation(
      async () =>
        ({
          ok: true,
          status: 200,
          clone() {
            return this;
          },
          json: async () => {
            throw new Error("not json");
          },
        }) as unknown as Response
    );

    // Preserving the server's own response matters more than the controls: a
    // pagination helper must never convert a readable response into an error.
    const response = await window.fetch(`${ENDPOINT}?${SENTINEL}&filter=garbage`);
    expect(response.ok).toBe(true);
  });
});
