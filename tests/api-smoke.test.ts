/**
 * API Smoke Tests
 * ---------------
 * Verify that every major endpoint returns a non-500 response after a
 * successful login.  These tests catch:
 *   - broken imports / missing exports after file splits
 *   - route registration gaps
 *   - schema column renames that break query compilation at runtime
 *   - missing `requireAuth` that would short-circuit with 401
 *
 * Assertion strategy:
 *   - Core ERP endpoints (accounts, vouchers, inventory, locations, …) must
 *     return HTTP 200.
 *   - Factory endpoints that depend on factory-company state we don't seed
 *     may return any non-500 code (200 or 4xx are both fine; 500 = broken).
 *   - Report endpoints that require `requireNonPOS` must return 200 for admin.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import {
  seedTestData,
  cleanupTestData,
  closeTestServer,
  type TestContext,
} from "./setup";

const TEST_PREFIX = "smktest";

let ctx: TestContext;
let agent: request.SuperAgentTest;

async function login() {
  const res = await agent.post("/api/auth/login").send({
    username: `${TEST_PREFIX}_testuser`,
    password: "testpassword123",
  });
  if (res.status !== 200) throw new Error(`Login failed: ${res.status}`);
  await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });
}

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);
  await login();
}, 60000);

afterAll(async () => {
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

// ── Core ERP endpoints ───────────────────────────────────────────────────────

describe("Smoke — Accounts", () => {
  it("GET /api/accounts/all returns 200", async () => {
    const res = await agent.get("/api/accounts/all");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/accounts/ledger/:id/balance returns 200", async () => {
    const res = await agent.get(`/api/accounts/ledger/${ctx.cashAccountId}/balance`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("balance");
  });

  it("GET /api/accounts/ledger/:id/transactions returns 200", async () => {
    const res = await agent.get(`/api/accounts/ledger/${ctx.cashAccountId}/transactions`);
    expect(res.status).toBe(200);
  });
});

describe("Smoke — Vouchers", () => {
  it("GET /api/vouchers returns 200 with an array", async () => {
    const res = await agent.get("/api/vouchers");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/vouchers/optional returns 200", async () => {
    const res = await agent.get("/api/vouchers/optional");
    expect(res.status).toBe(200);
  });
});

describe("Smoke — Inventory", () => {
  it("GET /api/inventory returns 200", async () => {
    const res = await agent.get(`/api/inventory?locationId=${ctx.locationId}`);
    expect(res.status).toBe(200);
  });

  it("GET /api/inventory without locationId returns 400 or 200 (not 500)", async () => {
    const res = await agent.get("/api/inventory");
    // Inventory route validates locationId: returns 400 (missing param) or 200 (empty).
    // Both are correct; any 5xx means a crash/unhandled error.
    expect([200, 400]).toContain(res.status);
  });

  it("GET /api/inventory/movement returns 200 with required params", async () => {
    const today = new Date().toISOString().split("T")[0];
    // stockItemId is required; startDate/endDate without values returns empty months (200)
    const res = await agent.get(
      `/api/inventory/movement?stockItemId=${ctx.stockItemIds[0]}&locationId=${ctx.locationId}&startDate=2024-01-01&endDate=${today}`,
    );
    expect(res.status).toBe(200);
  });

  it("GET /api/inventory/movement without stockItemId returns 400 not 500", async () => {
    const res = await agent.get("/api/inventory/movement");
    expect(res.status).toBe(400);
  });
});

describe("Smoke — Locations", () => {
  it("GET /api/locations returns 200 with an array", async () => {
    const res = await agent.get("/api/locations");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/locations/:id returns 200", async () => {
    const res = await agent.get(`/api/locations/${ctx.locationId}`);
    expect(res.status).toBe(200);
  });

  it("GET /api/locations/:id/inventory returns 200", async () => {
    const res = await agent.get(`/api/locations/${ctx.locationId}/inventory`);
    expect(res.status).toBe(200);
  });
});

describe("Smoke — Stock Items", () => {
  it("GET /api/stock-items returns 200 with an array", async () => {
    const res = await agent.get("/api/stock-items");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/stock-items includes seeded item for this company", async () => {
    const res = await agent.get("/api/stock-items");
    expect(res.status).toBe(200);
    const ids = (res.body as any[]).map((i) => i.id);
    expect(ids).toContain(ctx.stockItemIds[0]);
  });
});

describe("Smoke — POS", () => {
  it("GET /api/pos/shifts/history returns 200", async () => {
    const res = await agent.get(`/api/pos/shifts/history?locationId=${ctx.locationId}`);
    expect(res.status).toBe(200);
  });
});

describe("Smoke — Reports", () => {
  it("GET /api/reports/balance-sheet returns 200", async () => {
    const res = await agent.get("/api/reports/balance-sheet");
    expect(res.status).toBe(200);
  });

  it("GET /api/reports/profit-loss returns 200", async () => {
    const today = new Date().toISOString().split("T")[0];
    const res = await agent.get(
      `/api/reports/profit-loss?fromDate=2024-01-01&toDate=${today}`,
    );
    expect(res.status).toBe(200);
  });

  it("GET /api/reports/closing-stock-summary returns 200", async () => {
    const res = await agent.get("/api/reports/closing-stock-summary");
    expect(res.status).toBe(200);
  });
});

describe("Smoke — WhatsApp settings", () => {
  it("GET /api/whatsapp/settings returns non-500 (may be 404 when no row exists in test DB)", async () => {
    const res = await agent.get("/api/whatsapp/settings");
    // Settings row may not exist in test DB — 404 is acceptable; 500 = broken import/crash.
    expect(res.status).toBeLessThan(500);
  });

  it("GET /api/whatsapp/recipients returns non-500", async () => {
    const res = await agent.get("/api/whatsapp/recipients");
    // Recipients table may be empty in test DB — 200 with [] is also acceptable.
    expect(res.status).toBeLessThan(500);
  });
});

describe("Smoke — Factory (returns non-500)", () => {
  // Factory routes may return 400 when factory company context is not set up,
  // but must never return 500 (which would mean a broken import or crash).

  it("GET /api/factory/suppliers does not return 500", async () => {
    const res = await agent.get("/api/factory/suppliers");
    expect(res.status).toBeLessThan(500);
  });

  it("GET /api/factory/supplier-categories does not return 500", async () => {
    const res = await agent.get("/api/factory/supplier-categories");
    expect(res.status).toBeLessThan(500);
  });

  it("GET /api/factory/shipping-container-rows does not return 500", async () => {
    const res = await agent.get("/api/factory/shipping-container-rows");
    expect(res.status).toBeLessThan(500);
  });

  it("GET /api/factory/daybook does not return 500", async () => {
    const today = new Date().toISOString().split("T")[0];
    const res = await agent.get(`/api/factory/daybook?date=${today}`);
    expect(res.status).toBeLessThan(500);
  });

  it("GET /api/factory/supplier-payments does not return 500", async () => {
    const res = await agent.get("/api/factory/supplier-payments");
    expect(res.status).toBeLessThan(500);
  });
});

describe("Smoke — SP company guard (non-SP company gets 403, not 500)", () => {
  it("GET /api/sp/setup/status returns 403 for a non-supplier_partner company", async () => {
    const res = await agent.get("/api/sp/setup/status");
    // Our test company is type 'erp', not 'supplier_partner'
    expect(res.status).toBe(403);
  });

  it("POST /api/sp/setup returns 403 for a non-supplier_partner company", async () => {
    const res = await agent.post("/api/sp/setup").send({});
    expect(res.status).toBe(403);
  });

  it("GET /api/sp/containers returns 403 for a non-supplier_partner company", async () => {
    const res = await agent.get("/api/sp/containers");
    expect(res.status).toBe(403);
  });
});

describe("Smoke — Auth boundary", () => {
  it("unauthenticated request to /api/accounts/all returns 401", async () => {
    const anonAgent = request.agent(ctx.app);
    const res = await anonAgent.get("/api/accounts/all");
    expect(res.status).toBe(401);
  });

  it("unauthenticated request to /api/vouchers returns 401", async () => {
    const anonAgent = request.agent(ctx.app);
    const res = await anonAgent.get("/api/vouchers");
    expect(res.status).toBe(401);
  });

  it("unauthenticated request to /api/inventory returns 401", async () => {
    const anonAgent = request.agent(ctx.app);
    const res = await anonAgent.get(`/api/inventory?locationId=${ctx.locationId}`);
    expect(res.status).toBe(401);
  });
});

/*
 * What this file protects:
 * - All major API routes return valid HTTP status (not 500) after login
 * - Accounts, vouchers, inventory, locations, stock-items, POS, reports all respond 200
 * - Factory routes respond with non-500 even without factory company context
 * - WhatsApp settings route exists and does not crash
 * - Unauthenticated requests are rejected with 401
 */
