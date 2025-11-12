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

interface PaymentVoucherTabProps {
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
  sidebarSearchValue: string;
  setSidebarSearchValue: (value: string) => void;
  sidebarHighlightedIndex: number;
  setSidebarHighlightedIndex: (index: number) => void;
  sidebarActiveTab: string;
  setSidebarActiveTab: (tab: string) => void;
  mostUsedAccounts: Account[];
  handleSidebarAccountSelect: (account: Account) => void;
  handlePrint: () => void;
  onSubmit: (values: any) => void;
  activeTab: "payment" | "receipt";
}

export function PaymentVoucherTab({
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
  sidebarSearchValue,
  setSidebarSearchValue,
  sidebarHighlightedIndex,
  setSidebarHighlightedIndex,
  sidebarActiveTab,
  setSidebarActiveTab,
  mostUsedAccounts,
  handleSidebarAccountSelect,
  handlePrint,
  onSubmit,
  activeTab,
}: PaymentVoucherTabProps) {
  return (
    <div className="flex gap-4">
      {/* Left column: Form (60%) */}
      <div className="flex-1" style={{ width: "60%" }}>
        <Card>
          <CardHeader>
            <CardTitle>Payment Voucher</CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {/* Header section */}
                <div className="flex items-start justify-between gap-4">
                  {/* Left: Payment account selector */}
                  <FormField
                    control={form.control}
                    name="paymentAccountId"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormLabel>
                          {activeTab === "payment" ? "Pay From" : "Receive In"}
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
                            placeholder={activeTab === "payment" ? "Pay from..." : "Receive in..."}
                            testId="input-pay-from"
                          />
                        </FormControl>
                        {paymentAccountId > 0 && (
                          <p className="text-sm text-muted-foreground mt-1">
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
                  <div className="flex items-end gap-2">
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
                                    "w-[200px] justify-start text-left font-normal",
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

                    <Button
                      type="button"
                      variant="outline"
                      onClick={handlePrint}
                      disabled={paymentAccountId === 0 || entries.filter((e) => e.accountId > 0).length === 0}
                      data-testid="button-print"
                    >
                      <Printer className="h-4 w-4 mr-2" />
                      Print
                    </Button>
                  </div>
                </div>

                {/* Entries table */}
                <VoucherEntriesTable
                  form={form}
                  fieldArray={fieldArray}
                  entries={entries}
                  total={total}
                  mode="payment"
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
                <div className="flex justify-end">
                  <Button
                    type="submit"
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
          onSelectAccount={handleSidebarAccountSelect}
          searchValue={sidebarSearchValue}
          onSearchChange={setSidebarSearchValue}
          selectedAccountId={null}
          highlightedIndex={sidebarHighlightedIndex}
          onHighlightedIndexChange={setSidebarHighlightedIndex}
          activeTab={sidebarActiveTab}
          onTabChange={setSidebarActiveTab}
          mostUsedAccounts={mostUsedAccounts}
        />
      </div>
    </div>
  );
}
