export interface BalanceSheetAccount {
  id: string;
  accountId: number;
  type: string;
  code: string;
  name: string;
  accountType?: string;
  subType?: string;
  balance: number;
  balanceSide: string | null;
  active: boolean;
}

export type BalanceSheetSectionKey = "assets" | "liabilities" | "equity";

export interface BalanceSheetGroups {
  assets: BalanceSheetAccount[];
  liabilities: BalanceSheetAccount[];
  equity: BalanceSheetAccount[];
}

export function calculateBalanceSheetTotal(
  accounts: BalanceSheetAccount[],
  naturalSide: "Dr" | "Cr" = "Dr",
): number {
  return accounts.reduce((sum, account) => {
    const amount = account.balanceSide === naturalSide ? account.balance : -account.balance;
    return sum + amount;
  }, 0);
}

export function groupBalanceSheetAccounts(accounts: BalanceSheetAccount[]): BalanceSheetGroups {
  const groups: BalanceSheetGroups = { assets: [], liabilities: [], equity: [] };

  for (const account of accounts) {
    if (
      account.type === "fixedAsset" ||
      account.type === "bank" ||
      (account.type === "ledger" && account.accountType === "Asset")
    ) {
      groups.assets.push(account);
    }

    if (account.type === "supplier" || (account.type === "ledger" && account.accountType === "Liability")) {
      groups.liabilities.push(account);
    }

    if (account.type === "ledger" && account.accountType === "Equity") {
      groups.equity.push(account);
    }
  }

  return groups;
}
