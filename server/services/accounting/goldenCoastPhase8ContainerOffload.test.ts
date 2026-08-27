import { describe, expect, it } from "vitest";
import {
  GOLDEN_COAST_PHASE8_OFFLOAD_FIFO_SOURCE,
  GoldenCoastPhase8Error,
  buildGoldenCoastPhase8FundingPosting,
  buildGoldenCoastPhase8OffloadPosting,
  parseGoldenCoastPhase8ContainerInput,
  parseGoldenCoastPhase8OffloadInput,
  planGoldenCoastPhase8Funding,
  planGoldenCoastPhase8Offload,
  type GoldenCoastPhase8FundedContainerState,
} from "./goldenCoastPhase8ContainerOffload";

const accounts = {
  stockOtwAccountId: 10,
  stockInHandAccountId: 11,
  containerReserveAccountId: 12,
  hassanEquityAccountId: 13,
  hassanSavingsAccountId: 14,
};

function container() {
  return parseGoldenCoastPhase8ContainerInput({
    companyId: 7,
    body: {
      clientRequestId: "phase8-a",
      supplierName: "Fresh Start",
      containerNumber: "CNT-8",
      invoiceNumber: "FS-8",
      invoiceDate: "2026-09-05",
      reserveUsd: "22300",
      fundingAccount: { kind: "ledger", id: 99 },
      lines: [{ stockItemId: 1, articleCode: "BAG", description: "Bag", qty: "2000", unitRateUsd: "22" }],
    },
  });
}

function funded(): GoldenCoastPhase8FundedContainerState {
  const c = container();
  return {
    containerId: 20,
    companyId: 7,
    fundingVoucherId: 30,
    goodsCostUsd: "44000.00",
    reserveUsd: "22300.00",
    fundingAccount: c.fundingAccount,
    lines: c.lines,
  };
}

describe("Golden Coast Phase 8 container/offload accounting", () => {
  it("plans the 44k container plus 22.3k real reserve", () => {
    const c = container();
    const plan = planGoldenCoastPhase8Funding(c);
    expect(plan.goodsCostUsd).toBe("44000.00");
    expect(plan.reserveUsd).toBe("22300.00");
    expect(plan.totalFundingUsd).toBe("66300.00");
    const posting = buildGoldenCoastPhase8FundingPosting({ container: c, plan, accounts });
    expect(posting.entries.map((entry) => [entry.debitAmount, entry.creditAmount])).toEqual([
      ["44000", "0"],
      ["22300", "0"],
      ["0", "66300"],
    ]);
  });

  it("capitalizes actual duty and transport and moves the unused 1600 to Hassan Savings", () => {
    const offload = parseGoldenCoastPhase8OffloadInput({
      companyId: 7,
      body: {
        clientRequestId: "phase8-offload-a",
        containerId: 20,
        locationId: 5,
        offloadDate: "2026-09-06",
        charges: [
          { chargeType: "duty", amountUsd: "8500" },
          { chargeType: "transport", amountUsd: "12200" },
        ],
      },
    });
    const plan = planGoldenCoastPhase8Offload({ offload, funded: funded() });
    expect(plan.actualChargesUsd).toBe("20700.00");
    expect(plan.unusedReserveUsd).toBe("1600.00");
    expect(plan.totalFinalCostUsd).toBe("64700.00");
    expect(plan.lines[0].finalUnitCostUsd).toBe("32.350000");
    const posting = buildGoldenCoastPhase8OffloadPosting({ offload, funded: funded(), plan, accounts });
    const debit = posting.entries.reduce((sum, entry) => sum + Number(entry.debitAmount), 0);
    const credit = posting.entries.reduce((sum, entry) => sum + Number(entry.creditAmount), 0);
    expect(debit).toBe(67900);
    expect(credit).toBe(67900);
  });

  it("rejects actual charges above the funded reserve", () => {
    const offload = parseGoldenCoastPhase8OffloadInput({
      companyId: 7,
      body: {
        clientRequestId: "phase8-over",
        containerId: 20,
        locationId: 5,
        offloadDate: "2026-09-06",
        charges: [{ chargeType: "duty", amountUsd: "22300.01" }],
      },
    });
    expect(() => planGoldenCoastPhase8Offload({ offload, funded: funded() })).toThrowError(GoldenCoastPhase8Error);
  });

  it("rejects pre-cutover container dates", () => {
    expect(() =>
      parseGoldenCoastPhase8ContainerInput({
        companyId: 7,
        body: {
          clientRequestId: "bad-date",
          supplierName: "Fresh Start",
          invoiceNumber: "x",
          invoiceDate: "2026-08-31",
          reserveUsd: "0",
          fundingAccount: { kind: "ledger", id: 99 },
          lines: [{ stockItemId: 1, articleCode: "BAG", qty: "1", unitRateUsd: "22" }],
        },
      })
    ).toThrow(/cutover/i);
  });

  it("uses a distinct FIFO provenance for post-cutover offloads", () => {
    expect(GOLDEN_COAST_PHASE8_OFFLOAD_FIFO_SOURCE).toBe("golden_coast_phase8_offload");
  });
});
