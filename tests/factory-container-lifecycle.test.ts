/**
 * Factory / SP Container Lifecycle Tests
 * ----------------------------------------
 * Tests the full SP (Supplier Partner) container lifecycle:
 *
 *   1. Setup   — create supplier_partner company, run /api/sp/setup (accounts + location)
 *   2. Create  — POST /api/sp/containers → status "open", OTW voucher created (DR=CR)
 *   3. Offload — POST /api/sp/offload → status "offloaded", inventory added, DR=CR
 *
 * The SP module requires company_type = "supplier_partner".  This test seeds its
 * own isolated SP company so it does not interfere with the standard ERP test company.
 *
 * Reverse / re-offload scenarios are marked it.todo — they expose a pre-existing
 * invariant gap in reverseInventoryByExactValue (see inventory.test.ts skipped tests).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import {
  seedTestData,
  cleanupTestData,
  closeTestServer,
  type TestContext,
} from "./setup";
import { db, pool } from "../server/db";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "../shared/schema";
import {
  spContainers,
  spContainerLines,
  spOffloads,
  spOffloadCharges,
  spStockMovements,
} from "../shared/schema/sp";

const TEST_PREFIX = "facttest";

// The SP lifecycle needs its own company (supplier_partner type).
// We also keep a minimal ERP context for the shared app server.
let erpCtx: TestContext;       // ERP company — just for the shared app instance
let spCompanyId: number;
let spLocationId: number;
let spStockItemId: number;
let spAgent: request.SuperAgentTest;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function cleanupSpTables(companyId: number) {
  // Delete in FK-safe order
  await pool.query(
    `DELETE FROM sp_stock_movements WHERE company_id = $1`,
    [companyId],
  );
  await pool.query(
    `DELETE FROM sp_offload_charges WHERE offload_id IN (
       SELECT id FROM sp_offloads WHERE company_id = $1
     )`,
    [companyId],
  );
  await pool.query(`DELETE FROM sp_offloads WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM sp_container_lines WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM sp_containers WHERE company_id = $1`, [companyId]);
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  // Seed a minimal ERP context just to spin up the app server
  erpCtx = await seedTestData(TEST_PREFIX);
  const app = erpCtx.app;

  // ── Create supplier_partner company ──────────────────────────────────────
  const bcrypt = await import("bcryptjs");
  const hashedPw = await bcrypt.hash("testpassword123", 10);

  const [spUser] = await db
    .insert(schema.users)
    .values({ username: `${TEST_PREFIX}_spuser`, password: hashedPw })
    .returning();

  const [spCompany] = await db
    .insert(schema.companies)
    .values({
      code: "FACTSP",
      name: `${TEST_PREFIX}_SpCompany`,
      baseCurrency: "USD",
      companyType: "supplier_partner",
    })
    .returning();

  spCompanyId = spCompany.id;

  await db.insert(schema.userCompanyRoles).values({
    userId: spUser.id,
    companyId: spCompanyId,
    role: "Admin",
  });

  // ── Create stock item for the SP company (needed for container lines) ────
  const [spItem] = await db
    .insert(schema.stockItems)
    .values({
      companyId: spCompanyId,
      code: `${TEST_PREFIX}-SP-ITEM1`,
      name: "SP Test Item 1",
      uom: "PCS",
      stockGroupId: null,
      active: true,
    })
    .returning();

  spStockItemId = spItem.id;

  // ── Login as SP user and select SP company ───────────────────────────────
  spAgent = request.agent(app);
  const loginRes = await spAgent
    .post("/api/auth/login")
    .send({ username: `${TEST_PREFIX}_spuser`, password: "testpassword123" });
  if (loginRes.status !== 200) {
    throw new Error(`SP user login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }
  await spAgent.post("/api/auth/set-company").send({ companyId: spCompanyId });

  // ── Run SP account setup (creates ledger accounts + default location) ────
  const setupRes = await spAgent.post("/api/sp/setup").send({});
  if (setupRes.status !== 200) {
    throw new Error(`SP setup failed: ${setupRes.status} ${JSON.stringify(setupRes.body)}`);
  }

  // Fetch the default location created by setup
  const [defaultLoc] = await db
    .select()
    .from(schema.locations)
    .where(eq(schema.locations.companyId, spCompanyId))
    .limit(1);

  if (!defaultLoc) throw new Error("SP setup did not create a default location");
  spLocationId = defaultLoc.id;
}, 90000);

afterAll(async () => {
  if (spCompanyId) {
    await cleanupSpTables(spCompanyId);
    await pool.query("DELETE FROM voucher_entries WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id = $1)", [spCompanyId]);
    await pool.query("DELETE FROM vouchers WHERE company_id = $1", [spCompanyId]);
    await pool.query("DELETE FROM inventory WHERE company_id = $1", [spCompanyId]);
    await pool.query("DELETE FROM stock_items WHERE company_id = $1", [spCompanyId]);
    await pool.query("DELETE FROM ledger_accounts WHERE company_id = $1", [spCompanyId]);
    await pool.query("DELETE FROM locations WHERE company_id = $1", [spCompanyId]);
    await pool.query("DELETE FROM user_company_roles WHERE company_id = $1", [spCompanyId]);
    await pool.query("DELETE FROM audit_log WHERE company_id = $1", [spCompanyId]);
    await pool.query("DELETE FROM login_history WHERE company_id = $1", [spCompanyId]);
    await pool.query("DELETE FROM companies WHERE id = $1", [spCompanyId]);
    await pool.query("DELETE FROM users WHERE username = $1", [`${TEST_PREFIX}_spuser`]);
  }
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

// ── Phase 1: SP Setup verification ───────────────────────────────────────────

describe("SP Lifecycle — Phase 1: Setup", () => {
  it("GET /api/sp/setup/status returns 200 for supplier_partner company", async () => {
    const res = await spAgent.get("/api/sp/setup/status");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("isConfigured");
  });

  it("SP setup created all required ledger accounts", async () => {
    const res = await spAgent.get("/api/sp/setup/status");
    expect(res.status).toBe(200);
    expect(res.body.isConfigured).toBe(true);
    expect(Array.isArray(res.body.spAccounts)).toBe(true);
    expect(res.body.spAccounts.length).toBeGreaterThanOrEqual(8);
  });

  it("SP setup created at least one location", async () => {
    const res = await spAgent.get("/api/sp/setup/status");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.locations)).toBe(true);
    expect(res.body.locations.length).toBeGreaterThanOrEqual(1);
  });

  it("calling /api/sp/setup again is idempotent (no duplicate accounts)", async () => {
    const res = await spAgent.post("/api/sp/setup").send({});
    expect(res.status).toBe(200);
    // Re-running setup should report all accounts as 'existing', none as 'created'
    const created: string[] = res.body?.created ?? [];
    const accountsCreated = created.filter((c: string) => !c.toLowerCase().includes("location"));
    expect(accountsCreated.length).toBe(0);
  });
});

// ── Phase 2: Container creation ───────────────────────────────────────────────

let createdContainerId: number;
const INVOICE_TOTAL = 1000;
const CONTAINER_QTY  = 50;
const UNIT_RATE      = 20; // 50 × $20 = $1000

describe("SP Lifecycle — Phase 2: Container creation", () => {
  it("POST /api/sp/containers returns 200 with a container ID", async () => {
    const today = new Date().toISOString().split("T")[0];
    const res = await spAgent.post("/api/sp/containers").send({
      supplierName: "Test SP Supplier",
      containerNumber: `${TEST_PREFIX}-CONT-001`,
      invoiceNumber: `${TEST_PREFIX}-INV-001`,
      invoiceDate: today,
      invoiceTotalUsd: INVOICE_TOTAL,
      discountPct: 0,
      freightEstimateUsd: 0,
      lines: [{
        articleCode: `${TEST_PREFIX}-SP-ITEM1`,
        description: "SP test item",
        qty: CONTAINER_QTY,
        unitRateUsd: UNIT_RATE,
        stockItemId: spStockItemId,
      }],
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    createdContainerId = res.body.id;
  });

  it("created container has status 'open'", async () => {
    expect(createdContainerId).toBeDefined();
    const [row] = await db
      .select()
      .from(spContainers)
      .where(eq(spContainers.id, createdContainerId));
    expect(row).toBeDefined();
    expect(row!.status).toBe("open");
  });

  it("container creation posted a Goods OTW journal voucher", async () => {
    expect(createdContainerId).toBeDefined();
    const [row] = await db
      .select()
      .from(spContainers)
      .where(eq(spContainers.id, createdContainerId));
    expect(row!.goodsOtwVoucherId).toBeDefined();
    expect(row!.goodsOtwVoucherId).not.toBeNull();
  });

  it("Goods OTW voucher entries are balanced (DR = CR)", async () => {
    expect(createdContainerId).toBeDefined();
    const [row] = await db
      .select({ otwVoucherId: spContainers.goodsOtwVoucherId })
      .from(spContainers)
      .where(eq(spContainers.id, createdContainerId));
    expect(row!.otwVoucherId).toBeDefined();

    const result = await pool.query(
      `SELECT
         COALESCE(SUM(CAST(debit_amount  AS NUMERIC)), 0) AS total_dr,
         COALESCE(SUM(CAST(credit_amount AS NUMERIC)), 0) AS total_cr
       FROM voucher_entries
       WHERE voucher_id = $1`,
      [row!.otwVoucherId],
    );
    const dr = parseFloat(result.rows[0].total_dr);
    const cr = parseFloat(result.rows[0].total_cr);
    expect(Math.abs(dr - cr)).toBeLessThan(0.01);
    expect(dr).toBeCloseTo(INVOICE_TOTAL, 0);
  });

  it("container line is recorded in DB with correct qty", async () => {
    const [line] = await db
      .select()
      .from(spContainerLines)
      .where(eq(spContainerLines.containerId, createdContainerId));
    expect(line).toBeDefined();
    expect(parseFloat(line!.qty)).toBeCloseTo(CONTAINER_QTY, 1);
    expect(line!.stockItemId).toBe(spStockItemId);
  });

  it("GET /api/sp/containers lists the created container", async () => {
    const res = await spAgent.get("/api/sp/containers");
    expect(res.status).toBe(200);
    const ids = (res.body as any[]).map((c) => c.id);
    expect(ids).toContain(createdContainerId);
  });
});

// ── Phase 3: Container offload ────────────────────────────────────────────────

let offloadVoucherIds: number[] = [];

describe("SP Lifecycle — Phase 3: Container offload", () => {
  it("POST /api/sp/offload returns 200", async () => {
    const today = new Date().toISOString().split("T")[0];
    const res = await spAgent.post("/api/sp/offload").send({
      containerId: createdContainerId,
      offloadDate: today,
      locationId: spLocationId,
      chargeLines: [], // no extra charges for this test
    });
    expect(res.status).toBe(200);

    // Capture the offload voucher IDs for the DR=CR check
    const [offloadRow] = await db
      .select()
      .from(spOffloads)
      .where(eq(spOffloads.containerId, createdContainerId));
    if (offloadRow) {
      const ids: number[] = [];
      if (offloadRow.voucherIdReversal) ids.push(offloadRow.voucherIdReversal);
      if (offloadRow.voucherIdStock)    ids.push(offloadRow.voucherIdStock);
      offloadVoucherIds = ids;
    }
  });

  it("container status changes to 'offloaded' after offload", async () => {
    const [row] = await db
      .select()
      .from(spContainers)
      .where(eq(spContainers.id, createdContainerId));
    expect(row!.status).toBe("offloaded");
  });

  it("sp_offloads record is created with correct qty and cost", async () => {
    const [offload] = await db
      .select()
      .from(spOffloads)
      .where(eq(spOffloads.containerId, createdContainerId));
    expect(offload).toBeDefined();
    expect(parseFloat(offload!.totalQty)).toBeCloseTo(CONTAINER_QTY, 1);
    // Base cost = qty × unitRate × (1 - discount) = 50 × 20 × 1 = 1000
    expect(parseFloat(offload!.totalBaseCostUsd)).toBeCloseTo(CONTAINER_QTY * UNIT_RATE, 0);
  });

  it("inventory is added for the SP stock item at the offload location", async () => {
    const [inv] = await db
      .select()
      .from(schema.inventory)
      .where(
        and(
          eq(schema.inventory.companyId, spCompanyId),
          eq(schema.inventory.locationId, spLocationId),
          eq(schema.inventory.stockItemId, spStockItemId),
        ),
      )
      .limit(1);
    expect(inv).toBeDefined();
    // Quantity must match container line qty
    expect(parseFloat(inv!.quantity)).toBeCloseTo(CONTAINER_QTY, 1);
  });

  it("inventory totalValue and averageRate are correct after offload", async () => {
    const [inv] = await db
      .select()
      .from(schema.inventory)
      .where(
        and(
          eq(schema.inventory.companyId, spCompanyId),
          eq(schema.inventory.locationId, spLocationId),
          eq(schema.inventory.stockItemId, spStockItemId),
        ),
      )
      .limit(1);
    expect(inv).toBeDefined();
    // totalValue = qty × unitRate = 50 × 20 = 1000 (no charges → no markup)
    const expectedTotalValue = CONTAINER_QTY * UNIT_RATE;
    expect(parseFloat(inv!.totalValue ?? "0")).toBeCloseTo(expectedTotalValue, 0);
    // averageRate = totalValue / qty = 20
    expect(parseFloat(inv!.averageRate)).toBeCloseTo(UNIT_RATE, 1);
  });

  it("offload reversal voucher entries are balanced (DR = CR)", async () => {
    expect(offloadVoucherIds.length).toBeGreaterThan(0);
    for (const voucherId of offloadVoucherIds) {
      const result = await pool.query(
        `SELECT
           COALESCE(SUM(CAST(debit_amount  AS NUMERIC)), 0) AS total_dr,
           COALESCE(SUM(CAST(credit_amount AS NUMERIC)), 0) AS total_cr
         FROM voucher_entries
         WHERE voucher_id = $1`,
        [voucherId],
      );
      const dr = parseFloat(result.rows[0].total_dr);
      const cr = parseFloat(result.rows[0].total_cr);
      expect(Math.abs(dr - cr)).toBeLessThan(0.01);
    }
  });

  it("attempting to offload the same container again returns 400", async () => {
    const today = new Date().toISOString().split("T")[0];
    const res = await spAgent.post("/api/sp/offload").send({
      containerId: createdContainerId,
      offloadDate: today,
      locationId: spLocationId,
      chargeLines: [],
    });
    expect(res.status).toBe(400);
  });
});

// ── Phase 4: Reverse / re-offload (TODOs) ────────────────────────────────────

describe("SP Lifecycle — Phase 4: Reverse and re-offload", () => {
  it.todo(
    "TODO: reverse offload restores container to 'open' and removes inventory " +
    "— pre-existing gap: reverseInventoryByExactValue leaves non-zero averageRate " +
    "when qty goes to zero (see inventory.test.ts skipped tests). " +
    "Production fix: enforce qty<=0 → rate=0, value=0 invariant in inventoryHelper.ts."
  );

  it.todo(
    "TODO: re-offload after reversal produces identical inventory to first offload " +
    "— idempotency invariant not yet enforced. " +
    "Production fix: same as above (rate/value normalization on negative-qty inventory)."
  );

  it.todo(
    "TODO: offload with partial charge lines (prepaid_used, paid_now, unpaid_payable) " +
    "— requires seeded sp_prepaid_charges and bank accounts. " +
    "Production fix: seed SP prepaid charges in factory test setup."
  );
});

/*
 * What this file protects:
 * - supplier_partner company can run /api/sp/setup and get all accounts + a location
 * - /api/sp/setup is idempotent (re-running creates nothing new)
 * - /api/sp/containers creates a container with status 'open' and a balanced OTW voucher
 * - Container lines are stored with correct qty and stockItemId
 * - /api/sp/offload transitions container to 'offloaded'
 * - Offload creates an sp_offloads record with correct qty and base cost
 * - Inventory is added at the offload location for the container's stock item
 * - All offload voucher entries are balanced (DR = CR)
 * - Double-offload returns 400 (not 500, not silent 200)
 *
 * Skipped / TODO:
 * - Offload reversal: reverseInventoryByExactValue does not zero averageRate on qty=0
 * - Re-offload idempotency: same root cause as above
 * - Partial charge lines: requires sp_prepaid_charges seeding
 * - Factory container (non-SP) lifecycle: factory_containers / factory_raw_stock routes
 *   use a different model from sp_containers; tested separately at smoke level only.
 */
