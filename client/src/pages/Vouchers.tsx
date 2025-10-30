import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { useReactToPrint } from "react-to-print";
import { useCompany } from "@/contexts/CompanyContext";
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
  type: "DR" | "CR";
  accountType: "ledger" | "bank" | "supplier";
  accountId: number;
  accountName: string;
  amount: string;
}

interface StockItem {
  id: number;
  code: string;
  name: string;
  uom: string;
}

interface Location {
  id: number;
  code: string;
  name: string;
}

interface StockTransferEntry {
  sourceLocationId: number;
  sourceLocationName: string;
  stockItemId: number;
  stockItemName: string;
  quantity: string;
  rate: string;
}

interface StockAdjustmentEntry {
  stockItemId: number;
  stockItemName: string;
  quantity: string;
  rate: string;
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
  type: z.enum(["DR", "CR"]),
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

const stockTransferEntrySchema = z.object({
  sourceLocationId: z.number().min(1, "Please select a source location"),
  sourceLocationName: z.string(),
  stockItemId: z.number().min(1, "Please select a stock item"),
  stockItemName: z.string(),
  quantity: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Quantity must be positive"),
  rate: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Rate must be non-negative"),
});

const stockTransferFormSchema = z.object({
  voucherDate: z.date(),
  destinationLocationId: z.number().min(1, "Destination location required"),
  entries: z.array(stockTransferEntrySchema).min(1),
  notes: z.string().optional(),
});

const stockAdjustmentEntrySchema = z.object({
  stockItemId: z.number().min(1, "Please select a stock item"),
  stockItemName: z.string(),
  quantity: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) !== 0, "Quantity cannot be zero"),
  rate: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Rate must be non-negative"),
});

const stockAdjustmentFormSchema = z.object({
  voucherDate: z.date(),
  locationId: z.number().min(1, "Location required"),
  consumptionEntries: z.array(stockAdjustmentEntrySchema),
  productionEntries: z.array(stockAdjustmentEntrySchema),
  notes: z.string().optional(),
}).refine(
  (data) => data.consumptionEntries.length > 0 || data.productionEntries.length > 0,
  { message: "At least one entry (consumption or production) is required" }
);

type VoucherFormData = z.infer<typeof voucherFormSchema>;
type JournalFormData = z.infer<typeof journalFormSchema>;
type StockTransferFormData = z.infer<typeof stockTransferFormSchema>;
type StockAdjustmentFormData = z.infer<typeof stockAdjustmentFormSchema>;

