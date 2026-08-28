/**
 * Behavioural coverage for the bale scan-audit read on
 * `GET /api/factory/customer-orders/:id/bale-removals`.
 *
 * The scan-audit lookup deliberately reuses the existing removals route behind
 * an opt-in `includeScanAudit=1` query parameter rather than adding a route, so
 * two behaviours share one endpoint and both have to hold:
 *
 *   - **The default response is unchanged.** Without the parameter the route
 *     still answers with the removal log as a bare array. Every existing caller
 *     reads it that way, so wrapping it would break the removal panel silently.
 *   - **Tenancy is enforced before the audit query runs.** The audit statement
 *     filters on `order_id` alone; the order lookup above it is what keeps one
 *     company from reading another's scan trail. If that ordering were ever
 *     inverted the audit rows would leak across companies.
 *
 * A legacy row with no recorded scan time comes back as `null` rather than a
 * fabricated date — the panel renders nothing for it, which is the point.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  session: {} as Record<string, unknown>,
  orders: [] as Array<{ id: number; companyId: number }>,
  removals: [] as Array<Record<string, unknown>>,
  auditRows: [] as Array<Record<string, unknown>>,
  execute: vi.fn(),
}));

vi.mock("../server/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.session = harness.session;
    next();
  },
}));

vi.mock("../server/routes/factory/_helpers", () => ({
  recalculateOrderTotals: vi.fn(),
}));

vi.mock("../server/db", () => {
  function chain(rows: unknown[]) {
    const link: any = {
      where: () => link,
      orderBy: () => link,
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return link;
  }
  return {
    db: {
      select: () => ({
        from: (table: unknown) => chain(table === customerOrders ? harness.orders : harness.removals),
      }),
      execute: harness.execute,
    },
  };
});

import { customerOrders } from "@shared/schema";
import { registerOrderBaleExchangeRoutes } from "../server/routes/factory/customer-orders/bale-scanning/exchange";

const app = express();
app.use(express.json());
registerOrderBaleExchangeRoutes(app as any);

const REMOVAL = {
  id: 201,
  orderId: 77,
  referenceNumber: "REF-REMOVED",
  removedByUsername: "loader",
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.session = { factoryCompanyId: 4 };
  harness.orders = [{ id: 77, companyId: 4 }];
  harness.removals = [REMOVAL];
  harness.auditRows = [];
  harness.execute.mockImplementation(async () => ({ rows: harness.auditRows }));
});

describe("bale removals route", () => {
  it("answers with the removal log as a bare array by default", async () => {
    const response = await request(app).get("/api/factory/customer-orders/77/bale-removals");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([REMOVAL]);
    expect(harness.execute).not.toHaveBeenCalled();
  });

  it("returns scanner identity and scan time when the audit is requested", async () => {
    harness.auditRows = [
      { id: 10, scannedBy: "loader", scannedAt: "2026-08-28T10:00:00.000Z" },
      { id: 11, scannedBy: "supervisor", scannedAt: "2026-08-28T11:30:00.000Z" },
    ];

    const response = await request(app).get("/api/factory/customer-orders/77/bale-removals?includeScanAudit=1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      scanAudit: [
        { id: 10, scannedBy: "loader", scannedAt: "2026-08-28T10:00:00.000Z" },
        { id: 11, scannedBy: "supervisor", scannedAt: "2026-08-28T11:30:00.000Z" },
      ],
    });
  });

  it("reports a bale scanned before the feature existed as having no audit trail", async () => {
    harness.auditRows = [{ id: 10, scannedBy: null, scannedAt: null }];

    const response = await request(app).get("/api/factory/customer-orders/77/bale-removals?includeScanAudit=1");

    expect(response.body.scanAudit).toEqual([{ id: 10, scannedBy: null, scannedAt: null }]);
  });

  it("refuses the audit for an order belonging to another company", async () => {
    harness.orders = [];

    const response = await request(app).get("/api/factory/customer-orders/77/bale-removals?includeScanAudit=1");

    expect(response.status).toBe(404);
    expect(harness.execute).not.toHaveBeenCalled();
  });

  it("ignores any value other than the explicit opt-in", async () => {
    const response = await request(app).get("/api/factory/customer-orders/77/bale-removals?includeScanAudit=true");

    expect(response.body).toEqual([REMOVAL]);
    expect(harness.execute).not.toHaveBeenCalled();
  });
});
