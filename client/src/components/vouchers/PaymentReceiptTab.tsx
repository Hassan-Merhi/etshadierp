import { useState } from "react";
import { UseFormReturn, UseFieldArrayReturn } from "react-hook-form";
import { format } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Printer,
  FileDown,
  ChevronDown,
  ChevronUp,
  ArrowUpCircle,
  ArrowDownCircle,
  AlertCircle,
  CheckCircle2,
  BookOpen,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AccountAutocomplete } from "@/components/AccountAutocomplete";
import type { CombinedAccount } from "@/components/AccountAutocomplete";
import AccountSidebar, { Account } from "@/components/AccountSidebar";
import { VoucherEntriesTable } from "@/components/vouchers/VoucherEntriesTable";
import { useCurrencyContext } from "@/contexts/CurrencyContext";

// Account type badge config — mirrors VoucherEntriesTable's ENTRY_TYPE_BADGE
const ACCOUNT_TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  bank:            { label: "Bank",     cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" },
  ledger:          { label: "Ledger",   cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  supplier:        { label: "Supplier", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300" },
  employee:        { label: "Staff",    cls: "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300" },
  fixedAsset:      { label: "Asset",    cls: "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300" },
  customer:        { label: "Customer", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" },
  factorySupplier: { label: "F.Supp",  cls: "bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300" },
};

export interface PaymentReceiptTabProps {
  form: UseFormReturn<any>;
  fieldArray: UseFieldArrayReturn<any, "entries", "id">;
  entries: any[];
  total: number;
  paymentAccountId: number;
  paymentAccountType: string;
  paymentAccountName: string;
  accountBalance: number;
  accountCurrencyBalances?: { currency: string; balance: number }[] | null;
  allAccounts: CombinedAccount[];
  sidebarAccounts: Account[];
  filteredSidebarAccounts: Account[];
  sidebarSearchValue: string;
  setSidebarSearchValue: (value: string) => void;
  sidebarHighlightedIndex: number;
  setSidebarHighlightedIndex: (index: number) => void;
  selectedAccountId: number | null;
  selectedAccountType: string | null;
  handleSidebarAccountSelect: (account: Account) => void;
  handleAmountCommit: (rowIndex: number) => void;
  handlePrint: () => void;
  handleExportVoucher?: (detailed: boolean) => void;
  onSubmit: (values: any) => void;
  activeTab: "payment" | "receipt";
  activeRowIndex: number | null;
  setActiveRowIndex: (index: number | null) => void;
  onCreateAccount?: () => void;
  isFactoryCompany?: boolean;
  onAutoCreateAccount?: (name: string) => Promise<Account | null>;
  isAutoCreating?: boolean;
  isEditMode?: boolean;
  originalTotal?: number;
  isPending?: boolean;
  voucherNumber?: string;
}

export function PaymentReceiptTab({
  form,
  fieldArray,
  entries,
  total,
  paymentAccountId,
  paymentAccountType,
  paymentAccountName,
  accountBalance,
  accountCurrencyBalances,
  allAccounts,
  sidebarAccounts,
  filteredSidebarAccounts,
  sidebarSearchValue,
  setSidebarSearchValue,
  sidebarHighlightedIndex,
  setSidebarHighlightedIndex,
  selectedAccountId,
  selectedAccountType,
  handleSidebarAccountSelect,
  handleAmountCommit,
  handlePrint,
  handleExportVoucher,
  onSubmit,
  activeTab,
  activeRowIndex,
  setActiveRowIndex,
  onCreateAccount,
  isFactoryCompany = false,
  onAutoCreateAccount,
  isAutoCreating = false,
  isEditMode = false,
  originalTotal = 0,
  isPending = false,
  voucherNumber,
}: PaymentReceiptTabProps) {
  const { formatAmount } = useCurrencyContext();
  const { formatDisplayDate } = useDateFormat();

  const [notesOpen, setNotesOpen] = useState<boolean>(() => {
    const existingNotes = form.getValues("notes");
    return typeof existingNotes === "string" && existingNotes.trim().length > 0;
  });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [payFromActive, setPayFromActive] = useState(false);

  const isPayment = activeTab === "payment";

  // Tab-specific tokens
  const Icon = isPayment ? ArrowUpCircle : ArrowDownCircle;
  const accentBg = isPayment
    ? "bg-amber-50/70 dark:bg-amber-950/20"
    : "bg-emerald-50/70 dark:bg-emerald-950/20";
  const accentBorder = isPayment
    ? "border-amber-200/60 dark:border-amber-800/30"
    : "border-emerald-200/60 dark:border-emerald-800/30";
  const iconColor = isPayment
    ? "text-amber-600 dark:text-amber-400"
    : "text-emerald-600 dark:text-emerald-400";
  const title = isPayment ? "Payment Voucher" : "Receipt Voucher";
  const accountLabel = isPayment ? "Pay From" : "Receive Into";
  const accountPlaceholder = isPayment ? "Pay from..." : "Receive into...";
  const accountTestId = isPayment ? "input-pay-from" : "input-receive-in";

  const activeTargetLabel: string | undefined = payFromActive
    ? accountLabel
    : activeRowIndex !== null
      ? `Row ${activeRowIndex + 1}`
      : undefined;

  // Close drawer after selection
  const handleAccountSelect = (account: Account) => {
    handleSidebarAccountSelect(account);
    setSheetOpen(false);
  };

  // Clear payment account and refocus the autocomplete
  const clearPaymentAccount = () => {
    form.setValue("paymentAccountId", 0);
    form.setValue("paymentAccountName", "");
    form.setValue("paymentAccountType", "");
    setPayFromActive(true);
    requestAnimationFrame(() => {
      const input = document.querySelector(
        `[data-testid="${accountTestId}"]`
      ) as HTMLInputElement | null;
      if (input) { input.focus(); input.select(); }
    });
  };

  // Action guards
  const hasExport = Boolean(handleExportVoucher);
  const hasAnyEntry = entries.some((e) => (e?.accountId ?? 0) > 0);
  const canRunActions = paymentAccountId !== 0;
  const canPrint = canRunActions && hasAnyEntry;
  const canExport = canRunActions && hasAnyEntry && hasExport;

  const printDisabledReason = !canRunActions
    ? `Select ${accountLabel} account first`
    : "Add at least one valid entry";

  // Validation
  const validEntryCount = entries.filter(
    (e) => (e?.accountId ?? 0) > 0 && parseFloat(e?.amount || "0") > 0
  ).length;
  const missingAccount = paymentAccountId === 0;
  const missingEntries = validEntryCount === 0;
  const isReadyToSave = !missingAccount && !missingEntries;

  // Balance helpers
  const balColor = (v: number) =>
    v < 0
      ? "text-red-600 dark:text-red-400"
      : v > 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-muted-foreground";

  const fmtCurr = (n: number, curr: string) =>
    curr !== "USD"
      ? `${curr} ${Math.abs(n).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : formatAmount(Math.abs(n));

  const projected = isPayment
    ? isEditMode
      ? accountBalance + originalTotal - total
      : accountBalance - total
    : accountBalance + total;

  const accountTypeBadge = ACCOUNT_TYPE_BADGE[paymentAccountType];

  // Shared sidebar props
  const sidebarProps = {
    accounts: sidebarAccounts,
    filteredAccounts: filteredSidebarAccounts,
    onSelectAccount: handleAccountSelect,
    searchValue: sidebarSearchValue,
    onSearchChange: setSidebarSearchValue,
    selectedAccountId,
    selectedAccountType,
    highlightedIndex: sidebarHighlightedIndex,
    onHighlightedIndexChange: setSidebarHighlightedIndex,
    entries,
    mode: activeTab,
    paymentAccountId,
    paymentAccountType,
    voucherTotal: total,
    onCreateAccount: isFactoryCompany ? undefined : onCreateAccount,
    isFactoryCompany,
    onAutoCreateAccount,
    isAutoCreating,
    activeTargetLabel,
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* ── Left column ── */}
      <div className="flex-1 min-w-0">
        <Card className="overflow-hidden">
          {/* ── Coloured header ── */}
          <CardHeader
            className={cn(
              "px-5 py-4 border-b flex flex-row items-center gap-3 flex-wrap",
              accentBg,
              accentBorder
            )}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Icon className={cn("h-5 w-5 shrink-0", iconColor)} />
              <CardTitle className="text-base font-semibold">{title}</CardTitle>
              {isEditMode && (
                <Badge
                  variant="secondary"
                  className="text-xs shrink-0 font-normal"
                  data-testid="badge-editing"
                >
                  Editing
                </Badge>
              )}
              {voucherNumber && (
                <span
                  className="text-xs font-mono text-muted-foreground truncate"
                  data-testid="text-voucher-number"
                >
                  #{voucherNumber}
                </span>
              )}
            </div>

            {/* Mobile accounts button */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="sm:hidden shrink-0 bg-background/80"
              onClick={() => setSheetOpen(true)}
              data-testid="button-open-accounts-drawer"
            >
              <BookOpen className="h-4 w-4 mr-1.5" />
              Accounts
              {activeTargetLabel && (
                <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                  — {activeTargetLabel}
                </span>
              )}
            </Button>
          </CardHeader>

          <CardContent className="pt-5">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-5"
                noValidate
              >
                {/* ── Row 1: account | date | actions ── */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_160px_auto] lg:items-start">

                  {/* ── Account: card when selected, autocomplete when empty ── */}
                  <FormField
                    control={form.control}
                    name="paymentAccountId"
                    render={() => (
                      <FormItem className="min-w-0">
                        <FormLabel className="text-sm font-medium">
                          {accountLabel}
                        </FormLabel>
                        <FormControl>
                          <>
                            {paymentAccountId > 0 ? (
                              /* ── Selected account card ── */
                              <div
                                className="rounded-md border bg-muted/30 px-3 py-2.5 flex items-start gap-3"
                                data-testid="div-selected-account"
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-semibold truncate leading-snug">
                                    {paymentAccountName}
                                  </div>
                                  {accountTypeBadge && (
                                    <span
                                      className={cn(
                                        "inline-block text-[10px] font-medium px-1.5 py-0 rounded mt-0.5",
                                        accountTypeBadge.cls
                                      )}
                                    >
                                      {accountTypeBadge.label}
                                    </span>
                                  )}
                                  {/* Balance / projection */}
                                  <div className="mt-1.5">
                                    {accountCurrencyBalances &&
                                    accountCurrencyBalances.length > 0 ? (
                                      <div className="flex flex-col gap-0.5">
                                        {accountCurrencyBalances.map(
                                          ({ currency, balance }) => (
                                            <div
                                              key={currency}
                                              className="flex items-center gap-1.5 text-xs font-mono"
                                            >
                                              <span className="text-muted-foreground">
                                                Bal:
                                              </span>
                                              <span
                                                className={cn(balColor(balance))}
                                              >
                                                {fmtCurr(balance, currency)}{" "}
                                                {balance > 0
                                                  ? "CR"
                                                  : balance < 0
                                                    ? "DR"
                                                    : ""}
                                              </span>
                                            </div>
                                          )
                                        )}
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-1.5 flex-wrap text-xs font-mono">
                                        <span className="text-muted-foreground">
                                          Bal:
                                        </span>
                                        <span
                                          className={cn(balColor(accountBalance))}
                                        >
                                          {formatAmount(accountBalance)}
                                        </span>
                                        {total > 0 && (
                                          <>
                                            <span className="text-muted-foreground">
                                              →
                                            </span>
                                            <span
                                              className={cn(
                                                "font-semibold",
                                                balColor(projected)
                                              )}
                                            >
                                              {formatAmount(projected)}
                                            </span>
                                            <span className="text-muted-foreground">
                                              after
                                            </span>
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={clearPaymentAccount}
                                  className="shrink-0 text-xs h-7 px-2 text-muted-foreground"
                                  data-testid="button-change-account"
                                >
                                  <Pencil className="h-3 w-3 mr-1" />
                                  Change
                                </Button>
                              </div>
                            ) : (
                              /* ── Autocomplete input ── */
                              <div
                                className="w-full min-w-0"
                                onFocus={() => setPayFromActive(true)}
                              >
                                <AccountAutocomplete
                                  value={null}
                                  onChange={(type, id, name) => {
                                    form.setValue("paymentAccountType", type);
                                    form.setValue("paymentAccountId", id);
                                    form.setValue("paymentAccountName", name);
                                  }}
                                  allAccounts={allAccounts}
                                  rowIndex={-1}
                                  placeholder={accountPlaceholder}
                                  testId={accountTestId}
                                />
                              </div>
                            )}
                          </>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* ── Date ── */}
                  <FormField
                    control={form.control}
                    name="voucherDate"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel className="text-sm font-medium">Date</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            value={
                              field.value instanceof Date
                                ? format(field.value, "yyyy-MM-dd")
                                : typeof field.value === "string"
                                  ? field.value
                                  : ""
                            }
                            onChange={(e) =>
                              field.onChange(
                                e.target.value
                                  ? new Date(e.target.value + "T00:00:00")
                                  : new Date()
                              )
                            }
                            data-testid="input-date-picker"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* ── Print / Export ── */}
                  <div className="flex flex-col gap-1 lg:items-end lg:pt-[26px]">
                    <div className="flex items-center gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className={!canPrint ? "cursor-not-allowed" : ""}>
                            <Button
                              type="button"
                              variant="outline"
                              size="default"
                              disabled={!canPrint}
                              onClick={handlePrint}
                              data-testid="button-print"
                              className={!canPrint ? "pointer-events-none" : ""}
                            >
                              <Printer className="h-4 w-4 mr-2" />
                              Print
                            </Button>
                          </span>
                        </TooltipTrigger>
                        {!canPrint && (
                          <TooltipContent side="bottom" className="max-w-xs text-center text-xs">
                            {printDisabledReason}
                          </TooltipContent>
                        )}
                      </Tooltip>

                      {hasExport && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={!canExport ? "cursor-not-allowed" : ""}>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="default"
                                    disabled={!canExport}
                                    data-testid="button-export"
                                    className={!canExport ? "pointer-events-none" : ""}
                                  >
                                    <FileDown className="h-4 w-4 mr-2" />
                                    Export
                                    <ChevronDown className="h-4 w-4 ml-1" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={() => handleExportVoucher?.(false)}
                                    data-testid="export-summary"
                                  >
                                    <FileDown className="h-4 w-4 mr-2" />
                                    Summary
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleExportVoucher?.(true)}
                                    data-testid="export-detailed"
                                  >
                                    <FileDown className="h-4 w-4 mr-2" />
                                    Detailed
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </span>
                          </TooltipTrigger>
                          {!canExport && (
                            <TooltipContent side="bottom" className="max-w-xs text-center text-xs">
                              {printDisabledReason}
                            </TooltipContent>
                          )}
                        </Tooltip>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Entries table ── */}
                <VoucherEntriesTable
                  form={form}
                  fieldArray={fieldArray}
                  entries={entries}
                  total={total}
                  mode={activeTab}
                  onAmountCommit={handleAmountCommit}
                  activeRow={activeRowIndex}
                  filteredSidebarAccounts={filteredSidebarAccounts}
                  sidebarHighlightedIndex={sidebarHighlightedIndex}
                  setSidebarHighlightedIndex={setSidebarHighlightedIndex}
                  setSidebarSearchValue={setSidebarSearchValue}
                  handleSidebarAccountSelect={handleAccountSelect}
                  sidebarAccounts={sidebarAccounts}
                  onRowFocus={(rowIndex, fieldName) => {
                    if (fieldName === "account") {
                      setPayFromActive(false);
                      setActiveRowIndex(rowIndex);
                      const currentAccountName =
                        entries[rowIndex]?.accountName || "";
                      setSidebarSearchValue(currentAccountName);
                    }
                  }}
                  onRowBlur={() => {}}
                  isFactoryCompany={isFactoryCompany}
                  onAutoCreateAccount={onAutoCreateAccount}
                  isAutoCreating={isAutoCreating}
                />

                {/* ── Summary + actions card ── */}
                <div className="rounded-md border overflow-hidden">
                  {/* Status + totals row */}
                  <div className="px-4 py-3 bg-muted/30 flex flex-wrap items-center justify-between gap-3 border-b">
                    <div className="flex items-center gap-3">
                      {/* Status indicator */}
                      {isReadyToSave ? (
                        <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          Ready to save
                        </div>
                      ) : missingAccount ? (
                        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          Select {accountLabel}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          Add at least one valid entry
                        </div>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {validEntryCount} {validEntryCount === 1 ? "line" : "lines"}
                      </span>
                    </div>

                    {/* Total amount — prominent */}
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                        Total
                      </div>
                      <div
                        className={cn(
                          "text-xl font-bold font-mono tabular-nums leading-none",
                          total > 0 ? "text-foreground" : "text-muted-foreground"
                        )}
                        data-testid="text-total-amount"
                      >
                        {total > 0 ? formatAmount(total) : "—"}
                      </div>
                    </div>
                  </div>

                  {/* Notes (collapsible) */}
                  <div className="px-4 py-3 border-b">
                    <Collapsible open={notesOpen} onOpenChange={setNotesOpen}>
                      <div className="flex items-center justify-between gap-2">
                        <CollapsibleTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="flex items-center gap-1.5 px-1 h-auto py-0.5 text-muted-foreground"
                            data-testid="button-toggle-notes"
                          >
                            {notesOpen ? (
                              <ChevronUp className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )}
                            <span className="text-xs font-medium">Notes</span>
                          </Button>
                        </CollapsibleTrigger>
                        {!notesOpen && form.watch("notes") && (
                          <span className="text-xs text-muted-foreground truncate max-w-xs italic">
                            {form.watch("notes")}
                          </span>
                        )}
                      </div>
                      <CollapsibleContent>
                        <FormField
                          control={form.control}
                          name="notes"
                          render={({ field }) => (
                            <FormItem className="mt-2">
                              <FormControl>
                                <Textarea
                                  {...field}
                                  placeholder="Additional notes..."
                                  rows={2}
                                  data-testid="input-notes"
                                  className="text-sm resize-none"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </CollapsibleContent>
                    </Collapsible>
                  </div>

                  {/* Optional toggle + Save button */}
                  <div className="px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
                    <FormField
                      control={form.control}
                      name="optional"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center gap-2.5 space-y-0">
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="checkbox-optional"
                            />
                          </FormControl>
                          <div className="leading-none">
                            <FormLabel className="cursor-pointer text-sm">
                              Mark as Optional
                            </FormLabel>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Excluded from balance checks
                            </p>
                          </div>
                        </FormItem>
                      )}
                    />
                    <Button
                      type="submit"
                      size="default"
                      disabled={paymentAccountId === 0 || total === 0 || isPending}
                      data-testid="button-save-voucher"
                    >
                      {isPending
                        ? isEditMode
                          ? "Updating…"
                          : "Saving…"
                        : isEditMode
                          ? `Update Voucher${total > 0 ? ` · ${formatAmount(total)}` : ""}`
                          : `Save Voucher${total > 0 ? ` · ${formatAmount(total)}` : ""}`}
                    </Button>
                  </div>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>

      {/* ── Right column: Account Sidebar (desktop) ── */}
      <div
        className="hidden sm:block w-full lg:w-[38%] lg:sticky lg:top-4 h-fit"
        style={{ maxHeight: "calc(100vh - 2rem)" }}
      >
        <AccountSidebar {...sidebarProps} />
      </div>

      {/* ── Mobile Account Drawer ── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-sm p-0 flex flex-col"
          data-testid="sheet-accounts-drawer"
        >
          <SheetHeader className="px-4 py-3 border-b shrink-0">
            <SheetTitle className="text-sm font-semibold">
              {activeTargetLabel
                ? `Accounts — ${activeTargetLabel}`
                : "Select Account"}
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-hidden">
            <AccountSidebar {...sidebarProps} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
