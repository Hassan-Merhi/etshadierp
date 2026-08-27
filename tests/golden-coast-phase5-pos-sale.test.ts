/**
 * tests/golden-coast-phase5-pos-sale.test.ts
 *
 * Golden Coast Phase 5 — production POS sale accounting on the post-cutover
 * FIFO stock model.
 *
 * POST /api/sp/golden-coast/phase5/pos-sale must:
 *   * consume the canonical Phase 4 FIFO lots oldest-first,
 *   * derive COGS from the units actually consumed (never a user estimate),
 *   * post Dr sale-side / Cr Sales and Dr COGS / Cr Stock in Hand, both
 *     carrying the sale location,
 *   * behave atomically across inventory and accounting,
 *   * stay company scoped, replay safe and fail closed,
 *   * and leave non-Golden-Coast Supplier Partner companies untouched.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { pool, db } from "../server/db";
import { and, eq } from "drizzle-orm";
import * as schema from "../shared/schema";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";

const TEST_PREFIX = "gcphase5";
const SALE_URL = "/api/sp/golden-coast/phase5/pos-sale";
const SALE_DATE = "2026-09-05";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let goldenCoastStockItemId: number;
let secondStockItemId: number;

let saleSideAccountId: number;
let salesAccountId: number;
let cogsAccountId: number;
let stockInHandAccountId: number;

/** A second, deliberately non-Golden-Coast Supplier Partner company. */
let plainCompanyId: number;
let plainLocationId: number;
let plainStockItemId: number;
let plainPayableAccountId: number;
let plainCashAccountId: number;

let requestCounter = 0;
function nextRequestId(label: string): string {
  requestCounter += 1;
  return `gc5-${label}-${requestCounter}`;
}

