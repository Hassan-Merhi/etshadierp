import { describe, expect, it } from "vitest";

import type { SalaryAdvance, Transaction } from "./types";
import { buildERPWorkerStatementRows } from "./statement";

describe("buildERPWorkerStatementRows", () => {
  it("preserves chronological ordering, column direction and running balances", () => {
    const transactions = [
      {
        id: 7,
        voucherDate: "2026-02-03T12:00:00.000Z",
        voucherType: "Payment",
        voucherNumber: "PAY-7",
        voucherDescription: "Salary earned",
        creditAmount: "50",
        debitAmount: "10",
      },
    ] as Transaction[];
    const advances = [
      {
        id: 8,
        advanceDate: "2026-02-02T00:00:00.000Z",
        amount: "25",
        remainingBalance: "25",
        fullyPaid: false,
        notes: "Travel advance",
      },
    ] as SalaryAdvance[];

    expect(
      buildERPWorkerStatementRows({
        advances,
        joinDate: "2026-02-01T00:00:00.000Z",
        openingBalance: 100,
        transactions,
      })
    ).toEqual([
      {
        balance: 100,
        credit: 0,
        date: "2026-02-01",
        debit: 100,
        description: "Opening balance",
        ref: "—",
        type: "Opening Balance",
      },
      {
        balance: 75,
        credit: 25,
        date: "2026-02-02",
        debit: 0,
        description: "Travel advance",
        ref: "ADV-8",
        status: "Outstanding",
        type: "Advance",
      },
      {
        balance: 115,
        credit: 10,
        date: "2026-02-03",
        debit: 50,
        description: "Salary earned",
        ref: "PAY-7",
        type: "Payment",
      },
    ]);
  });
});
