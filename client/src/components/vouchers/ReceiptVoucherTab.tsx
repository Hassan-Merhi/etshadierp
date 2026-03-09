import { useState } from "react";
import { UseFormReturn, UseFieldArrayReturn } from "react-hook-form";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { CalendarIcon, Printer, FileDown, ChevronDown, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
}: ReceiptVoucherTabProps) {
  const { formatAmount } = useCurrencyContext();
  const { formatDisplayDate } = useDateFormat();
  const [mobileAccountOpen, setMobileAccountOpen] = useState(false);
  const hasExport = Boolean(handleExportVoucher);
  const hasAnyEntry = entries.some((e) => (e?.accountId ?? 0) > 0);
  const canRunActions = paymentAccountId !== 0;
  const canPrint = canRunActions && hasAnyEntry;
  const canExport = canRunActions && hasAnyEntry && hasExport;

  const accountSidebarProps = {
    accounts: sidebarAccounts,
    filteredAccounts: filteredSidebarAccounts,
    onSelectAccount: (account: Account) => {
      handleSidebarAccountSelect(account);
      setMobileAccountOpen(false);
    },
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
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* Form column */}
      <div className="flex-1 min-w-0">
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base sm:text-lg">
              Receipt Voucher
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-6"
              >
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
                        {paymentAccountId > 0 && (
                          <p className={cn("text-sm mt-1.5 font-mono", (() => {
                            const live = isEditMode ? accountBalance : (total > 0 ? accountBalance + total : accountBalance);
                            if (live < 0) return "text-red-600 dark:text-red-400";
                            if (live > 0) return "text-emerald-600 dark:text-emerald-400";
                            return "text-muted-foreground";
                          })())}>
                            Balance: {formatAmount(isEditMode ? accountBalance : (total > 0 ? accountBalance + total : accountBalance))}
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Date picker */}
                  <FormField
                    control={form.control}
                    name="voucherDate"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel>Date</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                className={cn(
                                  "h-10 w-full justify-start text-left font-normal",
                                  !field.value && "text-muted-foreground",
                                )}
                                data-testid="button-date-picker"
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                <span className="truncate">
                                  {field.value
                                    ? formatDisplayDate(field.value)
                                    : "Pick a date"}
                                </span>
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="end">
                            <Calendar
                              mode="single"
                              selected={field.value}
                              onSelect={field.onChange}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Actions dropdown */}
                  <div className="flex flex-col gap-1 lg:items-end">
                    <div className="text-sm font-medium text-transparent select-none">
                      Actions
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="default"
                          className="h-10"
                          disabled={!canRunActions}
                          data-testid="button-actions"
                        >
                          <Printer className="h-4 w-4 mr-2" />
                          Actions
                          <ChevronDown className="h-4 w-4 ml-2" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={handlePrint}
                          disabled={!canPrint}
                          data-testid="action-print"
                        >
                          <Printer className="h-4 w-4 mr-2" />
                          Print
                        </DropdownMenuItem>

                        {hasExport && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleExportVoucher?.(false)}
                              disabled={!canExport}
                              data-testid="export-summary"
                            >
                              <FileDown className="h-4 w-4 mr-2" />
                              Export (Summary)
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleExportVoucher?.(true)}
                              disabled={!canExport}
                              data-testid="export-detailed"
                            >
                              <FileDown className="h-4 w-4 mr-2" />
                              Export (Detailed)
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {/* Mobile: Select Account button (opens Sheet) */}
                <div className="block lg:hidden">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => setMobileAccountOpen(true)}
                    data-testid="button-mobile-select-account"
                  >
                    <Search className="h-4 w-4 mr-2" />
                    Select Account for Entry
                  </Button>
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
                    }
                  }}
                  onRowBlur={() => {}}
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

                {/* Optional checkbox */}
                <FormField
                  control={form.control}
                  name="optional"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-optional"
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>Mark as Optional</FormLabel>
                      </div>
                    </FormItem>
                  )}
                />

                {/* Submit button */}
                <div className="flex justify-end pt-2">
                  <Button
                    type="submit"
                    size="default"
                    disabled={paymentAccountId === 0 || total === 0}
                    data-testid="button-save-voucher"
                  >
                    Save Voucher
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>

      {/* Desktop sidebar (≥ lg) */}
      <div
        className="hidden lg:block sticky top-4 h-fit"
        style={{ width: "40%", maxHeight: "calc(100vh - 2rem)" }}
      >
        <AccountSidebar {...accountSidebarProps} onSelectAccount={handleSidebarAccountSelect} />
      </div>

      {/* Mobile sidebar Sheet (< lg) */}
      <Sheet open={mobileAccountOpen} onOpenChange={setMobileAccountOpen}>
        <SheetContent side="bottom" className="h-[82vh] p-0 flex flex-col">
          <SheetHeader className="px-4 pt-4 pb-2 border-b">
            <SheetTitle>Select Account</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-hidden">
            <AccountSidebar {...accountSidebarProps} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
