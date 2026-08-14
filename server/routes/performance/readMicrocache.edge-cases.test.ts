import { describe, expect, it, vi } from "vitest";
import { createReadMicrocacheMiddleware } from "./readMicrocache";

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    method: "GET",
    path: "/api/sales-report",
    originalUrl: "/api/sales-report?startDate=2026-07-01",
    headers: {},
    query: {},
    body: undefined,
    session: {
      userId: 7,
      currentCompanyId: 3,
      factoryCompanyId: null,
      currentRole: "Admin",
      currentLocationId: 2,
      currentPOSStation: 1,
    },
    ...overrides,
  };
}

function makeResponse(statusCode = 200) {
  return {
    statusCode,
    sentBody: undefined as unknown,
    jsonBody: undefined as unknown,
    ended: false,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    type() {
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    send(body: unknown) {
      this.sentBody = body;
      return this;
    },
    json(body: unknown) {
      this.jsonBody = body;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

describe("read microcache edge cases", () => {
  it("returns 304 after an expired entry recomputes to the same representation", () => {
    let currentTime = 1_000;
    const middleware = createReadMicrocacheMiddleware({ ttlMs: 10, now: () => currentTime });
    const firstResponse = makeResponse();
    middleware(makeRequest(), firstResponse, () => firstResponse.json({ total: 12 }));

    currentTime = 1_011;
    const secondResponse = makeResponse();
    const secondNext = vi.fn(() => secondResponse.json({ total: 12 }));
    middleware(makeRequest({ headers: { "if-none-match": firstResponse.headers.ETag } }), secondResponse, secondNext);

    expect(secondNext).toHaveBeenCalledOnce();
    expect(secondResponse.statusCode).toBe(304);
    expect(secondResponse.ended).toBe(true);
    expect(secondResponse.jsonBody).toBeUndefined();
    expect(secondResponse.headers["X-ERP-Read-Cache"]).toBe("REVALIDATED");
  });

  it("does not route binary barcode responses through the JSON cache", () => {
    const middleware = createReadMicrocacheMiddleware();
    const request = makeRequest({
      path: "/api/barcode/ABC123",
      originalUrl: "/api/barcode/ABC123",
    });
    const firstNext = vi.fn();
    const secondNext = vi.fn();

    middleware(request, makeResponse(), firstNext);
    middleware(request, makeResponse(), secondNext);

    expect(firstNext).toHaveBeenCalledOnce();
    expect(secondNext).toHaveBeenCalledOnce();
  });

  it("fails open when shared invalidation coordination is unavailable", () => {
    const middleware = createReadMicrocacheMiddleware({ cacheEnabled: () => false });
    const request = makeRequest();
    const firstNext = vi.fn();
    const secondNext = vi.fn();

    middleware(request, makeResponse(), firstNext);
    middleware(request, makeResponse(), secondNext);

    expect(firstNext).toHaveBeenCalledOnce();
    expect(secondNext).toHaveBeenCalledOnce();
  });
});
