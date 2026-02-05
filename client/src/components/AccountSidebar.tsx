import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus } from "lucide-react";
import { formatNumber } from "@/lib/formatNumber";
import { useCurrencyContext } from "@/contexts/CurrencyContext";

export interface Account {
  id: number;
  type: "bank" | "ledger" | "supplier" | "employee" | "fixedAsset";
  name: string;
  code: string;
  balance?: number;
}

export interface VoucherEntry {
  accountType: string;
  accountId: number;
  accountName: string;
  amount: string;
}

interface AccountSidebarProps {
  accounts: Account[];
  filteredAccounts: Account[];
  onSelectAccount: (account: Account) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  selectedAccountId: number | null;
  selectedAccountType: string | null;
  highlightedIndex: number;
  onHighlightedIndexChange: (index: number) => void;
  entries?: VoucherEntry[];
  mode?: "payment" | "receipt";
  paymentAccountId?: number;
  paymentAccountType?: string;
  voucherTotal?: number;
  onCreateAccount?: () => void;
}

export default function AccountSidebar({
  accounts,
  filteredAccounts,
  onSelectAccount,
  searchValue,
  onSearchChange,
  selectedAccountId,
  selectedAccountType,
  highlightedIndex,
  onHighlightedIndexChange,
  entries = [],
  mode = "payment",
  paymentAccountId = 0,
  paymentAccountType = "",
  voucherTotal = 0,
  onCreateAccount,
}: AccountSidebarProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { formatAmount } = useCurrencyContext();

  // Calculate projected balances based on voucher entries
  const getProjectedBalance = (account: Account): number => {
    const currentBalance = account.balance ?? 0;
    let adjustment = 0;

    const isPaymentAccount =
      account.id === paymentAccountId && account.type === paymentAccountType;

    // Check if this is the payment/receipt account
    if (isPaymentAccount && voucherTotal > 0) {
      // For payment vouchers, the payment account balance decreases
      // For receipt vouchers, the receipt account balance increases
      adjustment = mode === "payment" ? -voucherTotal : voucherTotal;
    }

    // For non-payment accounts, check if they appear in the entries
    if (!isPaymentAccount) {
      const entryAmount = entries
        .filter(
          (entry) =>
            entry.accountId === account.id &&
            entry.accountType === account.type &&
            entry.amount &&
            !isNaN(Number(entry.amount)),
        )
        .reduce((sum, entry) => sum + Number(entry.amount), 0);

      // Entry amounts affect balance differently based on account type:
      // - For liability accounts (employee, supplier): Payment DECREASES balance (we're paying off what we owe)
      // - For asset/expense accounts: Payment INCREASES balance (we're spending/acquiring)
      // The inverse is true for receipts
      const isLiabilityAccount =
        account.type === "employee" || account.type === "supplier";
      if (entryAmount > 0) {
        if (isLiabilityAccount) {
          // Liability: Payment reduces balance (debit), Receipt increases balance (credit)
          adjustment += mode === "payment" ? entryAmount : -entryAmount;
        } else {
          // Asset/Expense: Payment increases balance (debit), Receipt reduces balance (credit)
          adjustment += mode === "payment" ? entryAmount : -entryAmount;
        }
      }
    }

    return currentBalance + adjustment;
  };

  // Scroll highlighted item into view
  useEffect(() => {
    const highlightedElement = listRef.current?.querySelector(
      `[data-index="${highlightedIndex}"]`,
    );
    if (highlightedElement) {
      highlightedElement.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [highlightedIndex]);

  const formatBalance = (balance: number | undefined) => {
    if (balance === undefined) return "—";
    const absBalance = Math.abs(balance);
    const formatted = formatAmount(absBalance);
    return balance < 0 ? `(${formatted})` : formatted;
  };

  const getBalanceColorClass = (
    balance: number | undefined,
    accountType?: string,
  ) => {
    if (balance === undefined) return "text-muted-foreground";
    // For liability accounts (employee/supplier), flip the color logic:
    // Positive balance = Cr (we owe them) = Red
    // Negative balance = Dr (they owe us) = Green
    const isLiabilityAccount =
      accountType === "employee" || accountType === "supplier";
    if (isLiabilityAccount) {
      // your suppliers come as negative when it's Cr (we owe them)
      if (balance < 0) return "text-destructive"; // Cr => red
      if (balance > 0) return "text-chart-2"; // Dr => green
    } else {
      if (balance < 0) return "text-destructive";
      if (balance > 0) return "text-chart-2";
    }
    return "text-muted-foreground";
  };

  return (
    <Card className="flex flex-col h-full">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold">Select Account</h3>
          {onCreateAccount && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCreateAccount}
              data-testid="button-create-new-account"
            >
              <Plus className="h-4 w-4 mr-1" />
              New
            </Button>
          )}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            placeholder="Search accounts..."
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
            data-testid="input-search-account"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3" ref={listRef}>
        <div className="space-y-1">
          {filteredAccounts.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No accounts found
            </div>
          ) : (
            filteredAccounts.map((account, idx) => {
              const isSelected =
                account.id === selectedAccountId &&
                account.type === selectedAccountType;
              const isHighlighted = idx === highlightedIndex;
              const projectedBalance = getProjectedBalance(account);
              const hasProjection = projectedBalance !== (account.balance ?? 0);

              return (
                <button
                  key={`${account.type}-${account.id}`}
                  data-index={idx}
                  onClick={() => onSelectAccount(account)}
                  className={`w-full text-left px-3 py-2.5 rounded-md hover-elevate active-elevate-2 transition-colors ${
                    isSelected ? "ring-2 ring-primary" : ""
                  } ${isHighlighted ? "bg-accent" : ""}`}
                  data-testid={`account-${idx}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {account.name ||
                          account.code ||
                          `${account.type}-${account.id}`}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      {hasProjection && (
                        <div className="text-xs text-muted-foreground font-mono line-through">
                          {formatBalance(account.balance)}
                        </div>
                      )}
                      <div
                        className={`text-sm font-mono font-semibold flex-shrink-0 ${getBalanceColorClass(projectedBalance, account.type)}`}
                      >
                        {formatBalance(projectedBalance)}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </Card>
  );
}