// Account Combobox Component
function AccountCombobox({
  value,
  onChange,
  ledgerAccounts,
  bankAccounts,
  suppliers,
  rowIndex,
  onFocus,
  onKeyDown,
  testIdPrefix = "button-account",
}: {
  value: { type: string; id: number; name: string } | null;
  onChange: (type: "ledger" | "bank" | "supplier", id: number, name: string) => void;
  ledgerAccounts: LedgerAccount[];
  bankAccounts: BankAccount[];
  suppliers: Supplier[];
  rowIndex: number;
  onFocus?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  testIdPrefix?: string;
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
          data-testid={`${testIdPrefix}-${rowIndex}`}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
        >
          {value ? value.name : "Select account..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0 bg-popover text-popover-foreground">
        <Command className="bg-popover text-popover-foreground">
          <CommandInput placeholder="Search accounts..." className="bg-popover text-popover-foreground" />
          <CommandList className="bg-popover text-popover-foreground">
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

// Stock Item Combobox Component
function StockItemCombobox({
  value,
  onChange,
  stockItems,
  rowIndex,
  onFocus,
  onKeyDown,
  testIdPrefix = "button-stock-item",
}: {
  value: { id: number; name: string } | null;
  onChange: (id: number, name: string) => void;
  stockItems: StockItem[];
  rowIndex: number;
  onFocus?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  testIdPrefix?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          data-testid={`${testIdPrefix}-${rowIndex}`}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
        >
          {value ? value.name : "Select stock item..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0 bg-popover text-popover-foreground">
        <Command className="bg-popover text-popover-foreground">
          <CommandInput placeholder="Search stock items..." className="bg-popover text-popover-foreground" />
          <CommandList className="bg-popover text-popover-foreground">
            <CommandEmpty>No stock item found.</CommandEmpty>
            <CommandGroup>
              {stockItems.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.code} - ${item.name}`}
                  onSelect={() => {
                    onChange(item.id, `${item.code} - ${item.name}`);
                    setOpen(false);
                  }}
                  data-testid={`option-stock-item-${item.id}`}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value?.id === item.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {item.code} - {item.name}
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
  const [activeTab, setActiveTab] = useState<"payment" | "receipt" | "journal" | "transfer" | "adjustment">("payment");
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
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

  const { data: stockItems = [] } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items"],
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
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
        companyId: selectedCompany?.id,
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
          type: "DR",
          accountType: "ledger",
          accountId: 0,
          accountName: "",
          amount: "",
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
    (sum, entry) => sum + (entry.type === "DR" ? (parseFloat(entry.amount) || 0) : 0),
    0
  );
  const totalCredit = journalEntries.reduce(
    (sum, entry) => sum + (entry.type === "CR" ? (parseFloat(entry.amount) || 0) : 0),
    0
  );

  // Journal save mutation
  const journalMutation = useMutation({
    mutationFn: async (formData: JournalFormData) => {
      const data = formData;
      
      // Create voucher
      const voucherRes = await apiRequest("POST", "/api/vouchers", {
        companyId: selectedCompany?.id,
        voucherNumber: `JOURNAL-${Date.now()}`,
        voucherType: "Journal",
        voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
        description: "Journal voucher",
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

        // Set debit or credit based on type
        if (entry.type === "DR") {
          entryData.debitAmount = entry.amount;
          entryData.creditAmount = "0";
        } else {
          entryData.debitAmount = "0";
          entryData.creditAmount = entry.amount;
        }

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
            type: "DR",
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
        description: error.message || "Failed to create journal voucher",
        variant: "destructive",
      });
    },
  });

  const onJournalSubmit = (data: JournalFormData) => {
    // Validate that all entries have valid accounts
    const validEntries = data.entries.filter(
      (entry) => entry.accountId > 0 && parseFloat(entry.amount) > 0
    );

    if (validEntries.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please add at least one valid entry",
        variant: "destructive",
      });
      return;
    }

    // Validate that we have both DR and CR entries
    const hasDebit = validEntries.some((entry) => entry.type === "DR");
    const hasCredit = validEntries.some((entry) => entry.type === "CR");
    
    if (!hasDebit || !hasCredit) {
      toast({
        title: "Validation Error",
        description: "Journal must have both DR (debit) and CR (credit) entries",
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

  // Stock Transfer form
  const stockTransferForm = useForm<StockTransferFormData>({
    resolver: zodResolver(stockTransferFormSchema),
    defaultValues: {
      voucherDate: new Date(),
      destinationLocationId: 0,
      entries: [
        {
          sourceLocationId: 0,
          sourceLocationName: "",
          stockItemId: 0,
          stockItemName: "",
          quantity: "",
          rate: "",
        },
      ],
      notes: "",
    },
  });

  const {
    fields: transferFields,
    append: appendTransfer,
    remove: removeTransfer,
  } = useFieldArray({
    control: stockTransferForm.control,
    name: "entries",
  });

  const transferEntries = stockTransferForm.watch("entries");
  const transferTotal = transferEntries.reduce(
    (sum, entry) => sum + (parseFloat(entry.quantity || "0") * parseFloat(entry.rate || "0")),
    0
  );

  // Track active transfer row for showing suggestions
  const [activeTransferRow, setActiveTransferRow] = useState<number | null>(null);
  const [transferInventorySource, setTransferInventorySource] = useState<number | null>(null);

  // Fetch inventory for the source location of the active row
  const { data: transferInventory = [] } = useQuery<any[]>({
    queryKey: transferInventorySource ? [`/api/locations/${transferInventorySource}/inventory`] : [],
    enabled: !!transferInventorySource && transferInventorySource > 0,
  });

  // Auto-fill rate when source location + stock item are selected
  useEffect(() => {
    transferEntries.forEach((entry, index) => {
      if (entry.sourceLocationId > 0 && entry.stockItemId > 0 && !entry.rate) {
        // Fetch inventory for source location and auto-fill rate
        fetch(`/api/locations/${entry.sourceLocationId}/inventory`)
          .then(res => res.json())
          .then(inventory => {
            const inventoryItem = inventory.find((item: any) => item.stockItemId === entry.stockItemId);
            if (inventoryItem && inventoryItem.averageRate) {
              stockTransferForm.setValue(`entries.${index}.rate`, inventoryItem.averageRate);
            }
          })
          .catch(err => console.error('Failed to fetch inventory:', err));
      }
    });
  }, [transferEntries.map(e => `${e.sourceLocationId}-${e.stockItemId}`).join(',')]);

  // Helper function to lookup account by code
  const lookupAccountByCode = (code: string): { type: "ledger" | "bank" | "supplier"; id: number; name: string } | null => {
    if (!code || code.trim() === "") return null;
    
    const searchCode = code.trim().toLowerCase();
    
    // Search ledger accounts by code
    const ledgerAccount = ledgerAccounts.find(
      (a) => a.code.toLowerCase() === searchCode
    );
    if (ledgerAccount) {
      return {
        type: "ledger",
        id: ledgerAccount.id,
        name: `${ledgerAccount.code} - ${ledgerAccount.name}`,
      };
    }
    
    // Search bank accounts by accountNumber
    const bankAccount = bankAccounts.find(
      (a) => a.accountNumber.toLowerCase() === searchCode
    );
    if (bankAccount) {
      return {
        type: "bank",
        id: bankAccount.id,
        name: `${bankAccount.accountNumber} - ${bankAccount.bankName}`,
      };
    }
    
    // Search suppliers by code
    const supplier = suppliers.find(
      (s) => s.code.toLowerCase() === searchCode
    );
    if (supplier) {
      return {
        type: "supplier",
        id: supplier.id,
        name: `${supplier.code} - ${supplier.legalName}`,
      };
    }
    
    return null;
  };

  // Helper function to lookup location by code
  const lookupLocationByCode = (code: string) => {
    const location = locations.find(
      (l) => l.code.toLowerCase() === code.toLowerCase()
    );
    return location;
  };

  // Helper function to lookup stock item by code
  const lookupStockItemByCode = (code: string) => {
    const item = stockItems.find(
      (s) => s.code.toLowerCase() === code.toLowerCase()
    );
    return item;
  };

  // Stock Transfer mutation
  const stockTransferMutation = useMutation({
    mutationFn: async (formData: StockTransferFormData) => {
      const data = formData;
      
      // Get unique source locations for description
      const uniqueSources = Array.from(new Set(data.entries.map(e => e.sourceLocationId)));
      const sourceNames = uniqueSources.map(id => locations.find(l => l.id === id)?.name).filter(Boolean).join(", ");
      const destName = locations.find(l => l.id === data.destinationLocationId)?.name;
      
      // Create voucher
      const voucherRes = await apiRequest("POST", "/api/vouchers", {
        companyId: selectedCompany?.id,
        voucherType: "StockTransfer",
        voucherNumber: `TRANSFER-${Date.now()}`,
        voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
        description: `Stock transfer from ${sourceNames} to ${destName}`,
        totalAmount: transferTotal.toString(),
      });
      const voucher = await voucherRes.json();

      // Create stock transfer with items (including per-item source locations)
      await apiRequest("POST", "/api/stock-transfers", {
        voucherId: voucher.id,
        destinationLocationId: data.destinationLocationId,
        notes: data.notes || "",
        items: data.entries.map(entry => ({
          sourceLocationId: entry.sourceLocationId,
          stockItemId: entry.stockItemId,
          quantity: entry.quantity,
          rate: entry.rate,
        })),
      });

      return voucher;
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Stock transfer voucher created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      stockTransferForm.reset({
        voucherDate: new Date(),
        destinationLocationId: 0,
        entries: [
          {
            sourceLocationId: 0,
            sourceLocationName: "",
            stockItemId: 0,
            stockItemName: "",
            quantity: "",
            rate: "",
          },
        ],
        notes: "",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create stock transfer",
        variant: "destructive",
      });
    },
  });

  const onStockTransferSubmit = (data: StockTransferFormData) => {
    // Validate entries
    const validEntries = data.entries.filter(
      (entry) => entry.stockItemId > 0 && entry.sourceLocationId > 0 && parseFloat(entry.quantity) > 0
    );

    if (validEntries.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please add at least one valid entry with source location",
        variant: "destructive",
      });
      return;
    }

    // Validate that each row's sourceLocationId !== destinationLocationId
    const invalidEntry = validEntries.find(entry => entry.sourceLocationId === data.destinationLocationId);
    if (invalidEntry) {
      toast({
        title: "Validation Error",
        description: "Source and destination locations must be different for each item",
        variant: "destructive",
      });
      return;
    }

    stockTransferMutation.mutate(data);
  };

  // Stock Adjustment form
  const stockAdjustmentForm = useForm<StockAdjustmentFormData>({
    resolver: zodResolver(stockAdjustmentFormSchema),
    defaultValues: {
      voucherDate: new Date(),
      locationId: 0,
      consumptionEntries: [],
      productionEntries: [],
      notes: "",
    },
  });

  const {
    fields: consumptionFields,
    append: appendConsumption,
    remove: removeConsumption,
  } = useFieldArray({
    control: stockAdjustmentForm.control,
    name: "consumptionEntries",
  });

  const {
    fields: productionFields,
    append: appendProduction,
    remove: removeProduction,
  } = useFieldArray({
    control: stockAdjustmentForm.control,
    name: "productionEntries",
  });

  const consumptionEntries = stockAdjustmentForm.watch("consumptionEntries") || [];
  const productionEntries = stockAdjustmentForm.watch("productionEntries") || [];
  const consumptionTotal = consumptionEntries.reduce(
    (sum, entry) => sum + (parseFloat(entry.quantity || "0") * parseFloat(entry.rate || "0")),
    0
  );
  const productionTotal = productionEntries.reduce(
    (sum, entry) => sum + (parseFloat(entry.quantity || "0") * parseFloat(entry.rate || "0")),
    0
  );

  // Stock Adjustment mutation
  const stockAdjustmentMutation = useMutation({
    mutationFn: async (formData: StockAdjustmentFormData) => {
      const data = formData;
      
      // Determine adjustment type based on which arrays have entries
      const hasConsumption = data.consumptionEntries.length > 0;
      const hasProduction = data.productionEntries.length > 0;
      const adjustmentType = hasConsumption && hasProduction 
        ? "Mixed" 
        : hasProduction 
          ? "Production" 
          : "Consumption";
      
      // Combine both arrays with consumption quantities negated
      const combinedItems = [
        ...data.consumptionEntries.map(entry => ({
          stockItemId: entry.stockItemId,
          quantity: (-parseFloat(entry.quantity)).toString(), // Negate for consumption
          rate: entry.rate,
        })),
        ...data.productionEntries.map(entry => ({
          stockItemId: entry.stockItemId,
          quantity: entry.quantity, // Keep positive for production
          rate: entry.rate,
        })),
      ];

      const totalAmount = consumptionTotal + productionTotal;
      
      // Create voucher
      const voucherRes = await apiRequest("POST", "/api/vouchers", {
        companyId: selectedCompany?.id,
        voucherType: adjustmentType,
        voucherNumber: `${adjustmentType.toUpperCase()}-${Date.now()}`,
        voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
        description: `Stock ${adjustmentType.toLowerCase()} at ${locations.find(l => l.id === data.locationId)?.name}`,
        totalAmount: totalAmount.toString(),
      });
      const voucher = await voucherRes.json();

      // Create stock adjustment with combined items
      await apiRequest("POST", "/api/stock-adjustments", {
        voucherId: voucher.id,
        locationId: data.locationId,
        adjustmentType: adjustmentType,
        notes: data.notes || "",
        items: combinedItems,
      });

      return voucher;
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Production/Consumption voucher created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      stockAdjustmentForm.reset({
        voucherDate: new Date(),
        locationId: 0,
        consumptionEntries: [],
        productionEntries: [],
        notes: "",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create stock adjustment",
        variant: "destructive",
      });
    },
  });

  const onStockAdjustmentSubmit = (data: StockAdjustmentFormData) => {
    // Validate consumption entries
    const validConsumption = data.consumptionEntries.filter(
      (entry) => entry.stockItemId > 0 && parseFloat(entry.quantity) > 0
    );

    // Validate production entries
    const validProduction = data.productionEntries.filter(
      (entry) => entry.stockItemId > 0 && parseFloat(entry.quantity) > 0
    );

    if (validConsumption.length === 0 && validProduction.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please add at least one valid entry in consumption or production",
        variant: "destructive",
      });
      return;
    }

    stockAdjustmentMutation.mutate(data);
  };

  // Keyboard navigation handlers for Payment/Receipt
  const handleKeyDown = (
    e: React.KeyboardEvent,
    rowIndex: number,
    fieldName: "account" | "amount"
  ) => {
    const isLastRow = rowIndex === fields.length - 1;
    
    // Handle Tab for navigation on comboboxes (let Enter activate them naturally)
    if (fieldName === "account" && e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      setTimeout(() => {
        const amountInput = document.querySelector(`[data-testid="input-amount-${rowIndex}"]`) as HTMLInputElement;
        if (amountInput) {
          amountInput.focus();
          amountInput.select();
        }
      }, 50);
    }
    
    // Handle both Tab and Enter for navigation on input fields
    if (fieldName === "amount" && ((e.key === "Tab" && !e.shiftKey) || e.key === "Enter")) {
      e.preventDefault();
      // On last field - move to next row or create new row
      if (isLastRow) {
        append({
          accountType: "ledger",
          accountId: 0,
          accountName: "",
          amount: "",
        });
      }
      setTimeout(() => {
        const newRowButton = document.querySelector(`[data-testid="button-account-${rowIndex + 1}"]`) as HTMLButtonElement;
        if (newRowButton) {
          newRowButton.focus();
        }
      }, 100);
    }
  };

  // Keyboard navigation handlers for Journal
  const handleJournalKeyDown = (
    e: React.KeyboardEvent,
    rowIndex: number,
    fieldName: "type" | "account" | "amount"
  ) => {
    const isLastRow = rowIndex === journalFields.length - 1;
    
    // Handle Tab for navigation on Select (let Enter activate it naturally)
    if (fieldName === "type" && e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      setTimeout(() => {
        const accountInput = document.querySelector(`[data-testid="input-journal-account-${rowIndex}"]`) as HTMLInputElement;
        if (accountInput) {
          accountInput.focus();
          accountInput.select();
        }
      }, 50);
    }
    
    // Handle Tab/Enter on account input - move to amount
    if (fieldName === "account" && ((e.key === "Tab" && !e.shiftKey) || e.key === "Enter")) {
      e.preventDefault();
      setTimeout(() => {
        const amountInput = document.querySelector(`[data-testid="input-journal-amount-${rowIndex}"]`) as HTMLInputElement;
        if (amountInput) {
          amountInput.focus();
          amountInput.select();
        }
      }, 50);
    }
    
    // Handle both Tab and Enter for navigation on input fields
    if (fieldName === "amount" && ((e.key === "Tab" && !e.shiftKey) || e.key === "Enter")) {
      e.preventDefault();
      // On last field - move to next row or create new row
      if (isLastRow) {
        appendJournal({
          type: "DR",
          accountType: "ledger",
          accountId: 0,
          accountName: "",
          amount: "",
        });
      }
      setTimeout(() => {
        const newRowSelect = document.querySelector(`[data-testid="select-journal-type-${rowIndex + 1}"]`) as HTMLButtonElement;
        if (newRowSelect) {
          newRowSelect.focus();
        }
      }, 100);
    }
  };

  // Keyboard navigation handlers for Stock Transfer
  const handleTransferKeyDown = (
    e: React.KeyboardEvent,
    rowIndex: number,
    fieldName: "sourceLocation" | "stockItem" | "quantity" | "rate"
  ) => {
    const isLastRow = rowIndex === transferFields.length - 1;
    
    // Handle both Tab and Enter for navigation
    if ((e.key === "Tab" && !e.shiftKey) || e.key === "Enter") {
      e.preventDefault();
      
      if (fieldName === "sourceLocation") {
        setTimeout(() => {
          const stockItemInput = document.querySelector(`[data-testid="input-transfer-stock-${rowIndex}"]`) as HTMLInputElement;
          if (stockItemInput) {
            stockItemInput.focus();
            stockItemInput.select();
          }
        }, 50);
      } else if (fieldName === "stockItem") {
        setTimeout(() => {
          const quantityInput = document.querySelector(`[data-testid="input-transfer-quantity-${rowIndex}"]`) as HTMLInputElement;
          if (quantityInput) {
            quantityInput.focus();
            quantityInput.select();
          }
        }, 50);
      } else if (fieldName === "quantity") {
        setTimeout(() => {
          const rateInput = document.querySelector(`[data-testid="input-transfer-rate-${rowIndex}"]`) as HTMLInputElement;
          if (rateInput) {
            rateInput.focus();
            rateInput.select();
          }
        }, 50);
      } else if (fieldName === "rate") {
        // On rate field - move to next row or create new row
        if (isLastRow) {
          appendTransfer({
            sourceLocationId: 0,
            sourceLocationName: "",
            stockItemId: 0,
            stockItemName: "",
            quantity: "",
            rate: "",
          });
        }
        setTimeout(() => {
          const newRowInput = document.querySelector(`[data-testid="input-source-location-${rowIndex + 1}"]`) as HTMLInputElement;
          if (newRowInput) {
            newRowInput.focus();
            newRowInput.select();
          }
        }, 100);
      }
    }
  };

  // Keyboard navigation handlers for Consumption Table
  const handleConsumptionKeyDown = (
    e: React.KeyboardEvent,
    rowIndex: number,
    fieldName: "stockItem" | "quantity" | "rate"
  ) => {
    const isLastRow = rowIndex === consumptionFields.length - 1;
    
    // Handle both Tab and Enter for navigation
    if ((e.key === "Tab" && !e.shiftKey) || e.key === "Enter") {
      e.preventDefault();
      
      if (fieldName === "stockItem") {
        setTimeout(() => {
          const quantityInput = document.querySelector(`[data-testid="input-consumption-quantity-${rowIndex}"]`) as HTMLInputElement;
          if (quantityInput) {
            quantityInput.focus();
            quantityInput.select();
          }
        }, 50);
      } else if (fieldName === "quantity") {
        setTimeout(() => {
          const rateInput = document.querySelector(`[data-testid="input-consumption-rate-${rowIndex}"]`) as HTMLInputElement;
          if (rateInput) {
            rateInput.focus();
            rateInput.select();
          }
        }, 50);
      } else if (fieldName === "rate") {
        // On rate field - move to next row or create new row
        if (isLastRow) {
          appendConsumption({
            stockItemId: 0,
            stockItemName: "",
            quantity: "",
            rate: "",
          });
        }
        setTimeout(() => {
          const newRowInput = document.querySelector(`[data-testid="input-consumption-stock-${rowIndex + 1}"]`) as HTMLInputElement;
          if (newRowInput) {
            newRowInput.focus();
            newRowInput.select();
          }
        }, 100);
      }
    }
  };

  // Keyboard navigation handlers for Production Table
  const handleProductionKeyDown = (
    e: React.KeyboardEvent,
    rowIndex: number,
    fieldName: "stockItem" | "quantity" | "rate"
  ) => {
    const isLastRow = rowIndex === productionFields.length - 1;
    
    // Handle both Tab and Enter for navigation
    if ((e.key === "Tab" && !e.shiftKey) || e.key === "Enter") {
      e.preventDefault();
      
      if (fieldName === "stockItem") {
        setTimeout(() => {
          const quantityInput = document.querySelector(`[data-testid="input-production-quantity-${rowIndex}"]`) as HTMLInputElement;
          if (quantityInput) {
            quantityInput.focus();
            quantityInput.select();
          }
        }, 50);
      } else if (fieldName === "quantity") {
        setTimeout(() => {
          const rateInput = document.querySelector(`[data-testid="input-production-rate-${rowIndex}"]`) as HTMLInputElement;
          if (rateInput) {
            rateInput.focus();
            rateInput.select();
          }
        }, 50);
      } else if (fieldName === "rate") {
        // On rate field - move to next row or create new row
        if (isLastRow) {
          appendProduction({
            stockItemId: 0,
            stockItemName: "",
            quantity: "",
            rate: "",
          });
        }
        setTimeout(() => {
          const newRowInput = document.querySelector(`[data-testid="input-production-stock-${rowIndex + 1}"]`) as HTMLInputElement;
          if (newRowInput) {
            newRowInput.focus();
            newRowInput.select();
          }
        }, 100);
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

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "payment" | "receipt" | "journal" | "transfer" | "adjustment")}>
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
          <TabsTrigger value="transfer" data-testid="tab-transfer">
            Stock Transfer
          </TabsTrigger>
          <TabsTrigger value="adjustment" data-testid="tab-adjustment">
            Production/Consumption
          </TabsTrigger>
        </TabsList>

        <TabsContent value="payment" className="space-y-4">
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
                                        onKeyDown={(e) => handleKeyDown(e, index, "account")}
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

        <TabsContent value="receipt" className="space-y-4">
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
                                        onKeyDown={(e) => handleKeyDown(e, index, "account")}
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
                          <th className="text-left p-3 font-medium w-[10%]">DR/CR</th>
                          <th className="text-left p-3 font-medium w-[50%]">Account</th>
                          <th className="text-left p-3 font-medium w-[25%]">Amount</th>
                          <th className="w-[10%]"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {journalFields.map((field, index) => (
                          <tr key={field.id} className="border-t">
                            <td className="p-2">
                              <FormField
                                control={journalForm.control}
                                name={`entries.${index}.type`}
                                render={({ field }) => (
                                  <FormItem>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                      <FormControl>
                                        <SelectTrigger data-testid={`select-journal-type-${index}`} onKeyDown={(e) => handleJournalKeyDown(e, index, "type")}>
                                          <SelectValue placeholder="DR/CR" />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        <SelectItem value="DR">DR</SelectItem>
                                        <SelectItem value="CR">CR</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </td>
                            <td className="p-2">
                              <FormField
                                control={journalForm.control}
                                name={`entries.${index}.accountId`}
                                render={({ field }) => (
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
                                        testIdPrefix="button-journal-account"
                                        onKeyDown={(e) => handleJournalKeyDown(e, index, "account")}
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
                                name={`entries.${index}.amount`}
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
                                        data-testid={`input-journal-amount-${index}`}
                                        onKeyDown={(e) => handleJournalKeyDown(e, index, "amount")}
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
                                  type: "DR",
                                  accountType: "ledger",
                                  accountId: 0,
                                  accountName: "",
                                  amount: "",
                                })
                              }
                              data-testid="button-journal-add-row"
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Add Row
                            </Button>
                          </td>
                          <td className="p-3 text-right text-sm text-muted-foreground">
                            DR: ${totalDebit.toFixed(2)} | CR: ${totalCredit.toFixed(2)}
                          </td>
                          <td className="p-3">
                            <div className="text-right font-bold font-mono">
                              ${Math.max(totalDebit, totalCredit).toLocaleString(undefined, {
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

        <TabsContent value="transfer" className="space-y-4">
          <div className="flex gap-4">
            {/* Main Form Area */}
            <Card className="flex-1">
              <CardHeader>
                <CardTitle>Stock Transfer Voucher</CardTitle>
              </CardHeader>
              <CardContent>
                <Form {...stockTransferForm}>
                  <form onSubmit={stockTransferForm.handleSubmit(onStockTransferSubmit)} className="space-y-6">
                    {/* Header section */}
                    <div className="flex items-start justify-between gap-4">
                      <FormField
                        control={stockTransferForm.control}
                        name="destinationLocationId"
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormLabel>Destination Location</FormLabel>
                            <Select
                              value={field.value > 0 ? field.value.toString() : ""}
                              onValueChange={(value) => field.onChange(parseInt(value))}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-destination-location">
                                  <SelectValue placeholder="Select destination location..." />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {locations.map((location) => (
                                  <SelectItem key={location.id} value={location.id.toString()}>
                                    {location.code} - {location.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Right: Date picker */}
                      <FormField
                        control={stockTransferForm.control}
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
                                    data-testid="button-transfer-date-picker"
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
                          <th className="text-left p-3 font-medium w-[25%]">Source Location</th>
                          <th className="text-left p-3 font-medium w-[30%]">Stock Item</th>
                          <th className="text-left p-3 font-medium w-[12%]">Quantity</th>
                          <th className="text-left p-3 font-medium w-[12%]">Rate</th>
                          <th className="text-left p-3 font-medium w-[16%]">Total</th>
                          <th className="w-[5%]"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {transferFields.map((field, index) => (
                          <tr key={field.id} className="border-t">
                            <td className="p-2">
                              <FormField
                                control={stockTransferForm.control}
                                name={`entries.${index}.sourceLocationId`}
                                render={({ field }) => (
                                  <FormItem>
                                    <Select
                                      value={field.value > 0 ? field.value.toString() : ""}
                                      onValueChange={(value) => {
                                        const locationId = parseInt(value);
                                        field.onChange(locationId);
                                        const location = locations.find(l => l.id === locationId);
                                        if (location) {
                                          stockTransferForm.setValue(`entries.${index}.sourceLocationName`, `${location.code} - ${location.name}`);
                                          setTransferInventorySource(locationId);
                                        }
                                        setActiveTransferRow(index);
                                      }}
                                    >
                                      <FormControl>
                                        <SelectTrigger 
                                          data-testid={`select-source-location-${index}`}
                                          onFocus={() => {
                                            setActiveTransferRow(index);
                                            if (transferEntries[index].sourceLocationId > 0) {
                                              setTransferInventorySource(transferEntries[index].sourceLocationId);
                                            }
                                          }}
                                        >
                                          <SelectValue placeholder="Select source location..." />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        {locations.map((location) => (
                                          <SelectItem key={location.id} value={location.id.toString()}>
                                            {location.code} - {location.name}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </td>
                            <td className="p-2">
                              <FormField
                                control={stockTransferForm.control}
                                name={`entries.${index}.stockItemId`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormControl>
                                      <StockItemCombobox
                                        value={
                                          transferEntries[index].stockItemId > 0
                                            ? {
                                                id: transferEntries[index].stockItemId,
                                                name: transferEntries[index].stockItemName,
                                              }
                                            : null
                                        }
                                        onChange={(id, name) => {
                                          stockTransferForm.setValue(`entries.${index}.stockItemId`, id);
                                          stockTransferForm.setValue(`entries.${index}.stockItemName`, name);
                                          
                                          // Auto-fill rate from inventory if source location is selected
                                          if (transferEntries[index].sourceLocationId > 0) {
                                            fetch(`/api/locations/${transferEntries[index].sourceLocationId}/inventory`)
                                              .then(res => res.json())
                                              .then(inventory => {
                                                const inventoryItem = inventory.find((inv: any) => inv.stockItemId === id);
                                                if (inventoryItem && inventoryItem.averageRate) {
                                                  stockTransferForm.setValue(`entries.${index}.rate`, inventoryItem.averageRate);
                                                }
                                              })
                                              .catch(err => console.error('Failed to fetch inventory:', err));
                                          }
                                        }}
                                        stockItems={stockItems}
                                        rowIndex={index}
                                        testIdPrefix="button-transfer-stock"
                                        onFocus={() => {
                                          setActiveTransferRow(index);
                                          if (transferEntries[index].sourceLocationId > 0) {
                                            setTransferInventorySource(transferEntries[index].sourceLocationId);
                                          }
                                        }}
                                        onKeyDown={(e) => handleTransferKeyDown(e, index, "stockItem")}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </td>
                            <td className="p-2">
                              <FormField
                                control={stockTransferForm.control}
                                name={`entries.${index}.quantity`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormControl>
                                      <Input
                                        {...field}
                                        type="number"
                                        step="0.001"
                                        placeholder="0.000"
                                        className="font-mono"
                                        data-testid={`input-transfer-quantity-${index}`}
                                        onKeyDown={(e) => handleTransferKeyDown(e, index, "quantity")}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </td>
                            <td className="p-2">
                              <FormField
                                control={stockTransferForm.control}
                                name={`entries.${index}.rate`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormControl>
                                      <Input
                                        {...field}
                                        type="number"
                                        step="0.01"
                                        placeholder="0.00"
                                        className="font-mono"
                                        data-testid={`input-transfer-rate-${index}`}
                                        onKeyDown={(e) => handleTransferKeyDown(e, index, "rate")}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </td>
                            <td className="p-2">
                              <div className="text-right font-mono">
                                ${(parseFloat(transferEntries[index].quantity || "0") * parseFloat(transferEntries[index].rate || "0")).toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </div>
                            </td>
                            <td className="p-2">
                              {transferFields.length > 1 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeTransfer(index)}
                                  data-testid={`button-remove-transfer-${index}`}
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
                          <td colSpan={4} className="p-3">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                appendTransfer({
                                  sourceLocationId: 0,
                                  sourceLocationName: "",
                                  stockItemId: 0,
                                  stockItemName: "",
                                  quantity: "",
                                  rate: "",
                                })
                              }
                              data-testid="button-add-transfer-row"
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Add Row
                            </Button>
                          </td>
                          <td className="p-3">
                            <div className="text-right font-bold font-mono">
                              ${transferTotal.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </div>
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Notes field */}
                  <FormField
                    control={stockTransferForm.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            placeholder="Additional notes..."
                            rows={3}
                            data-testid="input-transfer-notes"
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
                      disabled={
                        stockTransferMutation.isPending ||
                        transferTotal === 0
                      }
                      data-testid="button-save-transfer-voucher"
                    >
                      {stockTransferMutation.isPending ? "Saving..." : "Save Stock Transfer"}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>

          {/* Right side panel - Stock Item Suggestions */}
          {activeTransferRow !== null && transferInventorySource && (
            <Card className="w-80">
              <CardHeader>
                <CardTitle className="text-sm">Available Items</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {locations.find(l => l.id === transferInventorySource)?.name}
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[600px] overflow-y-auto">
                  {transferInventory.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      No inventory at this location
                    </div>
                  ) : (
                    <div className="divide-y">
                      {transferInventory.map((item: any) => (
                        <button
                          key={item.stockItemId}
                          type="button"
                          className="w-full p-3 text-left hover-elevate active-elevate-2 transition-colors"
                          data-testid={`button-suggest-item-${item.stockItemId}`}
                          onClick={() => {
                            if (activeTransferRow !== null) {
                              const stockItem = stockItems.find(s => s.id === item.stockItemId);
                              if (stockItem) {
                                stockTransferForm.setValue(`entries.${activeTransferRow}.stockItemId`, item.stockItemId);
                                stockTransferForm.setValue(`entries.${activeTransferRow}.stockItemName`, `${stockItem.code} - ${stockItem.name}`);
                                stockTransferForm.setValue(`entries.${activeTransferRow}.rate`, item.averageRate || "0");
                                
                                // Move focus to quantity field
                                setTimeout(() => {
                                  const quantityInput = document.querySelector(`[data-testid="input-transfer-quantity-${activeTransferRow}"]`) as HTMLInputElement;
                                  if (quantityInput) {
                                    quantityInput.focus();
                                    quantityInput.select();
                                  }
                                }, 50);
                              }
                            }
                          }}
                        >
                          <div className="flex justify-between items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">
                                {item.stockItemName}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {item.stockItemCode}
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <div className="text-sm font-medium">
                                ${parseFloat(item.averageRate || "0").toFixed(2)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Qty: {parseFloat(item.quantity || "0").toFixed(2)}
                              </div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
        </TabsContent>

        <TabsContent value="adjustment" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Production / Consumption Voucher</CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...stockAdjustmentForm}>
                <form onSubmit={stockAdjustmentForm.handleSubmit(onStockAdjustmentSubmit)} className="space-y-6">
                  {/* Header section */}
                  <div className="flex items-start justify-between gap-4">
                    <FormField
                      control={stockAdjustmentForm.control}
                      name="locationId"
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormLabel>Location</FormLabel>
                          <Select
                            value={field.value > 0 ? field.value.toString() : ""}
                            onValueChange={(value) => field.onChange(parseInt(value))}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-adjustment-location">
                                <SelectValue placeholder="Select location..." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {locations.map((location) => (
                                <SelectItem key={location.id} value={location.id.toString()}>
                                  {location.code} - {location.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={stockAdjustmentForm.control}
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
                                  data-testid="button-adjustment-date-picker"
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

                  {/* TWO TABLES SIDE-BY-SIDE */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* LEFT: Consumption Table */}
                    <div className="border rounded-md overflow-hidden">
                      <div className="bg-muted/50 p-3 font-medium border-b">
                        Consumption
                      </div>
                      <table className="w-full">
                        <thead className="bg-muted/30">
                          <tr>
                            <th className="text-left p-2 text-sm font-medium">Stock Item</th>
                            <th className="text-left p-2 text-sm font-medium w-[80px]">Qty</th>
                            <th className="text-left p-2 text-sm font-medium w-[80px]">Rate</th>
                            <th className="text-left p-2 text-sm font-medium w-[100px]">Total</th>
                            <th className="w-[40px]"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {consumptionFields.map((field, index) => (
                            <tr key={field.id} className="border-t">
                              <td className="p-2">
                                <FormField
                                  control={stockAdjustmentForm.control}
                                  name={`consumptionEntries.${index}.stockItemId`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormControl>
                                        <StockItemCombobox
                                          value={
                                            consumptionEntries[index].stockItemId > 0
                                              ? {
                                                  id: consumptionEntries[index].stockItemId,
                                                  name: consumptionEntries[index].stockItemName,
                                                }
                                              : null
                                          }
                                          onChange={(id, name) => {
                                            stockAdjustmentForm.setValue(`consumptionEntries.${index}.stockItemId`, id);
                                            stockAdjustmentForm.setValue(`consumptionEntries.${index}.stockItemName`, name);
                                          }}
                                          stockItems={stockItems}
                                          rowIndex={index}
                                          testIdPrefix="button-consumption-stock"
                                          onKeyDown={(e) => handleConsumptionKeyDown(e, index, "stockItem")}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </td>
                              <td className="p-2">
                                <FormField
                                  control={stockAdjustmentForm.control}
                                  name={`consumptionEntries.${index}.quantity`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormControl>
                                        <Input
                                          {...field}
                                          type="number"
                                          step="0.001"
                                          placeholder="0"
                                          className="font-mono text-sm"
                                          data-testid={`input-consumption-quantity-${index}`}
                                          onKeyDown={(e) => handleConsumptionKeyDown(e, index, "quantity")}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </td>
                              <td className="p-2">
                                <FormField
                                  control={stockAdjustmentForm.control}
                                  name={`consumptionEntries.${index}.rate`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormControl>
                                        <Input
                                          {...field}
                                          type="number"
                                          step="0.01"
                                          placeholder="0"
                                          className="font-mono text-sm"
                                          data-testid={`input-consumption-rate-${index}`}
                                          onKeyDown={(e) => handleConsumptionKeyDown(e, index, "rate")}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </td>
                              <td className="p-2">
                                <div className="text-right font-mono text-sm">
                                  ${(parseFloat(consumptionEntries[index]?.quantity || "0") * parseFloat(consumptionEntries[index]?.rate || "0")).toFixed(2)}
                                </div>
                              </td>
                              <td className="p-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeConsumption(index)}
                                  data-testid={`button-remove-consumption-${index}`}
                                >
                                  ×
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-muted/30 border-t">
                          <tr>
                            <td colSpan={3} className="p-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  appendConsumption({
                                    stockItemId: 0,
                                    stockItemName: "",
                                    quantity: "",
                                    rate: "",
                                  })
                                }
                                data-testid="button-add-consumption-row"
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Add Row
                              </Button>
                            </td>
                            <td className="p-2">
                              <div className="text-right font-bold font-mono text-sm">
                                ${consumptionTotal.toFixed(2)}
                              </div>
                            </td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* RIGHT: Production Table */}
                    <div className="border rounded-md overflow-hidden">
                      <div className="bg-muted/50 p-3 font-medium border-b">
                        Production
                      </div>
                      <table className="w-full">
                        <thead className="bg-muted/30">
                          <tr>
                            <th className="text-left p-2 text-sm font-medium">Stock Item</th>
                            <th className="text-left p-2 text-sm font-medium w-[80px]">Qty</th>
                            <th className="text-left p-2 text-sm font-medium w-[80px]">Rate</th>
                            <th className="text-left p-2 text-sm font-medium w-[100px]">Total</th>
                            <th className="w-[40px]"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {productionFields.map((field, index) => (
                            <tr key={field.id} className="border-t">
                              <td className="p-2">
                                <FormField
                                  control={stockAdjustmentForm.control}
                                  name={`productionEntries.${index}.stockItemId`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormControl>
                                        <StockItemCombobox
                                          value={
                                            productionEntries[index].stockItemId > 0
                                              ? {
                                                  id: productionEntries[index].stockItemId,
                                                  name: productionEntries[index].stockItemName,
                                                }
                                              : null
                                          }
                                          onChange={(id, name) => {
                                            stockAdjustmentForm.setValue(`productionEntries.${index}.stockItemId`, id);
                                            stockAdjustmentForm.setValue(`productionEntries.${index}.stockItemName`, name);
                                          }}
                                          stockItems={stockItems}
                                          rowIndex={index}
                                          testIdPrefix="button-production-stock"
                                          onKeyDown={(e) => handleProductionKeyDown(e, index, "stockItem")}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </td>
                              <td className="p-2">
                                <FormField
                                  control={stockAdjustmentForm.control}
                                  name={`productionEntries.${index}.quantity`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormControl>
                                        <Input
                                          {...field}
                                          type="number"
                                          step="0.001"
                                          placeholder="0"
                                          className="font-mono text-sm"
                                          data-testid={`input-production-quantity-${index}`}
                                          onKeyDown={(e) => handleProductionKeyDown(e, index, "quantity")}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </td>
                              <td className="p-2">
                                <FormField
                                  control={stockAdjustmentForm.control}
                                  name={`productionEntries.${index}.rate`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormControl>
                                        <Input
                                          {...field}
                                          type="number"
                                          step="0.01"
                                          placeholder="0"
                                          className="font-mono text-sm"
                                          data-testid={`input-production-rate-${index}`}
                                          onKeyDown={(e) => handleProductionKeyDown(e, index, "rate")}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </td>
                              <td className="p-2">
                                <div className="text-right font-mono text-sm">
                                  ${(parseFloat(productionEntries[index]?.quantity || "0") * parseFloat(productionEntries[index]?.rate || "0")).toFixed(2)}
                                </div>
                              </td>
                              <td className="p-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeProduction(index)}
                                  data-testid={`button-remove-production-${index}`}
                                >
                                  ×
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-muted/30 border-t">
                          <tr>
                            <td colSpan={3} className="p-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  appendProduction({
                                    stockItemId: 0,
                                    stockItemName: "",
                                    quantity: "",
                                    rate: "",
                                  })
                                }
                                data-testid="button-add-production-row"
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Add Row
                              </Button>
                            </td>
                            <td className="p-2">
                              <div className="text-right font-bold font-mono text-sm">
                                ${productionTotal.toFixed(2)}
                              </div>
                            </td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  {/* Notes field */}
                  <FormField
                    control={stockAdjustmentForm.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            placeholder="Additional notes..."
                            rows={3}
                            data-testid="input-adjustment-notes"
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
                      disabled={stockAdjustmentMutation.isPending || (consumptionTotal === 0 && productionTotal === 0)}
                      data-testid="button-save-adjustment-voucher"
                    >
                      {stockAdjustmentMutation.isPending ? "Saving..." : "Save Production/Consumption Voucher"}
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
