import { UseFormReturn, UseFieldArrayReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Plus } from "lucide-react";
import type { Account } from "@/components/AccountSidebar";
import { useCurrencyContext } from "@/contexts/CurrencyContext";

export interface VoucherEntry {
  accountType: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset" | "factorySupplier";
  accountId: number;
  accountName: string;
  amount: string;
}

interface VoucherEntriesTableProps {
  form: UseFormReturn<any>;
  fieldArray: UseFieldArrayReturn<any, "entries", "id">;
  entries: VoucherEntry[];
  total: number;
  mode: "payment" | "receipt";
  onAmountCommit?: (rowIndex: number) => void;
  activeRow: number | null;
  filteredSidebarAccounts: Account[];
  sidebarHighlightedIndex: number;
  setSidebarHighlightedIndex: (index: number) => void;
  setSidebarSearchValue: (value: string) => void;
  handleSidebarAccountSelect: (account: Account) => void;
  sidebarAccounts?: Account[];
  onRowFocus: (rowIndex: number, fieldName: string) => void;
  onRowBlur: () => void;
  isFactoryCompany?: boolean;
  onAutoCreateAccount?: (name: string) => Promise<Account | null>;
  isAutoCreating?: boolean;
}

export function VoucherEntriesTable({
  form,
  fieldArray,
  entries,
  total,
  mode,
  onAmountCommit,
  activeRow,
  filteredSidebarAccounts,
  sidebarHighlightedIndex,
  setSidebarHighlightedIndex,
  setSidebarSearchValue,
  handleSidebarAccountSelect,
  sidebarAccounts = [],
  onRowFocus,
  onRowBlur,
  isFactoryCompany = false,
  onAutoCreateAccount,
  isAutoCreating = false,
}: VoucherEntriesTableProps) {
  const { fields, append, remove } = fieldArray;
  const { formatAmount, selectedCurrency, convertToUSD } = useCurrencyContext();

  const getEntryBalance = (index: number): number | null => {
    const entry = entries[index];
    if (!entry || !entry.accountId || !sidebarAccounts.length) return null;
    const found = sidebarAccounts.find((a) => {
      if (a.type !== (entry.accountType as any)) return false;
      if (entry.accountType === "employee") {
        return (a as any).accountId === entry.accountId;
      }
      return a.id === entry.accountId;
    });
    if (!found || found.balance == null) return null;
    return typeof found.balance === "string" ? parseFloat(found.balance) : found.balance;
  };

  const handleAddRow = () => {
    append({
      accountType: "ledger",
      accountId: 0,
      accountName: "",
      amount: "",
    });
  };

  const handleAccountKeyDown = async (e: React.KeyboardEvent, index: number) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filteredSidebarAccounts.length === 0) return;
      const newIndex = Math.min(
        sidebarHighlightedIndex < 0 ? 0 : sidebarHighlightedIndex + 1,
        filteredSidebarAccounts.length - 1
      );
      setSidebarHighlightedIndex(newIndex);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filteredSidebarAccounts.length === 0) return;
      const newIndex = Math.max(sidebarHighlightedIndex - 1, 0);
      setSidebarHighlightedIndex(newIndex);
    } else if (e.key === "Enter") {
      e.preventDefault();

      // Get the current account name from the form
      const currentName = form.getValues(`entries.${index}.accountName`)?.trim() || "";

      if (isFactoryCompany && onAutoCreateAccount && currentName) {
        // Check for EXACT match (case-insensitive)
        const exactMatch = filteredSidebarAccounts.find(
          (acc) => acc.name.toLowerCase() === currentName.toLowerCase()
        );

        if (exactMatch) {
          handleSidebarAccountSelect(exactMatch);
        } else {
          // No exact match - auto-create for factory
          const newAccount = await onAutoCreateAccount(currentName);
          if (newAccount) {
            handleSidebarAccountSelect(newAccount);
          }
        }
      } else if (filteredSidebarAccounts.length > 0 && sidebarHighlightedIndex >= 0) {
        // Non-factory: select highlighted account
        const highlightedAccount = filteredSidebarAccounts[sidebarHighlightedIndex];
        if (highlightedAccount) {
          handleSidebarAccountSelect(highlightedAccount);
        }
      }
    }
  };

  const handleAmountKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const amount = Number(entries[index]?.amount);

      if (!isNaN(amount) && amount > 0) {
        // Call commit callback to clear selection and refocus search
        if (onAmountCommit) {
          onAmountCommit(index);
        }

        // Then add a new row
        handleAddRow();

        // Focus the new row's account input
        requestAnimationFrame(() => {
          const newRowIndex = entries.length;
          const newInput = document.querySelector(`[data-testid="input-account-${newRowIndex}"]`) as HTMLInputElement;
          if (newInput) {
            newInput.focus();
            newInput.select();
          }
        });
      }
    } else if (e.key === "ArrowUp" && index > 0) {
      e.preventDefault();
      const prevInput = document.querySelector(`[data-testid="input-amount-${index - 1}"]`) as HTMLInputElement;
      if (prevInput) {
        prevInput.focus();
        prevInput.select();
      }
    } else if (e.key === "ArrowDown" && index < entries.length - 1) {
      e.preventDefault();
      const nextInput = document.querySelector(`[data-testid="input-amount-${index + 1}"]`) as HTMLInputElement;
      if (nextInput) {
        nextInput.focus();
        nextInput.select();
      }
    }
  };

  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left p-3 font-medium w-[60%]">Account</th>
            <th className="text-right p-3 font-medium w-[35%]">Amount</th>
            <th className="w-[5%]"></th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field, index) => (
            <tr key={field.id} className="border-t hover-elevate">
              <td className="p-2">
                <FormField
                  control={form.control}
                  name={`entries.${index}.accountName`}
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Type to search..."
                          className="text-sm"
                          data-testid={`input-account-${index}`}
                          onChange={(e) => {
                            field.onChange(e);
                            setSidebarSearchValue(e.target.value);
                            // Don't reset highlightedIndex here - let the useEffect in Vouchers.tsx handle it
                          }}
                          onFocus={() => {
                            onRowFocus(index, "account");
                          }}
                          onKeyDown={(e) => handleAccountKeyDown(e, index)}
                          onBlur={() => {
                            setTimeout(() => onRowBlur(), 200);
                          }}
                        />
                      </FormControl>
                      {(() => {
                        const bal = getEntryBalance(index);
                        if (bal == null) return null;
                        return (
                          <p className={`text-xs font-mono mt-0.5 ${bal < 0 ? "text-red-500 dark:text-red-400" : bal > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                            Balance: {formatAmount(bal)}
                          </p>
                        );
                      })()}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </td>
              <td className="p-2">
                <FormField
                  control={form.control}
                  name={`entries.${index}.amount`}
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          className="font-mono text-right"
                          data-testid={`input-amount-${index}`}
                          onKeyDown={(e) => handleAmountKeyDown(e, index)}
                          onBlur={(e) => {
                            const enteredAmount = Number(e.target.value);
                            if (!isNaN(enteredAmount) && enteredAmount > 0) {
                              // Convert from display currency to USD for storage
                              if (selectedCurrency !== "USD") {
                                const usdAmount = convertToUSD(enteredAmount);
                                form.setValue(`entries.${index}.amount`, usdAmount.toFixed(2));
                              }
                              if (onAmountCommit) {
                                onAmountCommit(index);
                              }
                            }
                          }}
                          onFocus={() => onRowFocus(index, "amount")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </td>
              <td className="p-2">
                {fields.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(index)}
                    data-testid={`button-remove-${index}`}
                  >
                    ×
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-muted/30 border-t-2">
          <tr>
            <td colSpan={1} className="p-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddRow}
                data-testid="button-add-row"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Row
              </Button>
            </td>
            <td className="p-3">
              <div className="text-right font-bold font-mono">
                {formatAmount(total)}
              </div>
            </td>
            <td colSpan={1}></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
