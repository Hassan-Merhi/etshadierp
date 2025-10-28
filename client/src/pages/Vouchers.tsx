import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { useReactToPrint } from "react-to-print";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CalendarIcon, Printer, Plus, Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Types
interface BankAccount {
  id: number;
  accountNumber: string;
  bankName: string;
  accountName: string;
  balance: string;
}

interface LedgerAccount {
  id: number;
  code: string;
  name: string;
  accountType: string;
}

interface Supplier {
  id: number;
  code: string;
  legalName: string;
}

interface VoucherEntry {
  accountType: "ledger" | "bank" | "supplier";
  accountId: number;
  accountName: string;
  amount: string;
}

const voucherEntrySchema = z.object({
  accountType: z.enum(["ledger", "bank", "supplier"]),
  accountId: z.number().min(1, "Please select an account"),
  accountName: z.string(),
  amount: z.string()
    .min(1, "Amount required")
    .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
      message: "Amount must be a positive number",
    }),
});

const voucherFormSchema = z.object({
  bankAccountId: z.number().min(1, "Please select a bank account"),
  voucherDate: z.date(),
  entries: z.array(voucherEntrySchema).min(1, "Add at least one entry"),
  notes: z.string().optional(),
});

type VoucherFormData = z.infer<typeof voucherFormSchema>;

