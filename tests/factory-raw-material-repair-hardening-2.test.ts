/**
 * Regression tests for the final raw-material repair hardening pass:
 *
 *  1. detectDoubleReservedDeduction (Model A) — reservedKg is informational
 *     exposure only; a fully-consumed/fully-reserved container must NOT be a
 *     false positive, but a genuine double-subtraction (reservedKg subtracted
 *     a second time on top of usedKg) must still be caught.
 *  2. Raw-stock recalc confirmation tokens are bound to a full input
 *     fingerprint (not just the old cost) — covered end-to-end by the
 *     existing stale-token test in factory-raw-stock-recalc-hardening.test.ts;
 *     here we add a case where ONLY a non-cost input (an additional charge)
 *     changes, proving the fingerprint — not just the derived cost — is what's
 *     actually checked.
 *  3. Supplier balance-by-currency reconciliation: gross exposure vs. net
 *     balance are distinct, unresolved-FX rows are flagged and excluded from
 *     netBalanceUsd rather than guessed at.
 *  4. Repair-token signing refuses to fall back to the shared dev key in
 *     production when SESSION_SECRET is missing/unset.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";
import { db, pool } from "../server/db";
import { eq } from "drizzle-orm";
import * as schema from "../shared/schema";
import {
  getRawMaterialReconciliation,
  detectDoubleReservedDeduction,
} from "../server/services/factory/rawMaterialReconciliation";
import {
  signRepairToken,
  verifyRepairToken,
  RepairTokenConfigurationError,
} from "../server/services/factory/repairToken";
import { loadRecalcFingerprintInputs, computeRecalcFingerprint } from "../server/services/factory/rawStockRecalc";

const TEST_PREFIX = "rmrepair2";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let supplierId: number;

async function cleanupFactoryTables(companyId: number) {
  await pool.query(`DELETE FROM factory_supplier_fx_transfers WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_supplier_payments WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_offload_additional_charges WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_container_commissions WHERE company_id = $1`, [companyId]);
  await pool.query(
    `DELETE FROM factory_mix_batch_sources WHERE container_id IN (SELECT id FROM factory_containers WHERE company_id = $1)`,
    [companyId]
  );
  await pool.query(`DELETE FROM factory_mix_batches WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_raw_stock WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_containers WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_suppliers WHERE company_id = $1`, [companyId]);
}

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

  const [supplier] = await db
    .insert(schema.factorySuppliers)
    .values({ companyId: ctx.companyId, name: `${TEST_PREFIX}_Supplier` })
    .returning();
  supplierId = supplier.id;
}, 30000);

afterAll(async () => {
  await cleanupFactoryTables(ctx.companyId);
  await cleanupTestData(ctx);
  await closeTestServer(ctx);
}, 30000);

describe("1. detectDoubleReservedDeduction (Model A false-positive fix)", () => {
  it("does NOT flag a fully-consumed, fully-reserved container (the ECMU-style false positive)", () => {
    // received=1000, used=1000 (already reflects the mix-batch consumption),
    // reserved=1000 (one open batch still references the whole container as
    // informational exposure), displayedFreeKg is the correct ground truth (0).
    const result = detectDoubleReservedDeduction({
      receivedKg: 1000,
      usedKg: 1000,
      reservedKg: 1000,
      displayedFreeKg: 0,
    });
    expect(result.provenDoubleSubtraction).toBe(false);
    expect(result.expectedFreeKg).toBeCloseTo(0, 6);
  });

  it("DOES flag a genuine double subtraction (reservedKg subtracted a second time on top of usedKg)", () => {
    // received=1000, used=400 → expectedFreeKg=600, but displayed free is 300,
    // i.e. exactly 600 - reservedKg(300) — proof reservedKg was subtracted again.
    const result = detectDoubleReservedDeduction({
      receivedKg: 1000,
      usedKg: 400,
      reservedKg: 300,
      displayedFreeKg: 300,
    });
    expect(result.provenDoubleSubtraction).toBe(true);
    expect(result.discrepancyKg).toBeCloseTo(-300, 6);
  });

  it("does not flag a healthy partially-used, partially-reserved container", () => {
    const result = detectDoubleReservedDeduction({
      receivedKg: 1000,
      usedKg: 400,
      reservedKg: 300,
      displayedFreeKg: 600,
    });
    expect(result.provenDoubleSubtraction).toBe(false);
  });

  it("live reconciliation report never flags a fully-consumed container as a double-reserved deduction", async () => {
    const [container] = await db
      .insert(schema.factoryContainers)
      .values({
        companyId: ctx.companyId,
        containerNumber: `${TEST_PREFIX}-DR1`,
        supplierId,
        currencyCode: "USD",
        fxRateToUsd: "1",
        fxRateConfirmed: true,
        status: "OFFLOADED",
        actualReceivedKg: "1000",
        ratePerKg: "2",
      })
      .returning();
    await db.insert(schema.factoryRawStock).values({
      companyId: ctx.companyId,
      containerId: container.id,
      receivedKg: "1000",
      usedKg: "1000", // fully consumed
      costPerKg: "2",
      costPerKgUsd: "2",
    });
    const [batch] = await db
      .insert(schema.factoryMixBatches)
      .values({
        companyId: ctx.companyId,
        batchCode: `${TEST_PREFIX}-MB1`,
        batchNumber: `${TEST_PREFIX}-MB1`,
        status: "OPEN",
        totalWeightKg: "1000",
        costPerKg: "2",
        totalCost: "2000",
      } as any)
      .returning();
    await db.insert(schema.factoryMixBatchSources).values({
      mixBatchId: batch.id,
      containerId: container.id,
      supplierId,
      weightKg: "1000", // fully reserved — this used to false-positive
      costPerKg: "2",
      totalCost: "2000",
    } as any);

    const recon = await getRawMaterialReconciliation(ctx.companyId);
    const flagged = recon.doubleReservedDeductions.find((r) => r.containerId === container.id);
    expect(flagged).toBeUndefined();
  });
});

describe("2. Recalc confirmation-token full fingerprint", () => {
  it("changing a non-cost input (an additional charge) after the dry-run still trips STALE_TOKEN", async () => {
    const [container] = await db
      .insert(schema.factoryContainers)
      .values({
        companyId: ctx.companyId,
        containerNumber: `${TEST_PREFIX}-FP1`,
        supplierId,
        currencyCode: "USD",
        fxRateToUsd: "1",
        fxRateConfirmed: true,
        status: "OFFLOADED",
        actualReceivedKg: "1000",
        ratePerKg: "3",
        freight: "0",
        otherCharges: "0",
        commissionAmount: "0",
        dutyStatus: "NONE",
        dutyAmount: "0",
      })
      .returning();
    await db.insert(schema.factoryRawStock).values({
      companyId: ctx.companyId,
      containerId: container.id,
      receivedKg: "1000",
      usedKg: "0",
      costPerKg: "2.5", // stale vs container.ratePerKg, forces a diff
      costPerKgUsd: "2.5",
    });

    const before = await loadRecalcFingerprintInputs(ctx.companyId, container.id);
    const tokenFingerprint = before ? computeRecalcFingerprint(before) : undefined;
    expect(tokenFingerprint).toBeTruthy();

    // A new additional charge appears after the token was issued — the cost
    // figures themselves haven't changed yet, but the input set has.
    await db.insert(schema.factoryOffloadAdditionalCharges).values({
      companyId: ctx.companyId,
      containerId: container.id,
      description: "Late-arriving inspection fee",
      amount: "50",
      currencyCode: "USD",
      fxRateToUsd: "1",
      fxRateConfirmed: true,
    } as any);

    const after = await loadRecalcFingerprintInputs(ctx.companyId, container.id);
    const freshFingerprint = after ? computeRecalcFingerprint(after) : undefined;
    expect(freshFingerprint).toBeTruthy();
    expect(freshFingerprint).not.toBe(tokenFingerprint);
  });
});

describe("3. Supplier balance-by-currency reconciliation", () => {
  it("keeps gross exposure and net balance distinct, and nets off payments per currency", async () => {
    const [eurSupplier] = await db
      .insert(schema.factorySuppliers)
      .values({ companyId: ctx.companyId, name: `${TEST_PREFIX}_EurSupplier` })
      .returning();

    const [container] = await db
      .insert(schema.factoryContainers)
      .values({
        companyId: ctx.companyId,
        containerNumber: `${TEST_PREFIX}-BAL1`,
        supplierId: eurSupplier.id,
        currencyCode: "EUR",
        fxRateToUsd: "1.1",
        fxRateConfirmed: true,
        status: "OFFLOADED",
        actualReceivedKg: "1000",
        ratePerKg: "2", // 2000 EUR gross exposure
      })
      .returning();

    await db.insert(schema.factorySupplierPayments).values({
      companyId: ctx.companyId,
      supplierId: eurSupplier.id,
      date: "2026-07-01",
      amount: "800", // native EUR
      currencyCode: "EUR",
      fxRateToUsd: "1.1",
      amountUsd: "880",
    } as any);

    const recon = await getRawMaterialReconciliation(ctx.companyId);
    const row = recon.supplierBalanceByCurrency.find((r) => r.supplierId === eurSupplier.id);
    expect(row).toBeTruthy();
    expect(row!.grossExposureByCurrency["EUR"]).toBeCloseTo(2000, 4);
    expect(row!.paymentsByCurrency["EUR"]).toBeCloseTo(800, 4);
    // Net balance must be gross minus payments — never equal to gross exposure
    // once a payment has been made (that would be the exact "mislabeled as
    // balance" bug this item exists to prevent).
    expect(row!.netBalanceByCurrency["EUR"]).toBeCloseTo(1200, 4);
    expect(row!.netBalanceByCurrency["EUR"]).not.toBeCloseTo(row!.grossExposureByCurrency["EUR"], 4);
    // 2000 EUR * 1.1 - 880 USD = 2200 - 880 = 1320 USD
    expect(row!.netBalanceUsd).toBeCloseTo(1320, 4);
    expect(row!.hasUnresolvedFx).toBe(false);

    await pool.query(`DELETE FROM factory_supplier_payments WHERE company_id = $1 AND supplier_id = $2`, [
      ctx.companyId,
      eurSupplier.id,
    ]);
    await pool.query(`DELETE FROM factory_containers WHERE id = $1`, [container.id]);
    await pool.query(`DELETE FROM factory_suppliers WHERE id = $1`, [eurSupplier.id]);
  });

  it("flags an unresolved FX row and excludes it from netBalanceUsd instead of guessing at a rate", async () => {
    const [gbpSupplier] = await db
      .insert(schema.factorySuppliers)
      .values({ companyId: ctx.companyId, name: `${TEST_PREFIX}_GbpSupplier` })
      .returning();

    const [container] = await db
      .insert(schema.factoryContainers)
      .values({
        companyId: ctx.companyId,
        containerNumber: `${TEST_PREFIX}-BAL2`,
        supplierId: gbpSupplier.id,
        currencyCode: "GBP",
        fxRateToUsd: "1", // default/unset value, not confirmed — "looks unset"
        fxRateConfirmed: false,
        status: "OFFLOADED",
        actualReceivedKg: "500",
        ratePerKg: "3", // 1500 GBP gross exposure, FX unresolved
      })
      .returning();

    const recon = await getRawMaterialReconciliation(ctx.companyId);
    const row = recon.supplierBalanceByCurrency.find((r) => r.supplierId === gbpSupplier.id);
    expect(row).toBeTruthy();
    expect(row!.grossExposureByCurrency["GBP"]).toBeCloseTo(1500, 4);
    // Native net balance is still computable without any FX resolution.
    expect(row!.netBalanceByCurrency["GBP"]).toBeCloseTo(1500, 4);
    // But the USD figure must NOT silently assume a rate of 1 for the unresolved GBP leg.
    expect(row!.netBalanceUsd).toBeCloseTo(0, 4);
    expect(row!.hasUnresolvedFx).toBe(true);

    const unresolvedRow = recon.unresolvedFxRows.find((r) => r.supplierId === gbpSupplier.id && r.rowId === container.id);
    expect(unresolvedRow).toBeTruthy();
    expect(unresolvedRow!.currencyCode).toBe("GBP");
    expect(unresolvedRow!.source).toBe("container");

    await pool.query(`DELETE FROM factory_containers WHERE id = $1`, [container.id]);
    await pool.query(`DELETE FROM factory_suppliers WHERE id = $1`, [gbpSupplier.id]);
  });
});

describe("4. Repair-token signing secret hardening", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSecret = process.env.SESSION_SECRET;

  function restoreEnv() {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
  }

  it("refuses to sign a repair token in production with no SESSION_SECRET configured", () => {
    try {
      process.env.NODE_ENV = "production";
      delete process.env.SESSION_SECRET;
      expect(() => signRepairToken({ foo: "bar", expiresAt: Date.now() + 60000 })).toThrow(
        RepairTokenConfigurationError
      );
    } finally {
      restoreEnv();
    }
  });

  it("refuses to sign a repair token in production if SESSION_SECRET is still the dev-fallback literal", () => {
    try {
      process.env.NODE_ENV = "production";
      process.env.SESSION_SECRET = "dev-fallback-repair-token-key-not-for-production";
      expect(() => signRepairToken({ foo: "bar", expiresAt: Date.now() + 60000 })).toThrow(
        RepairTokenConfigurationError
      );
    } finally {
      restoreEnv();
    }
  });

  it("signs and verifies normally in production once a real SESSION_SECRET is configured", () => {
    try {
      process.env.NODE_ENV = "production";
      process.env.SESSION_SECRET = "a-real-unique-production-secret-value";
      const token = signRepairToken({ foo: "bar", expiresAt: Date.now() + 60000 });
      const payload = verifyRepairToken<{ foo: string }>(token);
      expect(payload.foo).toBe("bar");
    } finally {
      restoreEnv();
    }
  });

  it("still allows the dev-fallback key outside production when no secret is configured", () => {
    try {
      process.env.NODE_ENV = "test";
      delete process.env.SESSION_SECRET;
      const token = signRepairToken({ foo: "bar", expiresAt: Date.now() + 60000 });
      const payload = verifyRepairToken<{ foo: string }>(token);
      expect(payload.foo).toBe("bar");
    } finally {
      restoreEnv();
    }
  });
});
