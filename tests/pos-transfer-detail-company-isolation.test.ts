import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { db, pool } from "../server/db";
import * as schema from "../shared/schema";
import { cleanupTestData, closeTestServer, seedTestData, type TestContext } from "./setup";

const TEST_PREFIX = "postransferiso";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let secondCompanyId = 0;
let secondSourceLocationId = 0;
let secondDestinationLocationId = 0;
let secondStockItemId = 0;
let secondVoucherId = 0;
let secondTransferId = 0;
let invalidVoucherId = 0;
let invalidTransferId = 0;
let revisionId = 0;

async function switchCompany(companyId: number) {
  const response = await agent.post("/api/auth/set-company").send({ companyId });
  expect(response.status).toBe(200);
}

async function removeCreatedTransfers() {
  const transferIds = [secondTransferId, invalidTransferId].filter(Boolean);
  if (transferIds.length === 0) return;

  const revisions = await db
    .select({ id: schema.stockTransferRevisions.id })
    .from(schema.stockTransferRevisions)
    .where(inArray(schema.stockTransferRevisions.transferId, transferIds));
  const revisionIds = revisions.map((revision) => revision.id);

  if (revisionIds.length > 0) {
    await db
      .delete(schema.stockTransferRevisionItems)
      .where(inArray(schema.stockTransferRevisionItems.revisionId, revisionIds));
    await db.delete(schema.stockTransferRevisions).where(inArray(schema.stockTransferRevisions.id, revisionIds));
  }

  await db.delete(schema.stockTransferItems).where(inArray(schema.stockTransferItems.transferId, transferIds));
  await db.delete(schema.stockTransferVouchers).where(inArray(schema.stockTransferVouchers.id, transferIds));

  const voucherIds = [secondVoucherId, invalidVoucherId].filter(Boolean);
  if (voucherIds.length > 0) {
    await db.delete(schema.vouchers).where(inArray(schema.vouchers.id, voucherIds));
  }
}

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);

  const login = await agent.post("/api/auth/login").send({
    username: `${TEST_PREFIX}_testuser`,
    password: "testpassword123",
  });
  expect(login.status).toBe(200);
  await switchCompany(ctx.companyId);

  const [secondCompany] = await db
    .insert(schema.companies)
    .values({
      code: "POSTISO2",
      name: `${TEST_PREFIX}_SecondCompany`,
      baseCurrency: "USD",
    })
    .returning();
  secondCompanyId = secondCompany.id;

  await db.insert(schema.userCompanyRoles).values({
    userId: ctx.userId,
    companyId: secondCompanyId,
    role: "Admin",
  });

  const secondLocations = await db
    .insert(schema.locations)
    .values([
      {
        companyId: secondCompanyId,
        code: "POSTISO2-SRC",
        name: `${TEST_PREFIX}_SecondSource`,
      },
      {
        companyId: secondCompanyId,
        code: "POSTISO2-DST",
        name: `${TEST_PREFIX}_SecondDestination`,
      },
    ])
    .returning();
  secondSourceLocationId = secondLocations[0].id;
  secondDestinationLocationId = secondLocations[1].id;

  const [secondStockItem] = await db
    .insert(schema.stockItems)
    .values({
      companyId: secondCompanyId,
      code: "POSTISO2-ITEM",
      name: `${TEST_PREFIX}_SecondItem`,
      uom: "PCS",
      active: true,
    })
    .returning();
  secondStockItemId = secondStockItem.id;

  const [secondVoucher] = await db
    .insert(schema.vouchers)
    .values({
      companyId: secondCompanyId,
      voucherNumber: "POSTISO2-TRANSFER",
      voucherType: "Stock Transfer",
      voucherDate: "2026-08-05",
      description: "Phase 2 company isolation transfer",
      totalAmount: "120",
      optional: false,
      locationId: secondSourceLocationId,
    })
    .returning();
  secondVoucherId = secondVoucher.id;

  const [secondTransfer] = await db
    .insert(schema.stockTransferVouchers)
    .values({
      voucherId: secondVoucherId,
      sourceLocationId: secondSourceLocationId,
      destinationLocationId: secondDestinationLocationId,
      notes: "Second-company transfer details",
      inventoryApplied: true,
    })
    .returning();
  secondTransferId = secondTransfer.id;

  await db.insert(schema.stockTransferItems).values([
    {
      transferId: secondTransferId,
      stockItemId: secondStockItemId,
      sourceLocationId: secondSourceLocationId,
      quantity: "10",
      rate: "12",
      totalAmount: "120",
    },
    {
      transferId: secondTransferId,
      stockItemId: ctx.stockItemIds[0],
      sourceLocationId: ctx.locationId,
      quantity: "1",
      rate: "999",
      totalAmount: "999",
    },
  ]);

  const [revision] = await db
    .insert(schema.stockTransferRevisions)
    .values({
      transferId: secondTransferId,
      revisionNumber: 1,
      note: "Approved second-company revision",
      optional: false,
      createdBy: ctx.userId,
      status: "approved",
      reviewedBy: ctx.userId,
      reviewedAt: new Date(),
    })
    .returning();
  revisionId = revision.id;

  await db.insert(schema.stockTransferRevisionItems).values([
    {
      revisionId,
      stockItemId: secondStockItemId,
      stockItemName: `${TEST_PREFIX}_SecondItem`,
      sourceLocationId: secondSourceLocationId,
      sourceLocationName: `${TEST_PREFIX}_SecondSource`,
      originalQuantity: "10",
      delta: "2",
      newQuantity: "12",
    },
    {
      revisionId,
      stockItemId: ctx.stockItemIds[0],
      stockItemName: `${TEST_PREFIX}_ForeignItem`,
      sourceLocationId: ctx.locationId,
      sourceLocationName: `${TEST_PREFIX}_ForeignSource`,
      originalQuantity: "1",
      delta: "1",
      newQuantity: "2",
    },
  ]);

  const [invalidVoucher] = await db
    .insert(schema.vouchers)
    .values({
      companyId: secondCompanyId,
      voucherNumber: "POSTISO2-INVALID-LOCATION",
      voucherType: "Stock Transfer",
      voucherDate: "2026-08-05",
      description: "Cross-company destination should be rejected",
      totalAmount: "1",
      optional: false,
      locationId: secondSourceLocationId,
    })
    .returning();
  invalidVoucherId = invalidVoucher.id;

  const [invalidTransfer] = await db
    .insert(schema.stockTransferVouchers)
    .values({
      voucherId: invalidVoucherId,
      sourceLocationId: secondSourceLocationId,
      destinationLocationId: ctx.locationId,
      notes: "Invalid cross-company destination",
      inventoryApplied: false,
    })
    .returning();
  invalidTransferId = invalidTransfer.id;
}, 60000);

