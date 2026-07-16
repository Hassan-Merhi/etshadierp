/**
 * Regression tests: Commission FX conversion bug fix.
 *
 * Before the fix, the offload backend used the container's fxRateToUsd as the
 * commission FX rate whenever the commission was non-USD, even if the commission
 * currency differed from the container currency.  E.g. EUR 1,000 commission on
 * an AUD container (fxRate=0.67) produced commissionTotalUsd = 670 instead of
 * 1000 × 1.18 = 1180.
 *
 * All 13 scenarios are pure unit tests of computeCorrectContainerCost — no DB.
 *
 * Scenarios:
 *  1  USD+USD                          — commUsd = native amount
 *  2  EUR+EUR                          — commUsd = native × containerFx
 *  3  EUR container + USD commission   — commUsd = native (no FX)
 *  4  AUD+EUR (canonical bug)          — commUsd = native × EUR/USD, NOT AUD/USD
 *  5  EUR+GBP cross-currency           — uses GBP/USD, not EUR/USD
 *  6  USD container + EUR commission   — uses EUR/USD, not 1
 *  7  PER_KG cross-currency            — uses correct FX on total
 *  8  FIXED cross-ccy via snapshot     — uses container commissionFxRateToUsd
 *  9  Unresolved FX → fxUnresolved=true, contributes 0
 * 10  Recalc matches manual offload math
 * 11  Commission FX independent from container FX changes
 * 12  Same-ccy commission uses containerFx correctly
 * 13  Idempotency — same inputs → identical outputs
 */
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeCorrectContainerCost } from "../server/services/factory/rawStockRecalc";

// ─── Builder helpers ──────────────────────────────────────────────────────────
function makeContainer(opts: {
  containerCcy: string;
  containerFxToUsd: number;
  actualKg: number;
  ratePerKg: number;
  commissionAmount?: number;
  commissionCcy?: string;
  commissionFxRateToUsd?: number;
  commissionFxRateConfirmed?: boolean;
}) {
  return {
    currencyCode: opts.containerCcy,
    fxRateToUsd: String(opts.containerFxToUsd),
    fxRateToUsdOffload: String(opts.containerFxToUsd),
    fxRateConfirmed: true,
    actualReceivedKg: String(opts.actualKg),
    ratePerKg: String(opts.ratePerKg),
    freight: "0",
    freightCurrencyCode: opts.containerCcy,
    freightFxRateToUsd: null,
    freightFxRateConfirmed: false,
    otherCharges: "0",
    dutyStatus: "NONE",
    dutyAmount: null,
    commissionAmount: String(opts.commissionAmount ?? 0),
    commissionCurrencyCode: opts.commissionCcy ?? opts.containerCcy,
    commissionFxRateToUsd: opts.commissionFxRateToUsd != null ? String(opts.commissionFxRateToUsd) : null,
    commissionFxRateConfirmed: opts.commissionFxRateConfirmed ?? false,
    status: "OFFLOADED",
  } as any;
}

