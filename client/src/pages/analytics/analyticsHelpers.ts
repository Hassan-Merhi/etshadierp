import { Account } from "./analyticsTypes";

export const parseBalance = (balance: number | string): number => {
  if (typeof balance === "string") {
    return parseFloat(balance) || 0;
  }
  return balance || 0;
};

export const calculateChildrenTotal = (parentAccountId: number, accountMap: Map<number, Account[]>) => {
  const children = accountMap.get(parentAccountId) || [];
  return children.reduce((sum, acc) => sum + parseBalance(acc.balance), 0);
};

export const signedBalance = (acc: Account) =>
  acc.balanceSide === "Cr" ? parseBalance(acc.balance) : -parseBalance(acc.balance);

export const calculateTotal = (accountList: Account[]) => {
  const accountIds = new Set(accountList.map((acc) => acc.accountId));
  const parentAccountIds = new Set(accountList.filter((acc) => acc.parentId).map((acc) => acc.parentId!));

  let total = 0;
  accountList.forEach((acc) => {
    const hasChildrenInList = parentAccountIds.has(acc.accountId);
    const isChildOfParentInList = acc.parentId && accountIds.has(acc.parentId);

    if (hasChildrenInList) {
      const children = accountList.filter((child) => child.parentId === acc.accountId);
      total += children.reduce((sum, child) => sum + signedBalance(child), 0);
    } else if (!isChildOfParentInList) {
      total += signedBalance(acc);
    }
  });
  return total;
};

export const groupAccountsByParent = (accountList: Account[]) => {
  const accountIdsInList = new Set(accountList.map((acc) => acc.accountId));
  const parentAccounts: Account[] = [];
  const childAccounts: Account[] = [];

  accountList.forEach((acc) => {
    if (!acc.parentId || !accountIdsInList.has(acc.parentId)) {
      parentAccounts.push(acc);
    } else {
      childAccounts.push(acc);
    }
  });

  const accountMap = new Map<number, Account[]>();
  childAccounts.forEach((child) => {
    const parentId = child.parentId!;
    if (!accountMap.has(parentId)) {
      accountMap.set(parentId, []);
    }
    accountMap.get(parentId)!.push(child);
  });

  return { parentAccounts, accountMap };
};

export const formatSmartCurrency = (value: number): string => {
  const absValue = Math.abs(value);
  const isWholeNumber = absValue % 1 === 0;
  if (isWholeNumber) {
    return "$" + absValue.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  return "$" + absValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const goToStatement = (accountId: number, appMode: string, customerId?: number, accountType?: string) => {
  if (customerId && appMode === "factory") {
    window.open(`/factory/customers/${customerId}`, "_blank");
    return;
  }
  const basePath = appMode === "factory" ? "/factory" : "";
  window.open(`${basePath}/ledger-monthly/${accountId}`, "_blank");
};
