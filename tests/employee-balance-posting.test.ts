import { describe, expect, it } from "vitest";
import { collectEmployeeBalanceDeltas } from "../server/services/accounting/employeeBalancePosting";

describe("collectEmployeeBalanceDeltas", () => {
  it("preserves the legacy direct employee debit and credit formulas", () => {
    const deltas = collectEmployeeBalanceDeltas({
      entries: [
        { employeeId: 10, debitAmount: "25", creditAmount: "0" },
        { employeeId: 10, debitAmount: "0", creditAmount: "100" },
      ],
    });

    expect(deltas.byEmployeeId.get(10)).toEqual({
      balanceChange: "75.00",
      deposits: "100.00",
      withdrawals: "25.00",
    });
  });

  it("produces the exact inverse delta for update and deletion reversal", () => {
    const deltas = collectEmployeeBalanceDeltas({
      entries: [
        { employeeId: 10, debitAmount: "25", creditAmount: "0" },
        { employeeId: 10, debitAmount: "0", creditAmount: "100" },
      ],
      direction: "reverse",
    });

    expect(deltas.byEmployeeId.get(10)).toEqual({
      balanceChange: "-75.00",
      deposits: "-100.00",
      withdrawals: "-25.00",
    });
  });

  it("maps EMP ledger entries to the employee code when no direct employeeId exists", () => {
    const deltas = collectEmployeeBalanceDeltas({
      entries: [
        { ledgerAccountId: 50, debitAmount: "10", creditAmount: "0" },
        { ledgerAccountId: 50, debitAmount: "0", creditAmount: "30" },
      ],
      employeeCodeByLedgerId: new Map([[50, "EMP001"]]),
    });

    expect(deltas.byEmployeeCode.get("EMP001")).toEqual({
      balanceChange: "20.00",
      deposits: "30.00",
      withdrawals: "10.00",
    });
  });

  it("reverses EMP ledger totals without swapping deposit and withdrawal history", () => {
    const deltas = collectEmployeeBalanceDeltas({
      entries: [
        { ledgerAccountId: 50, debitAmount: "10", creditAmount: "0" },
        { ledgerAccountId: 50, debitAmount: "0", creditAmount: "30" },
      ],
      employeeCodeByLedgerId: new Map([[50, "EMP001"]]),
      direction: "reverse",
    });

    expect(deltas.byEmployeeCode.get("EMP001")).toEqual({
      balanceChange: "-20.00",
      deposits: "-30.00",
      withdrawals: "-10.00",
    });
  });

  it("gives direct employeeId precedence over ledger mapping", () => {
    const deltas = collectEmployeeBalanceDeltas({
      entries: [
        {
          employeeId: 10,
          ledgerAccountId: 50,
          debitAmount: "0",
          creditAmount: "40",
        },
      ],
      employeeCodeByLedgerId: new Map([[50, "EMP001"]]),
    });

    expect(deltas.byEmployeeId.get(10)?.balanceChange).toBe("40.00");
    expect(deltas.byEmployeeCode.size).toBe(0);
  });

  it("ignores ordinary ledger entries", () => {
    const deltas = collectEmployeeBalanceDeltas({
      entries: [{ ledgerAccountId: 99, debitAmount: "50", creditAmount: "0" }],
      employeeCodeByLedgerId: new Map(),
    });

    expect(deltas.byEmployeeId.size).toBe(0);
    expect(deltas.byEmployeeCode.size).toBe(0);
  });
});
