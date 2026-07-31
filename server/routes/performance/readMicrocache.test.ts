import { describe, expect, it, vi } from "vitest";
import {
  buildReadMicrocacheKey,
  createReadMicrocacheMiddleware,
  getReadMicrocacheStats,
  READ_MICROCACHE_PATHS,
  READ_MICROCACHE_TTL_MS,
} from "./readMicrocache";

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    method: "GET",
    path: "/api/accounts/all",
    originalUrl: "/api/accounts/all?startDate=2026-07-01",
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
  } as any;
}

function makeResponse(statusCode = 200) {
  const listeners = new Map<string, Array<() => void>>();
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
    once(event: string, listener: () => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return this;
    },
    emit(event: string) {
      for (const listener of listeners.get(event) ?? []) listener();
      listeners.delete(event);
      return this;
    },
  } as any;
}

describe("Phase 7C read microcache", () => {
  it("covers the current production bandwidth hotspots", () => {
    const expectedPaths = [
      "/api/sales-report",
      "/api/location-summary",
      "/api/reports/stock-movement",
      "/api/factory/payrolls",
      "/api/factory/payrolls/preview",
      "/api/accounts/all",
      "/api/factory/raw-stock",
      "/api/factory/mix-batches",
      "/api/factory/bale-ledger",
      "/api/factory/containers",
      "/api/factory/bale-products",
      "/api/factory/workers",
      "/api/ledger-accounts",
      "/api/stock-items/light",
      "/api/locations",
      "/api/suppliers",
    ];

    for (const path of expectedPaths) expect(READ_MICROCACHE_PATHS.has(path)).toBe(true);
    expect(READ_MICROCACHE_PATHS.has("/api/pos/drafts")).toBe(false);
    expect(READ_MICROCACHE_TTL_MS.get("/api/sales-report")).toBe(120_000);
    expect(READ_MICROCACHE_TTL_MS.get("/api/factory/payrolls")).toBe(120_000);
    expect(READ_MICROCACHE_TTL_MS.get("/api/factory/bale-products")).toBe(300_000);
  });

  it("isolates cache keys by user, company, role, location, station, query, and client date", () => {
    const base = buildReadMicrocacheKey(makeRequest());
    expect(buildReadMicrocacheKey(makeRequest({ originalUrl: "/api/accounts/all?startDate=2026-07-02" }))).not.toBe(
      base
    );
    expect(buildReadMicrocacheKey(makeRequest({ headers: { "x-client-date": "2026-07-31" } }))).not.toBe(base);
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
    expect(firstRes.headers["Cache-Control"]).toBe("private, no-cache, must-revalidate");
    expect(firstRes.headers.ETag).toBeTruthy();

    currentTime = 1_500;
    const secondRes = makeResponse();
    const secondNext = vi.fn();
    middleware(req, secondRes, secondNext);

    expect(secondNext).not.toHaveBeenCalled();
    expect(secondRes.sentBody).toBe(JSON.stringify({ total: 12 }));
    expect(secondRes.headers["X-ERP-Read-Cache"]).toBe("HIT");
    expect(getReadMicrocacheStats().hits).toBe(1);
  });

  it("does not treat service-worker no-store semantics as an ERP-cache bypass", () => {
    const middleware = createReadMicrocacheMiddleware({ ttlMs: 5_000 });
    const req = makeRequest({ headers: { "cache-control": "no-store" } });
    const firstRes = makeResponse();
    middleware(req, firstRes, () => firstRes.json({ total: 12 }));

    const secondRes = makeResponse();
    const secondNext = vi.fn();
    middleware(req, secondRes, secondNext);

    expect(secondNext).not.toHaveBeenCalled();
    expect(secondRes.headers["X-ERP-Read-Cache"]).toBe("HIT");
  });

  it("returns 304 when the browser revalidates an unchanged cached response", () => {
    const middleware = createReadMicrocacheMiddleware({ ttlMs: 5_000 });
    const req = makeRequest();
    const firstRes = makeResponse();
    middleware(req, firstRes, () => firstRes.json({ total: 12 }));

    const secondRes = makeResponse();
    middleware(
      makeRequest({ headers: { "if-none-match": firstRes.headers.ETag } }),
      secondRes,
      vi.fn()
    );

    expect(secondRes.statusCode).toBe(304);
    expect(secondRes.ended).toBe(true);
    expect(secondRes.sentBody).toBeUndefined();
    expect(secondRes.headers["X-ERP-Read-Cache"]).toBe("REVALIDATED");
  });

  it("caches payroll preview POSTs by stable request body", () => {
    const middleware = createReadMicrocacheMiddleware({ ttlMs: 5_000 });
    const firstReq = makeRequest({
      method: "POST",
      path: "/api/factory/payrolls/preview",
      originalUrl: "/api/factory/payrolls/preview",
      body: { periodEnd: "2026-07-31", periodStart: "2026-07-01" },
    });
    const firstRes = makeResponse();
    middleware(firstReq, firstRes, () => firstRes.json({ workers: 12 }));

    const secondReq = makeRequest({
      method: "POST",
      path: "/api/factory/payrolls/preview",
      originalUrl: "/api/factory/payrolls/preview",
      body: { periodStart: "2026-07-01", periodEnd: "2026-07-31" },
    });
    const secondRes = makeResponse();
    const secondNext = vi.fn();
    middleware(secondReq, secondRes, secondNext);

    expect(secondNext).not.toHaveBeenCalled();
    expect(secondRes.headers["X-ERP-Read-Cache"]).toBe("HIT");
    expect(secondRes.sentBody).toBe(JSON.stringify({ workers: 12 }));
  });

  it("supports dynamic heavy read paths", () => {
    const middleware = createReadMicrocacheMiddleware({ ttlMs: 5_000 });
    const req = makeRequest({
      path: "/api/locations/12/inventory",
      originalUrl: "/api/locations/12/inventory?profile=combined",
    });
    const firstRes = makeResponse();
    middleware(req, firstRes, () => firstRes.json({ rows: 10 }));

    const secondRes = makeResponse();
    const secondNext = vi.fn();
    middleware(req, secondRes, secondNext);

    expect(secondNext).not.toHaveBeenCalled();
    expect(secondRes.headers["X-ERP-Read-Cache"]).toBe("HIT");
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
    middleware(
      makeRequest({ path: "/api/vouchers", originalUrl: "/api/vouchers" }),
      makeResponse(),
      unrelatedNext
    );
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

  it("clears cached reads only after a successful authenticated business request", () => {
    const middleware = createReadMicrocacheMiddleware({ ttlMs: 5_000 });
    const req = makeRequest();
    const firstRes = makeResponse();
    middleware(req, firstRes, () => firstRes.json({ ok: true }));

    const writeRes = makeResponse(200);
    const writeNext = vi.fn();
    middleware(
      makeRequest({ method: "POST", path: "/api/vouchers", originalUrl: "/api/vouchers" }),
      writeRes,
      writeNext
    );
    expect(writeNext).toHaveBeenCalledOnce();

    const beforeFinishRes = makeResponse();
    const beforeFinishNext = vi.fn();
    middleware(req, beforeFinishRes, beforeFinishNext);
    expect(beforeFinishNext).not.toHaveBeenCalled();

    writeRes.emit("finish");
    const afterFinishNext = vi.fn();
    middleware(req, makeResponse(), afterFinishNext);
    expect(afterFinishNext).toHaveBeenCalledOnce();
  });

  it("does not let unauthenticated or failed writes flush the cache", () => {
    const middleware = createReadMicrocacheMiddleware({ ttlMs: 5_000 });
    const req = makeRequest();
    const firstRes = makeResponse();
    middleware(req, firstRes, () => firstRes.json({ ok: true }));

    const anonymousWriteRes = makeResponse(200);
    middleware(
      makeRequest({
        method: "POST",
        path: "/api/vouchers",
        originalUrl: "/api/vouchers",
        session: {},
      }),
      anonymousWriteRes,
      vi.fn()
    );
    anonymousWriteRes.emit("finish");

    const failedWriteRes = makeResponse(403);
    middleware(
      makeRequest({ method: "POST", path: "/api/vouchers", originalUrl: "/api/vouchers" }),
      failedWriteRes,
      vi.fn()
    );
    failedWriteRes.emit("finish");

    const secondRes = makeResponse();
    const secondNext = vi.fn();
    middleware(req, secondRes, secondNext);
    expect(secondNext).not.toHaveBeenCalled();
    expect(secondRes.headers["X-ERP-Read-Cache"]).toBe("HIT");
  });

  it("preserves business caches across POS autosave and presence heartbeat writes", () => {
    const middleware = createReadMicrocacheMiddleware({ ttlMs: 5_000 });
    const req = makeRequest();
    const firstRes = makeResponse();
    middleware(req, firstRes, () => firstRes.json({ ok: true }));

    middleware(
      makeRequest({ method: "PATCH", path: "/api/pos/drafts/42", originalUrl: "/api/pos/drafts/42" }),
      makeResponse(),
      vi.fn()
    );
    middleware(
      makeRequest({ method: "PATCH", path: "/api/user-presence", originalUrl: "/api/user-presence" }),
      makeResponse(),
      vi.fn()
    );

    const secondRes = makeResponse();
    const secondNext = vi.fn();
    middleware(req, secondRes, secondNext);
    expect(secondNext).not.toHaveBeenCalled();
    expect(secondRes.headers["X-ERP-Read-Cache"]).toBe("HIT");
  });
});
