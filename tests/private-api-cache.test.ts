import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getPrivateApiCacheStats,
  installPrivateApiCache,
  resetPrivateApiCacheForTests,
} from "../server/middleware/privateApiCache";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = {
      userId: req.get("x-test-user") || "user-1",
      currentCompanyId: Number(req.get("x-test-company") || 7),
      currentRole: "Admin",
      currentLocationId: 3,
    };
    next();
  });

  installPrivateApiCache(app);

  let salesReportCalls = 0;
  let previewCalls = 0;
  let uncachedCalls = 0;

  app.get("/api/sales-report", (_req, res) => {
    salesReportCalls += 1;
    res.json({ calls: salesReportCalls, rows: [{ id: 1, value: "x".repeat(2_000) }] });
  });

  app.post("/api/factory/payrolls/preview", (req, res) => {
    previewCalls += 1;
    res.json({ calls: previewCalls, input: req.body });
  });

  app.post("/api/vouchers", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/not-on-cache-allowlist", (_req, res) => {
    uncachedCalls += 1;
    res.json({ calls: uncachedCalls });
  });

  return {
    app,
    getSalesReportCalls: () => salesReportCalls,
    getPreviewCalls: () => previewCalls,
    getUncachedCalls: () => uncachedCalls,
  };
}

describe("private API cache", () => {
  beforeEach(() => {
    resetPrivateApiCacheForTests();
  });

  it("serves repeated heavy GET requests from memory", async () => {
    const testApp = createTestApp();

    const first = await request(testApp.app).get("/api/sales-report?startDate=2026-07-01");
    const second = await request(testApp.app).get("/api/sales-report?startDate=2026-07-01");

    expect(first.status).toBe(200);
    expect(first.headers["x-erp-cache"]).toBe("MISS");
    expect(second.status).toBe(200);
    expect(second.headers["x-erp-cache"]).toBe("HIT");
    expect(second.body.calls).toBe(1);
    expect(testApp.getSalesReportCalls()).toBe(1);
    expect(getPrivateApiCacheStats().hits).toBe(1);
  });

  it("returns 304 for a matching cached ETag without running the route", async () => {
    const testApp = createTestApp();

    const first = await request(testApp.app).get("/api/sales-report");
    const second = await request(testApp.app)
      .get("/api/sales-report")
      .set("If-None-Match", first.headers.etag);

    expect(first.headers.etag).toBeTruthy();
    expect(second.status).toBe(304);
    expect(second.headers["x-erp-cache"]).toBe("REVALIDATED");
    expect(testApp.getSalesReportCalls()).toBe(1);
  });

  it("isolates cached responses by authenticated user", async () => {
    const testApp = createTestApp();

    await request(testApp.app).get("/api/sales-report").set("X-Test-User", "user-1");
    const userTwo = await request(testApp.app).get("/api/sales-report").set("X-Test-User", "user-2");

    expect(userTwo.body.calls).toBe(2);
    expect(testApp.getSalesReportCalls()).toBe(2);
  });

  it("clears cached reads around real API writes", async () => {
    const testApp = createTestApp();

    await request(testApp.app).get("/api/sales-report");
    await request(testApp.app).get("/api/sales-report");
    expect(testApp.getSalesReportCalls()).toBe(1);

    const write = await request(testApp.app).post("/api/vouchers").send({ amount: 10 });
    expect(write.status).toBe(200);

    const afterWrite = await request(testApp.app).get("/api/sales-report");
    expect(afterWrite.body.calls).toBe(2);
    expect(testApp.getSalesReportCalls()).toBe(2);
  });

  it("caches payroll preview POST requests by stable request body", async () => {
    const testApp = createTestApp();

    const first = await request(testApp.app)
      .post("/api/factory/payrolls/preview")
      .send({ periodEnd: "2026-07-31", periodStart: "2026-07-01" });
    const second = await request(testApp.app)
      .post("/api/factory/payrolls/preview")
      .send({ periodStart: "2026-07-01", periodEnd: "2026-07-31" });
    const third = await request(testApp.app)
      .post("/api/factory/payrolls/preview")
      .send({ periodStart: "2026-08-01", periodEnd: "2026-08-31" });

    expect(first.headers["x-erp-cache"]).toBe("MISS");
    expect(second.headers["x-erp-cache"]).toBe("HIT");
    expect(second.body.calls).toBe(1);
    expect(third.body.calls).toBe(2);
    expect(testApp.getPreviewCalls()).toBe(2);
  });

  it("does not cache endpoints outside the explicit allowlist", async () => {
    const testApp = createTestApp();

    const first = await request(testApp.app).get("/api/not-on-cache-allowlist");
    const second = await request(testApp.app).get("/api/not-on-cache-allowlist");

    expect(first.body.calls).toBe(1);
    expect(second.body.calls).toBe(2);
    expect(first.headers["x-erp-cache"]).toBeUndefined();
    expect(testApp.getUncachedCalls()).toBe(2);
  });
});
