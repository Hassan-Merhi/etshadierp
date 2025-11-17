import { UseFormReturn, UseFieldArrayReturn } from "react-hook-form";
import { format } from "date-fns";
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
import { CalendarIcon, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { AccountAutocomplete } from "@/components/AccountAutocomplete";
import type { CombinedAccount } from "@/components/AccountAutocomplete";
import AccountSidebar, { Account } from "@/components/AccountSidebar";
import { VoucherEntriesTable } from "@/components/vouchers/VoucherEntriesTable";

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
  onSubmit: (values: any) => void;
  activeTab: "payment" | "receipt";
  activeRowIndex: number | null;
  setActiveRowIndex: (index: number | null) => void;
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
  onSubmit,
  activeTab,
  activeRowIndex,
  setActiveRowIndex,
}: ReceiptVoucherTabProps) {
  return (
    <div className="flex gap-4">
      {/* Left column: Form (60%) */}
      <div className="flex-1" style={{ width: "60%" }}>
        <Card>
          <CardHeader>
            <CardTitle>Receipt Voucher</CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {/* Header section */}
                <div className="flex items-end gap-6">
                  {/* Left: Payment account selector */}
                  <FormField
                    control={form.control}
                    name="paymentAccountId"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormLabel>
                          Receive In
                        </FormLabel>
                        <FormControl>
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
                        </FormControl>
                        {paymentAccountId > 0 && (
                          <p className="text-sm text-muted-foreground mt-1.5">
                            Balance: $
                            {accountBalance.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Right: Date picker and print button */}
                  <div className="flex items-center gap-3">
                    <FormField
                      control={form.control}
                      name="voucherDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant="outline"
                                  className={cn(
                                    "w-[180px] justify-start text-left font-normal",
                                    !field.value && "text-muted-foreground"
                                  )}
                                  data-testid="button-date-picker"
                                >
                                  <CalendarIcon className="mr-2 h-4 w-4" />
                                  {field.value ? format(field.value, "PPP") : "Pick a date"}
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

                    <div className="pt-6">
                      <Button
                        type="button"
                        variant="outline"
                        size="default"
                        onClick={handlePrint}
                        disabled={paymentAccountId === 0 || entries.filter((e) => e.accountId > 0).length === 0}
                        data-testid="button-print"
                      >
                        <Printer className="h-4 w-4 mr-2" />
                        Print
                      </Button>
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
                  onRowFocus={(rowIndex, fieldName) => {
                    if (fieldName === "account") {
                      setActiveRowIndex(rowIndex);
                      const currentAccountName = entries[rowIndex]?.accountName || "";
                      setSidebarSearchValue(currentAccountName);
                      // Don't set highlightedIndex here - let the useEffect in Vouchers.tsx handle it
                    }
                  }}
                  onRowBlur={() => {
                    // Don't clear activeRow on blur - let amount commit handle it
                  }}
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
                        <FormLabel>
                          Mark as Optional
                        </FormLabel>
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

      {/* Right column: Account Sidebar (40%) */}
      <div className="sticky top-4 h-fit" style={{ width: "40%", maxHeight: "calc(100vh - 2rem)" }}>
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
        />
      </div>
    </div>
  );
}
