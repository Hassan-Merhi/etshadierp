import { useState, useEffect, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format, parseISO } from "date-fns";
import { useCompany } from "@/contexts/CompanyContext";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CalendarIcon, ArrowLeft, Plus, Check, ChevronsUpDown, X, FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";
import { AccountAutocomplete, CombinedAccount } from "@/components/AccountAutocomplete";

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

interface VoucherEntry {
  id: number;
  ledgerAccountId: number | null;
  bankAccountId: number | null;
  supplierId: number | null;
  debitAmount: string;
  creditAmount: string;
  narration: string | null;
}

interface PurchaseOrderLineItem {
  id: number;
  stockItemId: number;
  itemName: string;
  quantity: string;
  rate: string;
  lineTotal: string;
}

interface PurchaseOrderData {
  id: number;
  companyId: number;
  poNumber: string;
  containerId: number;
  supplierId: number;
  voucherId: number | null;
  currency: string;
  itemsTotal: string;
  status: string;
  items: PurchaseOrderLineItem[];
}

interface SalesItem {
  id: number;
  voucherId: number;
  stockItemId: number;
  quantity: string;
  sellingPrice: string;
  costPrice: string;
  totalSales: string;
  totalCost: string;
  profit: string;
  stockItemCode: string;
  stockItemName: string;
  stockItemUom: string;
}

interface AdjustmentItem {
  id: number;
  adjustmentId: number;
  stockItemId: number;
  quantity: string;
  rate: string;
  totalAmount: string;
  stockItemCode: string;
  stockItemName: string;
  stockItemUom: string;
}

interface AdjustmentData {
  id: number;
  voucherId: number;
  locationId: number;
  adjustmentType: string;
  notes: string | null;
  locationName: string;
  items: AdjustmentItem[];
}

interface TransferItem {
  id: number;
  transferId: number;
  stockItemId: number;
  quantity: string;
  rate: string;
  totalAmount: string;
  stockItemCode: string;
  stockItemName: string;
  stockItemUom: string;
}

interface TransferData {
  id: number;
  voucherId: number;
  sourceLocationId: number;
  destinationLocationId: number;
  notes: string | null;
  sourceLocationName: string;
  destinationLocationName: string;
  items: TransferItem[];
}

interface VoucherData {
  id: number;
  companyId: number;
  locationId: number | null;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  description: string | null;
  totalAmount: string;
  optional: boolean;
  entries: VoucherEntry[];
  purchaseOrder?: PurchaseOrderData | null;
  salesItems?: SalesItem[] | null;
  adjustmentData?: AdjustmentData | null;
  transferData?: TransferData | null;
}

// Form entry schemas
const voucherEntrySchema = z.object({
  id: z.number().optional(),
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
  id: z.number().optional(),
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

const salesLineItemSchema = z.object({
  id: z.number().optional(),
  stockItemId: z.number().min(1, "Please select a stock item"),
  stockItemName: z.string(),
  quantity: z.string()
    .min(1, "Quantity required")
    .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
      message: "Quantity must be a positive number",
    }),
  sellingPrice: z.string()
    .min(1, "Selling price required")
    .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
      message: "Selling price must be a positive number",
    }),
});

const purchaseLineItemSchema = z.object({
  id: z.number().optional(),
  stockItemId: z.number().min(1, "Please select a stock item"),
  stockItemName: z.string(),
  quantity: z.string()
    .min(1, "Quantity required")
    .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
      message: "Quantity must be a positive number",
    }),
  rate: z.string()
    .min(1, "Rate required")
    .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
      message: "Rate must be a positive number",
    }),
});

const adjustmentLineItemSchema = z.object({
  id: z.number().optional(),
  stockItemId: z.number().min(1, "Please select a stock item"),
  stockItemName: z.string(),
  quantity: z.string()
    .min(1, "Quantity required")
    .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
      message: "Quantity must be a positive number",
    }),
  rate: z.string()
    .min(1, "Rate required")
    .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
      message: "Rate must be a positive number",
    }),
});

const transferLineItemSchema = z.object({
  id: z.number().optional(),
  stockItemId: z.number().min(1, "Please select a stock item"),
  stockItemName: z.string(),
  quantity: z.string()
    .min(1, "Quantity required")
    .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
      message: "Quantity must be a positive number",
    }),
  rate: z.string()
    .min(1, "Rate required")
    .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
      message: "Rate must be a positive number",
    }),
});

// Form schemas
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

const salesFormSchema = z.object({
  voucherDate: z.date(),
  locationId: z.number().min(1, "Location is required"),
  items: z.array(salesLineItemSchema).min(1, "Add at least one item"),
  notes: z.string().optional(),
});

const purchaseFormSchema = z.object({
  voucherDate: z.date(),
  items: z.array(purchaseLineItemSchema).min(1, "Add at least one item"),
  notes: z.string().optional(),
});

const adjustmentFormSchema = z.object({
  voucherDate: z.date(),
  locationId: z.number().min(1, "Location is required"),
  items: z.array(adjustmentLineItemSchema).min(1, "Add at least one item"),
  notes: z.string().optional(),
});

const transferFormSchema = z.object({
  voucherDate: z.date(),
  sourceLocationId: z.number().min(1, "Source location is required"),
  destinationLocationId: z.number().min(1, "Destination location is required"),
  items: z.array(transferLineItemSchema).min(1, "Add at least one item"),
  notes: z.string().optional(),
});

type VoucherFormData = z.infer<typeof voucherFormSchema>;
type JournalFormData = z.infer<typeof journalFormSchema>;
type SalesFormData = z.infer<typeof salesFormSchema>;
type PurchaseFormData = z.infer<typeof purchaseFormSchema>;
type AdjustmentFormData = z.infer<typeof adjustmentFormSchema>;
type TransferFormData = z.infer<typeof transferFormSchema>;

