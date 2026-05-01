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
  Printer,
  FileDown,
  ChevronDown,
  ChevronUp,
  ArrowUpCircle,
  ArrowDownCircle,
  AlertCircle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { AccountAutocomplete } from "@/components/AccountAutocomplete";
import type { CombinedAccount } from "@/components/AccountAutocomplete";
import AccountSidebar, { Account } from "@/components/AccountSidebar";
import { VoucherEntriesTable } from "@/components/vouchers/VoucherEntriesTable";
import { useCurrencyContext } from "@/contexts/CurrencyContext";

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

  // Notes collapse state — auto-open if there is already a notes value
  const [notesOpen, setNotesOpen] = useState<boolean>(() => {
    const existingNotes = form.getValues("notes");
    return typeof existingNotes === "string" && existingNotes.trim().length > 0;
  });

  const isPayment = activeTab === "payment";

  // Tab-specific styling / labels
  const Icon = isPayment ? ArrowUpCircle : ArrowDownCircle;
  const headerBg = isPayment
    ? "bg-amber-50/60 dark:bg-amber-950/15"
    : "bg-emerald-50/60 dark:bg-emerald-950/15";
  const iconColor = isPayment
    ? "text-amber-600 dark:text-amber-400"
    : "text-emerald-600 dark:text-emerald-400";
  const title = isPayment ? "Payment Voucher" : "Receipt Voucher";
  const accountLabel = isPayment ? "Pay From" : "Receive Into";
  const accountPlaceholder = isPayment ? "Pay from..." : "Receive into...";
  const accountTestId = isPayment ? "input-pay-from" : "input-receive-in";

  // Action guards
  const hasExport = Boolean(handleExportVoucher);
  const hasAnyEntry = entries.some((e) => (e?.accountId ?? 0) > 0);
  const canRunActions = paymentAccountId !== 0;
  const canPrint = canRunActions && hasAnyEntry;
  const canExport = canRunActions && hasAnyEntry && hasExport;

  // Validation state for summary warnings
  const validEntryCount = entries.filter(
    (e) => (e?.accountId ?? 0) > 0 && parseFloat(e?.amount || "0") > 0
  ).length;
  const missingAccount = paymentAccountId === 0;
  const missingEntries = validEntryCount === 0;

  // Balance display helpers
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

  // Projected balance: Payment subtracts total, Receipt adds total.
  // In edit mode, Payment restores the original amount first then subtracts the new total.
  const projected = isPayment
    ? isEditMode
      ? accountBalance + originalTotal - total
      : accountBalance - total
    : accountBalance + total;

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* ── Left column: form ── */}
      <div className="flex-1 min-w-0">
        <Card>
          {/* Header */}
          <CardHeader
            className={cn(
              "p-4 sm:p-5 rounded-t-lg flex flex-row items-center gap-3 flex-wrap",
              headerBg
            )}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Icon className={cn("h-5 w-5 shrink-0", iconColor)} />
              <CardTitle className="text-base sm:text-lg">{title}</CardTitle>
              {isEditMode && (
                <Badge
                  variant="secondary"
                  className="text-xs shrink-0"
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
          </CardHeader>

          <CardContent>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-6"
                noValidate
              >
                {/* ── Row 1: account | date | actions ── */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_180px_auto] lg:items-start">
                  {/* Account selector */}
                  <FormField
                    control={form.control}
                    name="paymentAccountId"
                    render={() => (
                      <FormItem className="min-w-0">
                        <FormLabel>{accountLabel}</FormLabel>
                        <FormControl>
                          <div className="w-full min-w-0">
                            <AccountAutocomplete
                              value={
                                paymentAccountId > 0
                                  ? {
                                      type: paymentAccountType,
                                      id: paymentAccountId,
                                      name: paymentAccountName,
                                    }
                                  : null
                              }
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
                        </FormControl>

                        {/* Balance / projection display */}
                        {paymentAccountId > 0 &&
                          (accountCurrencyBalances &&
                          accountCurrencyBalances.length > 0 ? (
                            <div className="flex flex-col gap-0.5 mt-1.5">
                              {accountCurrencyBalances.map(
                                ({ currency, balance }) => (
                                  <div
                                    key={currency}
                                    className="flex items-center gap-1.5 text-sm font-mono"
                                  >
                                    <span className="text-muted-foreground text-xs">
                                      Bal:
                                    </span>
                                    <span className={cn(balColor(balance))}>
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
                            <div className="flex items-center gap-1.5 flex-wrap text-sm mt-1.5 font-mono">
                              <span className="text-muted-foreground text-xs">
                                Bal:
                              </span>
                              <span className={cn(balColor(accountBalance))}>
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
                                  <span className="text-muted-foreground text-xs">
                                    after
                                  </span>
                                </>
                              )}
                            </div>
                          ))}

                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Date */}
                  <FormField
                    control={form.control}
                    name="voucherDate"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel>Date</FormLabel>
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

                  {/* Print / Export */}
                  <div className="flex flex-col gap-1 lg:items-end lg:pt-[22px]">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="default"
                        disabled={!canPrint}
                        onClick={handlePrint}
                        data-testid="button-print"
                      >
                        <Printer className="h-4 w-4 mr-2" />
                        Print
                      </Button>
                      {hasExport && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="default"
                              disabled={!canExport}
                              data-testid="button-export"
                            >
                              <FileDown className="h-4 w-4 mr-2" />
                              Export
                              <ChevronDown className="h-4 w-4 ml-2" />
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
                  handleSidebarAccountSelect={handleSidebarAccountSelect}
                  sidebarAccounts={sidebarAccounts}
                  onRowFocus={(rowIndex, fieldName) => {
                    if (fieldName === "account") {
                      setActiveRowIndex(rowIndex);
                      const currentAccountName =
                        entries[rowIndex]?.accountName || "";
                      setSidebarSearchValue(currentAccountName);
                    }
                  }}
                  onRowBlur={() => {
                    // intentionally blank — amount commit clears active row
                  }}
                  isFactoryCompany={isFactoryCompany}
                  onAutoCreateAccount={onAutoCreateAccount}
                  isAutoCreating={isAutoCreating}
                />

                {/* ── Summary / validation ── */}
                <div className="rounded-md border bg-muted/30 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-4 text-sm">
                    <span className="text-muted-foreground">
                      Lines:{" "}
                      <span className="font-medium text-foreground">
                        {validEntryCount}
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      Total:{" "}
                      <span
                        className={cn(
                          "font-semibold tabular-nums",
                          total > 0
                            ? "text-foreground"
                            : "text-muted-foreground"
                        )}
                        data-testid="text-total-amount"
                      >
                        {total > 0 ? formatAmount(total) : "—"}
                      </span>
                    </span>
                  </div>

                  {/* Validation hints */}
                  {(missingAccount || missingEntries) && (
                    <div className="flex flex-col gap-1">
                      {missingAccount && (
                        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            {accountLabel} account is required
                          </span>
                        </div>
                      )}
                      {!missingAccount && missingEntries && (
                        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span>Add at least one entry with an amount</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Notes (collapsible) ── */}
                <Collapsible open={notesOpen} onOpenChange={setNotesOpen}>
                  <div className="flex items-center justify-between gap-2">
                    <CollapsibleTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="flex items-center gap-1.5 px-1 text-muted-foreground"
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
                              rows={3}
                              data-testid="input-notes"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CollapsibleContent>
                </Collapsible>

                {/* ── Optional toggle + Submit ── */}
                <div className="flex items-center justify-between gap-4 pt-1 flex-wrap">
                  <FormField
                    control={form.control}
                    name="optional"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center gap-3 space-y-0">
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="checkbox-optional"
                          />
                        </FormControl>
                        <div className="space-y-0.5 leading-none">
                          <FormLabel className="cursor-pointer">
                            Mark as Optional
                          </FormLabel>
                          <p className="text-xs text-muted-foreground">
                            Excluded from required balance checks
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
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>

      {/* ── Right column: Account Sidebar — hidden on mobile ── */}
      <div
        className="hidden sm:block w-full lg:w-[40%] lg:sticky lg:top-4 h-fit"
        style={{ maxHeight: "calc(100vh - 2rem)" }}
      >
        <AccountSidebar
          accounts={sidebarAccounts}
          filteredAccounts={filteredSidebarAccounts}
          onSelectAccount={handleSidebarAccountSelect}
          searchValue={sidebarSearchValue}
          onSearchChange={setSidebarSearchValue}
          selectedAccountId={selectedAccountId}
          selectedAccountType={selectedAccountType}
          highlightedIndex={sidebarHighlightedIndex}
          onHighlightedIndexChange={setSidebarHighlightedIndex}
          entries={entries}
          mode={activeTab}
          paymentAccountId={paymentAccountId}
          paymentAccountType={paymentAccountType}
          voucherTotal={total}
          onCreateAccount={isFactoryCompany ? undefined : onCreateAccount}
          isFactoryCompany={isFactoryCompany}
          onAutoCreateAccount={onAutoCreateAccount}
          isAutoCreating={isAutoCreating}
        />
      </div>
    </div>
  );
}
