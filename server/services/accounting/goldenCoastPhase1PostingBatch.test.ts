import { describe, expect, it } from "vitest";

import { buildGoldenCoastPhase1PostingBatch } from "./goldenCoastPhase1PostingBatch";

const ledger = (id: number) => ({ kind: "ledger" as const, id });
const bank = (id: number) => ({ kind: "bank" as const, id });

describe("Golden Coast Phase 1 posting batch", () => {
  it("splits the 30-bag sale into an $1,800 Sales voucher and $660 COGS journal", () => {
    const batch = buildGoldenCoastPhase1PostingBatch({
      companyId: 7,
      clientRequestId: "gc-sale-c-001",
      voucherNumber: "GC-SALE-C-001",
      voucherDate: "2026-08-26",
      exchangeRate: null,
      event: {
        type: "location_sale",
        quantity: 30,
        salePricePerUnitUsd: 60,
        inventoryCostPerUnitUsd: 22,
        locationId: 3,
        cashOrReceivableAccount: bank(1),
        salesRevenueAccount: ledger(401),
        cogsAccount: ledger(501),
        inventoryAccount: ledger(202),
      },
    });

    expect(batch.postings).toHaveLength(2);
    expect(batch.postings[0].role).toBe("primary");
    expect(batch.postings[0].request.voucher.totalAmount).toBe("1800.00");
    expect(batch.postings[0].request.voucher.voucherType).toBe("Sales");
    expect(batch.postings[1].role).toBe("cogs");
    expect(batch.postings[1].request.voucher.totalAmount).toBe("660.00");
    expect(batch.postings[1].request.voucher.voucherType).toBe("Journal");
    expect(batch.postings[0].request.source.idempotencyKey).not.toBe(
      batch.postings[1].request.source.idempotencyKey,
    );
  });
});
