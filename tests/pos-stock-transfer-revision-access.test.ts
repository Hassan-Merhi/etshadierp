import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import * as compatibilityRoute from "../server/routes/vouchers/adminPostUpdateStockTransferRevisionRoute";

type TestResponse = {
  status(code: number): TestResponse;
  json(body: unknown): unknown;
};

const authHarness = vi.hoisted(() => ({ calls: 0 }));
const revisionPath = "/api/stock-transfers/42/revisions";

vi.mock("../server/auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireNonPOS: (_req: unknown, res: TestResponse) => {
    authHarness.calls += 1;
    res.status(403);
    return res.json({ message: "POS blocked from admin compatibility lane" });
  },
}));
vi.mock("../server/db", () => ({ db: {} }));
vi.mock("../server/routes/_helpers", () => ({ logAudit: vi.fn() }));

function buildApp() {
  const app = express();
  app.use(express.json());
  compatibilityRoute.registerAdminPostUpdateStockTransferRevisionRoute(app);
  app.post("/api/stock-transfers/:transferId/revisions", (req, res) => {
    return res.status(201).json({ optional: req.body.optional === true });
  });
  return app;
}

describe("POS stock transfer revision access", () => {
  it("routes pending revisions around the admin-only compatibility guard", async () => {
    authHarness.calls = 0;

    const agent = request(buildApp());
    const response = await agent.post(revisionPath).send({ optional: true });

    expect(response.status).toBe(201);
    expect(response.body.optional).toBe(true);
    expect(authHarness.calls).toBe(0);
  });

  it("keeps non-pending revisions behind the admin-only guard", async () => {
    authHarness.calls = 0;

    const agent = request(buildApp());
    const response = await agent.post(revisionPath).send({ optional: false });

    expect(response.status).toBe(403);
    expect(authHarness.calls).toBe(1);
  });
});