// Stock Item Combobox Component
function StockItemCombobox({
  value,
  onChange,
  stockItems,
  rowIndex,
  testIdPrefix = "button-stock-item",
}: {
  value: { id: number; name: string } | null;
  onChange: (id: number, name: string) => void;
  stockItems: StockItem[];
  rowIndex: number;
  testIdPrefix?: string;
}) {
  const [open, setOpen] = useState(false);

  const sortedStockItems = [...stockItems].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          data-testid={`${testIdPrefix}-${rowIndex}`}
        >
          {value ? value.name : "Select item..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0 bg-popover text-popover-foreground">
        <Command className="bg-popover text-popover-foreground">
          <CommandInput placeholder="Search stock items..." className="bg-popover text-popover-foreground" />
          <CommandList className="bg-popover text-popover-foreground">
            <CommandEmpty>No stock item found.</CommandEmpty>
            <CommandGroup>
              {sortedStockItems.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.name}
                  onSelect={() => {
                    onChange(item.id, item.name);
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
                  {item.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Account Combobox Component
function AccountCombobox({
  value,
  onChange,
  ledgerAccounts,
  bankAccounts,
  suppliers,
  rowIndex,
  testIdPrefix = "button-account",
}: {
  value: { type: string; id: number; name: string } | null;
  onChange: (type: "ledger" | "bank" | "supplier", id: number, name: string) => void;
  ledgerAccounts: LedgerAccount[];
  bankAccounts: BankAccount[];
  suppliers: Supplier[];
  rowIndex: number;
  testIdPrefix?: string;
}) {
  const [open, setOpen] = useState(false);

  const allAccounts = [
    ...ledgerAccounts.map((a) => ({
      type: "ledger" as const,
      id: a.id,
      name: a.name,
    })),
    ...bankAccounts.map((a) => ({
      type: "bank" as const,
      id: a.id,
      name: a.bankName,
    })),
    ...suppliers.map((s) => ({
      type: "supplier" as const,
      id: s.id,
      name: s.legalName,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          data-testid={`${testIdPrefix}-${rowIndex}`}
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

// Helper function to format numbers: removes .00 for whole numbers, keeps decimals otherwise
function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return value.toLocaleString();
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function VoucherEdit() {
  const { id } = useParams<{ id: string }>();
  const [_location, navigate] = useLocation();
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const [formInitialized, setFormInitialized] = useState(false);

  // Fetch voucher data
  const { data: voucher, isLoading: voucherLoading, error: voucherError } = useQuery<VoucherData>({
    queryKey: [`/api/vouchers/${id}`],
    enabled: !!id,
  });

  // Fetch reference data
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

  // Fetch all accounts with balances
  interface AccountWithBalance {
    type: string;
    id: string;  // Composite ID like "ledger-1", "bank-2", etc.
    accountId: number;  // The actual numeric account ID
    name: string;
    balance: string;
    balanceSide?: string;
  }

  const { data: allAccountsData = [] } = useQuery<AccountWithBalance[]>({
    queryKey: ["/api/accounts/all"],
  });

  // Determine voucher type early for form logic
  const voucherType = voucher?.voucherType;
  const isPaymentOrReceipt = voucherType === "Payment" || voucherType === "Receipt";
  const isJournal = voucherType === "Journal";
  const isPurchase = voucherType === "Purchase";
  const isSales = voucherType === "Sales";
  const isConsumption = voucherType === "Consumption" || voucherType === "Production" || voucherType === "Mixed";
  const isStockTransfer = voucherType === "Stock Transfer";

  // Initialize forms first (needed for balance tracking)
  const paymentForm = useForm<VoucherFormData>({
    resolver: zodResolver(voucherFormSchema),
    defaultValues: {
      paymentAccountType: "bank",
      paymentAccountId: 0,
      paymentAccountName: "",
      voucherDate: new Date(),
      entries: [],
      notes: "",
    },
  });

  const { fields: paymentFields, append: paymentAppend, remove: paymentRemove } = useFieldArray({
    control: paymentForm.control,
    name: "entries",
  });

  // Create unified accounts list with balances for payment/receipt forms
  const [balanceAdjustments, setBalanceAdjustments] = useState<Record<string, number>>({});

  const allAccountsWithBalances: CombinedAccount[] = useMemo(() => {
    const accounts: CombinedAccount[] = [];

    // Add ledger accounts
    ledgerAccounts.forEach(ledger => {
      const accountData = allAccountsData.find(a => a.id === `ledger-${ledger.id}`);
      const baseBalance = parseFloat(accountData?.balance || "0");
      const adjustment = balanceAdjustments[`ledger-${ledger.id}`] || 0;
      const adjustedBalance = baseBalance + adjustment;

      accounts.push({
        type: "ledger",
        id: ledger.id,
        name: ledger.name,
        code: ledger.code,
        balance: adjustedBalance.toFixed(2),
      });
    });

    // Add bank accounts
    bankAccounts.forEach(bank => {
      const accountData = allAccountsData.find(a => a.id === `bank-${bank.id}`);
      const baseBalance = parseFloat(accountData?.balance || bank.balance || "0");
      const adjustment = balanceAdjustments[`bank-${bank.id}`] || 0;
      const adjustedBalance = baseBalance + adjustment;

      accounts.push({
        type: "bank",
        id: bank.id,
        name: bank.bankName,
        code: bank.accountNumber,
        balance: adjustedBalance.toFixed(2),
      });
    });

    // Add suppliers
    suppliers.forEach(supplier => {
      const accountData = allAccountsData.find(a => a.id === `supplier-${supplier.id}`);
      const baseBalance = parseFloat(accountData?.balance || "0");
      const adjustment = balanceAdjustments[`supplier-${supplier.id}`] || 0;
      const adjustedBalance = baseBalance + adjustment;

      accounts.push({
        type: "supplier",
        id: supplier.id,
        name: supplier.legalName,
        code: supplier.code,
        balance: adjustedBalance.toFixed(2),
      });
    });

    return accounts.sort((a, b) => a.name.localeCompare(b.name));
  }, [ledgerAccounts, bankAccounts, suppliers, allAccountsData, balanceAdjustments]);

  // Update balance adjustments when payment form entries change
  useEffect(() => {
    if (!isPaymentOrReceipt) return;

    // Subscribe to form changes instead of using watch in dependencies
    const subscription = paymentForm.watch((formValues) => {
      const newAdjustments: Record<string, number> = {};

      const paymentAccountType = formValues.paymentAccountType || "bank";
      const paymentAccountId = formValues.paymentAccountId || 0;
      const paymentKey = `${paymentAccountType}-${paymentAccountId}`;

      // Calculate total from entries
      const entries = formValues.entries || [];
      let totalAmount = 0;

      entries.forEach((entry) => {
        if (!entry) return;
        const amount = parseFloat(entry.amount || "0");
        const accountId = entry.accountId || 0;
        const accountType = entry.accountType || "ledger";
        
        if (amount > 0 && accountId > 0) {
          totalAmount += amount;

          // Adjust counterparty account balances
          const entryKey = `${accountType}-${accountId}`;
          
          // In this system, both Payment and Receipt entries represent the amount
          // transferred, not DR/CR sides. The sign depends on the voucher type:
          if (voucherType === "Payment") {
            // Payment: We're paying out to suppliers/vendors
            // Their balance (what we owe them) DECREASES
            newAdjustments[entryKey] = (newAdjustments[entryKey] || 0) - amount;
          } else if (voucherType === "Receipt") {
            // Receipt: We're receiving payment from customers  
            // Their balance (what they owe us) DECREASES (they paid us)
            newAdjustments[entryKey] = (newAdjustments[entryKey] || 0) - amount;
          }
        }
      });

      // Adjust our payment/receiving account (cash/bank account)
      if (paymentAccountId > 0 && totalAmount > 0) {
        if (voucherType === "Payment") {
          // Payment: Our cash/bank DECREASES (money going out)
          newAdjustments[paymentKey] = (newAdjustments[paymentKey] || 0) - totalAmount;
        } else if (voucherType === "Receipt") {
          // Receipt: Our cash/bank INCREASES (money coming in)
          newAdjustments[paymentKey] = (newAdjustments[paymentKey] || 0) + totalAmount;
        }
      }

      setBalanceAdjustments(newAdjustments);
    });

    return () => subscription.unsubscribe();
  }, [isPaymentOrReceipt, voucherType, paymentForm]);

  // Journal Form
  const journalForm = useForm<JournalFormData>({
    resolver: zodResolver(journalFormSchema),
    defaultValues: {
      voucherDate: new Date(),
      entries: [],
      notes: "",
    },
  });

  const { fields: journalFields, append: journalAppend, remove: journalRemove } = useFieldArray({
    control: journalForm.control,
    name: "entries",
  });

  // Sales Form
  const salesForm = useForm<SalesFormData>({
    resolver: zodResolver(salesFormSchema),
    defaultValues: {
      voucherDate: new Date(),
      locationId: 0,
      items: [],
      notes: "",
    },
  });

  const { fields: salesFields, append: salesAppend, remove: salesRemove } = useFieldArray({
    control: salesForm.control,
    name: "items",
  });

  // Purchase Form
  const purchaseForm = useForm<PurchaseFormData>({
    resolver: zodResolver(purchaseFormSchema),
    defaultValues: {
      voucherDate: new Date(),
      items: [],
      notes: "",
    },
  });

  const { fields: purchaseFields, append: purchaseAppend, remove: purchaseRemove } = useFieldArray({
    control: purchaseForm.control,
    name: "items",
  });

  // Adjustment Form (for Consumption/Mixed)
  const adjustmentForm = useForm<AdjustmentFormData>({
    resolver: zodResolver(adjustmentFormSchema),
    defaultValues: {
      voucherDate: new Date(),
      locationId: 0,
      items: [],
      notes: "",
    },
  });

  const { fields: adjustmentFields, append: adjustmentAppend, remove: adjustmentRemove } = useFieldArray({
    control: adjustmentForm.control,
    name: "items",
  });

  // Transfer Form (for Stock Transfer)
  const transferForm = useForm<TransferFormData>({
    resolver: zodResolver(transferFormSchema),
    defaultValues: {
      voucherDate: new Date(),
      sourceLocationId: 0,
      destinationLocationId: 0,
      items: [],
      notes: "",
    },
  });

  const { fields: transferFields, append: transferAppend, remove: transferRemove } = useFieldArray({
    control: transferForm.control,
    name: "items",
  });

  // Helper function to find account details by ID
  const findAccountDetails = (entry: VoucherEntry) => {
    if (entry.ledgerAccountId) {
      const account = ledgerAccounts.find(a => a.id === entry.ledgerAccountId);
      return account ? {
        type: "ledger" as const,
        id: account.id,
        name: account.name,
      } : null;
    } else if (entry.bankAccountId) {
      const account = bankAccounts.find(a => a.id === entry.bankAccountId);
      return account ? {
        type: "bank" as const,
        id: account.id,
        name: account.bankName,
      } : null;
    } else if (entry.supplierId) {
      const supplier = suppliers.find(s => s.id === entry.supplierId);
      return supplier ? {
        type: "supplier" as const,
        id: supplier.id,
        name: supplier.legalName,
      } : null;
    }
    return null;
  };

  // Populate form when voucher data is loaded
  useEffect(() => {
    if (!voucher || !voucherType || formInitialized) return;
    if (ledgerAccounts.length === 0 && bankAccounts.length === 0 && suppliers.length === 0) return;

    if (isPaymentOrReceipt && voucher.entries.length >= 1) {
      // First entry is the payment account (debit for Payment, credit for Receipt)
      const paymentEntry = voucher.entries[0];
      const paymentAccount = findAccountDetails(paymentEntry);
      
      // Remaining entries are the voucher entries - filter out zero amount entries
      const voucherEntries = voucher.entries.slice(1).filter(entry => {
        const amount = voucherType === "Payment" 
          ? parseFloat(entry.creditAmount || "0") 
          : parseFloat(entry.debitAmount || "0");
        return amount > 0;
      });

      if (paymentAccount) {
        paymentForm.reset({
          paymentAccountType: paymentAccount.type,
          paymentAccountId: paymentAccount.id,
          paymentAccountName: paymentAccount.name,
          voucherDate: parseISO(voucher.voucherDate),
          entries: voucherEntries.map(entry => {
            const account = findAccountDetails(entry);
            const amount = voucherType === "Payment" 
              ? entry.creditAmount 
              : entry.debitAmount;
            
            return account ? {
              id: entry.id,
              accountType: account.type,
              accountId: account.id,
              accountName: account.name,
              amount: amount || "0",
            } : {
              id: entry.id,
              accountType: "ledger" as const,
              accountId: 0,
              accountName: "",
              amount: amount || "0",
            };
          }),
          notes: voucher.description || "",
        });
        setFormInitialized(true);
      }
    } else if (isJournal) {
      journalForm.reset({
        voucherDate: parseISO(voucher.voucherDate),
        entries: voucher.entries.map(entry => {
          const account = findAccountDetails(entry);
          const isDR = parseFloat(entry.debitAmount || "0") > 0;
          const amount = isDR ? entry.debitAmount : entry.creditAmount;

          return account ? {
            id: entry.id,
            type: isDR ? "DR" as const : "CR" as const,
            accountType: account.type,
            accountId: account.id,
            accountName: account.name,
            amount: amount || "0",
          } : {
            id: entry.id,
            type: "DR" as const,
            accountType: "ledger" as const,
            accountId: 0,
            accountName: "",
            amount: "0",
          };
        }),
        notes: voucher.description || "",
      });
      setFormInitialized(true);
    } else if (isSales) {
      salesForm.reset({
        voucherDate: parseISO(voucher.voucherDate),
        locationId: voucher.locationId || 0,
        items: (voucher.salesItems || []).map(item => ({
          id: item.id,
          stockItemId: item.stockItemId,
          stockItemName: `${item.stockItemCode} - ${item.stockItemName}`,
          quantity: item.quantity,
          sellingPrice: item.sellingPrice,
        })),
        notes: voucher.description || "",
      });
      setFormInitialized(true);
    } else if (isPurchase) {
      purchaseForm.reset({
        voucherDate: parseISO(voucher.voucherDate),
        items: (voucher.purchaseOrder?.items || []).map(item => ({
          id: item.id,
          stockItemId: item.stockItemId,
          stockItemName: item.itemName,
          quantity: item.quantity,
          rate: item.rate,
        })),
        notes: voucher.description || "",
      });
      setFormInitialized(true);
    } else if (isConsumption) {
      adjustmentForm.reset({
        voucherDate: parseISO(voucher.voucherDate),
        locationId: voucher.adjustmentData?.locationId || voucher.locationId || 0,
        items: (voucher.adjustmentData?.items || []).map(item => ({
          id: item.id,
          stockItemId: item.stockItemId,
          stockItemName: `${item.stockItemCode} - ${item.stockItemName}`,
          quantity: item.quantity,
          rate: item.rate,
        })),
        notes: voucher.adjustmentData?.notes || voucher.description || "",
      });
      setFormInitialized(true);
    } else if (isStockTransfer) {
      transferForm.reset({
        voucherDate: parseISO(voucher.voucherDate),
        sourceLocationId: voucher.transferData?.sourceLocationId || voucher.locationId || 0,
        destinationLocationId: voucher.transferData?.destinationLocationId || 0,
        items: (voucher.transferData?.items || []).map(item => ({
          id: item.id,
          stockItemId: item.stockItemId,
          stockItemName: `${item.stockItemCode} - ${item.stockItemName}`,
          quantity: item.quantity,
          rate: item.rate,
        })),
        notes: voucher.transferData?.notes || voucher.description || "",
      });
      setFormInitialized(true);
    }
  }, [voucher, voucherType, ledgerAccounts, bankAccounts, suppliers, formInitialized, isPaymentOrReceipt, isJournal, isSales, isPurchase, isConsumption, isStockTransfer, paymentForm, journalForm, salesForm, purchaseForm, adjustmentForm, transferForm]);

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (data: { voucherUpdates: any; entriesUpdates: any[] }) => {
      // Update voucher header
      await apiRequest("PATCH", `/api/vouchers/${id}`, data.voucherUpdates);

      // Update each entry
      for (const entry of data.entriesUpdates) {
        if (entry.id) {
          await apiRequest("PATCH", `/api/voucher-entries/${entry.id}`, entry.updates);
        }
      }

      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/vouchers/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      toast({
        title: "Success",
        description: "Voucher updated successfully",
      });
      navigate("/daybook");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update voucher",
        variant: "destructive",
      });
    },
  });

  // Optional toggle mutation
  const toggleOptionalMutation = useMutation({
    mutationFn: async (optional: boolean) => {
      return await apiRequest("PATCH", `/api/vouchers/${id}/optional`, { optional });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/vouchers/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      toast({
        title: "Success",
        description: "Optional status updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update optional status",
        variant: "destructive",
      });
    },
  });

  // Sales update mutation
  const updateSalesMutation = useMutation({
    mutationFn: async (data: SalesFormData) => {
      const salesData = {
        voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
        description: data.notes,
        items: data.items.map(item => ({
          id: item.id,
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          sellingPrice: item.sellingPrice,
        })),
      };
      return await apiRequest("PATCH", `/api/vouchers/${id}/sales`, salesData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/vouchers/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      toast({
        title: "Success",
        description: "Sales voucher updated successfully",
      });
      navigate("/daybook");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update sales voucher",
        variant: "destructive",
      });
    },
  });

  // Purchase update mutation
  const updatePurchaseMutation = useMutation({
    mutationFn: async (data: PurchaseFormData) => {
      const purchaseData = {
        voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
        description: data.notes,
        items: data.items.map(item => ({
          id: item.id,
          stockItemId: item.stockItemId,
          itemName: item.stockItemName,
          quantity: item.quantity,
          rate: item.rate,
        })),
      };
      return await apiRequest("PATCH", `/api/vouchers/${id}/purchase`, purchaseData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/vouchers/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      toast({
        title: "Success",
        description: "Purchase voucher updated successfully",
      });
      navigate("/daybook");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update purchase voucher",
        variant: "destructive",
      });
    },
  });

  // Adjustment update mutation (for Consumption/Mixed)
  const updateAdjustmentMutation = useMutation({
    mutationFn: async (data: AdjustmentFormData) => {
      const adjustmentData = {
        voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
        description: data.notes,
        locationId: data.locationId,
        items: data.items.map(item => ({
          id: item.id,
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          rate: item.rate,
        })),
      };
      return await apiRequest("PATCH", `/api/vouchers/${id}/adjustment`, adjustmentData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/vouchers/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      toast({
        title: "Success",
        description: "Adjustment voucher updated successfully",
      });
      navigate("/daybook");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update adjustment voucher",
        variant: "destructive",
      });
    },
  });

  // Transfer update mutation
  const updateTransferMutation = useMutation({
    mutationFn: async (data: TransferFormData) => {
      const transferData = {
        voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
        description: data.notes,
        sourceLocationId: data.sourceLocationId,
        destinationLocationId: data.destinationLocationId,
        items: data.items.map(item => ({
          id: item.id,
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          rate: item.rate,
        })),
      };
      return await apiRequest("PATCH", `/api/vouchers/${id}/transfer`, transferData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/vouchers/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      toast({
        title: "Success",
        description: "Stock transfer voucher updated successfully",
      });
      navigate("/daybook");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update stock transfer voucher",
        variant: "destructive",
      });
    },
  });

  // Submit handlers
  const onSubmitPaymentReceipt = (data: VoucherFormData) => {
    const voucherUpdates = {
      voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
      voucherType: voucherType,
      description: data.notes,
    };

    const entriesUpdates = data.entries.map((entry, index) => ({
      id: entry.id,
      updates: {
        ledgerAccountId: entry.accountType === "ledger" ? entry.accountId : null,
        bankAccountId: entry.accountType === "bank" ? entry.accountId : null,
        supplierId: entry.accountType === "supplier" ? entry.accountId : null,
        debitAmount: voucherType === "Receipt" ? entry.amount : "0",
        creditAmount: voucherType === "Payment" ? entry.amount : "0",
      },
    }));

    updateMutation.mutate({ voucherUpdates, entriesUpdates });
  };

  const onSubmitJournal = (data: JournalFormData) => {
    const voucherUpdates = {
      voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
      voucherType: "Journal",
      description: data.notes,
    };

    const entriesUpdates = data.entries.map((entry) => ({
      id: entry.id,
      updates: {
        ledgerAccountId: entry.accountType === "ledger" ? entry.accountId : null,
        bankAccountId: entry.accountType === "bank" ? entry.accountId : null,
        supplierId: entry.accountType === "supplier" ? entry.accountId : null,
        debitAmount: entry.type === "DR" ? entry.amount : "0",
        creditAmount: entry.type === "CR" ? entry.amount : "0",
      },
    }));

    updateMutation.mutate({ voucherUpdates, entriesUpdates });
  };

  const onSubmitSales = (data: SalesFormData) => {
    updateSalesMutation.mutate(data);
  };

  const onSubmitPurchase = (data: PurchaseFormData) => {
    updatePurchaseMutation.mutate(data);
  };

  const onSubmitAdjustment = (data: AdjustmentFormData) => {
    updateAdjustmentMutation.mutate(data);
  };

  const onSubmitTransfer = (data: TransferFormData) => {
    updateTransferMutation.mutate(data);
  };

  // Handle cancel
  const handleCancel = () => {
    navigate("/daybook");
  };

  // Loading state
  if (voucherLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-8 w-64" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (voucherError || !voucher) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleCancel} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-3xl font-bold">Edit Voucher</h1>
        </div>
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-destructive">
              <p className="text-lg font-semibold">Voucher not found</p>
              <p className="text-sm text-muted-foreground mt-2">
                The voucher you're trying to edit doesn't exist or has been deleted.
              </p>
              <Button onClick={handleCancel} className="mt-4" data-testid="button-back-to-daybook">
                Back to Daybook
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Not supported voucher type (except Purchase, Sales, Consumption/Mixed, and Stock Transfer which we handle separately)
  if (!isPaymentOrReceipt && !isJournal && !isPurchase && !isSales && !isConsumption && !isStockTransfer) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleCancel} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-3xl font-bold">Edit Voucher</h1>
        </div>
        <Card>
          <CardContent className="py-8">
            <div className="text-center">
              <p className="text-lg font-semibold">Unsupported Voucher Type</p>
              <p className="text-sm text-muted-foreground mt-2">
                Editing {voucherType} vouchers is not currently supported.
              </p>
              <Button onClick={handleCancel} className="mt-4" data-testid="button-back-to-daybook">
                Back to Daybook
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Sales editing (when voucher type is Sales)
  if (isSales) {
    const location = locations.find(l => l.id === voucher.locationId);
    
    // Calculate grand total
    const salesGrandTotal = salesForm.watch("items").reduce((sum, item) => {
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.sellingPrice) || 0;
      return sum + (qty * price);
    }, 0);
    
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleCancel} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">
              Edit Sales Invoice
            </h1>
            <p className="text-muted-foreground mt-1">
              Voucher #{voucher.voucherNumber}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Edit Sales Voucher</CardTitle>
            <CardDescription>Update sales invoice details and line items</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...salesForm}>
              <form onSubmit={salesForm.handleSubmit(onSubmitSales)} className="space-y-6">
                {/* Header section with date and location */}
                <div className="flex items-start justify-between gap-4">
                  {/* Date picker */}
                  <FormField
                    control={salesForm.control}
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
                          <PopoverContent className="w-auto p-0" align="start">
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

                  {/* Location (readonly) */}
                  <div className="flex-1">
                    <FormLabel>Location</FormLabel>
                    <Input
                      value={location?.name || "N/A"}
                      disabled
                      className="mt-2"
                      data-testid="input-location"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Location cannot be changed to maintain inventory accuracy
                    </p>
                  </div>
                </div>

                {/* Optional toggle */}
                <div className="flex items-center gap-2 py-2 border-y">
                  <Switch
                    id="optional-toggle-sales"
                    checked={voucher.optional}
                    onCheckedChange={(checked) => toggleOptionalMutation.mutate(checked)}
                    disabled={toggleOptionalMutation.isPending}
                    data-testid="switch-optional"
                  />
                  <Label htmlFor="optional-toggle-sales" className="cursor-pointer">
                    Optional (Does not affect books)
                  </Label>
                </div>

                {/* Line items table */}
                <div>
                  <FormLabel className="mb-2 block">Line Items</FormLabel>
                  <div className="border rounded-md overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-3 font-medium w-[40%]">Stock Item</th>
                          <th className="text-left p-3 font-medium w-[15%]">Quantity</th>
                          <th className="text-left p-3 font-medium w-[15%]">Price</th>
                          <th className="text-right p-3 font-medium w-[25%]">Total</th>
                          <th className="w-[5%]"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {salesFields.map((field, index) => {
                          const qty = parseFloat(salesForm.watch(`items.${index}.quantity`)) || 0;
                          const price = parseFloat(salesForm.watch(`items.${index}.sellingPrice`)) || 0;
                          const lineTotal = qty * price;

                          return (
                            <tr key={field.id} className="border-t">
                              <td className="p-2">
                                <FormField
                                  control={salesForm.control}
                                  name={`items.${index}.stockItemId`}
                                  render={({ field: itemField }) => (
                                    <FormItem>
                                      <FormControl>
                                        <StockItemCombobox
                                          value={
                                            salesForm.watch(`items.${index}.stockItemId`) > 0
                                              ? {
                                                  id: salesForm.watch(`items.${index}.stockItemId`),
                                                  name: salesForm.watch(`items.${index}.stockItemName`),
                                                }
                                              : null
                                          }
                                          onChange={(id, name) => {
                                            salesForm.setValue(`items.${index}.stockItemId`, id);
                                            salesForm.setValue(`items.${index}.stockItemName`, name);
                                          }}
                                          stockItems={stockItems}
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
                                  control={salesForm.control}
                                  name={`items.${index}.quantity`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormControl>
                                        <Input
                                          {...field}
                                          type="number"
                                          step="0.001"
                                          placeholder="0"
                                          className="font-mono"
                                          data-testid={`input-quantity-${index}`}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </td>
                              <td className="p-2">
                                <FormField
                                  control={salesForm.control}
                                  name={`items.${index}.sellingPrice`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormControl>
                                        <Input
                                          {...field}
                                          type="number"
                                          step="0.01"
                                          placeholder="0.00"
                                          className="font-mono"
                                          data-testid={`input-price-${index}`}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </td>
                              <td className="p-2">
                                <div className="text-right font-mono font-medium" data-testid={`text-total-${index}`}>
                                  ${formatNumber(lineTotal)}
                                </div>
                              </td>
                              <td className="p-2">
                                {salesFields.length > 1 && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => salesRemove(index)}
                                    data-testid={`button-remove-${index}`}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-muted/30 border-t-2">
                        <tr>
                          <td colSpan={3} className="p-3">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                salesAppend({
                                  stockItemId: 0,
                                  stockItemName: "",
                                  quantity: "",
                                  sellingPrice: "",
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
                              ${formatNumber(salesGrandTotal)}
                            </div>
                          </td>
                          <td></td>
                        </tr>
                        <tr className="border-t">
                          <td className="p-3 text-right font-medium" colSpan={1}>Total Quantity:</td>
                          <td className="p-3 font-mono font-medium">
                            {formatNumber(salesForm.watch("items").reduce((sum, item) => sum + (parseFloat(item.quantity) || 0), 0))}
                          </td>
                          <td colSpan={3}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {/* Notes field */}
                <FormField
                  control={salesForm.control}
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

                {/* Action buttons */}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancel}
                    disabled={updateSalesMutation.isPending}
                    data-testid="button-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={updateSalesMutation.isPending || salesGrandTotal === 0}
                    data-testid="button-save-changes"
                  >
                    {updateSalesMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Purchase Order editing (when voucher type is Purchase)
  if (isPurchase) {
    const po = voucher.purchaseOrder;
    
    // Calculate grand total
    const purchaseGrandTotal = purchaseForm.watch("items").reduce((sum, item) => {
      const qty = parseFloat(item.quantity) || 0;
      const rate = parseFloat(item.rate) || 0;
      return sum + (qty * rate);
    }, 0);
    
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleCancel} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">
              Edit Purchase Order
            </h1>
            <p className="text-muted-foreground mt-1">
              Voucher #{voucher.voucherNumber}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Edit Purchase Voucher</CardTitle>
            <CardDescription>Update purchase order details and line items</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...purchaseForm}>
              <form onSubmit={purchaseForm.handleSubmit(onSubmitPurchase)} className="space-y-6">
                {/* Header section with date and readonly fields */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Date picker */}
                  <FormField
                    control={purchaseForm.control}
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
                                  "w-full justify-start text-left font-normal",
                                  !field.value && "text-muted-foreground"
                                )}
                                data-testid="button-date-picker"
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {field.value ? format(field.value, "PPP") : "Pick a date"}
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
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

                  {/* PO Number (readonly) */}
                  <div>
                    <FormLabel>PO Number</FormLabel>
                    <Input
                      value={po?.poNumber || "N/A"}
                      disabled
                      className="mt-2"
                      data-testid="input-po-number"
                    />
                  </div>

                  {/* Currency (readonly) */}
                  <div>
                    <FormLabel>Currency</FormLabel>
                    <Input
                      value={po?.currency || "USD"}
                      disabled
                      className="mt-2"
                      data-testid="input-currency"
                    />
                  </div>

                  {/* Status (readonly) */}
                  <div>
                    <FormLabel>Status</FormLabel>
                    <Input
                      value={po?.status || "Open"}
                      disabled
                      className="mt-2"
                      data-testid="input-status"
                    />
                  </div>
                </div>

                {/* Optional toggle */}
                <div className="flex items-center gap-2 py-2 border-y">
                  <Switch
                    id="optional-toggle-purchase"
                    checked={voucher.optional}
                    onCheckedChange={(checked) => toggleOptionalMutation.mutate(checked)}
                    disabled={toggleOptionalMutation.isPending}
                    data-testid="switch-optional"
                  />
                  <Label htmlFor="optional-toggle-purchase" className="cursor-pointer">
                    Optional (Does not affect books)
                  </Label>
                </div>

                {/* Line items table */}
                <div>
                  <FormLabel className="mb-2 block">Line Items</FormLabel>
                  <div className="border rounded-md overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-3 font-medium w-[40%]">Stock Item</th>
                          <th className="text-left p-3 font-medium w-[15%]">Quantity</th>
                          <th className="text-left p-3 font-medium w-[15%]">Rate</th>
                          <th className="text-right p-3 font-medium w-[25%]">Total</th>
                          <th className="w-[5%]"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {purchaseFields.map((field, index) => {
                          const qty = parseFloat(purchaseForm.watch(`items.${index}.quantity`)) || 0;
                          const rate = parseFloat(purchaseForm.watch(`items.${index}.rate`)) || 0;
                          const lineTotal = qty * rate;

                          return (
                            <tr key={field.id} className="border-t">
                              <td className="p-2">
                                <FormField
                                  control={purchaseForm.control}
                                  name={`items.${index}.stockItemId`}
                                  render={({ field: itemField }) => (
                                    <FormItem>
                                      <FormControl>
                                        <StockItemCombobox
                                          value={
                                            purchaseForm.watch(`items.${index}.stockItemId`) > 0
                                              ? {
                                                  id: purchaseForm.watch(`items.${index}.stockItemId`),
                                                  name: purchaseForm.watch(`items.${index}.stockItemName`),
                                                }
                                              : null
                                          }
                                          onChange={(id, name) => {
                                            purchaseForm.setValue(`items.${index}.stockItemId`, id);
                                            purchaseForm.setValue(`items.${index}.stockItemName`, name);
                                          }}
                                          stockItems={stockItems}
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
                                  control={purchaseForm.control}
                                  name={`items.${index}.quantity`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormControl>
                                        <Input
                                          {...field}
                                          type="number"
                                          step="0.001"
                                          placeholder="0"
                                          className="font-mono"
                                          data-testid={`input-quantity-${index}`}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </td>
                              <td className="p-2">
                                <FormField
                                  control={purchaseForm.control}
                                  name={`items.${index}.rate`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormControl>
                                        <Input
                                          {...field}
                                          type="number"
                                          step="0.01"
                                          placeholder="0.00"
                                          className="font-mono"
                                          data-testid={`input-rate-${index}`}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </td>
                              <td className="p-2">
                                <div className="text-right font-mono font-medium" data-testid={`text-total-${index}`}>
                                  ${formatNumber(lineTotal)}
                                </div>
                              </td>
                              <td className="p-2">
                                {purchaseFields.length > 1 && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => purchaseRemove(index)}
                                    data-testid={`button-remove-${index}`}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-muted/30 border-t-2">
                        <tr>
                          <td colSpan={3} className="p-3">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                purchaseAppend({
                                  stockItemId: 0,
                                  stockItemName: "",
                                  quantity: "",
                                  rate: "",
                                })
                              }
                              data-testid="button-add-row"
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Add Row
                            </Button>
                          </td>
                          <td className="p-3">
                            <div className="text-right font-bold font-mono" data-testid="text-grand-total">
                              ${formatNumber(purchaseGrandTotal)}
                            </div>
                          </td>
                          <td></td>
                        </tr>
                        <tr className="border-t">
                          <td className="p-3 text-right font-medium" colSpan={1}>Total Quantity:</td>
                          <td className="p-3 font-mono font-medium">
                            {formatNumber(purchaseForm.watch("items").reduce((sum, item) => sum + (parseFloat(item.quantity) || 0), 0))}
                          </td>
                          <td colSpan={3}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {/* Notes field */}
                <FormField
                  control={purchaseForm.control}
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

                {/* Action buttons */}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancel}
                    disabled={updatePurchaseMutation.isPending}
                    data-testid="button-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={updatePurchaseMutation.isPending || purchaseGrandTotal === 0}
                    data-testid="button-save-changes"
                  >
                    {updatePurchaseMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Consumption/Mixed editing (when voucher type is Consumption or Mixed)
  if (isConsumption && voucher.adjustmentData) {
    const adjustment = voucher.adjustmentData;
    const location = locations.find(l => l.id === adjustment.locationId);
    
    // Calculate grand total
    const adjustmentGrandTotal = adjustmentForm.watch("items").reduce((sum, item) => {
      const qty = parseFloat(item.quantity) || 0;
      const rate = parseFloat(item.rate) || 0;
      return sum + (qty * rate);
    }, 0);
    
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleCancel} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">
              Edit {voucherType} Voucher
            </h1>
            <p className="text-muted-foreground mt-1">
              Voucher #{voucher.voucherNumber}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Edit {voucherType} Voucher</CardTitle>
            <CardDescription>Update stock adjustment details and line items</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...adjustmentForm}>
              <form onSubmit={adjustmentForm.handleSubmit(onSubmitAdjustment)} className="space-y-6">
                {/* Header section with date and location */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Date picker */}
                  <FormField
                    control={adjustmentForm.control}
                    name="voucherDate"
                    render={({ field }) => (
                      <FormItem className="flex-1">
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
                          <PopoverContent className="w-auto p-0" align="start">
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

                  {/* Location (readonly) */}
                  <div className="flex-1">
                    <FormLabel>Location</FormLabel>
                    <Input
                      value={location?.name || "N/A"}
                      disabled
                      className="mt-2"
                      data-testid="input-location"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Location cannot be changed to maintain inventory accuracy
                    </p>
                  </div>
                </div>

                {/* Optional toggle */}
                <div className="flex items-center gap-2 py-2 border-y">
                  <Switch
                    id="optional-toggle-adjustment"
                    checked={voucher.optional}
                    onCheckedChange={(checked) => toggleOptionalMutation.mutate(checked)}
                    disabled={toggleOptionalMutation.isPending}
                    data-testid="switch-optional"
                  />
                  <Label htmlFor="optional-toggle-adjustment" className="cursor-pointer">
                    Optional (Does not affect books)
                  </Label>
                </div>

                {/* Line items table */}
                <div>
                  <FormLabel className="mb-2 block">Line Items</FormLabel>
                  <div className="border rounded-md overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-3 font-medium w-[40%]">Stock Item</th>
                          <th className="text-left p-3 font-medium w-[15%]">Quantity</th>
                          <th className="text-left p-3 font-medium w-[15%]">Rate</th>
                          <th className="text-right p-3 font-medium w-[25%]">Total</th>
                          <th className="w-[5%]"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {adjustmentFields.map((field, index) => {
                          const qty = parseFloat(adjustmentForm.watch(`items.${index}.quantity`)) || 0;
                          const rate = parseFloat(adjustmentForm.watch(`items.${index}.rate`)) || 0;
                          const lineTotal = qty * rate;

                          return (
                            <tr key={field.id} className="border-t">
                              <td className="p-2">
                                <FormField
                                  control={adjustmentForm.control}
                                  name={`items.${index}.stockItemId`}
                                  render={({ field: itemField }) => (
                                    <FormItem>
                                      <FormControl>
                                        <StockItemCombobox
                                          value={
                                            adjustmentForm.watch(`items.${index}.stockItemId`) > 0
                                              ? {
                                                  id: adjustmentForm.watch(`items.${index}.stockItemId`),
                                                  name: adjustmentForm.watch(`items.${index}.stockItemName`),
                                                }
                                              : null
                                          }
                                          onChange={(id, name) => {
                                            adjustmentForm.setValue(`items.${index}.stockItemId`, id);
                                            adjustmentForm.setValue(`items.${index}.stockItemName`, name);
                                          }}
                                          stockItems={stockItems}
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
                                  control={adjustmentForm.control}
                                  name={`items.${index}.quantity`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormControl>
                                        <Input
                                          {...field}
                                          type="number"
                                          step="0.001"
                                          placeholder="0"
                                          className="font-mono"
                                          data-testid={`input-quantity-${index}`}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </td>
                              <td className="p-2">
                                <FormField
                                  control={adjustmentForm.control}
                                  name={`items.${index}.rate`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormControl>
                                        <Input
                                          {...field}
                                          type="number"
                                          step="0.01"
                                          placeholder="0.00"
                                          className="font-mono"
                                          data-testid={`input-rate-${index}`}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </td>
                              <td className="p-2">
                                <div className="text-right font-mono font-medium" data-testid={`text-total-${index}`}>
                                  ${formatNumber(lineTotal)}
                                </div>
                              </td>
                              <td className="p-2">
                                {adjustmentFields.length > 1 && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => adjustmentRemove(index)}
                                    data-testid={`button-remove-${index}`}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-muted/30 border-t-2">
                        <tr>
                          <td colSpan={3} className="p-3">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                adjustmentAppend({
                                  stockItemId: 0,
                                  stockItemName: "",
                                  quantity: "",
                                  rate: "",
                                })
                              }
                              data-testid="button-add-row"
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Add Row
                            </Button>
                          </td>
                          <td className="p-3">
                            <div className="text-right font-bold font-mono" data-testid="text-grand-total">
                              ${formatNumber(adjustmentGrandTotal)}
                            </div>
                          </td>
                          <td></td>
                        </tr>
                        <tr className="border-t">
                          <td className="p-3 text-right font-medium" colSpan={1}>Total Quantity:</td>
                          <td className="p-3 font-mono font-medium">
                            {formatNumber(adjustmentForm.watch("items").reduce((sum, item) => sum + (parseFloat(item.quantity) || 0), 0))}
                          </td>
                          <td colSpan={3}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {/* Notes field */}
                <FormField
                  control={adjustmentForm.control}
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

                {/* Action buttons */}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancel}
                    disabled={updateAdjustmentMutation.isPending}
                    data-testid="button-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={updateAdjustmentMutation.isPending || adjustmentGrandTotal === 0}
                    data-testid="button-save-changes"
                  >
                    {updateAdjustmentMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Stock Transfer editing (when voucher type is Stock Transfer)
  if (isStockTransfer && voucher.transferData) {
    const transfer = voucher.transferData;
    
    // Calculate grand total
    const transferGrandTotal = transferForm.watch("items").reduce((sum, item) => {
      const qty = parseFloat(item.quantity) || 0;
      const rate = parseFloat(item.rate) || 0;
      return sum + (qty * rate);
    }, 0);

    // Get source location name
    const sourceLocation = locations.find(l => l.id === transfer.sourceLocationId);
    const destinationLocation = locations.find(l => l.id === transfer.destinationLocationId);
    
    // Excel export function for Stock Transfer
    const exportToExcel = () => {
      const XLSX = require('xlsx');
      
      const transferItems = transferForm.watch("items");
      const totalBales = transferItems.reduce((sum, item) => sum + (parseFloat(item.quantity) || 0), 0);
      
      const exportData = transferItems.map(item => ({
        'Source Location': sourceLocation?.name || 'Unknown',
        'Bale Name': item.stockItemName || 'Unknown',
        'Quantity': parseFloat(item.quantity) || 0,
        'Rate': parseFloat(item.rate) || 0,
        'Amount': (parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0),
        'Destination Location': destinationLocation?.name || 'Unknown',
      }));
      
      // Add total row
      exportData.push({
        'Source Location': '',
        'Bale Name': 'TOTAL',
        'Quantity': totalBales,
        'Rate': 0,
        'Amount': transferGrandTotal,
        'Destination Location': '',
      });
      
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Stock Transfer');
      
      const filename = `Stock_Transfer_${voucher.voucherNumber}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
      XLSX.writeFile(workbook, filename);
      
      toast({
        title: "Export Successful",
        description: `Stock transfer exported to ${filename}`,
      });
    };
    
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={handleCancel} data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold" data-testid="text-page-title">
                Edit Stock Transfer
              </h1>
              <p className="text-muted-foreground mt-1">
                Voucher #{voucher.voucherNumber}
              </p>
            </div>
          </div>
          <Button 
            variant="outline" 
            onClick={exportToExcel}
            data-testid="button-export-excel"
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Export to Excel
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Edit Stock Transfer Voucher</CardTitle>
            <CardDescription>
              Transfer from {sourceLocation?.name || "Unknown"} to {destinationLocation?.name || "Unknown"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...transferForm}>
              <form onSubmit={transferForm.handleSubmit(onSubmitTransfer)} className="space-y-6">
                {/* Header section with date and locations */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Date picker */}
                  <FormField
                    control={transferForm.control}
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
                                  "w-full justify-start text-left font-normal",
                                  !field.value && "text-muted-foreground"
                                )}
                                data-testid="button-date-picker"
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {field.value ? format(field.value, "PPP") : "Pick a date"}
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
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

                  <div></div>

                  {/* Source Location (readonly) */}
                  <div>
                    <FormLabel>From Location (Source)</FormLabel>
                    <Input
                      value={sourceLocation?.name || "Unknown"}
                      disabled
                      className="mt-2"
                      data-testid="input-source-location"
                    />
                  </div>

                  {/* Destination Location (readonly) */}
                  <div>
                    <FormLabel>To Location (Destination)</FormLabel>
                    <Input
                      value={destinationLocation?.name || "Unknown"}
                      disabled
                      className="mt-2"
                      data-testid="input-destination-location"
                    />
                  </div>
                </div>

                {/* Optional toggle */}
                <div className="flex items-center gap-2 py-2 border-y">
                  <Switch
                    id="optional-toggle-transfer"
                    checked={voucher.optional}
                    onCheckedChange={(checked) => toggleOptionalMutation.mutate(checked)}
                    disabled={toggleOptionalMutation.isPending}
                    data-testid="switch-optional"
                  />
                  <Label htmlFor="optional-toggle-transfer" className="cursor-pointer">
                    Optional (Does not affect books)
                  </Label>
                </div>

                {/* Line items table */}
                <div>
                  <FormLabel className="mb-2 block">Line Items</FormLabel>
                  <div className="border rounded-md overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-3 font-medium w-[40%]">Stock Item</th>
                          <th className="text-left p-3 font-medium w-[15%]">Quantity</th>
                          <th className="text-left p-3 font-medium w-[15%]">Rate</th>
                          <th className="text-right p-3 font-medium w-[25%]">Total</th>
                          <th className="w-[5%]"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {transferFields.map((field, index) => {
                          const qty = parseFloat(transferForm.watch(`items.${index}.quantity`)) || 0;
                          const rate = parseFloat(transferForm.watch(`items.${index}.rate`)) || 0;
                          const lineTotal = qty * rate;

                          return (
                            <tr key={field.id} className="border-t">
                              <td className="p-2">
                                <FormField
                                  control={transferForm.control}
                                  name={`items.${index}.stockItemId`}
                                  render={({ field: itemField }) => (
                                    <FormItem>
                                      <FormControl>
                                        <StockItemCombobox
                                          value={
                                            transferForm.watch(`items.${index}.stockItemId`) > 0
                                              ? {
                                                  id: transferForm.watch(`items.${index}.stockItemId`),
                                                  name: transferForm.watch(`items.${index}.stockItemName`),
                                                }
                                              : null
                                          }
                                          onChange={(id, name) => {
                                            transferForm.setValue(`items.${index}.stockItemId`, id);
                                            transferForm.setValue(`items.${index}.stockItemName`, name);
                                          }}
                                          stockItems={stockItems}
                                          rowIndex={index}
                                          testIdPrefix="button-stock-item-transfer"
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </td>
                              <td className="p-2">
                                <FormField
                                  control={transferForm.control}
                                  name={`items.${index}.quantity`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormControl>
                                        <Input
                                          {...field}
                                          type="number"
                                          step="0.001"
                                          placeholder="0"
                                          className="font-mono"
                                          data-testid={`input-quantity-${index}`}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </td>
                              <td className="p-2">
                                <FormField
                                  control={transferForm.control}
                                  name={`items.${index}.rate`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormControl>
                                        <Input
                                          {...field}
                                          type="number"
                                          step="0.01"
                                          placeholder="0.00"
                                          className="font-mono"
                                          data-testid={`input-rate-${index}`}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </td>
                              <td className="p-2">
                                <div className="text-right font-mono font-medium" data-testid={`text-total-${index}`}>
                                  ${formatNumber(lineTotal)}
                                </div>
                              </td>
                              <td className="p-2">
                                {transferFields.length > 1 && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => transferRemove(index)}
                                    data-testid={`button-remove-${index}`}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-muted/30 border-t-2">
                        <tr>
                          <td colSpan={3} className="p-3">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                transferAppend({
                                  stockItemId: 0,
                                  stockItemName: "",
                                  quantity: "",
                                  rate: "",
                                })
                              }
                              data-testid="button-add-row"
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Add Row
                            </Button>
                          </td>
                          <td className="p-3">
                            <div className="text-right font-bold font-mono" data-testid="text-grand-total">
                              ${formatNumber(transferGrandTotal)}
                            </div>
                          </td>
                          <td></td>
                        </tr>
                        <tr className="border-t">
                          <td className="p-3 text-right font-medium" colSpan={1}>Total Quantity:</td>
                          <td className="p-3 font-mono font-medium">
                            {formatNumber(transferForm.watch("items").reduce((sum, item) => sum + (parseFloat(item.quantity) || 0), 0))}
                          </td>
                          <td colSpan={3}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {/* Notes field */}
                <FormField
                  control={transferForm.control}
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

                {/* Action buttons */}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancel}
                    disabled={updateTransferMutation.isPending}
                    data-testid="button-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={updateTransferMutation.isPending || transferGrandTotal === 0}
                    data-testid="button-save-changes"
                  >
                    {updateTransferMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Calculate totals
  const paymentTotal = isPaymentOrReceipt
    ? paymentForm.watch("entries").reduce((sum, entry) => sum + (parseFloat(entry.amount) || 0), 0)
    : 0;

  const journalDRTotal = isJournal
    ? journalForm.watch("entries").filter(e => e.type === "DR").reduce((sum, entry) => sum + (parseFloat(entry.amount) || 0), 0)
    : 0;

  const journalCRTotal = isJournal
    ? journalForm.watch("entries").filter(e => e.type === "CR").reduce((sum, entry) => sum + (parseFloat(entry.amount) || 0), 0)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={handleCancel} data-testid="button-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">
            Edit {voucherType} Voucher
          </h1>
          <p className="text-muted-foreground mt-1">
            Voucher #{voucher.voucherNumber}
          </p>
        </div>
      </div>

      {isPaymentOrReceipt && (
        <Card>
          <CardHeader>
            <CardTitle>Edit {voucherType} Voucher</CardTitle>
            <CardDescription>Update voucher details and entries</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...paymentForm}>
              <form onSubmit={paymentForm.handleSubmit(onSubmitPaymentReceipt)} className="space-y-6">
                {/* Header section */}
                <div className="flex items-start justify-between gap-4">
                  {/* Left: Payment account selector */}
                  <FormField
                    control={paymentForm.control}
                    name="paymentAccountId"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormLabel>
                          {voucherType === "Payment" ? "Pay From" : "Receive In"}
                        </FormLabel>
                        <FormControl>
                          <AccountAutocomplete
                            value={
                              paymentForm.watch("paymentAccountId") > 0
                                ? {
                                    type: paymentForm.watch("paymentAccountType"),
                                    id: paymentForm.watch("paymentAccountId"),
                                    name: paymentForm.watch("paymentAccountName"),
                                  }
                                : null
                            }
                            onChange={(type, id, name) => {
                              // Only ledger, bank, supplier are allowed in payment forms
                              if (type === "ledger" || type === "bank" || type === "supplier") {
                                paymentForm.setValue("paymentAccountType", type);
                                paymentForm.setValue("paymentAccountId", id);
                                paymentForm.setValue("paymentAccountName", name);
                              }
                            }}
                            allAccounts={allAccountsWithBalances}
                            rowIndex={-1}
                            testId="input-payment-account"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Right: Date picker */}
                  <FormField
                    control={paymentForm.control}
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
                </div>

                {/* Entries table */}
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
                      {paymentFields.map((field, index) => (
                        <tr key={field.id} className="border-t">
                          <td className="p-2">
                            <FormField
                              control={paymentForm.control}
                              name={`entries.${index}.accountId`}
                              render={({ field: accountField }) => (
                                <FormItem>
                                  <FormControl>
                                    <AccountAutocomplete
                                      value={
                                        paymentForm.watch(`entries.${index}.accountId`) > 0
                                          ? {
                                              type: paymentForm.watch(`entries.${index}.accountType`),
                                              id: paymentForm.watch(`entries.${index}.accountId`),
                                              name: paymentForm.watch(`entries.${index}.accountName`),
                                            }
                                          : null
                                      }
                                      onChange={(type, id, name) => {
                                        // Only ledger, bank, supplier are allowed in payment forms
                                        if (type === "ledger" || type === "bank" || type === "supplier") {
                                          paymentForm.setValue(`entries.${index}.accountType`, type);
                                          paymentForm.setValue(`entries.${index}.accountId`, id);
                                          paymentForm.setValue(`entries.${index}.accountName`, name);
                                        }
                                      }}
                                      allAccounts={allAccountsWithBalances}
                                      rowIndex={index}
                                      testId={`input-account-${index}`}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </td>
                          <td className="p-2">
                            <FormField
                              control={paymentForm.control}
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
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </td>
                          <td className="p-2">
                            {paymentFields.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => paymentRemove(index)}
                                data-testid={`button-remove-${index}`}
                              >
                                <X className="h-4 w-4" />
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
                              paymentAppend({
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
                            ${formatNumber(paymentTotal)}
                          </div>
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Notes field */}
                <FormField
                  control={paymentForm.control}
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

                {/* Action buttons */}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancel}
                    disabled={updateMutation.isPending}
                    data-testid="button-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={updateMutation.isPending || paymentTotal === 0}
                    data-testid="button-save-changes"
                  >
                    {updateMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      )}

      {isJournal && (
        <Card>
          <CardHeader>
            <CardTitle>Edit Journal Voucher</CardTitle>
            <CardDescription>Update journal entries (debits must equal credits)</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...journalForm}>
              <form onSubmit={journalForm.handleSubmit(onSubmitJournal)} className="space-y-6">
                {/* Date picker */}
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
                              data-testid="button-date-picker"
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {field.value ? format(field.value, "PPP") : "Pick a date"}
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
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

                {/* Entries table */}
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-3 font-medium w-[10%]">Type</th>
                        <th className="text-left p-3 font-medium w-[60%]">Account</th>
                        <th className="text-left p-3 font-medium w-[25%]">Amount</th>
                        <th className="w-[5%]"></th>
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
                                      <SelectTrigger data-testid={`select-type-${index}`}>
                                        <SelectValue placeholder="Type" />
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
                              render={({ field: accountField }) => (
                                <FormItem>
                                  <FormControl>
                                    <AccountAutocomplete
                                      value={
                                        journalForm.watch(`entries.${index}.accountId`) > 0
                                          ? {
                                              type: journalForm.watch(`entries.${index}.accountType`),
                                              id: journalForm.watch(`entries.${index}.accountId`),
                                              name: journalForm.watch(`entries.${index}.accountName`),
                                            }
                                          : null
                                      }
                                      onChange={(type, id, name) => {
                                        // Only ledger, bank, supplier are allowed in journal forms
                                        if (type === "ledger" || type === "bank" || type === "supplier") {
                                          journalForm.setValue(`entries.${index}.accountType`, type);
                                          journalForm.setValue(`entries.${index}.accountId`, id);
                                          journalForm.setValue(`entries.${index}.accountName`, name);
                                        }
                                      }}
                                      allAccounts={allAccountsWithBalances}
                                      rowIndex={index}
                                      testId={`input-account-${index}`}
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
                                      placeholder="0.00"
                                      className="font-mono"
                                      data-testid={`input-amount-${index}`}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </td>
                          <td className="p-2">
                            {journalFields.length > 2 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => journalRemove(index)}
                                data-testid={`button-remove-${index}`}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/30 border-t-2">
                      <tr>
                        <td colSpan={2} className="p-3">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              journalAppend({
                                type: "DR",
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
                          <div className="text-right text-sm">
                            <div className="text-muted-foreground">
                              DR: ${formatNumber(journalDRTotal)}
                            </div>
                            <div className="text-muted-foreground">
                              CR: ${formatNumber(journalCRTotal)}
                            </div>
                            <div className={cn(
                              "font-bold font-mono mt-1",
                              Math.abs(journalDRTotal - journalCRTotal) > 0.01 && "text-destructive"
                            )}>
                              Diff: ${formatNumber(Math.abs(journalDRTotal - journalCRTotal))}
                            </div>
                          </div>
                        </td>
                        <td></td>
                      </tr>
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
                          data-testid="input-notes"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Action buttons */}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancel}
                    disabled={updateMutation.isPending}
                    data-testid="button-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={updateMutation.isPending || Math.abs(journalDRTotal - journalCRTotal) > 0.01}
                    data-testid="button-save-changes"
                  >
                    {updateMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