afterAll(async () => {
  closeTestServer();
  await removeCreatedTransfers();

  try {
    await cleanupTestData(TEST_PREFIX);
  } catch (error) {
    if (!String(error).includes("login_history_company_id_fkey")) throw error;

    await new Promise((resolve) => setTimeout(resolve, 25));
    await pool.query("DELETE FROM login_history WHERE company_id = ANY($1::int[])", [[ctx.companyId, secondCompanyId]]);
    await cleanupTestData(TEST_PREFIX);
  }
}, 30000);

describe("POS transfer detail company isolation", () => {
  it("does not disclose a transfer from another active company when its voucher ID is guessed", async () => {
    await switchCompany(ctx.companyId);

    const response = await agent.get("/api/pos-transfer-detail").query({
      voucherId: secondVoucherId,
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Transfer not found" });
    expect(JSON.stringify(response.body)).not.toContain("Second-company transfer details");
  });

  it("returns the transfer in its own company without leaking foreign items or revision lines", async () => {
    await switchCompany(secondCompanyId);

    const response = await agent.get("/api/pos-transfer-detail").query({
      voucherId: secondVoucherId,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      transferId: secondTransferId,
      voucherId: secondVoucherId,
      voucherNumber: "POSTISO2-TRANSFER",
      sourceLocationId: secondSourceLocationId,
      sourceLocationName: `${TEST_PREFIX}_SecondSource`,
      destinationLocationId: secondDestinationLocationId,
      destinationLocationName: `${TEST_PREFIX}_SecondDestination`,
    });
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      stockItemId: secondStockItemId,
      stockItemName: `${TEST_PREFIX}_SecondItem`,
      sourceLocationId: secondSourceLocationId,
      sourceLocationName: `${TEST_PREFIX}_SecondSource`,
    });
    expect(response.body.revisions).toHaveLength(1);
    expect(response.body.revisions[0]).toMatchObject({
      id: revisionId,
      status: "approved",
      reviewedBy: ctx.userId,
    });
    expect(response.body.revisions[0].items).toHaveLength(1);
    expect(response.body.revisions[0].items[0]).toMatchObject({
      stockItemId: secondStockItemId,
      stockItemName: `${TEST_PREFIX}_SecondItem`,
      sourceLocationId: secondSourceLocationId,
      sourceLocationName: `${TEST_PREFIX}_SecondSource`,
    });
    expect(JSON.stringify(response.body)).not.toContain(`${TEST_PREFIX}_ForeignItem`);
    expect(JSON.stringify(response.body)).not.toContain(`${TEST_PREFIX}_ForeignSource`);
  });

  it("rejects a company-owned voucher whose transfer points to another company's location", async () => {
    await switchCompany(secondCompanyId);

    const response = await agent.get("/api/pos-transfer-detail").query({
      voucherId: invalidVoucherId,
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Transfer not found" });
  });
});
