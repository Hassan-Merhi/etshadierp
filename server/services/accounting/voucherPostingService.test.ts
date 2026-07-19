import { describe, expect, it, vi } from "vitest";
import { insertVoucherWithEntriesTx } from "./voucherPostingService";

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
      ],
    );

    expect(result.voucher).toMatchObject({ id: 91 });
    expect(insert).toHaveBeenCalledTimes(2);
    expect(calls[0]).toMatchObject({ sourceModule: "ERP" });
    expect(calls[1]).toEqual([
      expect.objectContaining({ voucherId: 91, ledgerAccountId: 10 }),
      expect.objectContaining({ voucherId: 91, ledgerAccountId: 11 }),
    ]);
  });
});
