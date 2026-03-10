import { UseFormReturn, UseFieldArrayReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Plus } from "lucide-react";
import type { Account } from "@/components/AccountSidebar";
import { useCurrencyContext } from "@/contexts/CurrencyContext";

export interface VoucherEntry {
  accountType: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset";
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

  const getEntryProjectedBalance = (index: number): { bal: number; projected: number | null } | null => {
    const bal = getEntryBalance(index);
    if (bal == null) return null;
    const entryAmount = parseFloat(entries[index]?.amount || "0") || 0;
    if (entryAmount <= 0) return { bal, projected: null };
    const projected = mode === "payment" ? bal + entryAmount : bal - entryAmount;
    return { bal, projected };
  };

  const balColorClass = (v: number) =>
    v < 0
      ? "text-red-500 dark:text-red-400"
      : v > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-muted-foreground";

  const queryVisible = (testId: string): HTMLInputElement | null => {
    const els = document.querySelectorAll(`[data-testid="${testId}"]`);
    return (Array.from(els).find(el => (el as HTMLElement).offsetParent !== null) as HTMLInputElement) ?? null;
  };

  const focusAmountField = (index: number) => {
    requestAnimationFrame(() => {
      const amountInput = queryVisible(`input-amount-${index}`);
      if (amountInput) {
        amountInput.focus();
        amountInput.select();
      }
    });
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
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      focusAmountField(index);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const currentName = form.getValues(`entries.${index}.accountName`)?.trim() || "";
      const currentAccountId = form.getValues(`entries.${index}.accountId`) || 0;

      if (isFactoryCompany && onAutoCreateAccount && currentName) {
        if (filteredSidebarAccounts.length > 0) {
          const idx =
            sidebarHighlightedIndex >= 0 && sidebarHighlightedIndex < filteredSidebarAccounts.length
              ? sidebarHighlightedIndex
              : 0;
          handleSidebarAccountSelect(filteredSidebarAccounts[idx]);
          focusAmountField(index);
        } else {
          const newAccount = await onAutoCreateAccount(currentName);
          if (newAccount) {
            handleSidebarAccountSelect(newAccount);
            focusAmountField(index);
          }
        }
      } else if (!isFactoryCompany && filteredSidebarAccounts.length > 0 && sidebarHighlightedIndex >= 0) {
        const highlightedAccount = filteredSidebarAccounts[sidebarHighlightedIndex];
        if (highlightedAccount) {
          handleSidebarAccountSelect(highlightedAccount);
          focusAmountField(index);
        }
      } else if (currentAccountId > 0) {
        focusAmountField(index);
      }
    }
  };

  const handleAmountKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      const amount = Number(entries[index]?.amount);
      const isLastRow = index === entries.length - 1;

      if (!isNaN(amount) && amount > 0 && onAmountCommit) {
        onAmountCommit(index);
      }

      if (isLastRow) {
        handleAddRow();
      }

      requestAnimationFrame(() => {
        const newRowIndex = isLastRow ? entries.length : index + 1;
        const newInput = queryVisible(`input-account-${newRowIndex}`);
        if (newInput) {
          newInput.focus();
          newInput.select();
        }
      });
    } else if (e.key === "ArrowUp" && index > 0) {
      e.preventDefault();
      const prevInput = queryVisible(`input-amount-${index - 1}`);
      if (prevInput) {
        prevInput.focus();
        prevInput.select();
      }
    } else if (e.key === "ArrowDown" && index < entries.length - 1) {
      e.preventDefault();
      const nextInput = queryVisible(`input-amount-${index + 1}`);
      if (nextInput) {
        nextInput.focus();
        nextInput.select();
      }
    }
  };

  const sharedAmountBlur = (e: React.FocusEvent<HTMLInputElement>, index: number) => {
    const enteredAmount = Number(e.target.value);
    if (!isNaN(enteredAmount) && enteredAmount > 0) {
      if (selectedCurrency !== "USD") {
        const usdAmount = convertToUSD(enteredAmount);
        form.setValue(`entries.${index}.amount`, usdAmount.toFixed(2));
      }
      if (onAmountCommit) {
        onAmountCommit(index);
      }
    }
  };

  const renderBalanceLine = (index: number) => {
    const result = getEntryProjectedBalance(index);
    if (!result) return null;
    const { bal, projected } = result;
    const displayVal = projected ?? bal;
    return (
      <p className={`text-xs font-mono mt-0.5 ${balColorClass(displayVal)}`}>
        {projected != null ? "New Bal: " : "Bal: "}
        {formatAmount(displayVal)}
      </p>
    );
  };

  return (
    <div className="space-y-0">
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
                        {renderBalanceLine(index)}
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
                            onBlur={(e) => sharedAmountBlur(e, index)}
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
                <div className="text-right font-bold font-mono">{formatAmount(total)}</div>
              </td>
              <td colSpan={1}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
