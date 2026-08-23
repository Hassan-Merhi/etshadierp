import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../../client/src/lib/queryClient";

const ENDPOINT = "/api/accounts/ledger/17/transactions";

let underlyingFetch: ReturnType<typeof vi.fn>;
let intervalSpy: ReturnType<typeof vi.spyOn>;
let invalidateSpy: ReturnType<typeof vi.spyOn>;
let paginationModule: typeof import("../../client/src/lib/accountStatementPaginationClient");

function sentUrl(call: unknown[]): URL {
  const input = call[0];
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;
  return new URL(raw, "http://localhost");
}

function pageResponse(overrides: Record<string, unknown> = {}): Response {
  return {
    ok: true,
    status: 200,
    clone() {
      return this;
    },
    json: async () => ({
      transactions: [{ id: 1 }],
      total: 240,
      page: 1,
      limit: 100,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: false,
      periodDebitTotal: 125.5,
      periodCreditTotal: 40.25,
      closingNetBalance: 85.25,
      ...overrides,
    }),
  } as unknown as Response;
}

function resetRouteState(): void {
  window.history.replaceState({}, "", "/outside-accounts");
  window.dispatchEvent(new PopStateEvent("popstate"));
  document.querySelector("#erp-account-statement-pagination")?.remove();
  window.history.replaceState({}, "", "/accounts");
}

beforeAll(async () => {
  window.history.replaceState({}, "", "/accounts");
  delete window.__erpAccountStatementPaginationInstalled;
  underlyingFetch = vi.fn(async () => pageResponse());
  window.fetch = underlyingFetch as unknown as typeof window.fetch;
  intervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(() => 1 as unknown as ReturnType<typeof setInterval>);
  invalidateSpy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
  paginationModule = await import("../../client/src/lib/accountStatementPaginationClient");
});

beforeEach(() => {
  resetRouteState();
  underlyingFetch.mockClear();
  underlyingFetch.mockImplementation(async () => pageResponse());
  invalidateSpy.mockClear();
});

afterEach(() => {
  resetRouteState();
});

afterAll(() => {
  intervalSpy.mockRestore();
  invalidateSpy.mockRestore();
});

describe("account statement pagination client", () => {
  it("adds bounded paging to account statement GET requests and publishes totals", async () => {
    await window.fetch(`${ENDPOINT}?fromDate=2026-01-01`);

    const url = sentUrl(underlyingFetch.mock.calls[0]);
    expect(Number(url.searchParams.get("pagination"))).toBe(1);
    expect(Number(url.searchParams.get("page"))).toBe(1);
    expect(Number(url.searchParams.get("limit"))).toBe(100);

    expect(paginationModule.getAccountStatementPaginationSnapshot()).toMatchObject({
      total: 240,
      page: 1,
      limit: 100,
      totalPages: 3,
      periodDebitTotal: 125.5,
      periodCreditTotal: 40.25,
      closingNetBalance: 85.25,
    });
    expect(document.querySelector('[data-testid="account-statement-pagination"]')).not.toBeNull();
  });

  it("leaves unrelated endpoints and non-GET requests untouched", async () => {
    await window.fetch("/api/accounts/ledger/17/summary");
    await window.fetch(ENDPOINT, { method: "POST" });

    expect(sentUrl(underlyingFetch.mock.calls[0]).searchParams.has("pagination")).toBe(false);
    expect(sentUrl(underlyingFetch.mock.calls[1]).searchParams.has("pagination")).toBe(false);
  });

  it("moves between pages through the rendered controls", async () => {
    await window.fetch(ENDPOINT);
    const next = document.querySelector('[data-testid="account-statement-page-next"]') as HTMLButtonElement;
    expect(next.disabled).toBe(false);

    next.click();
    expect(invalidateSpy).toHaveBeenCalledTimes(1);

    underlyingFetch.mockClear();
    await window.fetch(ENDPOINT);
    expect(Number(sentUrl(underlyingFetch.mock.calls[0]).searchParams.get("page"))).toBe(2);
  });

  it("changes the page size and returns to the first page", async () => {
    await window.fetch(ENDPOINT);
    const next = document.querySelector('[data-testid="account-statement-page-next"]') as HTMLButtonElement;
    next.click();

    const select = document.querySelector('[data-testid="account-statement-page-size"]') as HTMLSelectElement;
    select.value = "50";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    underlyingFetch.mockClear();
    await window.fetch(ENDPOINT);
    const url = sentUrl(underlyingFetch.mock.calls[0]);
    expect(Number(url.searchParams.get("page"))).toBe(1);
    expect(Number(url.searchParams.get("limit"))).toBe(50);
  });

  it("resets to page one when statement filters change", async () => {
    underlyingFetch.mockImplementation(async () => pageResponse({ page: 2 }));
    await window.fetch(`${ENDPOINT}?fromDate=2026-01-01`);

    underlyingFetch.mockClear();
    underlyingFetch.mockImplementation(async () => pageResponse());
    await window.fetch(`${ENDPOINT}?fromDate=2026-02-01`);

    expect(Number(sentUrl(underlyingFetch.mock.calls[0]).searchParams.get("page"))).toBe(1);
  });

  it("clamps an out-of-range server page and requests a refresh", async () => {
    underlyingFetch.mockImplementation(async () => pageResponse({ page: 9, totalPages: 2, total: 120 }));
    await window.fetch(ENDPOINT);
    await Promise.resolve();

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    underlyingFetch.mockClear();
    underlyingFetch.mockImplementation(async () => pageResponse({ page: 2, totalPages: 2, total: 120 }));
    await window.fetch(ENDPOINT);
    expect(Number(sentUrl(underlyingFetch.mock.calls[0]).searchParams.get("page"))).toBe(2);
  });

  it("notifies subscribers and clears the snapshot when leaving accounts", async () => {
    const listener = vi.fn();
    const unsubscribe = paginationModule.subscribeAccountStatementPagination(listener);

    await window.fetch(ENDPOINT);
    expect(listener).toHaveBeenCalledTimes(1);

    window.history.replaceState({}, "", "/dashboard");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(paginationModule.getAccountStatementPaginationSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("passes failed and malformed responses through without corrupting pagination state", async () => {
    underlyingFetch.mockImplementationOnce(
      async () => ({ ok: false, status: 503 }) as unknown as Response,
    );
    const failed = await window.fetch(ENDPOINT);
    expect(failed.status).toBe(503);
    expect(paginationModule.getAccountStatementPaginationSnapshot()).toBeNull();

    underlyingFetch.mockImplementationOnce(
      async () =>
        ({
          ok: true,
          status: 200,
          clone() {
            return this;
          },
          json: async () => {
            throw new Error("invalid payload");
          },
        }) as unknown as Response,
    );
    const malformed = await window.fetch(ENDPOINT);
    expect(malformed.ok).toBe(true);
    expect(paginationModule.getAccountStatementPaginationSnapshot()).toBeNull();
  });
});
