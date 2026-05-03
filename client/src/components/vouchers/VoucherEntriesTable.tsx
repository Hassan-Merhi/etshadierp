import { UseFormReturn, UseFieldArrayReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Plus, X } from "lucide-react";
import type { Account } from "@/components/AccountSidebar";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { cn } from "@/lib/utils";

const ENTRY_TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  bank:            { label: "Bank",     cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" },
  ledger:          { label: "Ledger",   cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  supplier:        { label: "Supplier", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300" },
  employee:        { label: "Staff",    cls: "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300" },
  fixedAsset:      { label: "Asset",    cls: "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300" },
  customer:        { label: "Customer", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" },
  factorySupplier: { label: "F.Supp",  cls: "bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300" },
};

export interface VoucherEntry {
  accountType: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset" | "customer" | "factorySupplier";
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

      const currentName = form.getValues(`entries.${index}.accountName`)?.trim() || "";

      if (isFactoryCompany && onAutoCreateAccount && currentName) {
        const exactMatch = filteredSidebarAccounts.find(
          (acc) => acc.name.toLowerCase() === currentName.toLowerCase()
        );
        if (exactMatch) {
          handleSidebarAccountSelect(exactMatch);
        } else {
          const newAccount = await onAutoCreateAccount(currentName);
          if (newAccount) {
            handleSidebarAccountSelect(newAccount);
          }
        }
      } else if (filteredSidebarAccounts.length > 0 && sidebarHighlightedIndex >= 0) {
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
        if (onAmountCommit) onAmountCommit(index);
        handleAddRow();
        requestAnimationFrame(() => {
          const newInput = document.querySelector(`[data-testid="input-account-${entries.length}"]`) as HTMLInputElement;
          if (newInput) { newInput.focus(); newInput.select(); }
        });
      }
    } else if (e.key === "ArrowUp" && index > 0) {
      e.preventDefault();
      const prevInput = document.querySelector(`[data-testid="input-amount-${index - 1}"]`) as HTMLInputElement;
      if (prevInput) { prevInput.focus(); prevInput.select(); }
    } else if (e.key === "ArrowDown" && index < entries.length - 1) {
      e.preventDefault();
      const nextInput = document.querySelector(`[data-testid="input-amount-${index + 1}"]`) as HTMLInputElement;
      if (nextInput) { nextInput.focus(); nextInput.select(); }
    }
  };

  const handleAmountBlur = (e: React.FocusEvent<HTMLInputElement>, index: number) => {
    const enteredAmount = Number(e.target.value);
    if (!isNaN(enteredAmount) && enteredAmount > 0) {
      if (selectedCurrency !== "USD") {
        const usdAmount = convertToUSD(enteredAmount);
        form.setValue(`entries.${index}.amount`, usdAmount.toFixed(2));
      }
      if (onAmountCommit) onAmountCommit(index);
    }
  };

  const renderBalanceLine = (index: number) => {
    const bal = getEntryBalance(index);
    if (bal == null) return null;
    return (
      <p className={`text-xs font-mono mt-0.5 ${bal < 0 ? "text-red-500 dark:text-red-400" : bal > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
        Balance: {formatAmount(bal)}
      </p>
    );
  };

  return (
    <>
      {/* ── Desktop / tablet: original table ── */}
      <div className="hidden sm:block border rounded-md overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50 sticky top-0 z-30">
            <tr>
              <th className="text-center p-3 font-medium w-8 text-muted-foreground">#</th>
              <th className="text-left p-3 font-medium">Account</th>
              <th className="text-right p-3 font-medium w-[32%]">Amount</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field, index) => {
              const entry = entries[index];
              const isEmpty = !entry?.accountId || entry.accountId === 0;
              const typeBadge = entry?.accountType ? ENTRY_TYPE_BADGE[entry.accountType] : null;
              return (
              <tr key={field.id} className={cn("border-t hover-elevate", isEmpty && "bg-muted/20", activeRow === index && !isEmpty && "bg-primary/5 dark:bg-primary/10")}>
                <td className="px-2 py-3 text-center text-xs font-medium text-muted-foreground tabular-nums">
                  {index + 1}
                </td>
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
                            onFocus={() => onRowFocus(index, "account")}
                            onKeyDown={(e) => handleAccountKeyDown(e, index)}
                            onBlur={() => setTimeout(() => onRowBlur(), 200)}
                          />
                        </FormControl>
                        {!isEmpty && typeBadge && (
                          <span className={`inline-block text-[10px] font-medium px-1.5 py-0 rounded mt-0.5 ${typeBadge.cls}`}>
                            {typeBadge.label}
                          </span>
                        )}
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
                            onBlur={(e) => handleAmountBlur(e, index)}
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
                      size="icon"
                      onClick={() => remove(index)}
                      data-testid={`button-remove-${index}`}
                    >
                      <X className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-muted/40 border-t-2">
            <tr>
              <td></td>
              <td className="p-3">
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
              <td className="p-3 text-right">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Total</div>
                <div className={cn("text-base font-bold font-mono", total > 0 ? "text-foreground" : "text-muted-foreground")}>
                  {formatAmount(total)}
                </div>
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Mobile: one card per entry ── */}
      <div className="sm:hidden space-y-2">
        {fields.map((field, index) => (
          <div key={field.id} className="border rounded-md p-3 space-y-2 bg-card">
            {/* Account field + remove button */}
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <FormField
                  control={form.control}
                  name={`entries.${index}.accountName`}
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          value={field.value}
                          name={field.name}
                          placeholder="Type to search account..."
                          className="text-sm"
                          data-testid={`input-account-mobile-${index}`}
                          onChange={(e) => {
                            field.onChange(e);
                            setSidebarSearchValue(e.target.value);
                          }}
                          onFocus={() => onRowFocus(index, "account")}
                          onKeyDown={(e) => handleAccountKeyDown(e, index)}
                          onBlur={() => setTimeout(() => onRowBlur(), 200)}
                        />
                      </FormControl>
                      {/* Inline account suggestions (replaces sidebar on mobile) */}
                      {activeRow === index && filteredSidebarAccounts.length > 0 && (
                        <div className="mt-1 border rounded-md bg-popover shadow-md max-h-44 overflow-y-auto z-20 relative">
                          {filteredSidebarAccounts.slice(0, 10).map((account) => (
                            <button
                              key={`${account.type}-${account.id}`}
                              type="button"
                              className="w-full text-left px-3 py-2.5 text-sm hover-elevate border-b last:border-b-0"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                handleSidebarAccountSelect(account);
                              }}
                            >
                              <div className="font-medium truncate">{account.name}</div>
                              {account.balance != null && (
                                <div className="text-xs text-muted-foreground font-mono">
                                  {formatAmount(typeof account.balance === "string" ? parseFloat(account.balance) : account.balance)}
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                      {renderBalanceLine(index)}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              {fields.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(index)}
                  data-testid={`button-remove-mobile-${index}`}
                  className="shrink-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            {/* Amount field */}
            <FormField
              control={form.control}
              name={`entries.${index}.amount`}
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-14 shrink-0">Amount</span>
                    <FormControl>
                      <Input
                        value={field.value}
                        name={field.name}
                        onChange={field.onChange}
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        className="font-mono text-right"
                        data-testid={`input-amount-mobile-${index}`}
                        onKeyDown={(e) => handleAmountKeyDown(e, index)}
                        onBlur={(e) => handleAmountBlur(e, index)}
                        onFocus={() => onRowFocus(index, "amount")}
                      />
                    </FormControl>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        ))}

        {/* Add row + total footer */}
        <div className="flex items-center justify-between pt-1 px-0.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddRow}
            data-testid="button-add-row-mobile"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Row
          </Button>
          <div className="font-bold font-mono text-sm">
            Total: {formatAmount(total)}
          </div>
        </div>
      </div>
    </>
  );
}
