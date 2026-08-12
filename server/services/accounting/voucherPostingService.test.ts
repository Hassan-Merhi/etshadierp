import { describe, expect, it, vi } from "vitest";
import { insertVoucherWithEntries, insertVoucherWithEntriesTx } from "./voucherPostingService";

function makeTransaction() {
  const calls: unknown[] = [];
  const returning = vi
    .fn()
    .mockResolvedValueOnce([{ id: 91, voucherNumber: "JV-1" }])
    .mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
  const values = vi.fn((value: unknown) => {
    calls.push(value);
    return { returning };
  });
  const insert = vi.fn(() => ({ values }));
  return { tx: { insert }, calls, insert };
}

describe("voucherPostingService", () => {
  it("preserves voucher source metadata and batches entry insertion", async () => {
    const { tx, calls, insert } = makeTransaction();

    const result = await insertVoucherWithEntriesTx(
      tx,
      {
        companyId: 4,
        voucherNumber: "JV-1",
        voucherType: "Journal",
        voucherDate: "2026-07-19",
        totalAmount: "25.00",
        sourceModule: "ERP",
      },
      [
        { ledgerAccountId: 10, debitAmount: "25.00", creditAmount: "0" },
        { ledgerAccountId: 11, debitAmount: "0", creditAmount: "25.00" },
      ]
    );

    expect(result.voucher).toMatchObject({ id: 91 });
    expect(insert).toHaveBeenCalledTimes(2);
    expect(calls[0]).toMatchObject({ sourceModule: "ERP" });
    expect(calls[1]).toEqual([
      expect.objectContaining({ voucherId: 91, ledgerAccountId: 10 }),
      expect.objectContaining({ voucherId: 91, ledgerAccountId: 11 }),
    ]);
  });

  it("persists dual-currency linkage fields and returns without an entry insert for an empty voucher", async () => {
    const { tx, calls, insert } = makeTransaction();

    const result = await insertVoucherWithEntriesTx(
      tx,
      {
        companyId: 4,
        voucherNumber: "JV-2",
        voucherType: "Journal",
        voucherDate: "2026-07-20",
        totalAmount: "0",
        currency: "EUR",
        exchangeRate: "0.92",
        effectiveDate: "2026-07-19",
      },
      []
    );

    expect(result.entries).toEqual([]);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(calls[0]).toMatchObject({
      currency: "EUR",
      exchangeRate: "0.92",
      effectiveDate: "2026-07-19",
      description: null,
      optional: false,
    });
  });

  it("owns the transaction boundary in the database wrapper", async () => {
    const { tx } = makeTransaction();
    const transaction = vi.fn(async (callback) => callback(tx));

    const result = await insertVoucherWithEntries(
      { transaction },
      {
        companyId: 4,
        voucherNumber: "JV-3",
        voucherType: "Journal",
        voucherDate: "2026-07-21",
        totalAmount: "0",
      },
      []
    );

    expect(transaction).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ voucher: { id: 91 }, entries: [] });
  });

  it.each([undefined, { id: 0 }])("rejects an invalid persisted voucher result", async (voucher) => {
    const tx = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({ returning: vi.fn(async () => [voucher]) })),
      })),
    };

    await expect(
      insertVoucherWithEntriesTx(
        tx,
        {
          companyId: 4,
          voucherNumber: "JV-BAD",
          voucherType: "Journal",
          voucherDate: "2026-07-21",
          totalAmount: "0",
        },
        []
      )
    ).rejects.toThrow(/voucher/i);
  });
});
