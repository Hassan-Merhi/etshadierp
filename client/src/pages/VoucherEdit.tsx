import { useState, useEffect } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CalendarIcon, ArrowLeft, Plus, Check, ChevronsUpDown, X } from "lucide-react";
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

interface VoucherData {
  id: number;
  companyId: number;
  locationId: number | null;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  description: string | null;
  totalAmount: string;
  entries: VoucherEntry[];
  purchaseOrder?: PurchaseOrderData | null;
  salesItems?: SalesItem[] | null;
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

export default function VoucherEdit() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
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

  // Determine voucher type and initialize appropriate form
  const voucherType = voucher?.voucherType;
  const isPaymentOrReceipt = voucherType === "Payment" || voucherType === "Receipt";
  const isJournal = voucherType === "Journal";
  const isPurchase = voucherType === "Purchase" && voucher?.purchaseOrder;
  const isSales = voucherType === "Sales" && voucher?.salesItems;

  // Payment/Receipt Form
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

  // Helper function to find account details by ID
  const findAccountDetails = (entry: VoucherEntry) => {
    if (entry.ledgerAccountId) {
      const account = ledgerAccounts.find(a => a.id === entry.ledgerAccountId);
      return account ? {
        type: "ledger" as const,
        id: account.id,
        name: `${account.code} - ${account.name}`,
      } : null;
    } else if (entry.bankAccountId) {
      const account = bankAccounts.find(a => a.id === entry.bankAccountId);
      return account ? {
        type: "bank" as const,
        id: account.id,
        name: `${account.accountNumber} - ${account.bankName}`,
      } : null;
    } else if (entry.supplierId) {
      const supplier = suppliers.find(s => s.id === entry.supplierId);
      return supplier ? {
        type: "supplier" as const,
        id: supplier.id,
        name: `${supplier.code} - ${supplier.legalName}`,
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
      
      // Remaining entries are the voucher entries
      const voucherEntries = voucher.entries.slice(1);

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
    }
  }, [voucher, voucherType, ledgerAccounts, bankAccounts, suppliers, formInitialized, isPaymentOrReceipt, isJournal, paymentForm, journalForm]);

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

  // Not supported voucher type (except Purchase and Sales which we handle separately)
  if (!isPaymentOrReceipt && !isJournal && !isPurchase && !isSales) {
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

  // Sales viewing (when voucher type is Sales and items are linked)
  if (isSales && voucher.salesItems) {
    const salesItems = voucher.salesItems;
    const location = locations.find(l => l.id === voucher.locationId);
    
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleCancel} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">
              Sales Invoice: {voucher.voucherNumber}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              View sales transaction details
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sales Details</CardTitle>
            <CardDescription>
              Point of Sale transaction
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Invoice Number</p>
                <p className="text-base font-semibold">{voucher.voucherNumber}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Date</p>
                <p className="text-base font-semibold">{format(parseISO(voucher.voucherDate), "PPP")}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Location</p>
                <p className="text-base font-semibold">{location?.name || "N/A"}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Amount</p>
                <p className="text-base font-semibold">
                  ${parseFloat(voucher.totalAmount || "0").toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
            </div>

            {salesItems && salesItems.length > 0 && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-2">Items Sold</p>
                <div className="border rounded-md">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-2 text-sm font-medium">Item</th>
                        <th className="text-right p-2 text-sm font-medium">Quantity</th>
                        <th className="text-right p-2 text-sm font-medium">Price</th>
                        <th className="text-right p-2 text-sm font-medium">Total</th>
                        <th className="text-right p-2 text-sm font-medium">Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesItems.map((item, index) => (
                        <tr key={item.id} className={index < salesItems.length - 1 ? "border-b" : ""}>
                          <td className="p-2 text-sm">
                            {item.stockItemCode} - {item.stockItemName}
                          </td>
                          <td className="p-2 text-sm text-right">
                            {parseFloat(item.quantity).toLocaleString()} {item.stockItemUom}
                          </td>
                          <td className="p-2 text-sm text-right">
                            ${parseFloat(item.sellingPrice).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          <td className="p-2 text-sm text-right font-medium">
                            ${parseFloat(item.totalSales).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          <td className="p-2 text-sm text-right font-medium text-green-600">
                            ${parseFloat(item.profit).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t font-semibold bg-muted/30">
                        <td className="p-2 text-sm" colSpan={3}>Total</td>
                        <td className="p-2 text-sm text-right">
                          ${salesItems.reduce((sum, item) => sum + parseFloat(item.totalSales), 0).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="p-2 text-sm text-right text-green-600">
                          ${salesItems.reduce((sum, item) => sum + parseFloat(item.profit), 0).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {voucher.description && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Notes</p>
                <p className="text-sm">{voucher.description}</p>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                onClick={handleCancel}
                data-testid="button-back-to-daybook"
              >
                Back to Daybook
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Purchase Order editing (when voucher type is Purchase and PO is linked)
  if (isPurchase && voucher.purchaseOrder) {
    const po = voucher.purchaseOrder;
    
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleCancel} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">
              Purchase Order: {po.poNumber}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              View and verify purchase order details
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Purchase Order Details</CardTitle>
            <CardDescription>
              This purchase order was automatically created during container import
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">PO Number</p>
                <p className="text-base font-semibold">{po.poNumber}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Currency</p>
                <p className="text-base font-semibold">{po.currency}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Items Total</p>
                <p className="text-base font-semibold">
                  ${parseFloat(po.itemsTotal || "0").toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Status</p>
                <p className="text-base font-semibold">{po.status}</p>
              </div>
            </div>

            {po.items && po.items.length > 0 && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-2">Line Items</p>
                <div className="border rounded-md">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-2 text-sm font-medium">Item</th>
                        <th className="text-right p-2 text-sm font-medium">Quantity</th>
                        <th className="text-right p-2 text-sm font-medium">Rate</th>
                        <th className="text-right p-2 text-sm font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {po.items.map((item, index) => (
                        <tr key={item.id} className={index < po.items.length - 1 ? "border-b" : ""}>
                          <td className="p-2 text-sm">{item.itemName}</td>
                          <td className="p-2 text-sm text-right">{parseFloat(item.quantity).toLocaleString()}</td>
                          <td className="p-2 text-sm text-right">
                            ${parseFloat(item.rate).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          <td className="p-2 text-sm text-right font-medium">
                            ${parseFloat(item.lineTotal).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                onClick={handleCancel}
                data-testid="button-back-to-daybook"
              >
                Back to Daybook
              </Button>
            </div>
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
                          <AccountCombobox
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
                              paymentForm.setValue("paymentAccountType", type);
                              paymentForm.setValue("paymentAccountId", id);
                              paymentForm.setValue("paymentAccountName", name);
                            }}
                            ledgerAccounts={ledgerAccounts}
                            bankAccounts={bankAccounts}
                            suppliers={suppliers}
                            rowIndex={-1}
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
                                    <AccountCombobox
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
                                        paymentForm.setValue(`entries.${index}.accountType`, type);
                                        paymentForm.setValue(`entries.${index}.accountId`, id);
                                        paymentForm.setValue(`entries.${index}.accountName`, name);
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
                            ${paymentTotal.toLocaleString(undefined, {
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
                                    <AccountCombobox
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
                              DR: ${journalDRTotal.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </div>
                            <div className="text-muted-foreground">
                              CR: ${journalCRTotal.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </div>
                            <div className={cn(
                              "font-bold font-mono mt-1",
                              Math.abs(journalDRTotal - journalCRTotal) > 0.01 && "text-destructive"
                            )}>
                              Diff: ${Math.abs(journalDRTotal - journalCRTotal).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
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