async function login(): Promise<void> {
  const loginRes = await agent
    .post("/api/auth/login")
    .send({ username: `${TEST_PREFIX}_testuser`, password: "testpassword123" });
  if (loginRes.status !== 200) {
    throw new Error(`Login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }
}

async function selectCompany(companyId: number): Promise<void> {
  const res = await agent.post("/api/auth/set-company").send({ companyId });
  if (res.status !== 200) {
    throw new Error(`set-company failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

async function insertLedgerAccount(input: {
  companyId: number;
  code: string;
  name: string;
  accountType: string;
  subType: string;
  isHidden?: boolean;
}): Promise<number> {
  const [account] = await db
    .insert(schema.ledgerAccounts)
    .values({
      companyId: input.companyId,
      code: input.code,
      name: input.name,
      accountType: input.accountType,
      subType: input.subType,
      isHidden: input.isHidden ?? false,
      openingBalance: "0",
      openingBalanceSide: "Dr",
    })
    .returning();
  return account.id;
}

/** Mirrors what the Phase 4 opening FIFO bridge writes. */
async function seedCutoverLot(input: {
  companyId: number;
  locationId: number;
  stockItemId: number;
  qty: string;
  unitCost: string;
  createdAt?: string;
}): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO sp_stock_movements
       (company_id, source_type, article_code, description, stock_item_id, location_id,
        qty_in, qty_remaining, base_unit_cost_usd, landed_unit_cost_usd, final_unit_cost_usd, created_at)
     VALUES ($1, 'golden_coast_cutover', $2, 'Golden Coast opening lot', $3, $4, $5, $5, $6, $6, $6,
             COALESCE($7::timestamp, now()))
     RETURNING id`,
    [
      input.companyId,
      `${TEST_PREFIX}-ART`,
      input.stockItemId,
      input.locationId,
      input.qty,
      input.unitCost,
      input.createdAt ?? null,
    ]
  );
  return Number(rows[0].id);
}

async function lotRemaining(lotId: number): Promise<number> {
  const { rows } = await pool.query(`SELECT qty_remaining::numeric AS qty FROM sp_stock_movements WHERE id = $1`, [
    lotId,
  ]);
  return Number(rows[0].qty);
}

async function inventoryQuantity(companyId: number, locationId: number, stockItemId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(quantity::numeric, 0) AS qty FROM inventory
     WHERE company_id = $1 AND location_id = $2 AND stock_item_id = $3`,
    [companyId, locationId, stockItemId]
  );
  return rows.length === 0 ? 0 : Number(rows[0].qty);
}

async function clearLots(companyId: number): Promise<void> {
  await pool.query(`DELETE FROM sp_stock_movements WHERE company_id = $1`, [companyId]);
}

function postSale(body: Record<string, unknown>) {
  return agent.post(SALE_URL).send(body);
}

function saleBody(overrides: Record<string, unknown> = {}) {
  return {
    locationId: ctx.locationId,
    saleDate: SALE_DATE,
    customerName: "Golden Coast Customer",
    clientRequestId: nextRequestId("sale"),
    lines: [{ stockItemId: goldenCoastStockItemId, qty: "30", unitPriceUsd: "60" }],
    ...overrides,
  };
}

async function entriesFor(voucherId: number) {
  return db.select().from(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, voucherId));
}

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  goldenCoastStockItemId = ctx.stockItemIds[0];
  secondStockItemId = ctx.stockItemIds[1];

  await pool.query(`UPDATE companies SET company_type = 'supplier_partner' WHERE id = $1`, [ctx.companyId]);

  // Phase 2 canonical Golden Coast roles this phase posts against. The two
  // partner-capital roles are what identifies a Golden Coast company; Phase 5
  // never posts to them and never changes their balances.
  await insertLedgerAccount({
    companyId: ctx.companyId,
    code: "GC-FSCAP",
    name: "Fresh Start FZ Equity",
    accountType: "Equity",
    subType: "gc_partner_capital",
  });
  await insertLedgerAccount({
    companyId: ctx.companyId,
    code: "GC-HCAP",
    name: "Hassan Dakik Equity",
    accountType: "Equity",
    subType: "gc_owner_capital",
  });
  saleSideAccountId = await insertLedgerAccount({
    companyId: ctx.companyId,
    code: "SP-PAY",
    name: "GC Sales Cash",
    accountType: "Liability",
    subType: "sp_payable",
  });
  stockInHandAccountId = await insertLedgerAccount({
    companyId: ctx.companyId,
    code: "SP-STOCK",
    name: "Stock in Hand",
    accountType: "Asset",
    subType: "sp_stock",
  });
  salesAccountId = await insertLedgerAccount({
    companyId: ctx.companyId,
    code: "SP-SALES",
    name: "Sales",
    accountType: "Income",
    subType: "sp_sales",
  });
  cogsAccountId = await insertLedgerAccount({
    companyId: ctx.companyId,
    code: "SP-COGS",
    name: "Cost of Goods Sold",
    accountType: "Direct Expense",
    subType: "sp_cogs",
  });

  // A second Supplier Partner company with no Golden Coast capital roles.
  const [plainCompany] = await db
    .insert(schema.companies)
    .values({
      code: `${TEST_PREFIX.slice(0, 4).toUpperCase()}PLN1`,
      name: `${TEST_PREFIX}_PlainSupplierPartner`,
      companyType: "supplier_partner",
      baseCurrency: "USD",
    })
    .returning();
  plainCompanyId = plainCompany.id;

  await db.insert(schema.userCompanyRoles).values({
    userId: ctx.userId,
    companyId: plainCompanyId,
    role: "Admin",
  });

  const [plainLocation] = await db
    .insert(schema.locations)
    .values({ companyId: plainCompanyId, code: `${plainCompany.code}-WH1`, name: `${TEST_PREFIX}_PlainWarehouse` })
    .returning();
  plainLocationId = plainLocation.id;

  const [plainStockGroup] = await db
    .insert(schema.stockGroups)
    .values({ companyId: plainCompanyId, name: `${TEST_PREFIX}_PlainGroup`, code: "PLNG" })
    .returning();
  const [plainStockItem] = await db
    .insert(schema.stockItems)
    .values({
      companyId: plainCompanyId,
      code: `${TEST_PREFIX}-PLAIN-ITEM`,
      name: "Plain Item",
      uom: "PCS",
      stockGroupId: plainStockGroup.id,
      active: true,
    })
    .returning();
  plainStockItemId = plainStockItem.id;

  await db.insert(schema.inventory).values({
    companyId: plainCompanyId,
    locationId: plainLocationId,
    stockItemId: plainStockItemId,
    quantity: "100.000",
    averageRate: "10.00",
    totalValue: "1000.00",
  });

  plainPayableAccountId = await insertLedgerAccount({
    companyId: plainCompanyId,
    code: "SP-PAY",
    name: "Supplier Cash Payable",
    accountType: "Liability",
    subType: "sp_payable",
  });
  plainCashAccountId = await insertLedgerAccount({
    companyId: plainCompanyId,
    code: "PLN-CASH",
    name: "Plain Cash",
    accountType: "Cash",
    subType: "Cash",
  });

  await pool.query(`UPDATE inventory SET quantity = '1000.000', total_value = '10000.00' WHERE company_id = $1`, [
    ctx.companyId,
  ]);

  agent = request.agent(ctx.app);
  await login();
  await selectCompany(ctx.companyId);
}, 90000);