// Account Combobox Component
function AccountCombobox({
  value,
  onChange,
  ledgerAccounts,
  bankAccounts,
  suppliers,
  rowIndex,
  onFocus,
}: {
  value: { type: string; id: number; name: string } | null;
  onChange: (type: "ledger" | "bank" | "supplier", id: number, name: string) => void;
  ledgerAccounts: LedgerAccount[];
  bankAccounts: BankAccount[];
  suppliers: Supplier[];
  rowIndex: number;
  onFocus?: () => void;
}) {
  const [open, setOpen] = useState(false);

  const allAccounts = [
    ...ledgerAccounts.map((a) => ({
      type: "ledger" as const,
      id: a.id,
      name: `${a.code} - ${a.name}`,
    })),
    ...bankAccounts.map((a) => ({
      type: "bank" as const,
      id: a.id,
      name: `${a.accountNumber} - ${a.bankName}`,
    })),
    ...suppliers.map((s) => ({
      type: "supplier" as const,
      id: s.id,
      name: `${s.code} - ${s.legalName}`,
    })),
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          data-testid={`button-account-${rowIndex}`}
          onFocus={onFocus}
        >
          {value ? value.name : "Select account..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0">
        <Command>
          <CommandInput placeholder="Search accounts..." />
          <CommandList>
            <CommandEmpty>No account found.</CommandEmpty>
            <CommandGroup>
              {allAccounts.map((account) => (
                <CommandItem
                  key={`${account.type}-${account.id}`}
                  value={account.name}
                  onSelect={() => {
                    onChange(account.type, account.id, account.name);
                    setOpen(false);
                  }}
                  data-testid={`option-account-${account.type}-${account.id}`}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value?.type === account.type && value?.id === account.id
                        ? "opacity-100"
                        : "opacity-0"
                    )}
                  />
                  {account.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Print Template Component
const PrintTemplate = ({
  voucherType,
  bankAccount,
  date,
  entries,
  notes,
  total,
}: {
  voucherType: "Payment" | "Receipt";
  bankAccount: BankAccount | null;
  date: Date;
  entries: VoucherEntry[];
  notes: string;
  total: number;
}) => {
  return (
    <div className="p-8 max-w-4xl mx-auto bg-white text-black">
      <div className="border-2 border-black p-6">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold">{voucherType} Voucher</h1>
          <p className="text-sm mt-1">Date: {format(date, "PPP")}</p>
        </div>

        <div className="mb-6">
          <h2 className="font-bold text-lg mb-2">
            {voucherType === "Payment" ? "Paid From:" : "Received In:"}
          </h2>
          {bankAccount && (
            <div className="text-sm">
              <p>
                <strong>Bank:</strong> {bankAccount.bankName}
              </p>
              <p>
                <strong>Account:</strong> {bankAccount.accountName} ({bankAccount.accountNumber})
              </p>
              <p>
                <strong>Balance (Before Transaction):</strong> ${parseFloat(bankAccount.balance || "0").toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
            </div>
          )}
        </div>

        <table className="w-full border border-black mb-6">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-black p-2 text-left">#</th>
              <th className="border border-black p-2 text-left">Account</th>
              <th className="border border-black p-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => (
              <tr key={index}>
                <td className="border border-black p-2">{index + 1}</td>
                <td className="border border-black p-2">{entry.accountName}</td>
                <td className="border border-black p-2 text-right font-mono">
                  ${parseFloat(entry.amount || "0").toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </td>
              </tr>
            ))}
            <tr className="bg-gray-100 font-bold">
              <td colSpan={2} className="border border-black p-2 text-right">
                Total:
              </td>
              <td className="border border-black p-2 text-right font-mono">
                ${total.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </td>
            </tr>
          </tbody>
        </table>

        {notes && (
          <div className="mb-6">
            <h3 className="font-bold mb-2">Notes:</h3>
            <p className="text-sm whitespace-pre-wrap">{notes}</p>
          </div>
        )}

        <div className="mt-12 pt-6 border-t border-gray-400 flex justify-between">
          <div className="text-center">
            <div className="border-t border-black pt-2 w-48">Prepared By</div>
          </div>
          <div className="text-center">
            <div className="border-t border-black pt-2 w-48">Approved By</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function Vouchers() {
  const [activeTab, setActiveTab] = useState<"payment" | "receipt">("payment");
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  // Fetch data
  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({
    queryKey: ["/api/bank-accounts"],
  });

  const { data: ledgerAccounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger-accounts"],
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const form = useForm<VoucherFormData>({
    resolver: zodResolver(voucherFormSchema),
    defaultValues: {
      bankAccountId: 0,
      voucherDate: new Date(),
      entries: [
        {
          accountType: "ledger",
          accountId: 0,
          accountName: "",
          amount: "",
        },
      ],
      notes: "",
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "entries",
  });

  // Calculate total
  const entries = form.watch("entries");
  const total = entries.reduce(
    (sum, entry) => sum + (parseFloat(entry.amount) || 0),
    0
  );

  // Get selected bank account
  const selectedBankId = form.watch("bankAccountId");
  const selectedBank = bankAccounts.find((b) => b.id === selectedBankId);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (data: VoucherFormData) => {
      const voucherType = activeTab === "payment" ? "Payment" : "Receipt";
      
      // Create voucher
      const voucherRes = await apiRequest("POST", "/api/vouchers", {
        voucherNumber: `${voucherType.toUpperCase()}-${Date.now()}`,
        voucherType,
        voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
        description: `${voucherType} voucher`,
        totalAmount: total.toString(),
      });
      const voucher = await voucherRes.json();

      // Create voucher entries
      for (const entry of data.entries) {
        const voucherType = activeTab === "payment" ? "Payment" : "Receipt";
        const narration = `${voucherType} - ${entry.accountName}`;
        
        const entryData: any = {
          voucherId: voucher.id,
          narration,
        };

        if (activeTab === "payment") {
          // Payment: Debit the accounts, Credit the bank
          if (entry.accountType === "ledger") {
            entryData.ledgerAccountId = entry.accountId;
          } else if (entry.accountType === "bank") {
            entryData.bankAccountId = entry.accountId;
          } else if (entry.accountType === "supplier") {
            entryData.supplierId = entry.accountId;
          }
          entryData.debitAmount = entry.amount;
          entryData.creditAmount = "0";

          await apiRequest("POST", "/api/voucher-entries", entryData);

          // Credit the bank account
          await apiRequest("POST", "/api/voucher-entries", {
            voucherId: voucher.id,
            bankAccountId: data.bankAccountId,
            debitAmount: "0",
            creditAmount: entry.amount,
            narration,
          });
        } else {
          // Receipt: Debit the bank, Credit the accounts
          await apiRequest("POST", "/api/voucher-entries", {
            voucherId: voucher.id,
            bankAccountId: data.bankAccountId,
            debitAmount: entry.amount,
            creditAmount: "0",
            narration,
          });

          // Credit the account
          if (entry.accountType === "ledger") {
            entryData.ledgerAccountId = entry.accountId;
          } else if (entry.accountType === "bank") {
            entryData.bankAccountId = entry.accountId;
          } else if (entry.accountType === "supplier") {
            entryData.supplierId = entry.accountId;
          }
          entryData.debitAmount = "0";
          entryData.creditAmount = entry.amount;

          await apiRequest("POST", "/api/voucher-entries", entryData);
        }
      }

      return voucher;
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: `${activeTab === "payment" ? "Payment" : "Receipt"} voucher created successfully`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      form.reset({
        bankAccountId: selectedBankId,
        voucherDate: new Date(),
        entries: [
          {
            accountType: "ledger",
            accountId: 0,
            accountName: "",
            amount: "",
          },
        ],
        notes: "",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create voucher",
        variant: "destructive",
      });
    },
  });

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `${activeTab === "payment" ? "Payment" : "Receipt"}-Voucher-${format(
      form.watch("voucherDate"),
      "yyyy-MM-dd"
    )}`,
  });

  const onSubmit = (data: VoucherFormData) => {
    // Validate that all amounts are numeric and positive
    const validEntries = data.entries.filter(entry => entry.accountId > 0 && entry.amount);
    if (validEntries.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please add at least one valid entry",
        variant: "destructive",
      });
      return;
    }

    // Calculate total debits and credits to ensure balance
    const totalDebits = validEntries.reduce((sum, entry) => {
      const amount = parseFloat(entry.amount);
      return sum + (isNaN(amount) ? 0 : amount);
    }, 0);
    
    const totalCredits = totalDebits; // In our model, each entry creates matching debit/credit pairs

    // Validate numeric totals
    if (isNaN(totalDebits) || totalDebits <= 0) {
      toast({
        title: "Validation Error",
        description: "Invalid amounts detected. Please check your entries.",
        variant: "destructive",
      });
      return;
    }

    saveMutation.mutate(data);
  };

  // Keyboard navigation handlers
  const handleKeyDown = (
    e: React.KeyboardEvent,
    rowIndex: number,
    fieldName: "amount"
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (fieldName === "amount") {
        // Add new row when pressing Enter on amount field
        append({
          accountType: "ledger",
          accountId: 0,
          accountName: "",
          amount: "",
        });
        // Focus will naturally move to next row
      }
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-page-title">
          Vouchers
        </h1>
        <p className="text-muted-foreground mt-1">
          Create payment and receipt vouchers
        </p>
      </div>

      {/* Hidden print template */}
      <div className="hidden">
        <div ref={printRef}>
          <PrintTemplate
            voucherType={activeTab === "payment" ? "Payment" : "Receipt"}
            bankAccount={selectedBank || null}
            date={form.watch("voucherDate")}
            entries={entries.filter((e) => e.accountId > 0 && e.amount)}
            notes={form.watch("notes") || ""}
            total={total}
          />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "payment" | "receipt")}>
        <TabsList>
          <TabsTrigger value="payment" data-testid="tab-payment">
            Payment Voucher
          </TabsTrigger>
          <TabsTrigger value="receipt" data-testid="tab-receipt">
            Receipt Voucher
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>
                {activeTab === "payment" ? "Payment" : "Receipt"} Voucher
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  {/* Header section */}
                  <div className="flex items-start justify-between gap-4">
                    {/* Left: Bank account selector */}
                    <FormField
                      control={form.control}
                      name="bankAccountId"
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormLabel>
                            {activeTab === "payment" ? "Pay From" : "Receive In"}
                          </FormLabel>
                          <Select
                            onValueChange={(value) => field.onChange(parseInt(value))}
                            value={field.value?.toString()}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-bank-account">
                                <SelectValue placeholder="Select bank account" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {bankAccounts.map((account) => (
                                <SelectItem
                                  key={account.id}
                                  value={account.id.toString()}
                                  data-testid={`option-bank-${account.id}`}
                                >
                                  {account.bankName} - {account.accountNumber}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {selectedBank && (
                            <p className="text-sm text-muted-foreground mt-1">
                              Balance: $
                              {parseFloat(selectedBank.balance).toLocaleString(undefined, {
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
                        disabled={!selectedBank || entries.filter((e) => e.accountId > 0).length === 0}
                        data-testid="button-print"
                      >
                        <Printer className="h-4 w-4 mr-2" />
                        Print
                      </Button>
                    </div>
                  </div>

                  {/* Spreadsheet table */}
                  <div className="border rounded-md overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-3 font-medium w-[70%]">Account</th>
                          <th className="text-left p-3 font-medium w-[25%]">Amount</th>
                          <th className="w-[5%]"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {fields.map((field, index) => (
                          <tr key={field.id} className="border-t">
                            <td className="p-2">
                              <FormField
                                control={form.control}
                                name={`entries.${index}.accountId`}
                                render={({ field: accountField }) => (
                                  <FormItem>
                                    <FormControl>
                                      <AccountCombobox
                                        value={
                                          entries[index].accountId > 0
                                            ? {
                                                type: entries[index].accountType,
                                                id: entries[index].accountId,
                                                name: entries[index].accountName,
                                              }
                                            : null
                                        }
                                        onChange={(type, id, name) => {
                                          form.setValue(`entries.${index}.accountType`, type);
                                          form.setValue(`entries.${index}.accountId`, id);
                                          form.setValue(`entries.${index}.accountName`, name);
                                        }}
                                        ledgerAccounts={ledgerAccounts}
                                        bankAccounts={bankAccounts}
                                        suppliers={suppliers}
                                        rowIndex={index}
                                      />
                                    </FormControl>
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
                                        className="font-mono"
                                        data-testid={`input-amount-${index}`}
                                        onKeyDown={(e) => handleKeyDown(e, index, "amount")}
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
                              onClick={() =>
                                append({
                                  accountType: "ledger",
                                  accountId: 0,
                                  accountName: "",
                                  amount: "",
                                })
                              }
                              data-testid="button-add-row"
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Add Row
                            </Button>
                          </td>
                          <td className="p-3">
                            <div className="text-right font-bold font-mono">
                              ${total.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </div>
                          </td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

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

                  {/* Submit button */}
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      disabled={saveMutation.isPending || total === 0}
                      data-testid="button-save-voucher"
                    >
                      {saveMutation.isPending ? "Saving..." : "Save Voucher"}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
