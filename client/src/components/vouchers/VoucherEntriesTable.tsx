import { useState, useRef, useEffect } from "react";
import { UseFormReturn, UseFieldArrayReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Plus, X, Search, Check } from "lucide-react";
import type { Account } from "@/components/AccountSidebar";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { cn } from "@/lib/utils";

const ENTRY_TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  bank: { label: "Bank", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" },
  ledger: { label: "Ledger", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  supplier: { label: "Supplier", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300" },
  employee: { label: "Staff", cls: "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300" },
  fixedAsset: { label: "Asset", cls: "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300" },
  customer: { label: "Customer", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" },
  factorySupplier: { label: "F.Supp", cls: "bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300" },
};

export interface VoucherEntry {
  accountType: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset" | "customer" | "factorySupplier";
  accountId: number;
  accountName: string;
  amount: string;
}

interface VoucherEntriesTableProps {
  form: UseFormReturn<unknown>;
  fieldArray: UseFieldArrayReturn<unknown, "entries", "id">;
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

  // ── Mobile Sheet state ──────────────────────────────────────────────────────
  const [mobileEditIndex, setMobileEditIndex] = useState<number | null>(null);
  const [mobileEditOpen, setMobileEditOpen] = useState(false);
  const [mobileSearch, setMobileSearch] = useState("");
  const [mobileAmountStr, setMobileAmountStr] = useState("");
  const mobileAmountInputRef = useRef<HTMLInputElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mobileEditOpen && mobileEditIndex !== null) {
      const current = form.getValues(`entries.${mobileEditIndex}.amount`) || "";
      setMobileAmountStr(current);
      // Call onRowFocus first to set activeRowIndex (needed for account selection routing),
      // then immediately clear sidebarSearchValue so the list shows all accounts (not pre-filtered
      // by the existing account name). React 18 batches both — last write wins.
      onRowFocus(mobileEditIndex, "account");
      setSidebarSearchValue("");
      setMobileSearch("");
      setTimeout(() => mobileSearchInputRef.current?.focus(), 150);
    }
    if (!mobileEditOpen) {
      setMobileSearch("");
      setSidebarSearchValue("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileEditOpen, mobileEditIndex]);

  const openMobileEdit = (index: number) => {
    setMobileEditIndex(index);
    setMobileEditOpen(true);
  };

  const handleMobileAddRow = () => {
    const newIndex = fields.length;
    append({ accountType: "ledger", accountId: 0, accountName: "", amount: "" });
    setTimeout(() => {
      setMobileEditIndex(newIndex);
      setMobileEditOpen(true);
    }, 50);
  };

  const handleMobileAccountSelect = (account: Account) => {
    handleSidebarAccountSelect(account);
    setMobileSearch("");
    setSidebarSearchValue("");
    setTimeout(() => mobileAmountInputRef.current?.focus(), 120);
  };

  const handleMobileDone = () => {
    if (mobileEditIndex !== null) {
      const numVal = parseFloat(mobileAmountStr);
      const isPositive = !isNaN(numVal) && numVal > 0;
      // Always write back — even blank/0 — so clearing an amount actually clears the form field.
      const finalAmount = isPositive
        ? selectedCurrency !== "USD"
          ? convertToUSD(numVal).toFixed(2)
          : numVal.toFixed(2)
        : "";
      form.setValue(`entries.${mobileEditIndex}.amount`, finalAmount);
      if (isPositive && onAmountCommit) onAmountCommit(mobileEditIndex);
    }
    setMobileEditOpen(false);
  };
  // ────────────────────────────────────────────────────────────────────────────

  const getEntryBalance = (index: number): number | null => {
    const entry = entries[index];
    if (!entry || !entry.accountId || !sidebarAccounts.length) return null;
    const found = sidebarAccounts.find((a) => {
      if (a.type !== entry.accountType) return false;
      if (entry.accountType === "employee") {
        return (a as unknown as Account & { accountId: number }).accountId === entry.accountId;
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

  // Focus helper shared by the Tab / arrow navigation below. Fields are addressed by the
  // same data-testid attributes the keyboard test-suite already asserts on.
  const focusField = (field: "account" | "amount", index: number, select = true) => {
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-testid="input-${field}-${index}"]`) as HTMLInputElement | null;
      if (!el) return;
      el.focus();
      if (select) el.select();
    });
  };

  const handleAccountKeyDown = async (e: React.KeyboardEvent, index: number) => {
    // Tab takes the highlighted account (only when the row has none yet, so tabbing
    // through a filled row never reassigns it) and moves along to the amount.
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const hasAccount = (entries[index]?.accountId ?? 0) > 0;
      if (!hasAccount && filteredSidebarAccounts.length > 0 && sidebarHighlightedIndex >= 0) {
        const highlighted = filteredSidebarAccounts[sidebarHighlightedIndex];
        if (highlighted) handleSidebarAccountSelect(highlighted);
      }
      focusField("amount", index);
      return;
    }
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
        const exactMatch = filteredSidebarAccounts.find((acc) => acc.name.toLowerCase() === currentName.toLowerCase());
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
    // Tab commits the amount and carries on to the next row, adding one when needed —
    // the same motion as Enter, minus the requirement that the amount be positive.
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const amount = Number(entries[index]?.amount);
      if (!isNaN(amount) && amount > 0 && onAmountCommit) onAmountCommit(index);

      const isLastRow = index === fields.length - 1;
      const rowHasContent = (entries[index]?.accountId ?? 0) > 0 || (!isNaN(amount) && amount > 0);
      if (isLastRow) {
        // Only grow the table off a row that actually holds something, so tabbing
        // out of an untouched last row doesn't leave a trail of blank lines.
        if (!rowHasContent) return;
        handleAddRow();
      }
      focusField("account", index + 1, false);
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusField("account", index, false);
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      if (index < fields.length - 1) focusField("account", index + 1, false);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const amount = Number(entries[index]?.amount);
      if (!isNaN(amount) && amount > 0) {
        if (onAmountCommit) onAmountCommit(index);
        handleAddRow();
        requestAnimationFrame(() => {
          const newInput = document.querySelector(
            `[data-testid="input-account-${entries.length}"]`
          ) as HTMLInputElement;
          if (newInput) {
            newInput.focus();
            newInput.select();
          }
        });
      }
    } else if (e.key === "ArrowUp") {
      // Always prevent default on ArrowUp/Down for number inputs — without this
      // the browser increments/decrements the value (especially visible on Mac/Safari).
      e.preventDefault();
      if (index > 0) {
        const prevInput = document.querySelector(`[data-testid="input-amount-${index - 1}"]`) as HTMLInputElement;
        if (prevInput) {
          prevInput.focus();
          prevInput.select();
        }
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (index < entries.length - 1) {
        const nextInput = document.querySelector(`[data-testid="input-amount-${index + 1}"]`) as HTMLInputElement;
        if (nextInput) {
          nextInput.focus();
          nextInput.select();
        }
      }
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
      <p
        className={`text-[10px] font-mono tabular-nums mt-0.5 ${bal < 0 ? "text-red-500 dark:text-red-400" : bal > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
      >
        bal {formatAmount(bal)}
      </p>
    );
  };

  // Running subtotal down the amount column, so a batch can be checked against paper
  // as it is typed. Derived from the same entries the total is derived from.
  const runningTotals: number[] = [];
  {
    let running = 0;
    for (let i = 0; i < fields.length; i++) {
      const value = parseFloat(entries[i]?.amount || "0");
      if (!isNaN(value) && value > 0) running += value;
      runningTotals.push(running);
    }
  }
  const hasAnyAmount = runningTotals.length > 0 && runningTotals[runningTotals.length - 1] > 0;

  return (
    <>
      {/* ── Desktop / tablet: original table ── */}
      <div className="hidden sm:block border rounded-md overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50 sticky top-0 z-30">
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="text-center px-2 py-2 font-semibold w-8">#</th>
              <th className="text-left px-2 py-2 font-semibold">Account</th>
              <th className="text-left px-2 py-2 font-semibold w-24 hidden lg:table-cell">Type</th>
              <th className="text-right px-2 py-2 font-semibold w-[26%]">Amount</th>
              <th className="text-right px-2 py-2 font-semibold w-28 hidden lg:table-cell">Running</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field, index) => {
              const entry = entries[index];
              const isEmpty = !entry?.accountId || entry.accountId === 0;
              const typeBadge = entry?.accountType ? ENTRY_TYPE_BADGE[entry.accountType] : null;
              return (
                <tr
                  key={field.id}
                  className={cn(
                    "border-t hover-elevate",
                    activeRow === index &&
                      (mode === "payment"
                        ? "bg-amber-50/60 dark:bg-amber-950/20 shadow-[inset_2px_0_0_#f59e0b]"
                        : "bg-emerald-50/60 dark:bg-emerald-950/20 shadow-[inset_2px_0_0_#10b981]")
                  )}
                >
                  <td className="px-2 py-1.5 text-center text-[11px] font-mono text-muted-foreground tabular-nums align-top pt-3">
                    {index + 1}
                  </td>
                  <td className="px-2 py-1.5">
                    <FormField
                      control={form.control}
                      name={`entries.${index}.accountName`}
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="Type to search..."
                              className="text-sm h-8"
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
                          {/* Type badge lives in its own column on lg+, inline below the name otherwise */}
                          {!isEmpty && typeBadge && (
                            <span
                              className={`lg:hidden inline-block text-[10px] font-medium px-1.5 py-0 rounded mt-0.5 ${typeBadge.cls}`}
                            >
                              {typeBadge.label}
                            </span>
                          )}
                          {renderBalanceLine(index)}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </td>
                  <td className="px-2 py-1.5 align-top pt-3 hidden lg:table-cell">
                    {!isEmpty && typeBadge && (
                      <span className={`inline-block text-[10px] font-medium px-1.5 py-0 rounded ${typeBadge.cls}`}>
                        {typeBadge.label}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
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
                              className="font-mono tabular-nums text-right h-8"
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
                  <td className="px-2 py-1.5 align-top pt-3 text-right hidden lg:table-cell">
                    <span
                      className="text-xs font-mono tabular-nums text-muted-foreground"
                      data-testid={`text-running-${index}`}
                    >
                      {runningTotals[index] > 0 ? formatAmount(runningTotals[index]) : "—"}
                    </span>
                  </td>
                  <td className="px-1 py-1.5 align-top pt-2">
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
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
          <tfoot className="bg-muted/30 border-t">
            <tr>
              <td colSpan={6} className="px-2 py-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={handleAddRow}
                    data-testid="button-add-row"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    Add Row
                  </Button>

                  {/* The running column already ends on the total, so the footer only
                      carries the shortcuts rather than repeating the figure a third time. */}
                  <p className="text-[11px] text-muted-foreground hidden xl:block">
                    <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Tab</kbd> next field
                    <kbd className="px-1 py-0.5 bg-muted rounded text-[10px] ml-2">↵</kbd> new row
                    <kbd className="px-1 py-0.5 bg-muted rounded text-[10px] ml-2">↑↓</kbd> move
                  </p>
                  {hasAnyAmount && (
                    <div className="text-right xl:hidden">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Subtotal</div>
                      <div className="text-sm font-semibold font-mono tabular-nums">{formatAmount(total)}</div>
                    </div>
                  )}
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Mobile: compact tappable cards (sm:hidden) ── */}
      <div className="sm:hidden space-y-2">
        {fields.map((field, index) => {
          const entry = entries[index];
          const hasAccount = (entry?.accountId ?? 0) > 0;
          const typeBadge = entry?.accountType ? ENTRY_TYPE_BADGE[entry.accountType] : null;
          const amount = parseFloat(entry?.amount || "0");
          return (
            <div
              key={field.id}
              className="rounded-md border bg-card px-3 py-2.5 flex items-center gap-2 hover-elevate active-elevate-2 cursor-pointer"
              onClick={() => openMobileEdit(index)}
              data-testid={`mobile-entry-card-${index}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{index + 1}.</span>
                  {hasAccount ? (
                    <span className="text-sm font-medium truncate">{entry.accountName}</span>
                  ) : (
                    <span className="text-sm text-muted-foreground italic">Tap to select account</span>
                  )}
                </div>
                {hasAccount && typeBadge && (
                  <span className={`inline-block text-[10px] font-medium px-1.5 py-0 rounded mt-0.5 ${typeBadge.cls}`}>
                    {typeBadge.label}
                  </span>
                )}
              </div>
              <div className="shrink-0 flex items-center gap-1.5">
                {amount > 0 && <span className="text-sm font-semibold font-mono">{formatAmount(amount)}</span>}
                {fields.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(index);
                    }}
                    data-testid={`mobile-remove-entry-${index}`}
                  >
                    <X className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        {/* Dashed "add entry" card */}
        <div
          className="rounded-md border border-dashed border-muted-foreground/30 px-3 py-3 flex items-center gap-2 text-muted-foreground cursor-pointer hover-elevate active-elevate-2"
          onClick={handleMobileAddRow}
          data-testid="mobile-add-entry-card"
        >
          <Plus className="h-4 w-4" />
          <span className="text-sm">Tap to add entry</span>
        </div>

        {/* Total summary */}
        <div className="rounded-md border bg-muted/30 px-3 py-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {fields.length} {fields.length === 1 ? "entry" : "entries"}
          </span>
          <span className="text-base font-semibold font-mono">{formatAmount(total)}</span>
        </div>
      </div>

      {/* ── Mobile Sheet editor ── */}
      <Sheet
        open={mobileEditOpen}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setMobileEditOpen(false);
            setMobileSearch("");
            setSidebarSearchValue("");
          }
        }}
      >
        <SheetContent side="bottom" className="flex flex-col p-0" style={{ height: "auto", maxHeight: "88vh" }}>
          <SheetHeader className="px-4 pt-4 pb-3 border-b shrink-0">
            <div className="flex items-center justify-between gap-2">
              <SheetTitle className="text-base truncate">
                {mobileEditIndex !== null && (entries[mobileEditIndex]?.accountId ?? 0) > 0
                  ? entries[mobileEditIndex].accountName
                  : "Select Account"}
              </SheetTitle>
              <Button variant="default" size="sm" onClick={handleMobileDone} data-testid="button-mobile-entry-done">
                Done
              </Button>
            </div>
            {/* Search input */}
            <div className="relative mt-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                ref={mobileSearchInputRef}
                placeholder="Search accounts..."
                value={mobileSearch}
                onChange={(e) => {
                  setMobileSearch(e.target.value);
                  setSidebarSearchValue(e.target.value);
                }}
                className="pl-9"
                data-testid="input-mobile-account-search"
              />
            </div>
          </SheetHeader>

          {/* Account list */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {filteredSidebarAccounts.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {mobileSearch ? "No accounts match your search" : "No accounts available"}
              </div>
            ) : (
              filteredSidebarAccounts.slice(0, 40).map((account) => {
                const isSelected =
                  mobileEditIndex !== null &&
                  entries[mobileEditIndex]?.accountId === account.id &&
                  entries[mobileEditIndex]?.accountType === account.type;
                const bal =
                  typeof account.balance === "string" ? parseFloat(account.balance) : (account.balance ?? null);
                return (
                  <button
                    key={`${account.type}-${account.id}`}
                    type="button"
                    className={cn(
                      "w-full text-left px-4 py-3 border-b border-muted/40 flex items-center justify-between gap-3 active-elevate-2",
                      isSelected && "bg-accent"
                    )}
                    onClick={() => handleMobileAccountSelect(account)}
                    data-testid={`mobile-account-option-${account.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{account.name}</div>
                      {bal != null && (
                        <div className="text-xs text-muted-foreground font-mono mt-0.5">{formatAmount(bal)}</div>
                      )}
                    </div>
                    {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                  </button>
                );
              })
            )}
          </div>

          {/* Amount input */}
          <div className="px-4 py-4 border-t shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground shrink-0 w-16">Amount</span>
              <Input
                ref={mobileAmountInputRef}
                type="number"
                inputMode="decimal"
                step="0.01"
                placeholder="0.00"
                value={mobileAmountStr}
                onChange={(e) => setMobileAmountStr(e.target.value)}
                className="flex-1 font-mono text-right h-12 text-lg"
                data-testid="input-mobile-entry-amount"
              />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