afterAll(async () => {
  const companyIds = [ctx.companyId, plainCompanyId];
  // Shared fixture teardown does not know about shortage layers, and an
  // oversold item would otherwise hold stock_items down on the next run.
  await pool.query(
    `DELETE FROM inventory_negative_layers
     WHERE stock_item_id IN (SELECT id FROM stock_items WHERE company_id = ANY($1::int[]))`,
    [companyIds]
  );
  await pool.query(`DELETE FROM sp_stock_movements WHERE company_id = ANY($1::int[])`, [
    [ctx.companyId, plainCompanyId],
  ]);
  await pool.query(`DELETE FROM sp_sale_lines WHERE company_id = ANY($1::int[])`, [[ctx.companyId, plainCompanyId]]);
  await pool.query(`DELETE FROM sp_sales WHERE company_id = ANY($1::int[])`, [[ctx.companyId, plainCompanyId]]);
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 60000);

describe("Golden Coast Phase 5 — FIFO sale accounting", () => {
  it("posts 30 bags at $60 with a $22 FIFO cost as Sales 1800 / COGS 660 / gross profit 1140", async () => {
    await clearLots(ctx.companyId);
    const lotId = await seedCutoverLot({
      companyId: ctx.companyId,
      locationId: ctx.locationId,
      stockItemId: goldenCoastStockItemId,
      qty: "100",
      unitCost: "22",
    });
    const inventoryBefore = await inventoryQuantity(ctx.companyId, ctx.locationId, goldenCoastStockItemId);

    const res = await postSale(saleBody());
    expect(res.status).toBe(200);
    expect(res.body.replayed).toBe(false);
    expect(res.body.revenueUsd).toBe("1800.00");
    expect(res.body.cogsUsd).toBe("660.00");
    expect(res.body.grossProfitUsd).toBe("1140.00");

    const [revenue, cogs] = res.body.postings;
    expect(revenue.role).toBe("revenue");
    expect(cogs.role).toBe("cogs");

    const revenueEntries = await entriesFor(revenue.voucher.id);
    expect(revenueEntries).toHaveLength(2);
    const saleSideEntry = revenueEntries.find((entry) => entry.ledgerAccountId === saleSideAccountId);
    const salesEntry = revenueEntries.find((entry) => entry.ledgerAccountId === salesAccountId);
    expect(Number(saleSideEntry?.debitAmount)).toBeCloseTo(1800, 2);
    expect(Number(saleSideEntry?.creditAmount)).toBeCloseTo(0, 2);
    expect(Number(salesEntry?.creditAmount)).toBeCloseTo(1800, 2);
    expect(Number(salesEntry?.debitAmount)).toBeCloseTo(0, 2);

    const cogsEntries = await entriesFor(cogs.voucher.id);
    expect(cogsEntries).toHaveLength(2);
    const cogsEntry = cogsEntries.find((entry) => entry.ledgerAccountId === cogsAccountId);
    const stockEntry = cogsEntries.find((entry) => entry.ledgerAccountId === stockInHandAccountId);
    expect(Number(cogsEntry?.debitAmount)).toBeCloseTo(660, 2);
    expect(Number(stockEntry?.creditAmount)).toBeCloseTo(660, 2);

    // Location attribution on every accounting entry's voucher.
    expect(revenue.voucher.locationId).toBe(ctx.locationId);
    expect(cogs.voucher.locationId).toBe(ctx.locationId);

    // Stock in Hand reduction: FIFO lot and ERP inventory both fall by 30.
    expect(await lotRemaining(lotId)).toBeCloseTo(70, 4);
    expect(await inventoryQuantity(ctx.companyId, ctx.locationId, goldenCoastStockItemId)).toBeCloseTo(
      inventoryBefore - 30,
      4
    );
  });

  it("consumes multiple FIFO lots oldest-first and blends their real costs", async () => {
    await clearLots(ctx.companyId);
    const olderLotId = await seedCutoverLot({
      companyId: ctx.companyId,
      locationId: ctx.locationId,
      stockItemId: goldenCoastStockItemId,
      qty: "20",
      unitCost: "22",
      createdAt: "2026-09-01 00:00:00",
    });
    const newerLotId = await seedCutoverLot({
      companyId: ctx.companyId,
      locationId: ctx.locationId,
      stockItemId: goldenCoastStockItemId,
      qty: "20",
      unitCost: "30",
      createdAt: "2026-09-03 00:00:00",
    });

    const res = await postSale(saleBody());
    expect(res.status).toBe(200);
    // 20 @ 22 = 440 then 10 @ 30 = 300 → 740.
    expect(res.body.cogsUsd).toBe("740.00");
    expect(res.body.grossProfitUsd).toBe("1060.00");
    expect(res.body.allocations.map((allocation: { lotId: number }) => allocation.lotId)).toEqual([
      olderLotId,
      newerLotId,
    ]);
    expect(await lotRemaining(olderLotId)).toBeCloseTo(0, 4);
    expect(await lotRemaining(newerLotId)).toBeCloseTo(10, 4);
  });

  it("supports exact FIFO depletion", async () => {
    await clearLots(ctx.companyId);
    const lotId = await seedCutoverLot({
      companyId: ctx.companyId,
      locationId: ctx.locationId,
      stockItemId: goldenCoastStockItemId,
      qty: "30",
      unitCost: "22",
    });

    const res = await postSale(saleBody());
    expect(res.status).toBe(200);
    expect(res.body.cogsUsd).toBe("660.00");
    expect(await lotRemaining(lotId)).toBeCloseTo(0, 4);
  });

  it("fails closed on insufficient FIFO stock without posting or consuming anything", async () => {
    await clearLots(ctx.companyId);
    const lotId = await seedCutoverLot({
      companyId: ctx.companyId,
      locationId: ctx.locationId,
      stockItemId: goldenCoastStockItemId,
      qty: "29",
      unitCost: "22",
    });
    const inventoryBefore = await inventoryQuantity(ctx.companyId, ctx.locationId, goldenCoastStockItemId);

    const res = await postSale(saleBody());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("GC_PHASE5_FIFO_INSUFFICIENT");
    expect(await lotRemaining(lotId)).toBeCloseTo(29, 4);
    expect(await inventoryQuantity(ctx.companyId, ctx.locationId, goldenCoastStockItemId)).toBeCloseTo(
      inventoryBefore,
      4
    );
  });

  it("fails closed on invalid FIFO cost data", async () => {
    await clearLots(ctx.companyId);
    const lotId = await seedCutoverLot({
      companyId: ctx.companyId,
      locationId: ctx.locationId,
      stockItemId: goldenCoastStockItemId,
      qty: "100",
      unitCost: "0",
    });

    const res = await postSale(saleBody());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("GC_PHASE5_FIFO_COST_INVALID");
    expect(await lotRemaining(lotId)).toBeCloseTo(100, 4);
  });

  it("refuses to post before the Phase 4 opening FIFO bridge exists", async () => {
    await clearLots(ctx.companyId);
    const res = await postSale(saleBody());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("GC_PHASE5_NOT_READY");
  });

  it("replays a duplicate request without consuming stock or posting again", async () => {
    await clearLots(ctx.companyId);
    const lotId = await seedCutoverLot({
      companyId: ctx.companyId,
      locationId: ctx.locationId,
      stockItemId: goldenCoastStockItemId,
      qty: "100",
      unitCost: "22",
    });

    const body = saleBody();
    const first = await postSale(body);
    expect(first.status).toBe(200);
    expect(first.body.replayed).toBe(false);
    const remainingAfterFirst = await lotRemaining(lotId);
    const inventoryAfterFirst = await inventoryQuantity(ctx.companyId, ctx.locationId, goldenCoastStockItemId);

    // Identical resubmission. The repository-wide voucher-path request boundary
    // keys on clientRequestId and replays the stored response, so the sale must
    // not consume stock or post a second time.
    const replay = await postSale(body);
    expect(replay.status).toBe(200);
    expect(await lotRemaining(lotId)).toBeCloseTo(remainingAfterFirst, 4);
    expect(await inventoryQuantity(ctx.companyId, ctx.locationId, goldenCoastStockItemId)).toBeCloseTo(
      inventoryAfterFirst,
      4
    );

    // Same client request id behind a different transport identity: the request
    // reaches this route's own replay detection, which returns the already
    // posted pair instead of consuming stock again.
    const handlerReplay = await agent
      .post(SALE_URL)
      .set("X-Idempotency-Key", `${body.clientRequestId}-transport-retry`)
      .send(body);
    expect(handlerReplay.status).toBe(200);
    expect(handlerReplay.body.replayed).toBe(true);
    expect(handlerReplay.body.postings.map((posting: { voucher: { id: number } }) => posting.voucher.id)).toEqual(
      first.body.postings.map((posting: { voucher: { id: number } }) => posting.voucher.id)
    );
    expect(handlerReplay.body.postings.map((posting: { role: string }) => posting.role)).toEqual(["revenue", "cogs"]);
    expect(await lotRemaining(lotId)).toBeCloseTo(remainingAfterFirst, 4);
    expect(await inventoryQuantity(ctx.companyId, ctx.locationId, goldenCoastStockItemId)).toBeCloseTo(
      inventoryAfterFirst,
      4
    );

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM vouchers WHERE company_id = $1 AND voucher_number LIKE $2`,
      [ctx.companyId, `GC-POS-C${ctx.companyId}-${body.clientRequestId}%`]
    );
    expect(rows[0].c).toBe(2);
  });

  it("rejects a reused client request id that carries different sale data", async () => {
    await clearLots(ctx.companyId);
    await seedCutoverLot({
      companyId: ctx.companyId,
      locationId: ctx.locationId,
      stockItemId: goldenCoastStockItemId,
      qty: "100",
      unitCost: "22",
    });

    const body = saleBody();
    expect((await postSale(body)).status).toBe(200);

    const conflicting = await postSale({ ...body, customerName: "Someone Else" });
    expect(conflicting.status).toBe(409);
    expect(conflicting.body.code).toBe("POSTING_IDEMPOTENCY_CONFLICT");
  });

  it("requires a client request id on every Golden Coast sale", async () => {
    const res = await agent.post(SALE_URL).send({
      locationId: ctx.locationId,
      saleDate: SALE_DATE,
      customerName: "No Request Id",
      lines: [{ stockItemId: goldenCoastStockItemId, qty: "1", unitPriceUsd: "60" }],
    });
    expect(res.status).toBe(400);
    expect(["GC_PHASE5_SALE_INVALID", "GC_PHASE5_INPUT_INVALID", "ACCOUNTING_REQUEST_ID_REQUIRED"]).toContain(
      res.body.code
    );
    expect(res.body.message).toMatch(/clientRequestId|request identity/i);
  });

  it("rolls inventory and FIFO consumption back when the accounting posting fails", async () => {
    await clearLots(ctx.companyId);
    const lotId = await seedCutoverLot({
      companyId: ctx.companyId,
      locationId: ctx.locationId,
      stockItemId: goldenCoastStockItemId,
      qty: "100",
      unitCost: "22",
    });
    const inventoryBefore = await inventoryQuantity(ctx.companyId, ctx.locationId, goldenCoastStockItemId);

    // Occupy the voucher number this sale would derive, so the posting fails
    // after FIFO consumption and inventory adjustment have already run.
    const body = saleBody();
    const collidingNumber = `GC-POS-C${ctx.companyId}-${body.clientRequestId}`;
    await db.insert(schema.vouchers).values({
      companyId: ctx.companyId,
      voucherType: "Journal",
      voucherNumber: collidingNumber,
      voucherDate: SALE_DATE,
      description: "Voucher number collision fixture",
      totalAmount: "0",
      currency: "USD",
    });

    const res = await postSale(body);
    expect(res.status).toBeGreaterThanOrEqual(400);

    expect(await lotRemaining(lotId)).toBeCloseTo(100, 4);
    expect(await inventoryQuantity(ctx.companyId, ctx.locationId, goldenCoastStockItemId)).toBeCloseTo(
      inventoryBefore,
      4
    );
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM vouchers WHERE company_id = $1 AND voucher_number = $2`,
      [ctx.companyId, `${collidingNumber}-COGS`]
    );
    expect(rows[0].c).toBe(0);
  });

  it("never consumes another company's FIFO lots and rejects a foreign location", async () => {
    await clearLots(ctx.companyId);
    await clearLots(plainCompanyId);
    const ownLotId = await seedCutoverLot({
      companyId: ctx.companyId,
      locationId: ctx.locationId,
      stockItemId: goldenCoastStockItemId,
      qty: "100",
      unitCost: "22",
    });
    const foreignLotId = await seedCutoverLot({
      companyId: plainCompanyId,
      locationId: plainLocationId,
      stockItemId: plainStockItemId,
      qty: "100",
      unitCost: "5",
      createdAt: "2026-09-01 00:00:00",
    });

    const ok = await postSale(saleBody());
    expect(ok.status).toBe(200);
    expect(ok.body.cogsUsd).toBe("660.00");
    expect(await lotRemaining(foreignLotId)).toBeCloseTo(100, 4);
    expect(await lotRemaining(ownLotId)).toBeCloseTo(70, 4);

    const foreignLocation = await postSale(saleBody({ locationId: plainLocationId }));
    expect(foreignLocation.status).toBe(400);
    expect(foreignLocation.body.code).toBe("GC_PHASE5_LOCATION_INVALID");
  });

  it("attributes stock to the selling location and will not sell from an empty one", async () => {
    await clearLots(ctx.companyId);
    await seedCutoverLot({
      companyId: ctx.companyId,
      locationId: ctx.locationId,
      stockItemId: goldenCoastStockItemId,
      qty: "100",
      unitCost: "22",
    });

    const otherLocation = await postSale(saleBody({ locationId: ctx.location2Id }));
    expect(otherLocation.status).toBe(409);
    expect(otherLocation.body.code).toBe("GC_PHASE5_FIFO_INSUFFICIENT");
  });

  it("rejects a sale line for a stock item with no Golden Coast FIFO stock", async () => {
    await clearLots(ctx.companyId);
    await seedCutoverLot({
      companyId: ctx.companyId,
      locationId: ctx.locationId,
      stockItemId: goldenCoastStockItemId,
      qty: "100",
      unitCost: "22",
    });

    const res = await postSale(
      saleBody({
        lines: [
          { stockItemId: goldenCoastStockItemId, qty: "1", unitPriceUsd: "60" },
          { stockItemId: secondStockItemId, qty: "1", unitPriceUsd: "60" },
        ],
      })
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("GC_PHASE5_FIFO_INSUFFICIENT");
  });

  it("exposes readiness for the Golden Coast company", async () => {
    await clearLots(ctx.companyId);
    await seedCutoverLot({
      companyId: ctx.companyId,
      locationId: ctx.locationId,
      stockItemId: goldenCoastStockItemId,
      qty: "100",
      unitCost: "22",
    });

    const res = await agent.get(`${SALE_URL}/readiness`);
    expect(res.status).toBe(200);
    expect(res.body.canPost).toBe(true);
    expect(res.body.cutoverLotCount).toBeGreaterThan(0);
    expect(res.body.accounts).toMatchObject({
      saleSideAccountId,
      salesRevenueAccountId: salesAccountId,
      cogsAccountId,
      stockInHandAccountId,
    });
  });
});

describe("Golden Coast Phase 5 — non-Golden-Coast Supplier Partner companies", () => {
  it("refuses the Phase 5 sale path and leaves the legacy Supplier Partner sale working", async () => {
    await selectCompany(plainCompanyId);
    try {
      const blocked = await agent.post(SALE_URL).send({
        locationId: plainLocationId,
        saleDate: SALE_DATE,
        customerName: "Plain Customer",
        clientRequestId: nextRequestId("plain"),
        lines: [{ stockItemId: plainStockItemId, qty: "1", unitPriceUsd: "60" }],
      });
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe("GC_PHASE5_NOT_CONFIGURED");

      await clearLots(plainCompanyId);
      await seedCutoverLot({
        companyId: plainCompanyId,
        locationId: plainLocationId,
        stockItemId: plainStockItemId,
        qty: "10",
        unitCost: "5",
      });

      const legacy = await agent.post("/api/sp/sales").send({
        saleDate: SALE_DATE,
        customerName: "Plain Customer",
        paymentAccountType: "cash",
        paymentAccountId: plainCashAccountId,
        saleLines: [{ stockItemId: plainStockItemId, qtySold: 1, salePricePerUnit: 100 }],
      });
      expect(legacy.status).toBe(200);

      // Unchanged legacy shape: Dr Cash / Cr Supplier Cash Payable only.
      const legacyEntries = await entriesFor(legacy.body.voucherId);
      expect(legacyEntries).toHaveLength(2);
      expect(legacyEntries.find((entry) => entry.ledgerAccountId === plainPayableAccountId)?.creditAmount).toBeTruthy();
    } finally {
      await selectCompany(ctx.companyId);
    }
  });

  it("keeps the Golden Coast company's partner capital untouched by Phase 5 sales", async () => {
    const capitalRows = await db
      .select({ id: schema.ledgerAccounts.id })
      .from(schema.ledgerAccounts)
      .where(
        and(eq(schema.ledgerAccounts.companyId, ctx.companyId), eq(schema.ledgerAccounts.subType, "gc_partner_capital"))
      );
    expect(capitalRows).toHaveLength(1);

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM voucher_entries ve
       JOIN vouchers v ON v.id = ve.voucher_id
       WHERE v.company_id = $1
         AND ve.ledger_account_id IN (
           SELECT id FROM ledger_accounts
           WHERE company_id = $1 AND sub_type IN ('gc_partner_capital', 'gc_owner_capital'))`,
      [ctx.companyId]
    );
    expect(rows[0].c).toBe(0);
  });
});