function makeCommRec(opts: { ccy: string; fxToUsd: number; confirmed: boolean; total: number }) {
  return {
    currencyCode: opts.ccy,
    fxRateToUsd: String(opts.fxToUsd),
    fxRateConfirmed: opts.confirmed,
    commissionTotal: String(opts.total),
    commissionTotalUsd: String(opts.total * opts.fxToUsd),
    id: 1,
    createdAt: new Date(),
  } as any;
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("computeCorrectContainerCost — commission FX isolation", () => {
  // 1. USD+USD
  it("scenario 1: USD+USD — commUsd = native amount (no conversion)", () => {
    const r = computeCorrectContainerCost(
      makeContainer({ containerCcy: "USD", containerFxToUsd: 1, actualKg: 1000, ratePerKg: 1 }),
      [],
      makeCommRec({ ccy: "USD", fxToUsd: 1, confirmed: true, total: 500 })
    );
    expect(r.fxUnresolved).toBe(false);
    // base 1000×1=1000, comm 500 → totalUsd 1500
    expect(new Decimal(r.totalUsd).toDecimalPlaces(2).toNumber()).toBe(1500);
  });

  // 2. EUR+EUR
  it("scenario 2: EUR+EUR — commUsd = native × containerFx", () => {
    const r = computeCorrectContainerCost(
      makeContainer({ containerCcy: "EUR", containerFxToUsd: 1.1, actualKg: 1000, ratePerKg: 1 }),
      [],
      makeCommRec({ ccy: "EUR", fxToUsd: 1.1, confirmed: true, total: 200 })
    );
    expect(r.fxUnresolved).toBe(false);
    // base 1000×1.1=1100, comm 200×1.1=220 → 1320
    expect(new Decimal(r.totalUsd).toDecimalPlaces(2).toNumber()).toBe(1320);
  });

  // 3. EUR container + USD commission
  it("scenario 3: EUR container + USD commission — commUsd = native (no FX applied)", () => {
    const r = computeCorrectContainerCost(
      makeContainer({ containerCcy: "EUR", containerFxToUsd: 1.1, actualKg: 1000, ratePerKg: 1 }),
      [],
      makeCommRec({ ccy: "USD", fxToUsd: 1, confirmed: true, total: 300 })
    );
    expect(r.fxUnresolved).toBe(false);
    // base 1100, comm 300 → 1400
    expect(new Decimal(r.totalUsd).toDecimalPlaces(2).toNumber()).toBe(1400);
  });

  // 4. AUD+EUR — canonical bug
  it("scenario 4: AUD container + EUR commission — uses EUR/USD 1.18, NOT AUD/USD 0.67", () => {
    const r = computeCorrectContainerCost(
      makeContainer({ containerCcy: "AUD", containerFxToUsd: 0.67, actualKg: 10000, ratePerKg: 0.5 }),
      [],
      makeCommRec({ ccy: "EUR", fxToUsd: 1.18, confirmed: true, total: 1000 })
    );
    expect(r.fxUnresolved).toBe(false);
    const baseUsd = 10000 * 0.5 * 0.67; // 3350
    // CORRECT: 3350 + 1000×1.18 = 4530
    expect(new Decimal(r.totalUsd).toDecimalPlaces(2).toNumber()).toBeCloseTo(4530, 1);
    // Wrong old value would be 3350 + 1000×0.67 = 4020 — assert we are far from it
    expect(Math.abs(r.totalUsd - 4020)).toBeGreaterThan(100);
  });

  // 5. EUR container + GBP commission
  it("scenario 5: EUR+GBP — uses GBP/USD 1.27, not EUR/USD 1.1", () => {
    const r = computeCorrectContainerCost(
      makeContainer({ containerCcy: "EUR", containerFxToUsd: 1.1, actualKg: 5000, ratePerKg: 2 }),
      [],
      makeCommRec({ ccy: "GBP", fxToUsd: 1.27, confirmed: true, total: 500 })
    );
    expect(r.fxUnresolved).toBe(false);
    // base 5000×2×1.1=11000, comm 500×1.27=635 → 11635
    expect(new Decimal(r.totalUsd).toDecimalPlaces(2).toNumber()).toBeCloseTo(11635, 1);
  });

  // 6. USD container + EUR commission
  it("scenario 6: USD container + EUR commission — uses EUR/USD 1.15, not 1", () => {
    const r = computeCorrectContainerCost(
      makeContainer({ containerCcy: "USD", containerFxToUsd: 1, actualKg: 2000, ratePerKg: 3 }),
      [],
      makeCommRec({ ccy: "EUR", fxToUsd: 1.15, confirmed: true, total: 400 })
    );
    expect(r.fxUnresolved).toBe(false);
    // base 6000, comm 400×1.15=460 → 6460
    expect(new Decimal(r.totalUsd).toDecimalPlaces(2).toNumber()).toBeCloseTo(6460, 1);
  });

  // 7. PER_KG commission in different currency
  it("scenario 7: PER_KG cross-currency — uses EUR/USD on the computed total", () => {
    // 5000 kg × 0.5 EUR/kg = 2500 EUR total @ 1.18 = 2950 USD
    const r = computeCorrectContainerCost(
      makeContainer({ containerCcy: "AUD", containerFxToUsd: 0.67, actualKg: 5000, ratePerKg: 1 }),
      [],
      makeCommRec({ ccy: "EUR", fxToUsd: 1.18, confirmed: true, total: 2500 })
    );
    expect(r.fxUnresolved).toBe(false);
    const baseUsd = 5000 * 1 * 0.67; // 3350
    expect(new Decimal(r.totalUsd).toDecimalPlaces(2).toNumber()).toBeCloseTo(baseUsd + 2950, 1);
  });

  // 8. FIXED cross-ccy via container snapshot (null commission record)
  it("scenario 8: uses container commissionFxRateToUsd snapshot when no commission record", () => {
    const r = computeCorrectContainerCost(
      makeContainer({
        containerCcy: "AUD", containerFxToUsd: 0.67, actualKg: 1000, ratePerKg: 0.5,
        commissionAmount: 1000, commissionCcy: "EUR",
        commissionFxRateToUsd: 1.18, commissionFxRateConfirmed: true,
      }),
      [],
      null
    );
    expect(r.fxUnresolved).toBe(false);
    // base = 1000×0.5×0.67=335, comm = 1000×1.18=1180 → 1515
    expect(new Decimal(r.totalUsd).toDecimalPlaces(2).toNumber()).toBeCloseTo(1515, 1);
  });

  // 9. Unresolved FX → fxUnresolved=true, commission contributes 0
  it("scenario 9: unresolved commission FX → fxUnresolved=true, commission excluded from total", () => {
    const r = computeCorrectContainerCost(
      makeContainer({ containerCcy: "AUD", containerFxToUsd: 0.67, actualKg: 1000, ratePerKg: 0.5 }),
      [],
      // confirmed=false with a EUR commission on AUD container — different CCY, not confirmed
      makeCommRec({ ccy: "EUR", fxToUsd: 0.67, confirmed: false, total: 1000 })
    );
    expect(r.fxUnresolved).toBe(true);
    // Only base contributes; commission excluded
    const baseUsd = 1000 * 0.5 * 0.67;
    expect(new Decimal(r.totalUsd).toDecimalPlaces(2).toNumber()).toBeCloseTo(baseUsd, 1);
  });

  // 10. Recalc matches manual offload math
  it("scenario 10: recalculation matches manual offload math for AUD+EUR case", () => {
    const r = computeCorrectContainerCost(
      makeContainer({ containerCcy: "AUD", containerFxToUsd: 0.67, actualKg: 10000, ratePerKg: 0.42 }),
      [],
      makeCommRec({ ccy: "EUR", fxToUsd: 1.18, confirmed: true, total: 1000 })
    );
    // base = 10000×0.42×0.67 = 2814, comm = 1000×1.18 = 1180 → 3994
    expect(new Decimal(r.totalUsd).toDecimalPlaces(2).toNumber()).toBeCloseTo(3994, 1);
    expect(r.fxUnresolved).toBe(false);
  });

  // 11. Commission FX independent from container FX changes
  it("scenario 11: changing container FX does not shift cross-currency commission USD", () => {
    const comm = makeCommRec({ ccy: "EUR", fxToUsd: 1.18, confirmed: true, total: 1000 });
    const r1 = computeCorrectContainerCost(
      makeContainer({ containerCcy: "AUD", containerFxToUsd: 0.67, actualKg: 1000, ratePerKg: 1 }),
      [], comm
    );
    const r2 = computeCorrectContainerCost(
      makeContainer({ containerCcy: "AUD", containerFxToUsd: 0.72, actualKg: 1000, ratePerKg: 1 }),
      [], comm
    );
    // commUsd = 1000×1.18=1180 in both; only base changes
    const commUsd1 = new Decimal(r1.totalUsd).minus(1000 * 1 * 0.67);
    const commUsd2 = new Decimal(r2.totalUsd).minus(1000 * 1 * 0.72);
    expect(commUsd1.toDecimalPlaces(2).toNumber()).toBeCloseTo(1180, 1);
    expect(commUsd2.toDecimalPlaces(2).toNumber()).toBeCloseTo(1180, 1);
  });

  // 12. Same-currency commission still uses containerFx correctly
  it("scenario 12: same-ccy commission (EUR+EUR) still uses containerFx correctly", () => {
    const r = computeCorrectContainerCost(
      makeContainer({ containerCcy: "EUR", containerFxToUsd: 1.1, actualKg: 1000, ratePerKg: 2 }),
      [],
      makeCommRec({ ccy: "EUR", fxToUsd: 1.1, confirmed: true, total: 500 })
    );
    expect(r.fxUnresolved).toBe(false);
    // base = 1000×2×1.1=2200, comm = 500×1.1=550 → 2750
    expect(new Decimal(r.totalUsd).toDecimalPlaces(2).toNumber()).toBeCloseTo(2750, 1);
  });

  // 13. Idempotency — same inputs produce identical outputs
  it("scenario 13: idempotency — repeated calls with same inputs produce identical output", () => {
    const c = makeContainer({ containerCcy: "AUD", containerFxToUsd: 0.67, actualKg: 10000, ratePerKg: 0.42 });
    const comm = makeCommRec({ ccy: "EUR", fxToUsd: 1.18, confirmed: true, total: 1000 });
    const r1 = computeCorrectContainerCost(c, [], comm);
    const r2 = computeCorrectContainerCost(c, [], comm);
    expect(r1.totalUsd).toBe(r2.totalUsd);
    expect(r1.costPerKgUsd).toBe(r2.costPerKgUsd);
    expect(r1.fxUnresolved).toBe(false);
    expect(r2.fxUnresolved).toBe(false);
  });
});
