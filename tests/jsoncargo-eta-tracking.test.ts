/**
 * JSONCargo ETA Tracking — unit + integration tests.
 *
 * All JSONCargo HTTP calls are mocked via vi.stubGlobal("fetch", ...); no real
 * network requests are made and no real API key is required to run these tests.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";
import { db, pool } from "../server/db";
import { eq } from "drizzle-orm";
import * as schema from "../shared/schema";
import {
  normalizeJsonCargoCarrier,
  isValidContainerNumber,
  track as jsonCargoTrack,
} from "../server/lib/trackingProviders/jsonCargoProvider";
import {
  refreshContainerEta,
  refreshMultipleContainerEtas,
} from "../server/services/jsonCargoTrackingService";

const TEST_PREFIX = "jcargotest";

let ctx: TestContext;
let supplierId: number;
let agent: request.SuperAgentTest;
let managerAgent: request.SuperAgentTest;

function mockFetchOnce(response: { status: number; body?: any; throwError?: Error }) {
  return vi.fn(async () => {
    if (response.throwError) throw response.throwError;
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body ?? {},
    } as any;
  });
}

async function makeContainer(overrides: Partial<typeof schema.containers.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.containers)
    .values({
      companyId: ctx.companyId,
      containerNumber: overrides.containerNumber ?? `MSCU${Math.floor(1000000 + Math.random() * 8999999)}`,
      supplierId,
      status: "OTW",
      importDate: "2026-01-01",
      trackingCarrierHint: "MSC",
      trackingEnabled: true,
      ...overrides,
    } as any)
    .returning();
  return row;
}

beforeAll(async () => {
  // Purge any containers/suppliers left behind by a previous failed run before
  // seedTestData tries to delete their parent companies (containers.company_id
  // has an FK that would otherwise block company cleanup).
  await pool.query(
    "DELETE FROM containers WHERE company_id IN (SELECT id FROM companies WHERE name LIKE $1)",
    [`%${TEST_PREFIX}%`]
  );
  await pool.query("DELETE FROM suppliers WHERE code LIKE $1", [`${TEST_PREFIX}%`]);

  ctx = await seedTestData(TEST_PREFIX);

  // Note: `suppliers` is a global table with no companyId column (see schema) —
  // it is scoped only by its unique `code`.
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({
      code: `${TEST_PREFIX}-SUP1`,
      legalName: `${TEST_PREFIX}_Supplier`,
      email: `${TEST_PREFIX}_supplier@example.com`,
    })
    .returning();
  supplierId = supplier.id;

  agent = request.agent(ctx.app);
  const loginRes = await agent
    .post("/api/auth/login")
    .send({ username: `${TEST_PREFIX}_testuser`, password: "testpassword123" });
  if (loginRes.status !== 200) {
    throw new Error(`login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }
  await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });

  // A second, non-admin user for role-gating checks on the bulk route.
  const bcrypt = await import("bcryptjs");
  const hashedPassword = await bcrypt.hash("testpassword123", 10);
  const [managerUser] = await db
    .insert(schema.users)
    .values({ username: `${TEST_PREFIX}_manager`, password: hashedPassword })
    .returning();
  await db.insert(schema.userCompanyRoles).values({
    userId: managerUser.id,
    companyId: ctx.companyId,
    role: "Manager",
  });
  managerAgent = request.agent(ctx.app);
  const mgrLogin = await managerAgent
    .post("/api/auth/login")
    .send({ username: `${TEST_PREFIX}_manager`, password: "testpassword123" });
  if (mgrLogin.status !== 200) {
    throw new Error(`manager login failed: ${mgrLogin.status} ${JSON.stringify(mgrLogin.body)}`);
  }
  await managerAgent.post("/api/auth/set-company").send({ companyId: ctx.companyId });
});

afterAll(async () => {
  await pool.query("DELETE FROM login_history WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)", [
    `%${TEST_PREFIX}%`,
  ]);
  await pool.query(
    "DELETE FROM containers WHERE company_id IN (SELECT id FROM companies WHERE name LIKE $1)",
    [`%${TEST_PREFIX}%`]
  );
  await pool.query("DELETE FROM suppliers WHERE code LIKE $1", [`${TEST_PREFIX}%`]);
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
});

beforeEach(() => {
  process.env.JSONCARGO_API_KEY = "test-key-not-real";
  process.env.JSONCARGO_REFRESH_HOURS = "168";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.JSONCARGO_API_KEY;
  delete process.env.JSONCARGO_REFRESH_HOURS;
});

describe("normalizeJsonCargoCarrier", () => {
  it("maps the four supported carriers from loose free text", () => {
    expect(normalizeJsonCargoCarrier("Maersk")).toBe("MAERSK");
    expect(normalizeJsonCargoCarrier("MAERSK LINE")).toBe("MAERSK");
    expect(normalizeJsonCargoCarrier("Hapag-Lloyd")).toBe("HAPAG_LLOYD");
    expect(normalizeJsonCargoCarrier("Hapag Lloyd")).toBe("HAPAG_LLOYD");
    expect(normalizeJsonCargoCarrier("MSC")).toBe("MSC");
    expect(normalizeJsonCargoCarrier("Mediterranean Shipping Company")).toBe("MSC");
    expect(normalizeJsonCargoCarrier("CMA CGM")).toBe("CMA_CGM");
    expect(normalizeJsonCargoCarrier("CMA-CGM (France)")).toBe("CMA_CGM");
  });

  it("returns null for unsupported or missing carriers", () => {
    expect(normalizeJsonCargoCarrier("Evergreen")).toBeNull();
    expect(normalizeJsonCargoCarrier(null)).toBeNull();
    expect(normalizeJsonCargoCarrier("")).toBeNull();
    expect(normalizeJsonCargoCarrier(undefined)).toBeNull();
  });
});

describe("isValidContainerNumber", () => {
  it("accepts ISO 6346 formatted numbers", () => {
    expect(isValidContainerNumber("MSCU1234567")).toBe(true);
  });
  it("rejects malformed numbers", () => {
    expect(isValidContainerNumber("BADNUMBER")).toBe(false);
    expect(isValidContainerNumber("")).toBe(false);
    expect(isValidContainerNumber(null)).toBe(false);
  });
});

describe("jsonCargoProvider.track (mocked HTTP)", () => {
  it("extracts the ETA from response.data.eta_final_destination on success", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce({ status: 200, body: { data: { eta_final_destination: "2026-08-01T00:00:00Z" } } })
    );
    const result = await jsonCargoTrack("MSCU1234567", "MSC");
    expect(result.success).toBe(true);
    expect(result.eta).toBe("2026-08-01");
  });

  it("returns not_found on 404 with a single attempt (no retry)", async () => {
    const fetchMock = mockFetchOnce({ status: 404 });
    vi.stubGlobal("fetch", fetchMock);
    const result = await jsonCargoTrack("MSCU1234567", "MSC");
    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe("not_found");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once on 429 then gives up", async () => {
    const fetchMock = mockFetchOnce({ status: 429 });
    vi.stubGlobal("fetch", fetchMock);
    const result = await jsonCargoTrack("MSCU1234567", "MSC");
    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe("rate_limited");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once on 5xx then gives up", async () => {
    const fetchMock = mockFetchOnce({ status: 503 });
    vi.stubGlobal("fetch", fetchMock);
    const result = await jsonCargoTrack("MSCU1234567", "MSC");
    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe("http_error");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once on network error then gives up", async () => {
    const fetchMock = mockFetchOnce({ status: 0, throwError: new Error("network down") });
    vi.stubGlobal("fetch", fetchMock);
    const result = await jsonCargoTrack("MSCU1234567", "MSC");
    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe("network_error");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns not_configured immediately when the API key is missing, without calling fetch", async () => {
    delete process.env.JSONCARGO_API_KEY;
    const fetchMock = mockFetchOnce({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    const result = await jsonCargoTrack("MSCU1234567", "MSC");
    expect(result.success).toBe(false);
    expect(result.errorCategory).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("refreshContainerEta (service, mocked HTTP)", () => {
  it("updates the ETA on a successful response", async () => {
    const container = await makeContainer();
    vi.stubGlobal(
      "fetch",
      mockFetchOnce({ status: 200, body: { data: { eta_final_destination: "2026-09-15" } } })
    );
    const result = await refreshContainerEta(container.id);
    expect(result.status).toBe("updated");
    expect(result.newEta).toBe("2026-09-15");

    const [updated] = await db.select().from(schema.containers).where(eq(schema.containers.id, container.id));
    expect(updated.eta).toBe("2026-09-15");
    expect(updated.etaSource).toBe("api");
    expect(updated.jsonCargoTrackingStatus).toBe("SUCCESS");
  });

  it("never blanks an existing ETA when the provider returns no ETA", async () => {
    const container = await makeContainer({ eta: "2026-05-01" });
    vi.stubGlobal("fetch", mockFetchOnce({ status: 200, body: { data: { eta_final_destination: null } } }));
    const result = await refreshContainerEta(container.id);
    expect(result.status).toBe("no_eta");
    expect(result.newEta).toBe("2026-05-01");

    const [row] = await db.select().from(schema.containers).where(eq(schema.containers.id, container.id));
    expect(row.eta).toBe("2026-05-01");
    expect(row.jsonCargoTrackingStatus).toBe("NO_ETA");
  });

  it("never blanks an existing ETA on not_found", async () => {
    const container = await makeContainer({ eta: "2026-05-01" });
    vi.stubGlobal("fetch", mockFetchOnce({ status: 404 }));
    const result = await refreshContainerEta(container.id);
    expect(result.status).toBe("not_found");
    expect(result.newEta).toBe("2026-05-01");
  });

  it("never blanks an existing ETA on a transient error", async () => {
    const container = await makeContainer({ eta: "2026-05-01" });
    vi.stubGlobal("fetch", mockFetchOnce({ status: 503 }));
    const result = await refreshContainerEta(container.id);
    expect(result.status).toBe("error");
    expect(result.newEta).toBe("2026-05-01");
  });

  it("skips unsupported carriers without calling the API", async () => {
    const container = await makeContainer({ trackingCarrierHint: "Evergreen" });
    const fetchMock = mockFetchOnce({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    const result = await refreshContainerEta(container.id);
    expect(result.status).toBe("unsupported_carrier");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips containers with no carrier hint at all", async () => {
    const container = await makeContainer({ trackingCarrierHint: null });
    const fetchMock = mockFetchOnce({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    const result = await refreshContainerEta(container.id);
    expect(result.status).toBe("unsupported_carrier");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips inactive (offloaded) containers without calling the API", async () => {
    const container = await makeContainer({ status: "OFFLOADED" });
    const fetchMock = mockFetchOnce({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    const result = await refreshContainerEta(container.id);
    expect(result.status).toBe("inactive");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips containers checked within the refresh window, without calling the API", async () => {
    const container = await makeContainer({ jsonCargoLastCheckedAt: new Date() as any });
    const fetchMock = mockFetchOnce({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    const result = await refreshContainerEta(container.id);
    expect(result.status).toBe("skipped_recent");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forceRefresh bypasses the weekly window and calls the API", async () => {
    const container = await makeContainer({ jsonCargoLastCheckedAt: new Date() as any });
    const fetchMock = mockFetchOnce({ status: 200, body: { data: { eta_final_destination: "2026-10-01" } } });
    vi.stubGlobal("fetch", fetchMock);
    const result = await refreshContainerEta(container.id, { forceRefresh: true });
    expect(result.status).toBe("updated");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors JSONCARGO_REFRESH_HOURS when it has elapsed", async () => {
    process.env.JSONCARGO_REFRESH_HOURS = "1";
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const container = await makeContainer({ jsonCargoLastCheckedAt: eightDaysAgo as any });
    const fetchMock = mockFetchOnce({ status: 200, body: { data: { eta_final_destination: "2026-11-01" } } });
    vi.stubGlobal("fetch", fetchMock);
    const result = await refreshContainerEta(container.id);
    expect(result.status).toBe("updated");
  });
});

describe("refreshMultipleContainerEtas (bulk)", () => {
  it("dedupes ids and aggregates status counts without exceeding the batch", async () => {
    const c1 = await makeContainer();
    const c2 = await makeContainer({ trackingCarrierHint: "Evergreen" }); // unsupported
    const c3 = await makeContainer({ status: "OFFLOADED" }); // inactive
    vi.stubGlobal(
      "fetch",
      mockFetchOnce({ status: 200, body: { data: { eta_final_destination: "2026-12-01" } } })
    );

    const summary = await refreshMultipleContainerEtas([c1.id, c1.id, c2.id, c3.id]);
    expect(summary.total).toBe(3); // deduped
    expect(summary.updated).toBe(1);
    expect(summary.unsupportedCarrier).toBe(1);
    expect(summary.inactive).toBe(1);
  });
});

describe("routes — permissions and company isolation", () => {
  it("rejects unauthenticated refresh-eta requests", async () => {
    const container = await makeContainer();
    const res = await request(ctx.app).post(`/api/containers/${container.id}/refresh-eta`).send({});
    expect(res.status).toBe(401);
  });

  it("returns 404 when refreshing a container from another company", async () => {
    const otherCtx = await seedTestData(`${TEST_PREFIX}other`);
    try {
      const [foreignSupplier] = await db
        .insert(schema.suppliers)
        .values({
          code: `${TEST_PREFIX}-FSUP`,
          legalName: "Foreign Supplier",
          email: `${TEST_PREFIX}_foreign@example.com`,
        })
        .returning();
      const [foreignContainer] = await db
        .insert(schema.containers)
        .values({
          companyId: otherCtx.companyId,
          containerNumber: "MSCU7654321",
          supplierId: foreignSupplier.id,
          status: "OTW",
          importDate: "2026-01-01",
          trackingCarrierHint: "MSC",
        } as any)
        .returning();

      vi.stubGlobal("fetch", mockFetchOnce({ status: 200 }));
      const res = await agent.post(`/api/containers/${foreignContainer.id}/refresh-eta`).send({});
      expect(res.status).toBe(404);
    } finally {
      await pool.query("DELETE FROM containers WHERE company_id = $1", [otherCtx.companyId]);
      await pool.query("DELETE FROM suppliers WHERE code = $1", [`${TEST_PREFIX}-FSUP`]);
      await cleanupTestData(`${TEST_PREFIX}other`);
    }
  });

  it("allows a regular (non-admin) authenticated user to refresh a single container", async () => {
    const container = await makeContainer();
    vi.stubGlobal(
      "fetch",
      mockFetchOnce({ status: 200, body: { data: { eta_final_destination: "2026-12-15" } } })
    );
    const res = await managerAgent.post(`/api/containers/${container.id}/refresh-eta`).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("updated");
  });

  it("rejects bulk refresh for non-admin roles", async () => {
    const res = await managerAgent.post("/api/containers/refresh-etas").send({});
    expect(res.status).toBe(403);
  });

  it("allows bulk refresh for Admin", async () => {
    vi.stubGlobal("fetch", mockFetchOnce({ status: 200, body: { data: { eta_final_destination: "2027-01-01" } } }));
    const res = await agent.post("/api/containers/refresh-etas").send({});
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("total");
  });

  it("returns a safe summary with no secrets on GET eta-tracking-summary", async () => {
    const res = await agent.get("/api/containers/eta-tracking-summary");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("configured");
    expect(res.body).toHaveProperty("supportedCarriers");
    expect(JSON.stringify(res.body)).not.toContain("test-key-not-real");
  });
});
