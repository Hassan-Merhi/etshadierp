import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../server/db";
import { closeTestServer } from "./setup";
import {
  GOLDEN_COAST_PHASE5_SALE_DATE,
  clearLots,
  goldenCoastPhase5SaleUrl,
  seedCutoverLot,
  setupGoldenCoastPhase5Fixture,
  teardownGoldenCoastPhase5Fixture,
  type GoldenCoastPhase5Fixture,
} from "./helpers/goldenCoastPhase5Fixture";

const TEST_PREFIX = "gcphase16hadi";
const LEGACY_PHASE7_URL = "/api/sp/golden-coast/phase7/sales-cash-transfer";
const FRESH_START_PAYMENT_URL = "/api/sp/golden-coast/phase7/sales-cash-pay-fresh-start";
let fixture: GoldenCoastPhase5Fixture;

async function roleAccountId(companyId: number, subType: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT id FROM ledger_accounts
     WHERE company_id = $1 AND sub_type = $2 AND active = true AND deleted_at IS NULL
     ORDER BY id`,
    [companyId, subType]
  );
  if (rows.length !== 1) throw new Error(`Expected one active ${subType} account, found ${rows.length}`);
  return Number(rows[0].id);
}

async function netDebit(accountId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(ve.debit_amount::numeric - ve.credit_amount::numeric), 0) AS balance
     FROM voucher_entries ve
     JOIN vouchers v ON v.id = ve.voucher_id
     WHERE ve.ledger_account_id = $1 AND v.deleted_at IS NULL`,
    [accountId]
  );
  return Number(rows[0].balance);
}

