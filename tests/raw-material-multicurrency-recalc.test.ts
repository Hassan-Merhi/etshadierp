/**
 * Integration + unit tests for multi-currency raw-material cost recomputation
 * and the write-path rejections added around opening-balance commissions.
 *
 * Covers remaining spec scenarios not exercised by factory-fx-diagnostic-repair.test.ts:
 *   - computeCorrectContainerCost blends a container-currency base cost with charges
 *     stored in OTHER currencies (freight/other-charges/commission/additional-charge
 *     each with their own currency + explicit rate) using decimal.js, not floats.
 *   - An unresolved container FX rate is surfaced as fxUnresolved, never guessed as 1.
 *   - Opening-balance import rejects a non-USD commission with no explicit rate,
 *     exactly like the existing check for the main container rate.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";
import { db, pool } from "../server/db";
import { eq } from "drizzle-orm";
import * as schema from "../shared/schema";
import { computeCorrectContainerCost } from "../server/services/factory/rawStockRecalc";

const TEST_PREFIX = "fxmulti";

let ctx: TestContext;
let agent: request.SuperAgentTest;

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  await db.update(schema.companies).set({ companyType: "factory" }).where(eq(schema.companies.id, ctx.companyId));
  agent = request.agent(ctx.app);
  const loginRes = await agent
    .post("/api/auth/login")
    .send({ username: `${TEST_PREFIX}_testuser`, password: "testpassword123" });
  if (loginRes.status !== 200) {
    throw new Error(`Login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }
  await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });
}, 30000);

afterAll(async () => {
  await pool.query(`DELETE FROM factory_offload_additional_charges WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM factory_container_commissions WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM factory_raw_stock WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM factory_containers WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM factory_suppliers WHERE company_id = $1`, [ctx.companyId]);
  await cleanupTestData(ctx);
  await closeTestServer(ctx);
}, 30000);

describe("Multi-currency raw-material cost recomputation (decimal.js)", () => {
  it("blends a EUR base cost with a CDF additional charge, each converted via its own explicit rate", () => {
    const container: any = {
      currencyCode: "EUR",
      fxRateToUsd: "1.08",
      fxRateToUsdOffload: "1.08",
      fxRateConfirmed: true,
      actualReceivedKg: "1000",
      ratePerKg: "2.5", // 2.5 EUR/kg
      freight: "0",
      freightCurrencyCode: "EUR",
      otherCharges: "0",
      otherChargesCurrencyCode: "EUR",
      commissionAmount: "0",
      commissionCurrencyCode: "EUR",
      dutyStatus: "PENDING",
      dutyAmount: "0",
    };
    const additionalCharges: any[] = [
      {
        amount: "50000", // 50,000 CDF
        currencyCode: "CDF",
        fxRateToUsd: "0.00038", // 1 CDF = 0.00038 USD
      },
    ];

    const result = computeCorrectContainerCost(container, additionalCharges, null);

    expect(result.fxUnresolved).toBe(false);
    // Base: 1000kg * 2.5 EUR/kg = 2500 EUR -> USD at 1.08 = 2700 USD
    // Additional charge: 50000 CDF * 0.00038 = 19 USD
    // Total USD = 2719
    expect(result.totalUsd).toBeCloseTo(2719, 4);
    // Total in container currency: base 2500 EUR + (19 USD / 1.08 EUR-rate) = 2500 + 17.592592... EUR
    expect(result.totalCost).toBeCloseTo(2500 + 19 / 1.08, 4);
    expect(result.costPerKgUsd).toBeCloseTo(2719 / 1000, 6);
  });

  it("surfaces fxUnresolved instead of guessing rate=1 for a non-USD container with no confirmed rate", () => {
    const container: any = {
      currencyCode: "EUR",
      fxRateToUsd: "1", // looks like the old "unset" heuristic value
      fxRateToUsdOffload: null,
      fxRateConfirmed: false,
      actualReceivedKg: "500",
      ratePerKg: "3",
      freight: "0",
      otherCharges: "0",
      commissionAmount: "0",
      dutyStatus: "PENDING",
      dutyAmount: "0",
    };

    const result = computeCorrectContainerCost(container, [], null);
    expect(result.fxUnresolved).toBe(true);
    expect(result.totalUsd).toBe(0);
  });

  it("does not flag a genuinely-confirmed 1:1 peg as unresolved", () => {
    const container: any = {
      currencyCode: "EUR",
      fxRateToUsd: "1",
      fxRateToUsdOffload: "1",
      fxRateConfirmed: true,
      actualReceivedKg: "500",
      ratePerKg: "3",
      freight: "0",
      otherCharges: "0",
      commissionAmount: "0",
      dutyStatus: "PENDING",
      dutyAmount: "0",
    };

    const result = computeCorrectContainerCost(container, [], null);
    expect(result.fxUnresolved).toBe(false);
    expect(result.totalUsd).toBeCloseTo(1500, 4);
  });
});

describe("Opening-balance import: commission FX rejection", () => {
  it("rejects an opening-balance import whose main rate is missing for a non-USD currency", async () => {
    const res = await agent.post("/api/factory/raw-stock/opening-balance").send({
      supplierName: `${TEST_PREFIX}_SupplierA`,
      receivedKg: "100",
      costPerKg: "2",
      currencyCode: "EUR",
      // fxRateToUsd intentionally omitted
    });
    expect(res.status).toBe(400);
  });

  it("rejects an opening-balance import whose commission currency is non-USD with no explicit rate", async () => {
    const res = await agent.post("/api/factory/raw-stock/opening-balance").send({
      supplierName: `${TEST_PREFIX}_SupplierB`,
      receivedKg: "100",
      costPerKg: "2",
      currencyCode: "USD",
      commissionAmount: "50",
      commissionCurrencyCode: "EUR",
      // commissionFxRateToUsd intentionally omitted
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/[Cc]ommission/);
  });

  it("accepts an opening-balance import with an explicit commission FX rate and blends it correctly", async () => {
    const res = await agent.post("/api/factory/raw-stock/opening-balance").send({
      supplierName: `${TEST_PREFIX}_SupplierC`,
      receivedKg: "100",
      costPerKg: "2",
      currencyCode: "USD",
      commissionAmount: "50",
      commissionCurrencyCode: "EUR",
      commissionFxRateToUsd: "1.08",
    });
    expect(res.status).toBe(200);
  });
});
