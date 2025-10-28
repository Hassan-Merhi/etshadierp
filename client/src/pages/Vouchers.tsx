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

interface JournalEntry {
  accountType: "ledger" | "bank" | "supplier";
  accountId: number;
  accountName: string;
  debitAmount: string;
  creditAmount: string;
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

const journalEntrySchema = z.object({
  accountType: z.enum(["ledger", "bank", "supplier"]),
  accountId: z.number().min(1, "Please select an account"),
  accountName: z.string(),
  debitAmount: z.string().refine((val) => val === "" || (!isNaN(parseFloat(val)) && parseFloat(val) >= 0), {
    message: "Debit must be a positive number or empty",
  }),
  creditAmount: z.string().refine((val) => val === "" || (!isNaN(parseFloat(val)) && parseFloat(val) >= 0), {
    message: "Credit must be a positive number or empty",
  }),
}).refine((data) => {
  const debit = parseFloat(data.debitAmount) || 0;
  const credit = parseFloat(data.creditAmount) || 0;
  return debit > 0 || credit > 0;
}, {
  message: "Either debit or credit amount must be greater than 0",
});

const voucherFormSchema = z.object({
  paymentAccountType: z.enum(["ledger", "bank", "supplier"]),
  paymentAccountId: z.number().min(1, "Please select an account"),
  paymentAccountName: z.string(),
  voucherDate: z.date(),
  entries: z.array(voucherEntrySchema).min(1, "Add at least one entry"),
  notes: z.string().optional(),
});

const journalFormSchema = z.object({
  voucherDate: z.date(),
  entries: z.array(journalEntrySchema).min(1, "Add at least one entry"),
  notes: z.string().optional(),
});

type VoucherFormData = z.infer<typeof voucherFormSchema>;
type JournalFormData = z.infer<typeof journalFormSchema>;

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
  paymentAccountName,
  paymentAccountBalance,
  date,
  entries,
  notes,
  total,
}: {
  voucherType: "Payment" | "Receipt";
  paymentAccountName: string;
  paymentAccountBalance: number;
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
          {paymentAccountName && (
            <div className="text-sm">
              <p>
                <strong>Account:</strong> {paymentAccountName}
              </p>
              <p>
                <strong>Balance (Before Transaction):</strong> ${paymentAccountBalance.toLocaleString(undefined, {
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
  const [activeTab, setActiveTab] = useState<"payment" | "receipt" | "journal">("payment");
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
      paymentAccountType: "bank",
      paymentAccountId: 0,
      paymentAccountName: "",
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

  // Get selected payment account and calculate balance
  const paymentAccountType = form.watch("paymentAccountType");
  const paymentAccountId = form.watch("paymentAccountId");
  const paymentAccountName = form.watch("paymentAccountName");
  
  // Calculate balance for selected account
  const { data: accountBalance = 0 } = useQuery({
    queryKey: ["/api/accounts", paymentAccountType, paymentAccountId, "balance"],
    enabled: paymentAccountId > 0,
    queryFn: async () => {
      if (paymentAccountType === "bank") {
        const account = bankAccounts.find((b) => b.id === paymentAccountId);
        return account ? parseFloat(account.balance || "0") : 0;
      } else if (paymentAccountType === "ledger") {
        const res = await fetch(`/api/accounts/ledger/${paymentAccountId}/transactions`);
        const transactions = await res.json();
        const balance = transactions.reduce((sum: number, t: any) => {
          const debit = parseFloat(t.debitAmount || "0");
          const credit = parseFloat(t.creditAmount || "0");
          return sum + debit - credit;
        }, 0);
        return balance;
      } else if (paymentAccountType === "supplier") {
        const res = await fetch(`/api/accounts/supplier/${paymentAccountId}/transactions`);
        const transactions = await res.json();
        const balance = transactions.reduce((sum: number, t: any) => {
          const credit = parseFloat(t.creditAmount || "0");
          const debit = parseFloat(t.debitAmount || "0");
          return sum + credit - debit;
        }, 0);
        return balance;
      }
      return 0;
    },
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (formData: VoucherFormData) => {
      const data = formData;
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

        const paymentEntryData: any = {
          voucherId: voucher.id,
          narration,
        };

        if (activeTab === "payment") {
          // Payment: Debit the expense/asset accounts, Credit the payment account
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

          // Credit the payment account
          if (data.paymentAccountType === "ledger") {
            paymentEntryData.ledgerAccountId = data.paymentAccountId;
          } else if (data.paymentAccountType === "bank") {
            paymentEntryData.bankAccountId = data.paymentAccountId;
          } else if (data.paymentAccountType === "supplier") {
            paymentEntryData.supplierId = data.paymentAccountId;
          }
          paymentEntryData.debitAmount = "0";
          paymentEntryData.creditAmount = entry.amount;

          await apiRequest("POST", "/api/voucher-entries", paymentEntryData);
        } else {
          // Receipt: Debit the payment account, Credit the income/liability accounts
          if (data.paymentAccountType === "ledger") {
            paymentEntryData.ledgerAccountId = data.paymentAccountId;
          } else if (data.paymentAccountType === "bank") {
            paymentEntryData.bankAccountId = data.paymentAccountId;
          } else if (data.paymentAccountType === "supplier") {
            paymentEntryData.supplierId = data.paymentAccountId;
          }
          paymentEntryData.debitAmount = entry.amount;
          paymentEntryData.creditAmount = "0";

          await apiRequest("POST", "/api/voucher-entries", paymentEntryData);

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
    onSuccess: (voucher, formData) => {
      toast({
        title: "Success",
        description: `${activeTab === "payment" ? "Payment" : "Receipt"} voucher created successfully`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      form.reset({
        paymentAccountType: formData.paymentAccountType,
        paymentAccountId: formData.paymentAccountId,
        paymentAccountName: formData.paymentAccountName,
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

  // Journal form
  const journalForm = useForm<JournalFormData>({
    resolver: zodResolver(journalFormSchema),
    defaultValues: {
      voucherDate: new Date(),
      entries: [
        {
          accountType: "ledger",
          accountId: 0,
          accountName: "",
          debitAmount: "",
          creditAmount: "",
        },
      ],
      notes: "",
    },
  });

  const {
    fields: journalFields,
    append: appendJournal,
    remove: removeJournal,
  } = useFieldArray({
    control: journalForm.control,
    name: "entries",
  });

  const journalEntries = journalForm.watch("entries");
  const totalDebit = journalEntries.reduce(
    (sum, entry) => sum + (parseFloat(entry.debitAmount) || 0),
    0
  );
  const totalCredit = journalEntries.reduce(
    (sum, entry) => sum + (parseFloat(entry.creditAmount) || 0),
    0
  );

  // Journal save mutation
  const journalMutation = useMutation({
    mutationFn: async (formData: JournalFormData) => {
      const data = formData;
      
      // Create voucher
      const voucherRes = await apiRequest("POST", "/api/vouchers", {
        voucherType: "Journal",
        voucherDate: data.voucherDate.toISOString(),
        notes: data.notes || "",
        totalAmount: totalDebit.toString(),
      });
      const voucher = await voucherRes.json();

      // Create voucher entries
      for (const entry of data.entries) {
        if (entry.accountId === 0) continue;

        const narration = `Journal Entry - ${entry.accountName}`;
        const entryData: any = {
          voucherId: voucher.id,
          narration,
        };

        if (entry.accountType === "ledger") {
          entryData.ledgerAccountId = entry.accountId;
        } else if (entry.accountType === "bank") {
          entryData.bankAccountId = entry.accountId;
        } else if (entry.accountType === "supplier") {
          entryData.supplierId = entry.accountId;
        }

        entryData.debitAmount = entry.debitAmount || "0";
        entryData.creditAmount = entry.creditAmount || "0";

        await apiRequest("POST", "/api/voucher-entries", entryData);
      }

      return voucher;
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Journal voucher created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      journalForm.reset({
        voucherDate: new Date(),
        entries: [
          {
            accountType: "ledger",
            accountId: 0,
            accountName: "",
            debitAmount: "",
            creditAmount: "",
          },
        ],
        notes: "",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create journal voucher",
        variant: "destructive",
      });
    },
  });

  const onJournalSubmit = (data: JournalFormData) => {
    // Validate that all entries have valid accounts
    const validEntries = data.entries.filter(
      (entry) =>
        entry.accountId > 0 &&
        (parseFloat(entry.debitAmount) > 0 || parseFloat(entry.creditAmount) > 0)
    );

    if (validEntries.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please add at least one valid entry",
        variant: "destructive",
      });
      return;
    }

    // Validate that total debits equal total credits
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      toast({
        title: "Validation Error",
        description: `Debits ($${totalDebit.toFixed(2)}) must equal Credits ($${totalCredit.toFixed(2)})`,
        variant: "destructive",
      });
      return;
    }

    journalMutation.mutate(data);
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
            paymentAccountName={paymentAccountName}
            paymentAccountBalance={accountBalance}
            date={form.watch("voucherDate")}
            entries={entries.filter((e) => e.accountId > 0 && e.amount)}
            notes={form.watch("notes") || ""}
            total={total}
          />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "payment" | "receipt" | "journal")}>
        <TabsList>
          <TabsTrigger value="payment" data-testid="tab-payment">
            Payment
          </TabsTrigger>
          <TabsTrigger value="receipt" data-testid="tab-receipt">
            Receipt
          </TabsTrigger>
          <TabsTrigger value="journal" data-testid="tab-journal">
            Journal
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
                            <AccountCombobox
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
                              ledgerAccounts={ledgerAccounts}
                              bankAccounts={bankAccounts}
                              suppliers={suppliers}
                              rowIndex={-1}
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

        {/* Journal Voucher Tab */}
        <TabsContent value="journal" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Journal Voucher</CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...journalForm}>
                <form onSubmit={journalForm.handleSubmit(onJournalSubmit)} className="space-y-6">
                  {/* Header section */}
                  <div className="flex items-start justify-end gap-4">
                    <FormField
                      control={journalForm.control}
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
                                  data-testid="button-journal-date-picker"
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
                  </div>

                  {/* Spreadsheet table */}
                  <div className="border rounded-md overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-3 font-medium w-[50%]">Account</th>
                          <th className="text-left p-3 font-medium w-[20%]">Debit</th>
                          <th className="text-left p-3 font-medium w-[20%]">Credit</th>
                          <th className="w-[10%]"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {journalFields.map((field, index) => (
                          <tr key={field.id} className="border-t">
                            <td className="p-2">
                              <FormField
                                control={journalForm.control}
                                name={`entries.${index}.accountId`}
                                render={({ field: accountField }) => (
                                  <FormItem>
                                    <FormControl>
                                      <AccountCombobox
                                        value={
                                          journalEntries[index].accountId > 0
                                            ? {
                                                type: journalEntries[index].accountType,
                                                id: journalEntries[index].accountId,
                                                name: journalEntries[index].accountName,
                                              }
                                            : null
                                        }
                                        onChange={(type, id, name) => {
                                          journalForm.setValue(`entries.${index}.accountType`, type);
                                          journalForm.setValue(`entries.${index}.accountId`, id);
                                          journalForm.setValue(`entries.${index}.accountName`, name);
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
                                control={journalForm.control}
                                name={`entries.${index}.debitAmount`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormControl>
                                      <Input
                                        {...field}
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        placeholder="0.00"
                                        className="font-mono text-right"
                                        data-testid={`input-journal-debit-${index}`}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </td>
                            <td className="p-2">
                              <FormField
                                control={journalForm.control}
                                name={`entries.${index}.creditAmount`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormControl>
                                      <Input
                                        {...field}
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        placeholder="0.00"
                                        className="font-mono text-right"
                                        data-testid={`input-journal-credit-${index}`}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </td>
                            <td className="p-2">
                              {journalFields.length > 1 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeJournal(index)}
                                  data-testid={`button-journal-remove-${index}`}
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
                          <td className="p-3">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                appendJournal({
                                  accountType: "ledger",
                                  accountId: 0,
                                  accountName: "",
                                  debitAmount: "",
                                  creditAmount: "",
                                })
                              }
                              data-testid="button-journal-add-row"
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Add Row
                            </Button>
                          </td>
                          <td className="p-3">
                            <div className="text-right font-bold font-mono">
                              ${totalDebit.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="text-right font-bold font-mono">
                              ${totalCredit.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </div>
                          </td>
                          <td></td>
                        </tr>
                        {Math.abs(totalDebit - totalCredit) > 0.01 && (
                          <tr>
                            <td colSpan={4} className="p-3">
                              <div className="text-center text-sm text-destructive">
                                ⚠️ Debits and Credits must be equal. Difference: $
                                {Math.abs(totalDebit - totalCredit).toFixed(2)}
                              </div>
                            </td>
                          </tr>
                        )}
                      </tfoot>
                    </table>
                  </div>

                  {/* Notes field */}
                  <FormField
                    control={journalForm.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            placeholder="Additional notes..."
                            rows={3}
                            data-testid="input-journal-notes"
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
                      disabled={journalMutation.isPending || Math.abs(totalDebit - totalCredit) > 0.01}
                      data-testid="button-save-journal-voucher"
                    >
                      {journalMutation.isPending ? "Saving..." : "Save Journal Voucher"}
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
