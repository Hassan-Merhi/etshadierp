import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export interface Account {
  id: number;
  type: "bank" | "ledger" | "supplier" | "employee" | "fixedAsset";
  name: string;
  code: string;
  balance?: number;
}

interface AccountSidebarProps {
  accounts: Account[];
  onSelectAccount: (account: Account) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  selectedAccountId: number | null;
  selectedAccountType: string | null;
  highlightedIndex: number;
  onHighlightedIndexChange: (index: number) => void;
  // Removed: activeTab, onTabChange, mostUsedAccounts - no longer needed without tabs
}

export default function AccountSidebar({
  accounts,
  onSelectAccount,
  searchValue,
  onSearchChange,
  selectedAccountId,
  selectedAccountType,
  highlightedIndex,
  onHighlightedIndexChange,
}: AccountSidebarProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter and sort all accounts alphabetically by name
  const filteredAccounts = accounts
    .filter((acc) =>
      acc.name.toLowerCase().includes(searchValue.toLowerCase()) ||
      acc.code.toLowerCase().includes(searchValue.toLowerCase())
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  // Clamp highlighted index to filtered list length when list changes
  useEffect(() => {
    const maxIndex = Math.max(0, filteredAccounts.length - 1);
    if (highlightedIndex > maxIndex) {
      onHighlightedIndexChange(Math.min(highlightedIndex, maxIndex));
    } else {
      onHighlightedIndexChange(0);
    }
  }, [searchValue, filteredAccounts.length]);

  // Scroll highlighted item into view
  useEffect(() => {
    const highlightedElement = listRef.current?.querySelector(`[data-index="${highlightedIndex}"]`);
    if (highlightedElement) {
      highlightedElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [highlightedIndex]);

  const formatBalance = (balance: number | undefined) => {
    if (balance === undefined) return "—";
    const absBalance = Math.abs(balance);
    const formatted = absBalance.toFixed(2);
    return balance < 0 ? `($${formatted})` : `$${formatted}`;
  };

  const getBalanceColorClass = (balance: number | undefined) => {
    if (balance === undefined) return "text-muted-foreground";
    if (balance < 0) return "text-destructive";
    if (balance > 0) return "text-chart-2";
    return "text-muted-foreground";
  };

  return (
    <Card className="flex flex-col h-full">
      <div className="p-3 border-b">
        <h3 className="text-sm font-semibold mb-3">Select Account</h3>
        
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

      <div className="flex-1 overflow-y-auto p-2" ref={listRef}>
        <div className="space-y-0.5">
          {filteredAccounts.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No accounts found
            </div>
          ) : (
            filteredAccounts.map((account, idx) => {
              const isSelected = account.id === selectedAccountId && account.type === selectedAccountType;
              const isHighlighted = idx === highlightedIndex;
              
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
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{account.name}</div>
                    </div>
                    <div className={`text-sm font-mono font-medium flex-shrink-0 ${getBalanceColorClass(account.balance)}`}>
                      {formatBalance(account.balance)}
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
