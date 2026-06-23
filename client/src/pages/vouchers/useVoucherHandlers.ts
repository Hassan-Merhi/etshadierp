import type { Account } from "@/components/AccountSidebar";

interface UseVoucherHandlersProps {
  form: any;
  append: any;
  activeRowIndex: number | null;
  setActiveRowIndex: (i: number | null) => void;
  sidebarAccounts: Account[];
  selectedCompany: { id: number } | null;
  setIsAutoCreating: (v: boolean) => void;
  queryClient: any;
  toast: any;
  setSelectedAccountId: (v: number | null) => void;
  setSelectedAccountType: (v: string | null) => void;
  setSidebarSearchValue: (v: string) => void;
  setSidebarHighlightedIndex: (v: number) => void;
}

export function useVoucherHandlers({
  form,
  append,
  activeRowIndex,
  setActiveRowIndex,
  sidebarAccounts,
  selectedCompany,
  setIsAutoCreating,
  queryClient,
  toast,
  setSelectedAccountId,
  setSelectedAccountType,
  setSidebarSearchValue,
  setSidebarHighlightedIndex,
}: UseVoucherHandlersProps) {
  const handleSidebarAccountSelect = async (account: Account) => {
    const currentEntries = form.getValues("entries");
    let targetRowIndex: number;

    if (activeRowIndex !== null && activeRowIndex < currentEntries.length) {
      targetRowIndex = activeRowIndex;
      form.setValue(`entries.${activeRowIndex}.accountType`, account.type);
      form.setValue(`entries.${activeRowIndex}.accountId`, account.id);
      form.setValue(`entries.${activeRowIndex}.accountName`, account.name);
      requestAnimationFrame(() => {
        const amountInput = document.querySelector(
          `[data-testid="input-amount-${activeRowIndex}"]`
        ) as HTMLInputElement;
        if (amountInput) { amountInput.focus(); amountInput.select(); }
      });
    } else {
      const emptyEntryIndex = currentEntries.findIndex(
        (e: any) => e.accountId === 0 || !e.accountName
      );
      if (emptyEntryIndex >= 0) {
        targetRowIndex = emptyEntryIndex;
        form.setValue(`entries.${emptyEntryIndex}.accountType`, account.type);
        form.setValue(`entries.${emptyEntryIndex}.accountId`, account.id);
        form.setValue(`entries.${emptyEntryIndex}.accountName`, account.name);
        requestAnimationFrame(() => {
          const amountInput = document.querySelector(
            `[data-testid="input-amount-${emptyEntryIndex}"]`
          ) as HTMLInputElement;
          if (amountInput) { amountInput.focus(); amountInput.select(); }
        });
      } else {
        targetRowIndex = currentEntries.length;
        append({ accountType: account.type, accountId: account.id, accountName: account.name, amount: "" });
        requestAnimationFrame(() => {
          const amountInput = document.querySelector(
            `[data-testid="input-amount-${targetRowIndex}"]`
          ) as HTMLInputElement;
          if (amountInput) { amountInput.focus(); amountInput.select(); }
        });
      }
    }

    setSelectedAccountId(account.id);
    setSelectedAccountType(account.type);
    setActiveRowIndex(targetRowIndex);
  };

  const handleAmountCommit = async (rowIndex: number) => {
    if (rowIndex === activeRowIndex) {
      setSelectedAccountId(null);
      setSelectedAccountType(null);
      setActiveRowIndex(null);
      setSidebarSearchValue("");
      setSidebarHighlightedIndex(0);
      requestAnimationFrame(() => {
        const searchInput = document.querySelector(
          '[data-testid="input-search-account"]'
        ) as HTMLInputElement;
        if (searchInput) searchInput.focus();
      });
    }
  };

  const handleAutoCreateAccount = async (name: string): Promise<Account | null> => {
    if (!selectedCompany?.id || !name.trim()) return null;
    setIsAutoCreating(true);
    try {
      const normalizedName = name.trim().toLowerCase();
      const existingAccount = sidebarAccounts.find(
        (acc) => acc.name.toLowerCase() === normalizedName
      );
      if (existingAccount) return existingAccount;

      const payload = { name: name.trim(), accountType: "Indirect Expense", companyId: selectedCompany.id };
      const response = await fetch("/api/ledger-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create account");
      }
      const newAccount = await response.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/accounts/voucher-sidebar", selectedCompany.id] });
      await queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts", selectedCompany.id] });
      toast({ title: "Account created", description: `"${newAccount.name}" created as Indirect Expense.` });
      return { id: newAccount.id, name: newAccount.name, type: "ledger" as const, code: newAccount.code || "", balance: 0 };
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to create account" });
      return null;
    } finally {
      setIsAutoCreating(false);
    }
  };

  return { handleSidebarAccountSelect, handleAmountCommit, handleAutoCreateAccount };
}
