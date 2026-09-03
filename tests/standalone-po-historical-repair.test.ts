import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "../server/db";
import { repairStandalonePurchaseOrderAccounting } from "../server/routes/containers/accounting/standalone-po-repair";
import { storage } from "../server/storage";
import * as schema from "../shared/schema";
import { companyScopedSuppliers } from "../shared/schema/supplierCompanyScope";
import { cleanupTestData, closeTestServer, seedTestData, type TestContext } from "./setup";

const TEST_PREFIX = "standhist";

let ctx: TestContext;
let originalParentCompanyId: number | null;
let legacyParentCompanyId = 0;
let supplierId = 0;
let containerId = 0;
let voucherId = 0;
let poId = 0;
let parentCreditAccountId = 0;

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  originalParentCompanyId = await storage.getParentCompanyId();

  const [legacyParent] = await db
    .insert(schema.companies)
    .values({
      code: `${TEST_PREFIX.toUpperCase()}P`,
      name: `${TEST_PREFIX} Legacy Parent`,
      companyType: "erp",
      baseCurrency: "USD",
      active: true,
    })
    .returning();
  legacyParentCompanyId = legacyParent.id;

  await storage.setParentCompanyId(legacyParentCompanyId);
  await db
    .update(schema.companies)
    .set({ parentCompanyId: null, companyType: "erp" })
    .where(eq(schema.companies.id, ctx.companyId));

  const [supplier] = await db
    .insert(companyScopedSuppliers)
    .values({
      companyId: ctx.companyId,
      code: `${TEST_PREFIX.toUpperCase()}-SUP`,
      legalName: `${TEST_PREFIX} Supplier`,
      email: `${TEST_PREFIX}@example.test`,
      openingBalance: "0",
      active: true,
    })
    .returning();
  supplierId = supplier.id;

  let purchasesAccount = await storage.getLedgerAccountByCode("PURCHASES", ctx.companyId);
  if (!purchasesAccount) {
    purchasesAccount = await storage.createLedgerAccount({
      companyId: ctx.companyId,
      code: "PURCHASES",
      name: "Purchases",
      accountType: "Expense",
      openingBalance: "0",
      openingBalanceSide: "Dr",
      active: true,
    });
  }

  const parentCredit = await storage.createLedgerAccount({
    companyId: ctx.companyId,
    code: `${TEST_PREFIX.toUpperCase()}-PCR`,
    name: `${TEST_PREFIX} Legacy Parent Credit`,
    accountType: "Liability",
    subType: "Current Liability",
    openingBalance: "0",
    openingBalanceSide: "Cr",
    active: true,
  });
  parentCreditAccountId = parentCredit.id;

  const [container] = await db
    .insert(schema.containers)
    .values({
      companyId: ctx.companyId,
      containerNumber: `${TEST_PREFIX.toUpperCase()}-CONT`,
      supplierId,
      status: "OFFLOADED",
      importDate: "2026-09-02",
      offloadDate: "2026-09-02",
      itemsTotal: "90.00",
      chargesTotal: "10.00",
      grandTotal: "100.00",
    })
    .returning();
  containerId = container.id;

  const [voucher] = await db
    .insert(schema.vouchers)
    .values({
      companyId: ctx.companyId,
      voucherNumber: `${TEST_PREFIX.toUpperCase()}-PURCHASE`,
      voucherType: "Purchase",
      voucherDate: "2026-09-02",
      description: `${container.containerNumber} ${supplier.legalName}`,
      totalAmount: "100.00",
      currency: "USD",
      optional: false,
      sourceModule: "ERP",
    })
    .returning();
  voucherId = voucher.id;

  await db.insert(schema.voucherEntries).values([
    {
      voucherId,
      ledgerAccountId: purchasesAccount.id,
      debitAmount: "100.00",
      creditAmount: "0",
      narration: "Legacy intercompany purchase debit",
    },
    {
      voucherId,
      ledgerAccountId: parentCreditAccountId,
      debitAmount: "0",
      creditAmount: "100.00",
      narration: "Legacy parent credit instead of supplier",
    },
  ]);

  const [po] = await db
    .insert(schema.purchaseOrders)
    .values({
      companyId: ctx.companyId,
      poNumber: `${TEST_PREFIX.toUpperCase()}-PO-1`,
      containerId,
      supplierId,
      voucherId,
      currency: "USD",
      itemsTotal: "90.00",
      freight: "10.00",
      surcharge: "0",
      fumigation: "0",
      documentCharges: "0",
      discount: "0",
      otherCharges: "0",
      freightPaidBy: "parent",
      status: "Open",
    })
    .returning();
  poId = po.id;
}, 60000);

afterAll(async () => {
  if (poId) await db.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, poId));
  if (voucherId) {
    await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, voucherId));
    await db.delete(schema.vouchers).where(eq(schema.vouchers.id, voucherId));
  }
  if (containerId) await db.delete(schema.containers).where(eq(schema.containers.id, containerId));
  if (supplierId) await db.delete(companyScopedSuppliers).where(eq(companyScopedSuppliers.id, supplierId));
  if (parentCreditAccountId) {
    await db.delete(schema.ledgerAccounts).where(eq(schema.ledgerAccounts.id, parentCreditAccountId));
  }

  await storage.setParentCompanyId(originalParentCompanyId);
  if (legacyParentCompanyId) {
    await db.delete(schema.companies).where(eq(schema.companies.id, legacyParentCompanyId));
  }
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

describe("historical standalone PO accounting repair", () => {
  it("moves the old parent-credit posting to the selected supplier without touching the offloaded container", async () => {
    const result = await repairStandalonePurchaseOrderAccounting(ctx.companyId);

    expect(result.handled).toBe(true);
    expect(result.repairedStandaloneSupplierVouchers).toBe(1);
    expect(result.normalizedStandaloneParentFreight).toBe(1);

    const [storedPo] = await db
      .select({
        freightPaidBy: schema.purchaseOrders.freightPaidBy,
        freightParentAccountId: schema.purchaseOrders.freightParentAccountId,
      })
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.id, poId));
    expect(storedPo.freightPaidBy).toBe("supplier");
    expect(storedPo.freightParentAccountId).toBeNull();

    const entries = await db
      .select({
        supplierId: schema.voucherEntries.supplierId,
        ledgerAccountId: schema.voucherEntries.ledgerAccountId,
        debitAmount: schema.voucherEntries.debitAmount,
        creditAmount: schema.voucherEntries.creditAmount,
      })
      .from(schema.voucherEntries)
      .where(eq(schema.voucherEntries.voucherId, voucherId));

    expect(entries).toHaveLength(2);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ supplierId: null, debitAmount: "100.00", creditAmount: "0.00" }),
        expect.objectContaining({
          supplierId,
          ledgerAccountId: null,
          debitAmount: "0.00",
          creditAmount: "100.00",
        }),
      ])
    );
    expect(entries.some((entry) => entry.ledgerAccountId === parentCreditAccountId)).toBe(false);

    const [container] = await db
      .select({ status: schema.containers.status, grandTotal: schema.containers.grandTotal })
      .from(schema.containers)
      .where(eq(schema.containers.id, containerId));
    expect(container.status).toBe("OFFLOADED");
    expect(container.grandTotal).toBe("100.00");

    const secondRun = await repairStandalonePurchaseOrderAccounting(ctx.companyId);
    expect(secondRun.repairedStandaloneSupplierVouchers).toBe(0);
  });
});
