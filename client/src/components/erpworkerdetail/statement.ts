import type { SalaryAdvance, Transaction } from "./types";

export interface LedgerRow {
  date: string;
  type: string;
  ref: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  status?: string;
}

export function buildERPWorkerStatementRows({
  advances,
  joinDate,
  openingBalance,
  transactions,
}: {
  advances: SalaryAdvance[];
  joinDate?: string | null;
  openingBalance: number;
  transactions: Transaction[];
}): LedgerRow[] {
  const rows: Omit<LedgerRow, "balance">[] = [];

  if (openingBalance !== 0) {
    rows.push({
      date: joinDate?.slice(0, 10) || "—",
      type: "Opening Balance",
      ref: "—",
      description: "Opening balance",
      debit: openingBalance > 0 ? openingBalance : 0,
      credit: openingBalance < 0 ? Math.abs(openingBalance) : 0,
    });
  }

  for (const transaction of transactions) {
    const credit = parseFloat(transaction.creditAmount || "0");
    const debit = parseFloat(transaction.debitAmount || "0");
    rows.push({
      date: transaction.voucherDate?.slice(0, 10) || "—",
      type: transaction.voucherType || "Entry",
      ref: transaction.voucherNumber || `#${transaction.voucherId || transaction.id}`,
      description: transaction.voucherDescription || transaction.narration || "",
      debit: credit,
      credit: debit,
    });
  }

  for (const advance of advances) {
    rows.push({
      date: advance.advanceDate?.slice(0, 10) || "—",
      type: "Advance",
      ref: `ADV-${advance.id}`,
      description: advance.notes || "Salary advance",
      debit: 0,
      credit: parseFloat(advance.amount || "0"),
      status: advance.fullyPaid ? "Repaid" : "Outstanding",
    });
  }

  rows.sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));

  let running = 0;
  return rows.map((row) => {
    running += row.debit - row.credit;
    return { ...row, balance: running };
  });
}
