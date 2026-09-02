/**
 * Golden Coast normal itemized POS sale integration.
 *
 * This deliberately uses the ordinary /api/pos/sales and
 * /api/vouchers/:id/sales paths rather than the retired Phase 5 endpoint.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../server/db";
import * as schema from "../shared/schema";
import { closeTestServer } from "./setup";
import {
  setupGoldenCoastNormalPosFixture,
  teardownGoldenCoastNormalPosFixture,
  voucherEntriesFor,
  type GoldenCoastNormalPosFixture,
} from "./helpers/goldenCoastPhase5Fixture";

const TEST_PREFIX = "gcnormalpos";
const SALE_DATE = "2026-09-05";
const SETTLEMENT_SOURCE_TYPE = "golden-coast-pos-settlement";

let fixture: GoldenCoastNormalPosFixture;

async function accountBalance(accountId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(ve.debit_amount::numeric - ve.credit_amount::numeric), 0) AS balance
     FROM voucher_entries ve
     JOIN vouchers v ON v.id = ve.voucher_id
     WHERE ve.ledger_account_id = $1 AND v.deleted_at IS NULL`,
    [accountId]
  );
  return Number(rows[0].balance);
}

async function settlementVoucherIds(clientSaleId: string): Promise<number[]> {
  const { rows } = await pool.query(
    `SELECT apr.voucher_id
     FROM accounting_posting_requests apr
     WHERE apr.source_type = $1
       AND apr.source_id LIKE $2
     ORDER BY apr.voucher_id`,
    [SETTLEMENT_SOURCE_TYPE, `${clientSaleId}:%`]
  );
  return rows.map((row) => Number(row.voucher_id));
}

async function expectBalancedSettlementVouchers(clientSaleId: string): Promise<void> {
  const voucherIds = await settlementVoucherIds(clientSaleId);
  expect(voucherIds.length).toBeGreaterThan(0);
  for (const voucherId of voucherIds) {
    const entries = await voucherEntriesFor(voucherId);
    const debit = entries.reduce((sum, entry) => sum + Number(entry.debitAmount), 0);
    const credit = entries.reduce((sum, entry) => sum + Number(entry.creditAmount), 0);
    expect(debit).toBeCloseTo(credit, 2);
  }
}

function saleBody() {
  return {
    locationId: fixture.ctx.locationId,
    voucherDate: SALE_DATE,
    paymentAccountType: "ledger",
    paymentAccountId: fixture.ctx.cashAccountId,
    clientSaleId: "normal-pos-sale",
    targetCompanyId: fixture.hadiCompanyId,
    items: [{ stockItemId: fixture.goldenCoastStockItemId, quantity: "4", rate: "125" }],
  };
}

beforeAll(async () => {
  fixture = await setupGoldenCoastNormalPosFixture(TEST_PREFIX);
}, 90_000);

afterAll(async () => {
  await teardownGoldenCoastNormalPosFixture(fixture);
  closeTestServer();
}, 60_000);

describe("Golden Coast normal itemized POS sale", () => {
  it("posts the sale items, full cash debit, payable, and one location deduction", async () => {
    const beforeSelectedCash = await accountBalance(fixture.ctx.cashAccountId);
    const beforeHadiCash = await accountBalance(fixture.hadiCashAccountId);
    const beforeGoldenCoastIntercompany = await accountBalance(fixture.goldenCoastIntercompanyAccountId);
    const beforeHadiIntercompany = await accountBalance(fixture.hadiIntercompanyAccountId);

    const response = await fixture.agent.post("/api/pos/sales").send(saleBody());

    expect(response.status).toBe(200);
    expect(response.body.voucher.id).toBeTruthy();
    expect(response.body.items).toHaveLength(1);

    const entries = await voucherEntriesFor(response.body.voucher.id);
    expect(entries).toHaveLength(3);
    expect(entries.find((entry) => entry.ledgerAccountId === fixture.ctx.cashAccountId)?.debitAmount).toBe("500.00");
    expect(entries.find((entry) => entry.ledgerAccountId === fixture.saleSideAccountId)?.creditAmount).toBe("460.00");
    expect(entries.find((entry) => entry.ledgerAccountId === fixture.deductionClearingAccountId)?.creditAmount).toBe(
      "40.00"
    );

    const { rows: saleItemRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM sales_items WHERE voucher_id = $1`,
      [response.body.voucher.id]
    );
    expect(saleItemRows[0].count).toBe(1);
    expect(await accountBalance(fixture.ctx.cashAccountId)).toBeCloseTo(beforeSelectedCash, 2);
    expect(await accountBalance(fixture.hadiCashAccountId)).toBeCloseTo(beforeHadiCash + 500, 2);
    expect(await accountBalance(fixture.goldenCoastIntercompanyAccountId)).toBeCloseTo(
      beforeGoldenCoastIntercompany + 500,
      2
    );
    expect(await accountBalance(fixture.hadiIntercompanyAccountId)).toBeCloseTo(beforeHadiIntercompany - 500, 2);
    expect(await accountBalance(fixture.saleSideAccountId)).toBeCloseTo(-460, 2);
    const settlementIds = await settlementVoucherIds("normal-pos-sale");
    expect(settlementIds).toHaveLength(2);
    const goldenCoastSettlementEntries = await voucherEntriesFor(settlementIds[0]);
    expect(
      goldenCoastSettlementEntries.find((entry) => entry.ledgerAccountId === fixture.ctx.cashAccountId)?.creditAmount
    ).toBe("500.00");
    const hadiSettlementEntries = await voucherEntriesFor(settlementIds[1]);
    expect(
      hadiSettlementEntries.find((entry) => entry.ledgerAccountId === fixture.hadiCashAccountId)?.debitAmount
    ).toBe("500.00");
    await expectBalancedSettlementVouchers("normal-pos-sale");
  });

  it("replays the same request without duplicating settlement vouchers", async () => {
    const first = await fixture.agent.post("/api/pos/sales").send({
      ...saleBody(),
      clientSaleId: "normal-pos-sale-retry",
    });
    expect(first.status).toBe(200);
    const beforeRetry = await settlementVoucherIds("normal-pos-sale-retry");

    const retry = await fixture.agent.post("/api/pos/sales").send({
      ...saleBody(),
      clientSaleId: "normal-pos-sale-retry",
    });

    expect(retry.status).toBe(200);
    expect(retry.body.voucher.id).toBe(first.body.voucher.id);
    expect(await settlementVoucherIds("normal-pos-sale-retry")).toEqual(beforeRetry);
  });

  it("reverses and rebuilds the paired settlement on PATCH edit", async () => {
    const beforeEdit = await accountBalance(fixture.hadiCashAccountId);
    const beforePayable = await accountBalance(fixture.saleSideAccountId);
    const beforeDeduction = await accountBalance(fixture.deductionClearingAccountId);
    const { rows: inventoryBeforeRows } = await pool.query(
      `SELECT quantity::numeric AS quantity
       FROM inventory
       WHERE company_id = $1 AND location_id = $2 AND stock_item_id = $3`,
      [fixture.ctx.companyId, fixture.ctx.locationId, fixture.goldenCoastStockItemId]
    );
    const inventoryBeforeEdit = Number(inventoryBeforeRows[0].quantity);
    const voucherId = (
      await fixture.agent.post("/api/pos/sales").send({
        ...saleBody(),
        clientSaleId: "normal-pos-sale-edit",
      })
    ).body.voucher.id;
    const afterCreate = await accountBalance(fixture.hadiCashAccountId);
    expect(afterCreate - beforeEdit).toBeCloseTo(500, 2);

    const edited = await fixture.agent.patch(`/api/vouchers/${voucherId}/sales`).send({
      locationId: fixture.ctx.locationId,
      paymentAccountType: "cash",
      paymentAccountId: fixture.ctx.cashAccountId,
      targetCompanyId: fixture.hadiCompanyId,
      items: [{ stockItemId: fixture.goldenCoastStockItemId, quantity: "2", sellingPrice: "200" }],
    });

    expect(edited.status).toBe(200);
    expect(edited.body.voucher.id).toBe(voucherId);
    expect(edited.body.grandTotal).toBe("400.00");
    expect(edited.body.items).toHaveLength(1);
    expect(await accountBalance(fixture.hadiCashAccountId)).toBeCloseTo(beforeEdit + 400, 2);
    expect(await accountBalance(fixture.saleSideAccountId)).toBeCloseTo(beforePayable - 380, 2);
    expect(await accountBalance(fixture.deductionClearingAccountId)).toBeCloseTo(beforeDeduction - 20, 2);
    expect(await settlementVoucherIds("normal-pos-sale-edit")).toHaveLength(6);
    await expectBalancedSettlementVouchers("normal-pos-sale-edit");

    const { rows: inventoryRows } = await pool.query(
      `SELECT quantity::numeric AS quantity
       FROM inventory
       WHERE company_id = $1 AND location_id = $2 AND stock_item_id = $3`,
      [fixture.ctx.companyId, fixture.ctx.locationId, fixture.goldenCoastStockItemId]
    );
    expect(Number(inventoryRows[0].quantity)).toBeCloseTo(inventoryBeforeEdit - 2, 3);
  });
});
