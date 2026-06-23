import { useQuery } from "@tanstack/react-query";
import type { BankAccount } from "./voucherTypes";

interface UseAccountBalanceProps {
  paymentAccountType: string;
  paymentAccountId: number;
  bankAccounts: BankAccount[];
  selectedAccountOpeningBalance?: string;
}

export function useAccountBalance({
  paymentAccountType,
  paymentAccountId,
  bankAccounts,
  selectedAccountOpeningBalance,
}: UseAccountBalanceProps) {
  const { data: accountBalance = 0 } = useQuery({
    queryKey: ["/api/accounts", paymentAccountType, paymentAccountId, "balance"],
    enabled: paymentAccountId > 0,
    queryFn: async () => {
      if (paymentAccountType === "bank") {
        const account = bankAccounts.find((b) => b.id === paymentAccountId);
        return account ? parseFloat(account.balance || "0") : 0;
      } else if (paymentAccountType === "ledger") {
        const accountRes = await fetch(`/api/ledger-accounts/${paymentAccountId}`);
        const account = await accountRes.json();
        const transRes = await fetch(`/api/accounts/ledger/${paymentAccountId}/transactions`);
        const transactions = await transRes.json();
        let openingBalance = parseFloat(account.openingBalance || "0");
        if (account.openingBalanceSide === "Cr") openingBalance = -openingBalance;
        return transactions.reduce((sum: number, t: any) => {
          return sum + parseFloat(t.debitAmount || "0") - parseFloat(t.creditAmount || "0");
        }, openingBalance);
      } else if (paymentAccountType === "supplier") {
        const supplierRes = await fetch(`/api/suppliers/${paymentAccountId}`);
        const supplier = await supplierRes.json();
        const transRes = await fetch(`/api/accounts/supplier/${paymentAccountId}/transactions`);
        const transactions = await transRes.json();
        const openingBalance = parseFloat(supplier.openingBalance || "0");
        return transactions.reduce((sum: number, t: any) => {
          return sum + parseFloat(t.creditAmount || "0") - parseFloat(t.debitAmount || "0");
        }, openingBalance);
      } else if (paymentAccountType === "employee") {
        const openingBalance = parseFloat(selectedAccountOpeningBalance || "0");
        const transRes = await fetch(`/api/accounts/employee/${paymentAccountId}/transactions`);
        const transactions = await transRes.json();
        return transactions.reduce((sum: number, t: any) => {
          return sum + parseFloat(t.creditAmount || "0") - parseFloat(t.debitAmount || "0");
        }, openingBalance);
      } else if (paymentAccountType === "fixedAsset") {
        const openingBalance = parseFloat(selectedAccountOpeningBalance || "0");
        const transRes = await fetch(`/api/accounts/fixed-asset/${paymentAccountId}/transactions`);
        const transactions = await transRes.json();
        return transactions.reduce((sum: number, t: any) => {
          return sum + parseFloat(t.debitAmount || "0") - parseFloat(t.creditAmount || "0");
        }, openingBalance);
      } else if (paymentAccountType === "customer") {
        const customerRes = await fetch(`/api/customers/${paymentAccountId}`);
        const customer = await customerRes.json();
        const transRes = await fetch(`/api/accounts/customer/${paymentAccountId}/transactions`);
        const transactions = await transRes.json();
        const openingBalance = parseFloat(customer.openingBalance || "0");
        return transactions.reduce((sum: number, t: any) => {
          return sum + parseFloat(t.debitAmount || "0") - parseFloat(t.creditAmount || "0");
        }, openingBalance);
      } else if (paymentAccountType === "factorySupplier") {
        const res = await fetch(`/api/factory/suppliers/${paymentAccountId}/balance`);
        const data = await res.json();
        return parseFloat(data.outstandingUsd || "0");
      }
      return 0;
    },
  });

  const { data: accountCurrencyBalances } = useQuery<{ currency: string; balance: number }[] | null>({
    queryKey: ["/api/accounts", paymentAccountType, paymentAccountId, "currencyBalances"],
    enabled: paymentAccountId > 0 && (paymentAccountType === "supplier" || paymentAccountType === "factorySupplier"),
    queryFn: async () => {
      if (paymentAccountType === "supplier") {
        const [supplierRes, transRes] = await Promise.all([
          fetch(`/api/suppliers/${paymentAccountId}`, { credentials: "include" }),
          fetch(`/api/accounts/supplier/${paymentAccountId}/transactions`, { credentials: "include" }),
        ]);
        const supplier = await supplierRes.json();
        const transactions: any[] = await transRes.json();
        const openingBalance = parseFloat(supplier.openingBalance || "0");
        const currMap = new Map<string, number>();
        transactions.forEach((t) => {
          const curr = t.currency || "USD";
          currMap.set(curr, (currMap.get(curr) ?? 0) + parseFloat(t.creditAmount || "0") - parseFloat(t.debitAmount || "0"));
        });
        currMap.set("USD", (currMap.get("USD") ?? 0) + openingBalance);
        const result = Array.from(currMap.entries())
          .map(([currency, balance]) => ({ currency, balance }))
          .filter((r) => Math.abs(r.balance) >= 0.005);
        const hasNonUsd = result.some((r) => r.currency !== "USD");
        return hasNonUsd ? result : null;
      } else if (paymentAccountType === "factorySupplier") {
        const res = await fetch(`/api/factory/suppliers/${paymentAccountId}/broker-statement`, { credentials: "include" });
        if (!res.ok) return null;
        const data = await res.json();
        const ledgers: any[] = data.currencyLedgers || [];
        if (ledgers.length <= 1) return null;
        return ledgers
          .map((section: any) => ({
            currency: section.currencyCode,
            balance: parseFloat(section.netBalance || "0"),
          }))
          .filter((r) => Math.abs(r.balance) >= 0.005);
      }
      return null;
    },
  });

  return { accountBalance, accountCurrencyBalances };
}
