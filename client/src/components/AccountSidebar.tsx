import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  highlightedIndex: number;
  onHighlightedIndexChange: (index: number) => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  mostUsedAccounts?: Account[];
}

export default function AccountSidebar({
  accounts,
  onSelectAccount,
  searchValue,
  onSearchChange,
  selectedAccountId,
  highlightedIndex,
  onHighlightedIndexChange,
  activeTab,
  onTabChange,
  mostUsedAccounts = [],
}: AccountSidebarProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter accounts by active tab
  const filteredAccounts = accounts
    .filter((acc) => {
      if (activeTab === "quick" && mostUsedAccounts.length > 0) {
        return mostUsedAccounts.some(ma => ma.id === acc.id && ma.type === acc.type);
      }
      return acc.type === activeTab;
    })
    .filter((acc) =>
      acc.name.toLowerCase().includes(searchValue.toLowerCase()) ||
      acc.code.toLowerCase().includes(searchValue.toLowerCase())
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  // Reset highlighted index when filtered accounts change
  useEffect(() => {
    onHighlightedIndexChange(0);
  }, [searchValue, activeTab]);

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
      <div className="p-4 border-b space-y-3">
        <h3 className="text-sm font-semibold">Select Account</h3>
        
        <Tabs value={activeTab} onValueChange={onTabChange}>
          <TabsList className="grid w-full grid-cols-3">
            {mostUsedAccounts.length > 0 && (
              <TabsTrigger value="quick" className="text-xs" data-testid="tab-quick">
                Quick
              </TabsTrigger>
            )}
            <TabsTrigger value="bank" className="text-xs" data-testid="tab-bank">
              Bank
            </TabsTrigger>
            <TabsTrigger value="ledger" className="text-xs" data-testid="tab-ledger">
              Ledger
            </TabsTrigger>
          </TabsList>
          <TabsList className="grid w-full grid-cols-3 mt-2">
            <TabsTrigger value="supplier" className="text-xs" data-testid="tab-supplier">
              Suppliers
            </TabsTrigger>
            <TabsTrigger value="employee" className="text-xs" data-testid="tab-employee">
              Employees
            </TabsTrigger>
            <TabsTrigger value="fixedAsset" className="text-xs" data-testid="tab-fixedAsset">
              Assets
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            placeholder="Search by name or code..."
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
            data-testid="input-search-account"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2" ref={listRef}>
        <div className="space-y-1">
          {filteredAccounts.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No accounts found
            </div>
          ) : (
            filteredAccounts.map((account, idx) => {
              const isSelected = account.id === selectedAccountId && account.type === activeTab;
              const isHighlighted = idx === highlightedIndex;
              const showNumberBadge = activeTab === "quick" && idx < 9;
              
              return (
                <button
                  key={`${account.type}-${account.id}`}
                  data-index={idx}
                  onClick={() => onSelectAccount(account)}
                  className={`w-full text-left px-3 py-3 rounded-md hover-elevate active-elevate-2 ${
                    isSelected ? "ring-2 ring-primary" : ""
                  } ${isHighlighted ? "bg-accent" : ""}`}
                  data-testid={`account-${idx}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {showNumberBadge && (
                          <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-medium bg-primary/20 text-primary rounded">
                            {idx + 1}
                          </span>
                        )}
                        <div className="text-sm font-medium">{account.name}</div>
                      </div>
                      <div className="text-xs text-muted-foreground font-mono mt-1">
                        {account.code}
                      </div>
                    </div>
                    <div className={`text-sm font-mono font-medium ${getBalanceColorClass(account.balance)}`}>
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
