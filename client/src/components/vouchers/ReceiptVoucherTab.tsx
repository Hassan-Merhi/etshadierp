import { UseFormReturn, UseFieldArrayReturn } from "react-hook-form";
import { format } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { Button } from "@/components/ui/button";
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
import { Printer, FileDown, ChevronDown, ArrowDownCircle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { AccountAutocomplete } from "@/components/AccountAutocomplete";
import type { CombinedAccount } from "@/components/AccountAutocomplete";
import AccountSidebar, { Account } from "@/components/AccountSidebar";
import { VoucherEntriesTable } from "@/components/vouchers/VoucherEntriesTable";
import { useCurrencyContext } from "@/contexts/CurrencyContext";

interface ReceiptVoucherTabProps {
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
}

export function ReceiptVoucherTab({
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
}: ReceiptVoucherTabProps) {
  const { formatAmount } = useCurrencyContext();
  const { formatDisplayDate } = useDateFormat();
  const hasExport = Boolean(handleExportVoucher);
  const hasAnyEntry = entries.some((e) => (e?.accountId ?? 0) > 0);
  const canRunActions = paymentAccountId !== 0;
  const canPrint = canRunActions && hasAnyEntry;
  const canExport = canRunActions && hasAnyEntry && hasExport;

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* Left column: Form */}
      <div className="flex-1 min-w-0">
        <Card>
          <CardHeader className="p-4 sm:p-5 bg-emerald-50/60 dark:bg-emerald-950/15 rounded-t-lg flex flex-row items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <ArrowDownCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <CardTitle className="text-base sm:text-lg">Receipt Voucher</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-6"
               noValidate>
                {/* Header section */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_180px_auto] lg:items-start">
                  {/* Receive In account selector */}
                  <FormField
                    control={form.control}
                    name="paymentAccountId"
                    render={() => (
                      <FormItem className="min-w-0">
                        <FormLabel>Receive In</FormLabel>
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
                              placeholder="Receive in..."
                              testId="input-receive-in"
                            />
                          </div>
                        </FormControl>
                        {paymentAccountId > 0 && (() => {
                          const balColor = (v: number) => v < 0 ? "text-red-600 dark:text-red-400" : v > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground";
                          const fmtCurr = (n: number, curr: string) =>
                            curr !== "USD"
                              ? `${curr} ${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : formatAmount(Math.abs(n));

                          if (accountCurrencyBalances && accountCurrencyBalances.length > 0) {
                            return (
                              <div className="flex flex-col gap-0.5 mt-1.5">
                                {accountCurrencyBalances.map(({ currency, balance }) => (
                                  <div key={currency} className="flex items-center gap-1.5 text-sm font-mono">
                                    <span className="text-muted-foreground text-xs">Bal:</span>
                                    <span className={cn(balColor(balance))}>
                                      {fmtCurr(balance, currency)} {balance > 0 ? "CR" : balance < 0 ? "DR" : ""}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            );
                          }

                          const projected = accountBalance + total;
                          return (
                            <div className="flex items-center gap-1.5 flex-wrap text-sm mt-1.5 font-mono">
                              <span className="text-muted-foreground text-xs">Bal:</span>
                              <span className={cn(balColor(accountBalance))}>{formatAmount(accountBalance)}</span>
                              {total > 0 && (
                                <>
                                  <span className="text-muted-foreground">→</span>
                                  <span className={cn("font-semibold", balColor(projected))}>{formatAmount(projected)}</span>
                                  <span className="text-muted-foreground text-xs">after</span>
                                </>
                              )}
                            </div>
                          );
                        })()}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Date input (typable) */}
                  <FormField
                    control={form.control}
                    name="voucherDate"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel>Date</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            value={field.value instanceof Date ? format(field.value, "yyyy-MM-dd") : (typeof field.value === "string" ? field.value : "")}
                            onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value + "T00:00:00") : new Date())}
                            data-testid="input-date-picker"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Print + Export actions */}
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

                {/* Entries table */}
                <VoucherEntriesTable
                  form={form}
                  fieldArray={fieldArray}
                  entries={entries}
                  total={total}
                  mode="receipt"
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
                      // Don't set highlightedIndex here - let the useEffect in Vouchers.tsx handle it
                    }
                  }}
                  onRowBlur={() => {
                    // Don't clear activeRow on blur - let amount commit handle it
                  }}
                  isFactoryCompany={isFactoryCompany}
                  onAutoCreateAccount={onAutoCreateAccount}
                  isAutoCreating={isAutoCreating}
                />

                {/* Notes field */}
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
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

                {/* Optional toggle + submit */}
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
                          <FormLabel className="cursor-pointer">Mark as Optional</FormLabel>
                          <p className="text-xs text-muted-foreground">Excluded from required balance checks</p>
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
                      ? (isEditMode ? "Updating…" : "Saving…")
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

      {/* Right column: Account Sidebar — hidden on mobile, visible on sm+ */}
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
