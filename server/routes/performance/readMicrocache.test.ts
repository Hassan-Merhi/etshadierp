import { describe, expect, it, vi } from "vitest";
import { buildReadMicrocacheKey, createReadMicrocacheMiddleware, READ_MICROCACHE_PATHS } from "./readMicrocache";

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    method: "GET",
    path: "/api/accounts/all",
    originalUrl: "/api/accounts/all?startDate=2026-07-01",
    headers: {},
    session: {
      userId: 7,
      currentCompanyId: 3,
      factoryCompanyId: null,
      currentRole: "Admin",
    },
    ...overrides,
  } as any;
}

function makeResponse(statusCode = 200) {
  return {
    statusCode,
    sentBody: undefined as unknown,
    jsonBody: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    type() {
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
  } as any;
}

describe("Phase 7C read microcache", () => {
  it("covers factory, account, Daybook, and reporting read paths", () => {
    expect(READ_MICROCACHE_PATHS).toEqual(
      new Set([
        "/api/factory/daybook",
        "/api/accounts/all",
        "/api/stats/monthly-data",
        "/api/dashboard/sales-report-all",
      ])
    );
  });

  it("isolates cache keys by user, company, role, and full query", () => {
    const base = buildReadMicrocacheKey(makeRequest());
    expect(buildReadMicrocacheKey(makeRequest({ originalUrl: "/api/accounts/all?startDate=2026-07-02" }))).not.toBe(
      base
    );
    expect(buildReadMicrocacheKey(makeRequest({ session: { userId: 8, currentCompanyId: 3 } }))).not.toBe(base);
    expect(buildReadMicrocacheKey(makeRequest({ session: { userId: 7, currentCompanyId: 4 } }))).not.toBe(base);
  });

  it("serves a successful repeated JSON read from the short cache", () => {
    let currentTime = 1_000;
    const middleware = createReadMicrocacheMiddleware({ ttlMs: 1_000, now: () => currentTime });
    const req = makeRequest();
    const firstRes = makeResponse();
    const firstNext = vi.fn(() => firstRes.json({ total: 12 }));

    middleware(req, firstRes, firstNext);
    expect(firstNext).toHaveBeenCalledOnce();
    expect(firstRes.jsonBody).toEqual({ total: 12 });

    currentTime = 1_500;
    const secondRes = makeResponse();
    const secondNext = vi.fn();
    middleware(req, secondRes, secondNext);

    expect(secondNext).not.toHaveBeenCalled();
    expect(secondRes.sentBody).toBe(JSON.stringify({ total: 12 }));
  });

  it("does not cache failed responses or requests outside the allowlist", () => {
    const middleware = createReadMicrocacheMiddleware();
    const req = makeRequest();
    const failedRes = makeResponse(500);
    middleware(req, failedRes, () => failedRes.json({ message: "failed" }));

    const retryNext = vi.fn();
    middleware(req, makeResponse(), retryNext);
    expect(retryNext).toHaveBeenCalledOnce();

    const unrelatedNext = vi.fn();
    middleware(makeRequest({ path: "/api/vouchers", originalUrl: "/api/vouchers" }), makeResponse(), unrelatedNext);
    expect(unrelatedNext).toHaveBeenCalledOnce();
  });

  it("expires entries after the configured TTL", () => {
    let currentTime = 10;
    const middleware = createReadMicrocacheMiddleware({ ttlMs: 5, now: () => currentTime });
    const req = makeRequest();
    const firstRes = makeResponse();
    middleware(req, firstRes, () => firstRes.json({ ok: true }));

    currentTime = 16;
    const next = vi.fn();
    middleware(req, makeResponse(), next);
    expect(next).toHaveBeenCalledOnce();
  });
});