async function phase16PaymentMarkerCount(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM accounting_posting_requests
     WHERE source_type = 'golden-coast-fresh-start-hadi-payment'
       AND company_id = ANY($1::int[])`,
    [[fixture.ctx.companyId, fixture.hadiCompanyId]]
  );
  return Number(rows[0].count);
}

beforeAll(async () => {
  fixture = await setupGoldenCoastPhase5Fixture(TEST_PREFIX);
  await pool.query(
    `UPDATE locations SET supplier_partner_payable_deduction_per_qty = '0'
     WHERE id = $1 AND company_id = $2`,
    [fixture.ctx.locationId, fixture.ctx.companyId]
  );
  await clearLots(fixture.ctx.companyId);
  await seedCutoverLot({
    prefix: TEST_PREFIX,
    companyId: fixture.ctx.companyId,
    locationId: fixture.ctx.locationId,
    stockItemId: fixture.goldenCoastStockItemId,
    qty: "100",
    unitCost: "22",
  });
}, 90_000);

afterAll(async () => {
  await teardownGoldenCoastPhase5Fixture(fixture);
  closeTestServer();
}, 60_000);

describe("Golden Coast Phase 16 — HADI credit-payable settlement", () => {
  it("retires the old manual debit-model mutation without changing any ledger balance", async () => {
    const freshStartEquity = await roleAccountId(fixture.ctx.companyId, "gc_partner_capital");
    const before = {
      payable: await netDebit(fixture.saleSideAccountId),
      fresh: await netDebit(freshStartEquity),
      gcHadi: await netDebit(fixture.goldenCoastHadiIntercompanyAccountId),
      hadiCash: await netDebit(fixture.hadiCashAccountId),
    };

    const response = await fixture.agent
      .post(`${LEGACY_PHASE7_URL}?targetCompanyId=${fixture.hadiCompanyId}`)
      .send({
        operation: "collect_via_hadi",
        transferDate: GOLDEN_COAST_PHASE5_SALE_DATE,
        amountUsd: "100.00",
        clientRequestId: "phase16-legacy-mutation",
        hadiCashAccount: { kind: "ledger", id: fixture.hadiCashAccountId },
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("GC_PHASE16_LEGACY_HADI_TRANSFER_RETIRED");
    expect(await netDebit(fixture.saleSideAccountId)).toBeCloseTo(before.payable, 2);
    expect(await netDebit(freshStartEquity)).toBeCloseTo(before.fresh, 2);
    expect(await netDebit(fixture.goldenCoastHadiIntercompanyAccountId)).toBeCloseTo(before.gcHadi, 2);
    expect(await netDebit(fixture.hadiCashAccountId)).toBeCloseTo(before.hadiCash, 2);
  });

  it("pays Fresh Start from HADI by reducing the credit payable and HADI asset without another equity hit", async () => {
    const freshStartEquity = await roleAccountId(fixture.ctx.companyId, "gc_partner_capital");
    const hassanEquity = await roleAccountId(fixture.ctx.companyId, "gc_owner_capital");
    const beforeSale = {
      payable: await netDebit(fixture.saleSideAccountId),
      fresh: await netDebit(freshStartEquity),
      hassan: await netDebit(hassanEquity),
      gcHadi: await netDebit(fixture.goldenCoastHadiIntercompanyAccountId),
      hadiCash: await netDebit(fixture.hadiCashAccountId),
      hadiGc: await netDebit(fixture.hadiGoldenCoastIntercompanyAccountId),
    };

    const sale = await fixture.agent.post(goldenCoastPhase5SaleUrl(fixture)).send({
      locationId: fixture.ctx.locationId,
      saleDate: GOLDEN_COAST_PHASE5_SALE_DATE,
      customerName: "Phase 16 settlement customer",
      clientRequestId: "phase16-sale",
      lines: [{ stockItemId: fixture.goldenCoastStockItemId, qty: "10", unitPriceUsd: "60" }],
    });
    expect(sale.status).toBe(200);

    const afterSale = {
      payable: await netDebit(fixture.saleSideAccountId),
      fresh: await netDebit(freshStartEquity),
      hassan: await netDebit(hassanEquity),
      gcHadi: await netDebit(fixture.goldenCoastHadiIntercompanyAccountId),
      hadiCash: await netDebit(fixture.hadiCashAccountId),
      hadiGc: await netDebit(fixture.hadiGoldenCoastIntercompanyAccountId),
    };
    expect(afterSale.payable - beforeSale.payable).toBeCloseTo(-600, 2);
    expect(afterSale.fresh - beforeSale.fresh).toBeCloseTo(600, 2);
    expect(afterSale.hassan - beforeSale.hassan).toBeCloseTo(0, 2);
    expect(afterSale.gcHadi - beforeSale.gcHadi).toBeCloseTo(600, 2);
    expect(afterSale.hadiCash - beforeSale.hadiCash).toBeCloseTo(600, 2);
    expect(afterSale.hadiGc - beforeSale.hadiGc).toBeCloseTo(-600, 2);

    const markersBefore = await phase16PaymentMarkerCount();
    const paymentBody = {
      paymentDate: GOLDEN_COAST_PHASE5_SALE_DATE,
      amountUsd: "250.00",
      clientRequestId: "phase16-hadi-payment",
      reference: "Partial Fresh Start settlement",
      hadiCashAccount: { kind: "ledger", id: fixture.hadiCashAccountId },
    };
    const payment = await fixture.agent
      .post(`${FRESH_START_PAYMENT_URL}?targetCompanyId=${fixture.hadiCompanyId}`)
      .send(paymentBody);
    expect(payment.status).toBe(201);
    expect(payment.body.replayed).toBe(false);
    expect(payment.body.balances).toMatchObject({
      gcSalesCashPayableAfterUsd: "350.00",
      outstandingHadiSalesCashAfterUsd: "350.00",
      hadiIntercompanyAssetAfterUsd: "350.00",
    });

    expect((await netDebit(fixture.saleSideAccountId)) - afterSale.payable).toBeCloseTo(250, 2);
    expect((await netDebit(freshStartEquity)) - afterSale.fresh).toBeCloseTo(0, 2);
    expect((await netDebit(hassanEquity)) - afterSale.hassan).toBeCloseTo(0, 2);
    expect((await netDebit(fixture.goldenCoastHadiIntercompanyAccountId)) - afterSale.gcHadi).toBeCloseTo(-250, 2);
    expect((await netDebit(fixture.hadiCashAccountId)) - afterSale.hadiCash).toBeCloseTo(-250, 2);
    expect((await netDebit(fixture.hadiGoldenCoastIntercompanyAccountId)) - afterSale.hadiGc).toBeCloseTo(250, 2);
    expect((await phase16PaymentMarkerCount()) - markersBefore).toBe(2);

    const beforeReplay = {
      payable: await netDebit(fixture.saleSideAccountId),
      fresh: await netDebit(freshStartEquity),
      gcHadi: await netDebit(fixture.goldenCoastHadiIntercompanyAccountId),
      hadiCash: await netDebit(fixture.hadiCashAccountId),
      markers: await phase16PaymentMarkerCount(),
    };
    const replay = await fixture.agent
      .post(`${FRESH_START_PAYMENT_URL}?targetCompanyId=${fixture.hadiCompanyId}`)
      .send(paymentBody);
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(await netDebit(fixture.saleSideAccountId)).toBeCloseTo(beforeReplay.payable, 2);
    expect(await netDebit(freshStartEquity)).toBeCloseTo(beforeReplay.fresh, 2);
    expect(await netDebit(fixture.goldenCoastHadiIntercompanyAccountId)).toBeCloseTo(beforeReplay.gcHadi, 2);
    expect(await netDebit(fixture.hadiCashAccountId)).toBeCloseTo(beforeReplay.hadiCash, 2);
    expect(await phase16PaymentMarkerCount()).toBe(beforeReplay.markers);
  });
});
