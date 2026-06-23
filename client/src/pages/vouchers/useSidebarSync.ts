import { useMemo, useEffect } from "react";
import type { Account } from "@/components/AccountSidebar";
import type { CombinedAccount } from "@/components/AccountAutocomplete";

interface UseSidebarSyncProps {
  sidebarAccounts: Account[];
  sidebarSearchValue: string;
  paymentAccountId: number;
  paymentAccountType: string;
  sidebarHighlightedIndex: number;
  setSidebarHighlightedIndex: (i: number) => void;
  entries: any[];
  activeRowIndex: number | null;
  allAccounts: CombinedAccount[];
}

export function useSidebarSync({
  sidebarAccounts,
  sidebarSearchValue,
  paymentAccountId,
  paymentAccountType,
  sidebarHighlightedIndex,
  setSidebarHighlightedIndex,
  entries,
  activeRowIndex,
  allAccounts,
}: UseSidebarSyncProps) {
  const filteredSidebarAccounts = useMemo(() => {
    const searchLower = sidebarSearchValue.toLowerCase().trim();
    return sidebarAccounts
      .filter((acc) => {
        if (acc.type === "customer") return false;
        if (paymentAccountId > 0 && acc.id === paymentAccountId && acc.type === paymentAccountType) {
          return false;
        }
        if (acc.type === "employee" && !searchLower) return false;
        return (
          (acc.name || "").toLowerCase().includes(searchLower) || (acc.code || "").toLowerCase().includes(searchLower)
        );
      })
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [sidebarAccounts, sidebarSearchValue, paymentAccountId, paymentAccountType]);

  const activeRowAccountId =
    activeRowIndex !== null && entries[activeRowIndex] ? entries[activeRowIndex].accountId : null;
  const activeRowAccountType =
    activeRowIndex !== null && entries[activeRowIndex] ? entries[activeRowIndex].accountType : null;

  useEffect(() => {
    if (filteredSidebarAccounts.length === 0) {
      setSidebarHighlightedIndex(-1);
      return;
    }
    if (activeRowAccountId && activeRowAccountType) {
      const accountIndex = filteredSidebarAccounts.findIndex(
        (acc) => acc.id === activeRowAccountId && acc.type === activeRowAccountType
      );
      if (accountIndex >= 0) {
        setSidebarHighlightedIndex(accountIndex);
        return;
      }
    }
    setSidebarHighlightedIndex(0);
  }, [sidebarSearchValue, activeRowIndex, activeRowAccountId, activeRowAccountType]);

  useEffect(() => {
    if (filteredSidebarAccounts.length === 0) return;
    const maxIndex = filteredSidebarAccounts.length - 1;
    if (sidebarHighlightedIndex > maxIndex) {
      setSidebarHighlightedIndex(maxIndex);
    }
  }, [filteredSidebarAccounts.length]);

  const selectedAccount = useMemo(
    () => allAccounts.find((acc) => acc.type === paymentAccountType && acc.id === paymentAccountId),
    [allAccounts, paymentAccountType, paymentAccountId]
  );

  return { filteredSidebarAccounts, selectedAccount };
}
