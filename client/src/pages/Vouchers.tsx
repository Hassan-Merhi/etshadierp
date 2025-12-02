import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useReactToPrint } from "react-to-print";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { VoucherEditDialog } from "@/components/VoucherEditDialog";
import { AccountAutocomplete } from "@/components/AccountAutocomplete";
import type { CombinedAccount } from "@/components/AccountAutocomplete";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import { StockItemAutocomplete } from "@/components/StockItemAutocomplete";
import AccountSidebar, { Account } from "@/components/AccountSidebar";
import { useVoucherEntries } from "@/hooks/useVoucherEntries";
import { VoucherEntriesTable } from "@/components/vouchers/VoucherEntriesTable";
import { PaymentVoucherTab } from "@/components/vouchers/PaymentVoucherTab";
import { ReceiptVoucherTab } from "@/components/vouchers/ReceiptVoucherTab";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CalendarIcon, Printer, Plus, Check, ChevronsUpDown, Pencil, Upload, FileSpreadsheet, Download, CheckCircle, XCircle, X, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
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

interface Employee {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
  openingBalance?: string;
}

interface FixedAsset {
  id: number;
  code: string;
  name: string;
  openingBalance?: string;
}

interface VoucherEntry {
  accountType: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset";
  accountId: number;
  accountName: string;
  amount: string;
}

interface JournalEntry {
  type: "DR" | "CR";
  accountType: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset";
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
  accountType: z.enum(["ledger", "bank", "supplier", "employee", "fixedAsset"]),
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
  accountType: z.enum(["ledger", "bank", "supplier", "employee", "fixedAsset"]),
  accountId: z.number().min(1, "Please select an account"),
  accountName: z.string(),
  amount: z.string()
    .min(1, "Amount required")
    .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
      message: "Amount must be a positive number",
    }),
});

const voucherFormSchema = z.object({
  paymentAccountType: z.enum(["ledger", "bank", "supplier", "employee", "fixedAsset"]),
  paymentAccountId: z.number().min(1, "Please select an account"),
  paymentAccountName: z.string(),
  voucherDate: z.date(),
  entries: z.array(voucherEntrySchema).min(1, "Add at least one entry"),
  notes: z.string().optional(),
  optional: z.boolean().default(false),
});

const journalFormSchema = z.object({
  voucherDate: z.date(),
  entries: z.array(journalEntrySchema).min(1, "Add at least one entry"),
  notes: z.string().optional(),
  optional: z.boolean().default(false),
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
  optional: z.boolean().default(false),
});

const stockAdjustmentEntrySchema = z.object({
  type: z.enum(["CONSUME", "PRODUCE"]),
  stockItemId: z.number().min(1, "Please select a stock item"),
  stockItemName: z.string(),
  quantity: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) !== 0, "Quantity cannot be zero"),
  rate: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Rate must be non-negative"),
});

const stockAdjustmentFormSchema = z.object({
  voucherDate: z.date(),
  locationId: z.number().min(1, "Location required"),
  entries: z.array(stockAdjustmentEntrySchema).min(1, "At least one entry is required"),
  notes: z.string().optional(),
  optional: z.boolean().default(false),
});

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

interface VouchersProps {
  posUser?: any;
}

export default function Vouchers({ posUser }: VouchersProps = {}) {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const { formatDisplayDate } = useDateFormat();
  const [location, setLocation] = useLocation();
  const printRef = useRef<HTMLDivElement>(null);
  const isPOS = !!posUser;
  const posLocationId = posUser?.assignedLocationId;
  
  // Parse URL parameters for edit mode (use window.location.search since wouter doesn't include query params)
  const searchParams = new URLSearchParams(window.location.search);
  const editParam = searchParams.get('edit');
  const tabParam = searchParams.get('tab');
  const voucherIdToEdit = editParam ? parseInt(editParam) : null;
  
  const [activeTab, setActiveTab] = useState<"payment" | "receipt" | "journal" | "transfer" | "adjustment">(
    (tabParam as any) || "payment"
  );
  const [editVoucherId, setEditVoucherId] = useState<number | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // Handle opening voucher for editing
  const handleEditVoucher = (voucherId: number) => {
    // Navigate to the full voucher edit page for better editing experience
    setLocation(`/vouchers/${voucherId}/edit`);
  };

  // Synchronize activeTab and editVoucherId with URL parameters
  useEffect(() => {
    // Update tab: use URL param if present, otherwise reset to default "payment"
    if (tabParam) {
      setActiveTab(tabParam as any);
    } else {
      setActiveTab("payment");
    }
    
    // Update edit voucher ID: use URL param if present, otherwise clear it
    if (voucherIdToEdit) {
      setEditVoucherId(voucherIdToEdit);
    } else {
      setEditVoucherId(null);
    }
  }, [tabParam, voucherIdToEdit]);

  // Sidebar state management
  const [sidebarSearchValue, setSidebarSearchValue] = useState("");
  const [sidebarHighlightedIndex, setSidebarHighlightedIndex] = useState(0);
  const [sidebarActiveTab, setSidebarActiveTab] = useState("bank");
  const [mostUsedAccounts, setMostUsedAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [selectedAccountType, setSelectedAccountType] = useState<string | null>(null);
  const [activeRowIndex, setActiveRowIndex] = useState<number | null>(null);

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

  // Get POS user's location name for auto-populating source location
  const posLocation = isPOS && posLocationId ? locations.find(l => l.id === posLocationId) : null;
  const posLocationName = posLocation?.name || "";

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: fixedAssets = [] } = useQuery<FixedAsset[]>({
    queryKey: ["/api/fixed-assets"],
  });

  // Fetch accounts for sidebar (with balances)
  const { data: sidebarAccounts = [] } = useQuery<Account[]>({
    queryKey: ["/api/accounts/voucher-sidebar"],
  });

  // Fetch voucher data for editing if voucherIdToEdit is present
  const { data: voucherToEdit, isLoading: loadingVoucher } = useQuery({
    queryKey: ["/api/vouchers", voucherIdToEdit],
    enabled: !!voucherIdToEdit,
    queryFn: async () => {
      const res = await fetch(`/api/vouchers/${voucherIdToEdit}`);
      if (!res.ok) throw new Error("Failed to fetch voucher");
      return res.json();
    },
  });

  // Fetch stock transfer data for editing if voucherIdToEdit is present
  const { data: stockTransferToEdit } = useQuery({
    queryKey: ["/api/stock-transfers", voucherIdToEdit],
    enabled: !!voucherIdToEdit && (tabParam === "transfer" || activeTab === "transfer"),
    queryFn: async () => {
      const res = await fetch(`/api/stock-transfers?voucherId=${voucherIdToEdit}`);
      if (!res.ok) throw new Error("Failed to fetch stock transfer");
      const data = await res.json();
      return Array.isArray(data) ? data[0] : data;
    },
  });

  // Fetch stock adjustment data for editing if voucherIdToEdit is present
  const { data: stockAdjustmentToEdit } = useQuery({
    queryKey: ["/api/stock-adjustments", voucherIdToEdit],
    enabled: !!voucherIdToEdit && (tabParam === "adjustment" || activeTab === "adjustment"),
    queryFn: async () => {
      const res = await fetch(`/api/stock-adjustments?voucherId=${voucherIdToEdit}`);
      if (!res.ok) throw new Error("Failed to fetch stock adjustment");
      const data = await res.json();
      return Array.isArray(data) ? data[0] : data;
    },
  });

  // Combine all accounts for autocomplete (names only, no codes)
  const allAccounts = useMemo<CombinedAccount[]>(() => {
    const accounts = [
      ...ledgerAccounts.map((a) => ({
        type: "ledger" as const,
        id: a.id,
        name: a.name,
        code: a.code,
      })),
      ...bankAccounts.map((a) => ({
        type: "bank" as const,
        id: a.id,
        name: a.bankName,
        code: a.accountNumber,
      })),
      ...suppliers.map((s) => ({
        type: "supplier" as const,
        id: s.id,
        name: s.legalName,
        code: s.code,
      })),
      ...employees.map((e) => ({
        type: "employee" as const,
        id: e.id,
        name: `${e.firstName} ${e.lastName}`,
        code: e.code,
        openingBalance: e.openingBalance,
      })),
      ...fixedAssets.map((f) => ({
        type: "fixedAsset" as const,
        id: f.id,
        name: f.name,
        code: f.code,
        openingBalance: f.openingBalance,
      })),
    ];
    return accounts.sort((a, b) => a.name.localeCompare(b.name));
  }, [ledgerAccounts, bankAccounts, suppliers, employees, fixedAssets]);

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
      optional: false,
    },
  });

  const fieldArray = useFieldArray({
    control: form.control,
    name: "entries",
  });
  const { fields, append, remove } = fieldArray;

  // Calculate total
  const entries = form.watch("entries");
  const total = entries.reduce(
    (sum, entry) => sum + (parseFloat(entry.amount) || 0),
    0
  );

  // Pre-populate form when editing
  useEffect(() => {
    if (voucherToEdit && voucherToEdit.entries && allAccounts.length > 0) {
      // For Payment vouchers: payment account is the one with CREDIT
      // For Receipt vouchers: payment account is the one with DEBIT
      const paymentEntry = voucherToEdit.entries.find((entry: any) => {
        if (voucherToEdit.voucherType === "Payment") {
          return parseFloat(entry.creditAmount || "0") > 0;
        } else if (voucherToEdit.voucherType === "Receipt") {
          return parseFloat(entry.debitAmount || "0") > 0;
        }
        return false;
      });

      if (!paymentEntry) return;

      // Determine account type and ID from the payment entry
      let paymentType: string = "bank";
      let paymentId = 0;
      let paymentName = "";

      if (paymentEntry.bankAccountId) {
        paymentType = "bank";
        paymentId = paymentEntry.bankAccountId;
        const account = bankAccounts.find(b => b.id === paymentId);
        paymentName = account?.bankName || "";
      } else if (paymentEntry.ledgerAccountId) {
        paymentType = "ledger";
        paymentId = paymentEntry.ledgerAccountId;
        const account = ledgerAccounts.find(l => l.id === paymentId);
        paymentName = account?.name || "";
      } else if (paymentEntry.supplierId) {
        paymentType = "supplier";
        paymentId = paymentEntry.supplierId;
        const supplier = suppliers.find(s => s.id === paymentId);
        paymentName = supplier?.legalName || "";
      } else if (paymentEntry.employeeId) {
        paymentType = "employee";
        paymentId = paymentEntry.employeeId;
        const employee = employees.find(e => e.id === paymentId);
        paymentName = employee ? `${employee.firstName} ${employee.lastName}` : "";
      } else if (paymentEntry.fixedAssetId) {
        paymentType = "fixedAsset";
        paymentId = paymentEntry.fixedAssetId;
        const asset = fixedAssets.find(f => f.id === paymentId);
        paymentName = asset?.name || "";
      }

      // Convert contra entries (all entries except payment entry) to form format
      const formEntries = voucherToEdit.entries
        .filter((entry: any) => entry !== paymentEntry)
        .map((entry: any) => {
        let accountType: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset" = "ledger";
        let accountId = 0;
        let accountName = "";
        let amount = "0";

        if (entry.ledgerAccountId) {
          accountType = "ledger";
          accountId = entry.ledgerAccountId;
          const account = ledgerAccounts.find(l => l.id === accountId);
          accountName = account?.name || "";
        } else if (entry.bankAccountId) {
          accountType = "bank";
          accountId = entry.bankAccountId;
          const account = bankAccounts.find(b => b.id === accountId);
          accountName = account?.bankName || "";
        } else if (entry.supplierId) {
          accountType = "supplier";
          accountId = entry.supplierId;
          const supplier = suppliers.find(s => s.id === accountId);
          accountName = supplier?.legalName || "";
        } else if (entry.employeeId) {
          accountType = "employee";
          accountId = entry.employeeId;
          const employee = employees.find(e => e.id === accountId);
          accountName = employee ? `${employee.firstName} ${employee.lastName}` : "";
        } else if (entry.fixedAssetId) {
          accountType = "fixedAsset";
          accountId = entry.fixedAssetId;
          const asset = fixedAssets.find(f => f.id === accountId);
          accountName = asset?.name || "";
        }

        // For Payment vouchers, contra entries are debits (expenses, assets purchased)
        // For Receipt vouchers, contra entries are credits (revenue, liability decrease)
        if (voucherToEdit.voucherType === "Payment") {
          amount = entry.debitAmount || "0";
        } else if (voucherToEdit.voucherType === "Receipt") {
          amount = entry.creditAmount || "0";
        }

        return {
          accountType,
          accountId,
          accountName,
          amount,
        };
      });

      // Reset form with voucher data
      form.reset({
        paymentAccountType: paymentType as any,
        paymentAccountId: paymentId,
        paymentAccountName: paymentName,
        voucherDate: new Date(voucherToEdit.voucherDate),
        entries: formEntries.length > 0 ? formEntries : [{
          accountType: "ledger",
          accountId: 0,
          accountName: "",
          amount: "",
        }],
        notes: voucherToEdit.description || "",
        optional: voucherToEdit.optional || false,
      });
    }
  }, [voucherToEdit, allAccounts, bankAccounts, ledgerAccounts, suppliers, employees, fixedAssets, form]);

  // Compute filtered accounts based on search (lifted from AccountSidebar)
  const filteredSidebarAccounts = useMemo(() => {
    return sidebarAccounts
      .filter((acc) =>
        acc.name.toLowerCase().includes(sidebarSearchValue.toLowerCase()) ||
        acc.code.toLowerCase().includes(sidebarSearchValue.toLowerCase())
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sidebarAccounts, sidebarSearchValue]);

  // Track active row's account for sync
  const activeRowAccountId = activeRowIndex !== null && entries[activeRowIndex] 
    ? entries[activeRowIndex].accountId 
    : null;
  const activeRowAccountType = activeRowIndex !== null && entries[activeRowIndex]
    ? entries[activeRowIndex].accountType
    : null;

  // Sync highlighted index only when search changes or active row changes
  useEffect(() => {
    if (filteredSidebarAccounts.length === 0) {
      setSidebarHighlightedIndex(-1);
      return;
    }
    
    // If there's an active row with an account, try to highlight that account
    if (activeRowAccountId && activeRowAccountType) {
      const accountIndex = filteredSidebarAccounts.findIndex(
        (acc) => acc.id === activeRowAccountId && acc.type === activeRowAccountType
      );
      if (accountIndex >= 0) {
        setSidebarHighlightedIndex(accountIndex);
        return;
      }
    }
    
    // Otherwise reset to first item when search changes
    setSidebarHighlightedIndex(0);
  }, [sidebarSearchValue, activeRowIndex, activeRowAccountId, activeRowAccountType]);

  // Clamp highlighted index when filtered list length changes (separate effect to avoid re-syncing during navigation)
  useEffect(() => {
    if (filteredSidebarAccounts.length === 0) {
      return; // Already handled in sync effect
    }
    const maxIndex = filteredSidebarAccounts.length - 1;
    if (sidebarHighlightedIndex > maxIndex) {
      setSidebarHighlightedIndex(maxIndex);
    }
  }, [filteredSidebarAccounts.length]);

  // Get selected payment account and calculate balance
  const paymentAccountType = form.watch("paymentAccountType");
  const paymentAccountId = form.watch("paymentAccountId");
  const paymentAccountName = form.watch("paymentAccountName");
  
  // Find the selected account in allAccounts to get openingBalance
  const selectedAccount = useMemo(() => {
    return allAccounts.find(acc => acc.type === paymentAccountType && acc.id === paymentAccountId);
  }, [allAccounts, paymentAccountType, paymentAccountId]);
  
  // Calculate balance for selected account
  const { data: accountBalance = 0 } = useQuery({
    queryKey: ["/api/accounts", paymentAccountType, paymentAccountId, "balance"],
    enabled: paymentAccountId > 0,
    queryFn: async () => {
      if (paymentAccountType === "bank") {
        const account = bankAccounts.find((b) => b.id === paymentAccountId);
        return account ? parseFloat(account.balance || "0") : 0;
      } else if (paymentAccountType === "ledger") {
        // Fetch the ledger account details to get opening balance
        const accountRes = await fetch(`/api/ledger-accounts/${paymentAccountId}`);
        const account = await accountRes.json();
        
        // Fetch transactions
        const transRes = await fetch(`/api/accounts/ledger/${paymentAccountId}/transactions`);
        const transactions = await transRes.json();
        
        // Calculate opening balance with side
        let openingBalance = parseFloat(account.openingBalance || "0");
        if (account.openingBalanceSide === "Cr") {
          openingBalance = -openingBalance;
        }
        
        // Sum transactions starting from opening balance
        const balance = transactions.reduce((sum: number, t: any) => {
          const debit = parseFloat(t.debitAmount || "0");
          const credit = parseFloat(t.creditAmount || "0");
          return sum + debit - credit;
        }, openingBalance);
        return balance;
      } else if (paymentAccountType === "supplier") {
        // Fetch the supplier details to get opening balance
        const supplierRes = await fetch(`/api/suppliers/${paymentAccountId}`);
        const supplier = await supplierRes.json();
        
        // Fetch transactions
        const transRes = await fetch(`/api/accounts/supplier/${paymentAccountId}/transactions`);
        const transactions = await transRes.json();
        
        // Opening balance: Positive = we owe them, Negative = they owe us/prepaid
        const openingBalance = parseFloat(supplier.openingBalance || "0");
        
        // Sum transactions starting from opening balance
        // Credits increase payable, Debits decrease payable
        const balance = transactions.reduce((sum: number, t: any) => {
          const credit = parseFloat(t.creditAmount || "0");
          const debit = parseFloat(t.debitAmount || "0");
          return sum + credit - debit;
        }, openingBalance);
        return balance;
      } else if (paymentAccountType === "employee") {
        // Use opening balance from selected account
        const openingBalance = parseFloat(selectedAccount?.openingBalance || "0");
        
        // Fetch transactions
        const transRes = await fetch(`/api/accounts/employee/${paymentAccountId}/transactions`);
        const transactions = await transRes.json();
        
        // Sum transactions starting from opening balance
        // Credits increase payable (we owe them), Debits decrease payable (we paid them)
        const balance = transactions.reduce((sum: number, t: any) => {
          const credit = parseFloat(t.creditAmount || "0");
          const debit = parseFloat(t.debitAmount || "0");
          return sum + credit - debit;
        }, openingBalance);
        return balance;
      } else if (paymentAccountType === "fixedAsset") {
        // Use opening balance from selected account
        const openingBalance = parseFloat(selectedAccount?.openingBalance || "0");
        
        // Fetch transactions
        const transRes = await fetch(`/api/accounts/fixed-asset/${paymentAccountId}/transactions`);
        const transactions = await transRes.json();
        
        // Sum transactions starting from opening balance
        // Debits increase asset value, Credits decrease (depreciation)
        const balance = transactions.reduce((sum: number, t: any) => {
          const debit = parseFloat(t.debitAmount || "0");
          const credit = parseFloat(t.creditAmount || "0");
          return sum + debit - credit;
        }, openingBalance);
        return balance;
      }
      return 0;
    },
  });

  // Save mutation (handles both create and update) - OPTIMIZED to use batch endpoint
  const saveMutation = useMutation({
    mutationFn: async (formData: VoucherFormData) => {
      const data = formData;
      const voucherType = activeTab === "payment" ? "Payment" : "Receipt";
      const isEditMode = !!voucherIdToEdit;

      // Prepare request payload
      const payload = {
        voucherType,
        voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
        paymentAccountType: data.paymentAccountType,
        paymentAccountId: data.paymentAccountId,
        paymentAccountName: data.paymentAccountName,
        entries: data.entries,
        notes: data.notes,
        optional: data.optional,
      };

      // Use batch endpoint for both create and update
      if (isEditMode) {
        const res = await apiRequest("PATCH", `/api/vouchers/${voucherIdToEdit}/payment-receipt`, payload);
        return await res.json();
      } else {
        const res = await apiRequest("POST", "/api/vouchers/payment-receipt", payload);
        return await res.json();
      }
    },
    onSuccess: async () => {
      const isEditMode = !!voucherIdToEdit;
      toast({
        title: "Success",
        description: `${activeTab === "payment" ? "Payment" : "Receipt"} voucher ${isEditMode ? "updated" : "created"} successfully`,
      });
      
      // Refetch all affected data immediately
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["/api/vouchers"] }),
        queryClient.refetchQueries({ queryKey: ["/api/daybook"] }),
        queryClient.refetchQueries({ queryKey: ["/api/accounts/all"] }),
        queryClient.refetchQueries({ queryKey: ["/api/accounts"] }),
        queryClient.refetchQueries({ queryKey: ["/api/bank-accounts"] }),
        queryClient.refetchQueries({ queryKey: ["/api/ledger-accounts"] }),
        queryClient.refetchQueries({ queryKey: ["/api/suppliers"] }),
        queryClient.refetchQueries({ queryKey: ["/api/employees"] }),
        queryClient.refetchQueries({ queryKey: ["/api/fixed-assets"] }),
        queryClient.refetchQueries({ queryKey: ["/api/payroll/employees-with-balances"] }),
      ]);
      
      // Clear edit mode and navigate back to daybook
      if (isEditMode) {
        setLocation("/daybook");
      } else {
        form.reset({
          paymentAccountType: "ledger",
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
          optional: false,
        });
      }
    },
    onError: (error: any) => {
      const isEditMode = !!voucherIdToEdit;
      toast({
        title: "Error",
        description: error.message || `Failed to ${isEditMode ? "update" : "create"} voucher`,
        variant: "destructive",
      });
    },
  });

  // Handle account selection from sidebar
  const handleSidebarAccountSelect = (account: Account) => {
    // Get the current entries from form state
    const currentEntries = form.getValues("entries");
    
    let targetRowIndex: number;

    // If there's an active row (user is typing in that row), fill it
    if (activeRowIndex !== null && activeRowIndex < currentEntries.length) {
      targetRowIndex = activeRowIndex;
      form.setValue(`entries.${activeRowIndex}.accountType`, account.type);
      form.setValue(`entries.${activeRowIndex}.accountId`, account.id);
      form.setValue(`entries.${activeRowIndex}.accountName`, account.name);
      
      // Focus the amount input for that row
      requestAnimationFrame(() => {
        const amountInput = document.querySelector(
          `[data-testid="input-amount-${activeRowIndex}"]`
        ) as HTMLInputElement;
        if (amountInput) {
          amountInput.focus();
          amountInput.select();
        }
      });
    } else {
      // Find if there's an empty entry to populate
      const emptyEntryIndex = currentEntries.findIndex(
        (e: any) => e.accountId === 0 || !e.accountName
      );

      if (emptyEntryIndex >= 0) {
        // Fill the existing empty entry
        targetRowIndex = emptyEntryIndex;
        form.setValue(`entries.${emptyEntryIndex}.accountType`, account.type);
        form.setValue(`entries.${emptyEntryIndex}.accountId`, account.id);
        form.setValue(`entries.${emptyEntryIndex}.accountName`, account.name);
        
        // Focus the amount input for that row
        requestAnimationFrame(() => {
          const amountInput = document.querySelector(
            `[data-testid="input-amount-${emptyEntryIndex}"]`
          ) as HTMLInputElement;
          if (amountInput) {
            amountInput.focus();
            amountInput.select();
          }
        });
      } else {
        // Add a new entry with all account data
        targetRowIndex = currentEntries.length;
        append({
          accountType: account.type,
          accountId: account.id,
          accountName: account.name,
          amount: "",
        });
        
        // Focus the amount input for the new row after it's been added
        requestAnimationFrame(() => {
          const amountInput = document.querySelector(
            `[data-testid="input-amount-${targetRowIndex}"]`
          ) as HTMLInputElement;
          if (amountInput) {
            amountInput.focus();
            amountInput.select();
          }
        });
      }
    }
    
    // Set selected account and active row for sidebar highlighting
    setSelectedAccountId(account.id);
    setSelectedAccountType(account.type);
    setActiveRowIndex(targetRowIndex);
  };
  
  // Clear selection when amount is committed (blur or Enter with amount > 0)
  const handleAmountCommit = (rowIndex: number) => {
    // Only clear if this is the active row
    if (rowIndex === activeRowIndex) {
      setSelectedAccountId(null);
      setSelectedAccountType(null);
      setActiveRowIndex(null);
      setSidebarSearchValue("");
      setSidebarHighlightedIndex(0);
      
      // Refocus sidebar search to support auto-focus workflow
      requestAnimationFrame(() => {
        const searchInput = document.querySelector(
          '[data-testid="input-search-account"]'
        ) as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
        }
      });
    }
  };

  // Sync active row's accountName to sidebar search (like POS does with itemName)
  useEffect(() => {
    if (activeRowIndex !== null) {
      const entries = form.watch("entries");
      const activeEntry = entries[activeRowIndex];
      if (activeEntry) {
        setSidebarSearchValue(activeEntry.accountName || "");
        setSidebarHighlightedIndex(0);
      }
    }
  }, [form.watch("entries"), activeRowIndex]);

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
      optional: false,
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

  // Pre-populate journal form when editing
  useEffect(() => {
    if (voucherToEdit && voucherToEdit.voucherType === "Journal" && voucherToEdit.entries && allAccounts.length > 0) {
      const formEntries = voucherToEdit.entries.map((entry: any) => {
        let accountType: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset" = "ledger";
        let accountId = 0;
        let accountName = "";
        let type: "DR" | "CR" = "DR";
        let amount = "0";

        // Determine account type and ID
        if (entry.bankAccountId) {
          accountType = "bank";
          accountId = entry.bankAccountId;
          const account = bankAccounts.find(b => b.id === accountId);
          accountName = account?.bankName || "";
        } else if (entry.ledgerAccountId) {
          accountType = "ledger";
          accountId = entry.ledgerAccountId;
          const account = ledgerAccounts.find(l => l.id === accountId);
          accountName = account?.name || "";
        } else if (entry.supplierId) {
          accountType = "supplier";
          accountId = entry.supplierId;
          const supplier = suppliers.find(s => s.id === accountId);
          accountName = supplier?.legalName || "";
        } else if (entry.employeeId) {
          accountType = "employee";
          accountId = entry.employeeId;
          const employee = employees.find(e => e.id === accountId);
          accountName = employee ? `${employee.firstName} ${employee.lastName}` : "";
        } else if (entry.fixedAssetId) {
          accountType = "fixedAsset";
          accountId = entry.fixedAssetId;
          const asset = fixedAssets.find(f => f.id === accountId);
          accountName = asset?.name || "";
        }

        // Determine DR/CR and amount
        const debitAmt = parseFloat(entry.debitAmount || "0");
        const creditAmt = parseFloat(entry.creditAmount || "0");
        
        if (debitAmt > 0) {
          type = "DR";
          amount = entry.debitAmount;
        } else if (creditAmt > 0) {
          type = "CR";
          amount = entry.creditAmount;
        }

        return {
          type,
          accountType,
          accountId,
          accountName,
          amount,
        };
      });

      journalForm.reset({
        voucherDate: new Date(voucherToEdit.voucherDate),
        entries: formEntries.length > 0 ? formEntries : [{
          type: "DR",
          accountType: "ledger",
          accountId: 0,
          accountName: "",
          amount: "",
        }],
        notes: voucherToEdit.notes || "",
        optional: voucherToEdit.optional || false,
      });
    }
  }, [voucherToEdit, allAccounts, bankAccounts, ledgerAccounts, suppliers, employees, fixedAssets, journalForm]);

  // Journal save mutation (handles both create and update) - OPTIMIZED to use batch endpoint
  const journalMutation = useMutation({
    mutationFn: async (formData: JournalFormData) => {
      const data = formData;
      const isEditMode = !!voucherIdToEdit;

      // Filter out empty entries
      const validEntries = data.entries.filter((entry) => entry.accountId > 0);

      // Prepare request payload
      const payload = {
        voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
        entries: validEntries,
        notes: data.notes,
        optional: data.optional,
      };

      // Use batch endpoint for both create and update
      if (isEditMode) {
        const res = await apiRequest("PATCH", `/api/vouchers/${voucherIdToEdit}/journal`, payload);
        return await res.json();
      } else {
        const res = await apiRequest("POST", "/api/vouchers/journal", payload);
        return await res.json();
      }
    },
    onSuccess: async () => {
      const isEditMode = !!voucherIdToEdit;
      toast({
        title: "Success",
        description: `Journal voucher ${isEditMode ? "updated" : "created"} successfully`,
      });
      
      // Refetch all affected data immediately
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["/api/daybook"] }),
        queryClient.refetchQueries({ queryKey: ["/api/vouchers"] }),
        queryClient.refetchQueries({ queryKey: ["/api/accounts/all"] }),
        queryClient.refetchQueries({ queryKey: ["/api/accounts"] }),
        queryClient.refetchQueries({ queryKey: ["/api/bank-accounts"] }),
        queryClient.refetchQueries({ queryKey: ["/api/ledger-accounts"] }),
        queryClient.refetchQueries({ queryKey: ["/api/suppliers"] }),
        queryClient.refetchQueries({ queryKey: ["/api/employees"] }),
        queryClient.refetchQueries({ queryKey: ["/api/fixed-assets"] }),
        queryClient.refetchQueries({ queryKey: ["/api/payroll/employees-with-balances"] }),
      ]);
      
      // Clear edit mode and navigate back to daybook or reset form
      if (isEditMode) {
        setLocation("/daybook");
      } else {
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
          optional: false,
        });
      }
    },
    onError: (error: any) => {
      const isEditMode = !!voucherIdToEdit;
      toast({
        title: "Error",
        description: error.message || `Failed to ${isEditMode ? "update" : "create"} journal voucher`,
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
      optional: false,
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
  const [transferInventorySource, setTransferInventorySource] = useState<number | null>(isPOS && posLocationId ? posLocationId : null);
  const [transferSearchTerm, setTransferSearchTerm] = useState("");
  const [transferHighlightedIndex, setTransferHighlightedIndex] = useState(0);
  const [transferSourceSearchTerm, setTransferSourceSearchTerm] = useState("");
  const [transferSourceHighlightedIndex, setTransferSourceHighlightedIndex] = useState(0);
  const [showSourceSidebar, setShowSourceSidebar] = useState(false);
  const [showItemSidebar, setShowItemSidebar] = useState(false);
  const [activeFieldType, setActiveFieldType] = useState<'source' | 'item' | null>(null);
  const transferSidebarRef = useRef<HTMLDivElement>(null);
  const transferFocusIdRef = useRef(0);

  // For POS users, auto-set source location to their assigned location when locations load
  useEffect(() => {
    if (isPOS && posLocationId && posLocationName) {
      // Update all entries to use POS user's location as source
      const entries = stockTransferForm.getValues("entries");
      entries.forEach((_, index) => {
        stockTransferForm.setValue(`entries.${index}.sourceLocationId`, posLocationId);
        stockTransferForm.setValue(`entries.${index}.sourceLocationName`, posLocationName);
      });
      // Set inventory source for sidebar
      setTransferInventorySource(posLocationId);
    }
  }, [isPOS, posLocationId, posLocationName]);

  // Stock Transfer Import state
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [importValidationResult, setImportValidationResult] = useState<any>(null);
  const [importDestLocation, setImportDestLocation] = useState<string>("");
  const [importDate, setImportDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [importNotes, setImportNotes] = useState<string>("");

  // Import mutations
  const importParseMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch("/api/stock-transfer-import/parse-multi-source", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to parse file");
      }
      return await res.json();
    },
    onSuccess: (data) => {
      setImportPreview(data);
      setImportValidationResult(null);
      toast({
        title: "File parsed successfully",
        description: `Found ${data.items.length} item(s). Click Validate to check the data.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Parse error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const importValidateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/stock-transfer-import/validate-multi-source", data);
      return await res.json();
    },
    onSuccess: (data) => {
      setImportValidationResult(data);
      const errorCount = data.errors?.length || 0;
      if (errorCount === 0) {
        toast({
          title: "Validation passed",
          description: "All items validated successfully. You can now import the data.",
        });
      } else {
        toast({
          title: "Validation issues found",
          description: `Found ${errorCount} issue(s). Please review before importing.`,
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Validation error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/stock-transfer-import/import-multi-source", data);
      return await res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Import successful",
        description: `${data.itemsCount} items transferred successfully.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-by-location"] });
      // Reset import state
      setImportDialogOpen(false);
      setImportFile(null);
      setImportPreview(null);
      setImportValidationResult(null);
      setImportDestLocation("");
      setImportNotes("");
    },
    onError: (error: any) => {
      toast({
        title: "Import error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setImportFile(selectedFile);
      setImportPreview(null);
      setImportValidationResult(null);
    }
  };

  const handleImportParse = () => {
    if (!importFile) {
      toast({
        title: "No file selected",
        description: "Please select an Excel file to upload",
        variant: "destructive",
      });
      return;
    }
    const formData = new FormData();
    formData.append("file", importFile);
    importParseMutation.mutate(formData);
  };

  const handleImportValidate = () => {
    if (!importDestLocation) {
      toast({
        title: "Destination required",
        description: "Please select a destination location",
        variant: "destructive",
      });
      return;
    }
    if (!importPreview) {
      toast({
        title: "No preview data",
        description: "Please parse the file first",
        variant: "destructive",
      });
      return;
    }
    importValidateMutation.mutate({
      destinationLocationId: parseInt(importDestLocation),
      items: importPreview.items,
    });
  };

  const handleImportSubmit = () => {
    if (!importDestLocation || !importPreview || !importValidationResult?.validatedItems) {
      toast({
        title: "Cannot import",
        description: "Please parse, validate, and fix any errors first",
        variant: "destructive",
      });
      return;
    }
    
    // Filter valid items (those without errors)
    const validItems = importValidationResult.validatedItems.filter((item: any) => !item.error);
    
    // If there are validation errors, show confirmation dialog
    if (importValidationResult?.errors?.length > 0) {
      setImportConfirmDialogOpen(true);
      return;
    }
    
    // No errors - proceed directly
    importMutation.mutate({
      destinationLocationId: parseInt(importDestLocation),
      transferDate: importDate,
      notes: importNotes,
      items: validItems,
    });
  };
  
  const handleConfirmedImport = () => {
    // Filter valid items and proceed with import
    const validItems = importValidationResult?.validatedItems?.filter((item: any) => !item.error) || [];
    
    // Close confirmation dialog first
    setImportConfirmDialogOpen(false);
    
    if (validItems.length === 0) {
      // Close the import dialog and reset all state
      setImportDialogOpen(false);
      setImportFile(null);
      setImportPreview(null);
      setImportValidationResult(null);
      setImportDestLocation("");
      setImportDate(new Date().toISOString().split("T")[0]);
      setImportNotes("");
      // Show informational message
      toast({
        title: "No items imported",
        description: "All items had validation errors. No transfer was created. You can try again with a different file.",
      });
      return;
    }
    
    importMutation.mutate({
      destinationLocationId: parseInt(importDestLocation),
      transferDate: importDate,
      notes: importNotes,
      items: validItems,
    });
  };

  const downloadImportTemplate = () => {
    window.open("/api/stock-transfer-import/template-multi-source", "_blank");
  };

  const importIsValidated = importValidationResult !== null;
  const importHasErrors = importValidationResult?.errors && importValidationResult.errors.length > 0;
  
  // Calculate valid items (items without errors)
  const importValidItems = importValidationResult?.validatedItems?.filter((item: any) => !item.error) || [];
  const importValidItemsCount = importValidItems.length;
  const importTotalItemsCount = importValidationResult?.validatedItems?.length || 0;
  
  // Confirmation dialog state for import with errors
  const [importConfirmDialogOpen, setImportConfirmDialogOpen] = useState(false);

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

  // Pre-populate stock transfer form when editing
  useEffect(() => {
    if (stockTransferToEdit && stockTransferToEdit.items && locations.length > 0 && stockItems.length > 0) {
      // Map stock transfer items to form entries
      const formEntries = stockTransferToEdit.items.map((item: any) => {
        const sourceLocation = locations.find(l => l.id === item.sourceLocationId);
        const stockItem = stockItems.find(s => s.id === item.stockItemId);
        
        return {
          sourceLocationId: item.sourceLocationId || 0,
          sourceLocationName: sourceLocation?.name || "",
          stockItemId: item.stockItemId || 0,
          stockItemName: stockItem?.name || "",
          quantity: item.quantity || "0",
          rate: item.rate || "0",
        };
      });

      // Reset form with stock transfer data
      stockTransferForm.reset({
        voucherDate: voucherToEdit ? new Date(voucherToEdit.voucherDate) : new Date(),
        destinationLocationId: stockTransferToEdit.destinationLocationId || 0,
        entries: formEntries.length > 0 ? formEntries : [{
          sourceLocationId: 0,
          sourceLocationName: "",
          stockItemId: 0,
          stockItemName: "",
          quantity: "",
          rate: "",
        }],
        notes: stockTransferToEdit.notes || "",
        optional: voucherToEdit?.optional || false,
      });
    }
  }, [stockTransferToEdit, voucherToEdit, locations, stockItems, stockTransferForm]);

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
        name: ledgerAccount.name,
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
        name: bankAccount.bankName,
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
        name: supplier.legalName,
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

  // Stock Transfer mutation (handles both create and update)
  const stockTransferMutation = useMutation({
    mutationFn: async (formData: StockTransferFormData) => {
      const data = formData;
      const isEditMode = !!voucherIdToEdit;
      
      // Get unique source locations for description
      const uniqueSources = Array.from(new Set(data.entries.map(e => e.sourceLocationId)));
      const sourceNames = uniqueSources.map(id => locations.find(l => l.id === id)?.name).filter(Boolean).join(", ");
      const destName = locations.find(l => l.id === data.destinationLocationId)?.name;
      
      if (isEditMode) {
        // UPDATE MODE: Use PATCH to update existing voucher and stock transfer
        const voucherRes = await apiRequest("PATCH", `/api/vouchers/${voucherIdToEdit}`, {
          voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
          description: `Stock transfer from ${sourceNames} to ${destName}`,
          totalAmount: transferTotal.toString(),
          optional: data.optional,
        });
        
        // Update stock transfer (assuming stockTransferToEdit has an id)
        if (stockTransferToEdit?.id) {
          await apiRequest("PUT", `/api/stock-transfers/${stockTransferToEdit.id}`, {
            destinationLocationId: data.destinationLocationId,
            notes: data.notes || "",
            items: data.entries.map(entry => ({
              sourceLocationId: entry.sourceLocationId,
              stockItemId: entry.stockItemId,
              quantity: entry.quantity,
              rate: entry.rate,
            })),
          });
        }
        
        return await voucherRes.json();
      } else {
        // CREATE MODE: Create new voucher and stock transfer
        const voucherRes = await apiRequest("POST", "/api/vouchers", {
          companyId: selectedCompany?.id,
          voucherType: "StockTransfer",
          voucherNumber: `TRANSFER-${Date.now()}`,
          voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
          description: `Stock transfer from ${sourceNames} to ${destName}`,
          totalAmount: transferTotal.toString(),
          optional: data.optional,
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
      }
    },
    onSuccess: () => {
      const isEditMode = !!voucherIdToEdit;
      toast({
        title: "Success",
        description: `Stock transfer voucher ${isEditMode ? "updated" : "created"} successfully`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
      
      // Clear edit mode and navigate back to daybook or reset form
      if (isEditMode) {
        setLocation("/daybook");
      } else {
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
      }
    },
    onError: (error: any) => {
      const isEditMode = !!voucherIdToEdit;
      toast({
        title: "Error",
        description: error.message || `Failed to ${isEditMode ? "update" : "create"} stock transfer`,
        variant: "destructive",
      });
    },
  });

  const onStockTransferSubmit = async (data: StockTransferFormData) => {
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

    // Check for zero quantity entries
    const zeroQtyEntry = data.entries.find(
      (entry) => entry.stockItemId > 0 && entry.sourceLocationId > 0 && parseFloat(entry.quantity) === 0
    );
    if (zeroQtyEntry) {
      const item = stockItems.find(s => s.id === zeroQtyEntry.stockItemId);
      toast({
        title: "Validation Error",
        description: `Cannot add ${item?.name} with zero quantity`,
        variant: "destructive",
      });
      return;
    }

    // Validate quantities against available inventory
    const inventoryValidationPromises = validEntries.map(entry =>
      fetch(`/api/locations/${entry.sourceLocationId}/inventory`)
        .then(res => res.json())
        .then(inventory => {
          const availableItem = inventory.find((item: any) => item.stockItemId === entry.stockItemId);
          const availableQty = availableItem ? parseFloat(availableItem.quantity || "0") : 0;
          const requestedQty = parseFloat(entry.quantity);
          
          if (requestedQty > availableQty) {
            const item = stockItems.find(s => s.id === entry.stockItemId);
            const sourceLocation = locations.find(l => l.id === entry.sourceLocationId);
            return {
              success: false,
              error: `${item?.name} has only ${availableQty} available in ${sourceLocation?.name}, but you're trying to transfer ${requestedQty}`
            };
          }
          return { success: true };
        })
        .catch(err => ({
          success: false,
          error: `Failed to validate inventory: ${err.message}`
        }))
    );

    const results = await Promise.all(inventoryValidationPromises);
    const failedValidation = results.find(r => !r.success);
    
    if (failedValidation) {
      toast({
        title: "Insufficient Stock",
        description: failedValidation.error,
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
      entries: [],
      notes: "",
      optional: false,
    },
  });

  const {
    fields: adjustmentFields,
    append: appendAdjustment,
    remove: removeAdjustment,
  } = useFieldArray({
    control: stockAdjustmentForm.control,
    name: "entries",
  });

  const adjustmentEntries = stockAdjustmentForm.watch("entries") || [];
  const adjustmentLocationId = stockAdjustmentForm.watch("locationId") || 0;
  
  const consumptionTotal = adjustmentEntries
    .filter(entry => entry.type === "CONSUME")
    .reduce((sum, entry) => sum + (parseFloat(entry.quantity || "0") * parseFloat(entry.rate || "0")), 0);
  const productionTotal = adjustmentEntries
    .filter(entry => entry.type === "PRODUCE")
    .reduce((sum, entry) => sum + (parseFloat(entry.quantity || "0") * parseFloat(entry.rate || "0")), 0);

  // Fetch location inventory for auto-filling rates in adjustments
  const { data: locationInventory = [] } = useQuery<any[]>({
    queryKey: ['/api/adjustment-location-inventory', adjustmentLocationId],
    enabled: adjustmentLocationId > 0,
    queryFn: async () => {
      const response = await fetch(`/api/locations/${adjustmentLocationId}/inventory`);
      if (!response.ok) throw new Error('Failed to fetch inventory');
      return response.json();
    },
  });

  // Pre-populate stock adjustment form when editing
  useEffect(() => {
    if (stockAdjustmentToEdit && stockAdjustmentToEdit.items && stockItems.length > 0) {
      // Map stock adjustment items to form entries
      const formEntries = stockAdjustmentToEdit.items.map((item: any) => {
        const stockItem = stockItems.find(s => s.id === item.stockItemId);
        const quantity = parseFloat(item.quantity || "0");
        
        // Determine type: negative quantities are CONSUME, positive are PRODUCE
        const type = quantity < 0 ? "CONSUME" : "PRODUCE";
        const absQuantity = Math.abs(quantity).toString();
        
        return {
          type,
          stockItemId: item.stockItemId || 0,
          stockItemName: stockItem?.name || "",
          quantity: absQuantity,
          rate: item.rate || "0",
        };
      });

      // Reset form with stock adjustment data
      stockAdjustmentForm.reset({
        voucherDate: voucherToEdit ? new Date(voucherToEdit.voucherDate) : new Date(),
        locationId: stockAdjustmentToEdit.locationId || 0,
        entries: formEntries.length > 0 ? formEntries : [{
          type: "PRODUCE",
          stockItemId: 0,
          stockItemName: "",
          quantity: "",
          rate: "",
        }],
        notes: stockAdjustmentToEdit.notes || "",
        optional: voucherToEdit?.optional || false,
      });
    }
  }, [stockAdjustmentToEdit, voucherToEdit, stockItems, stockAdjustmentForm]);

  // Stock Adjustment mutation (handles both create and update)
  const stockAdjustmentMutation = useMutation({
    mutationFn: async (formData: StockAdjustmentFormData) => {
      const data = formData;
      const isEditMode = !!voucherIdToEdit;
      
      // Determine adjustment type based on entry types
      const hasConsumption = data.entries.some(e => e.type === "CONSUME");
      const hasProduction = data.entries.some(e => e.type === "PRODUCE");
      const adjustmentType = hasConsumption && hasProduction 
        ? "Mixed" 
        : hasProduction 
          ? "Production" 
          : "Consumption";
      
      // Map entries with consumption quantities negated
      const items = data.entries.map(entry => ({
        stockItemId: entry.stockItemId,
        quantity: entry.type === "CONSUME" 
          ? (-parseFloat(entry.quantity)).toString() 
          : entry.quantity,
        rate: entry.rate,
      }));

      const totalAmount = consumptionTotal + productionTotal;
      
      if (isEditMode) {
        // UPDATE MODE: Use PATCH to update existing voucher and stock adjustment
        const voucherRes = await apiRequest("PATCH", `/api/vouchers/${voucherIdToEdit}`, {
          voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
          description: `Stock ${adjustmentType.toLowerCase()} at ${locations.find(l => l.id === data.locationId)?.name}`,
          totalAmount: totalAmount.toString(),
          optional: data.optional,
        });
        
        // Update stock adjustment (assuming stockAdjustmentToEdit has an id)
        if (stockAdjustmentToEdit?.id) {
          await apiRequest("PUT", `/api/stock-adjustments/${stockAdjustmentToEdit.id}`, {
            locationId: data.locationId,
            adjustmentType: adjustmentType,
            notes: data.notes || "",
            items: items,
          });
        }
        
        return await voucherRes.json();
      } else {
        // CREATE MODE: Create new voucher and stock adjustment
        const voucherRes = await apiRequest("POST", "/api/vouchers", {
          companyId: selectedCompany?.id,
          voucherType: adjustmentType,
          voucherNumber: `${adjustmentType.toUpperCase()}-${Date.now()}`,
          voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
          description: `Stock ${adjustmentType.toLowerCase()} at ${locations.find(l => l.id === data.locationId)?.name}`,
          totalAmount: totalAmount.toString(),
          optional: data.optional,
        });
        const voucher = await voucherRes.json();

        // Create stock adjustment
        await apiRequest("POST", "/api/stock-adjustments", {
          voucherId: voucher.id,
          locationId: data.locationId,
          adjustmentType: adjustmentType,
          notes: data.notes || "",
          items: items,
        });

        return voucher;
      }
    },
    onSuccess: () => {
      const isEditMode = !!voucherIdToEdit;
      toast({
        title: "Success",
        description: `Production/Consumption voucher ${isEditMode ? "updated" : "created"} successfully`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-adjustments"] });
      
      // Clear edit mode and navigate back to daybook or reset form
      if (isEditMode) {
        setLocation("/daybook");
      } else {
        stockAdjustmentForm.reset({
          voucherDate: new Date(),
          locationId: 0,
          entries: [
            {
              type: "PRODUCE",
              stockItemId: 0,
              stockItemName: "",
              quantity: "",
              rate: "",
            },
          ],
          notes: "",
        });
      }
    },
    onError: (error: any) => {
      const isEditMode = !!voucherIdToEdit;
      toast({
        title: "Error",
        description: error.message || `Failed to ${isEditMode ? "update" : "create"} stock adjustment`,
        variant: "destructive",
      });
    },
  });

  const onStockAdjustmentSubmit = (data: StockAdjustmentFormData) => {
    // Validate entries
    const validEntries = data.entries.filter(
      (entry) => entry.stockItemId > 0 && parseFloat(entry.quantity) > 0
    );

    if (validEntries.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please add at least one valid entry",
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
    
    // Arrow key navigation for amount field
    if (fieldName === "amount") {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rowIndex > 0) {
          setTimeout(() => {
            const prevAmountInput = document.querySelector(`[data-testid="input-amount-${rowIndex - 1}"]`) as HTMLInputElement;
            if (prevAmountInput) {
              prevAmountInput.focus();
              prevAmountInput.select();
            }
          }, 50);
        }
        return;
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rowIndex < fields.length - 1) {
          setTimeout(() => {
            const nextAmountInput = document.querySelector(`[data-testid="input-amount-${rowIndex + 1}"]`) as HTMLInputElement;
            if (nextAmountInput) {
              nextAmountInput.focus();
              nextAmountInput.select();
            }
          }, 50);
        }
        return;
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setTimeout(() => {
          const accountInput = document.querySelector(`[data-testid="input-account-${rowIndex}"]`) as HTMLInputElement;
          if (accountInput) accountInput.focus();
        }, 50);
        return;
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (rowIndex < fields.length - 1) {
          setTimeout(() => {
            const nextAccountInput = document.querySelector(`[data-testid="input-account-${rowIndex + 1}"]`) as HTMLInputElement;
            if (nextAccountInput) nextAccountInput.focus();
          }, 50);
        }
        return;
      }
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
        const newRowInput = document.querySelector(`[data-testid="input-account-${rowIndex + 1}"]`) as HTMLInputElement;
        if (newRowInput) {
          newRowInput.focus();
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
    
    // Arrow key navigation for type field
    if (fieldName === "type") {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rowIndex > 0) {
          setTimeout(() => {
            const prevTypeInput = document.querySelector(`[data-testid="input-journal-type-${rowIndex - 1}"]`) as HTMLInputElement;
            if (prevTypeInput) {
              prevTypeInput.focus();
              prevTypeInput.select();
            }
          }, 50);
        }
        return;
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rowIndex < journalFields.length - 1) {
          setTimeout(() => {
            const nextTypeInput = document.querySelector(`[data-testid="input-journal-type-${rowIndex + 1}"]`) as HTMLInputElement;
            if (nextTypeInput) {
              nextTypeInput.focus();
              nextTypeInput.select();
            }
          }, 50);
        }
        return;
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setTimeout(() => {
          const accountInput = document.querySelector(`[data-testid="input-journal-account-${rowIndex}"]`) as HTMLInputElement;
          if (accountInput) accountInput.focus();
        }, 50);
        return;
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        // Wrap to current row's Amount field (circular navigation)
        setTimeout(() => {
          const amountInput = document.querySelector(`[data-testid="input-journal-amount-${rowIndex}"]`) as HTMLInputElement;
          if (amountInput) {
            amountInput.focus();
            amountInput.select();
          }
        }, 50);
        return;
      } else if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        setTimeout(() => {
          const accountInput = document.querySelector(`[data-testid="input-journal-account-${rowIndex}"]`) as HTMLInputElement;
          if (accountInput) {
            accountInput.focus();
          }
        }, 50);
        return;
      }
    }
    
    // Arrow key navigation for amount field
    if (fieldName === "amount") {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rowIndex > 0) {
          setTimeout(() => {
            const prevAmountInput = document.querySelector(`[data-testid="input-journal-amount-${rowIndex - 1}"]`) as HTMLInputElement;
            if (prevAmountInput) {
              prevAmountInput.focus();
              prevAmountInput.select();
            }
          }, 50);
        }
        return;
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rowIndex < journalFields.length - 1) {
          setTimeout(() => {
            const nextAmountInput = document.querySelector(`[data-testid="input-journal-amount-${rowIndex + 1}"]`) as HTMLInputElement;
            if (nextAmountInput) {
              nextAmountInput.focus();
              nextAmountInput.select();
            }
          }, 50);
        }
        return;
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setTimeout(() => {
          const accountInput = document.querySelector(`[data-testid="input-journal-account-${rowIndex}"]`) as HTMLInputElement;
          if (accountInput) accountInput.focus();
        }, 50);
        return;
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (rowIndex < journalFields.length - 1) {
          setTimeout(() => {
            const nextTypeInput = document.querySelector(`[data-testid="input-journal-type-${rowIndex + 1}"]`) as HTMLInputElement;
            if (nextTypeInput) {
              nextTypeInput.focus();
              nextTypeInput.select();
            }
          }, 50);
        }
        return;
      }
    }
    
    // Handle Tab on Amount - move to DR/CR of next row or create new row
    if (fieldName === "amount" && e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      // On last row - create new row
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
        const nextRowInput = document.querySelector(`[data-testid="input-journal-type-${rowIndex + 1}"]`) as HTMLInputElement;
        if (nextRowInput) {
          nextRowInput.focus();
          nextRowInput.select();
        }
      }, 100);
    }
    
    // Handle Enter on Amount - create new row if last row, then focus DR/CR of new row
    if (fieldName === "amount" && e.key === "Enter") {
      e.preventDefault();
      // On last row - create new row
      if (isLastRow) {
        appendJournal({
          type: "DR",
          accountType: "ledger",
          accountId: 0,
          accountName: "",
          amount: "",
        });
        setTimeout(() => {
          const newRowInput = document.querySelector(`[data-testid="input-journal-type-${rowIndex + 1}"]`) as HTMLInputElement;
          if (newRowInput) {
            newRowInput.focus();
            newRowInput.select();
          }
        }, 100);
      } else {
        // Not last row - move to DR/CR of next row
        setTimeout(() => {
          const nextRowInput = document.querySelector(`[data-testid="input-journal-type-${rowIndex + 1}"]`) as HTMLInputElement;
          if (nextRowInput) {
            nextRowInput.focus();
            nextRowInput.select();
          }
        }, 50);
      }
    }
  };

  // Keyboard navigation handlers for Stock Transfer
  const handleTransferKeyDown = (
    e: React.KeyboardEvent,
    rowIndex: number,
    fieldName: "quantity" | "rate"
  ) => {
    const isLastRow = rowIndex === transferFields.length - 1;
    
    // Arrow key navigation for quantity field
    if (fieldName === "quantity") {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rowIndex > 0) {
          setTimeout(() => {
            const prevInput = document.querySelector(`[data-testid="input-transfer-quantity-${rowIndex - 1}"]`) as HTMLInputElement;
            if (prevInput) {
              prevInput.focus();
              prevInput.select();
            }
          }, 50);
        }
        return;
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rowIndex < transferFields.length - 1) {
          setTimeout(() => {
            const nextInput = document.querySelector(`[data-testid="input-transfer-quantity-${rowIndex + 1}"]`) as HTMLInputElement;
            if (nextInput) {
              nextInput.focus();
              nextInput.select();
            }
          }, 50);
        }
        return;
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setTimeout(() => {
          const stockItemInput = document.querySelector(`[data-testid="input-stock-item-${rowIndex}"]`) as HTMLInputElement;
          if (stockItemInput) {
            stockItemInput.focus();
            stockItemInput.select();
          }
        }, 50);
        return;
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setTimeout(() => {
          const rateInput = document.querySelector(`[data-testid="input-transfer-rate-${rowIndex}"]`) as HTMLInputElement;
          if (rateInput) {
            rateInput.focus();
            rateInput.select();
          }
        }, 50);
        return;
      } else if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        setTimeout(() => {
          const rateInput = document.querySelector(`[data-testid="input-transfer-rate-${rowIndex}"]`) as HTMLInputElement;
          if (rateInput) {
            rateInput.focus();
            rateInput.select();
          }
        }, 50);
        return;
      }
    }
    
    // Arrow key navigation for rate field
    if (fieldName === "rate") {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rowIndex > 0) {
          setTimeout(() => {
            const prevInput = document.querySelector(`[data-testid="input-transfer-rate-${rowIndex - 1}"]`) as HTMLInputElement;
            if (prevInput) {
              prevInput.focus();
              prevInput.select();
            }
          }, 50);
        }
        return;
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rowIndex < transferFields.length - 1) {
          setTimeout(() => {
            const nextInput = document.querySelector(`[data-testid="input-transfer-rate-${rowIndex + 1}"]`) as HTMLInputElement;
            if (nextInput) {
              nextInput.focus();
              nextInput.select();
            }
          }, 50);
        }
        return;
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setTimeout(() => {
          const quantityInput = document.querySelector(`[data-testid="input-transfer-quantity-${rowIndex}"]`) as HTMLInputElement;
          if (quantityInput) {
            quantityInput.focus();
            quantityInput.select();
          }
        }, 50);
        return;
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (rowIndex < transferFields.length - 1) {
          setTimeout(() => {
            const nextSourceInput = document.querySelector(`[data-testid="input-source-location-${rowIndex + 1}"]`) as HTMLInputElement;
            if (nextSourceInput) {
              nextSourceInput.focus();
              nextSourceInput.select();
            }
          }, 50);
        }
        return;
      } else if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        // On last row - create new row
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
          const nextRowInput = document.querySelector(`[data-testid="input-source-location-${rowIndex + 1}"]`) as HTMLInputElement;
          if (nextRowInput) {
            nextRowInput.focus();
            nextRowInput.select();
          }
        }, 100);
        return;
      } else if (e.key === "Enter") {
        e.preventDefault();
        // On last row - create new row
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
          const nextRowInput = document.querySelector(`[data-testid="input-source-location-${rowIndex + 1}"]`) as HTMLInputElement;
          if (nextRowInput) {
            nextRowInput.focus();
            nextRowInput.select();
          }
        }, 100);
        return;
      }
    }
  };

  // Keyboard navigation handlers for Production/Consumption Table
  const handleAdjustmentKeyDown = (
    e: React.KeyboardEvent,
    rowIndex: number,
    fieldName: "type" | "stockItem" | "quantity" | "rate"
  ) => {
    const isLastRow = rowIndex === adjustmentFields.length - 1;
    
    // Handle Tab for navigation
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      
      if (fieldName === "type") {
        setTimeout(() => {
          const stockItemButton = document.querySelector(`[data-testid="button-adjustment-stock-${rowIndex}"]`) as HTMLButtonElement;
          if (stockItemButton) {
            stockItemButton.focus();
          }
        }, 50);
      } else if (fieldName === "stockItem") {
        setTimeout(() => {
          const quantityInput = document.querySelector(`[data-testid="input-adjustment-quantity-${rowIndex}"]`) as HTMLInputElement;
          if (quantityInput) {
            quantityInput.focus();
            quantityInput.select();
          }
        }, 50);
      } else if (fieldName === "quantity") {
        setTimeout(() => {
          const rateInput = document.querySelector(`[data-testid="input-adjustment-rate-${rowIndex}"]`) as HTMLInputElement;
          if (rateInput) {
            rateInput.focus();
            rateInput.select();
          }
        }, 50);
      }
    }
    
    // Handle Enter on Rate - create new row and focus Type of new row
    if (fieldName === "rate" && e.key === "Enter") {
      e.preventDefault();
      if (isLastRow) {
        appendAdjustment({
          type: "CONSUME",
          stockItemId: 0,
          stockItemName: "",
          quantity: "",
          rate: "",
        });
      }
      setTimeout(() => {
        const newRowSelect = document.querySelector(`[data-testid="select-adjustment-type-${rowIndex + 1}"]`) as HTMLButtonElement;
        if (newRowSelect) {
          newRowSelect.focus();
        }
      }, 100);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-page-title">
          {isPOS ? "Stock Transfer" : "Vouchers"}
        </h1>
        <p className="text-muted-foreground mt-1">
          {isPOS ? "Transfer stock between locations" : "Create payment and receipt vouchers"}
        </p>
      </div>

      {/* Hidden print template */}
      {!isPOS && (
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
      )}

      <Tabs value={isPOS ? "transfer" : activeTab} onValueChange={(v) => !isPOS && setActiveTab(v as "payment" | "receipt" | "journal" | "transfer" | "adjustment")}>
        {!isPOS && (
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
        )}

        {!isPOS && (
          <TabsContent value="payment" className="space-y-4">
            <PaymentVoucherTab
              form={form}
              fieldArray={fieldArray}
              entries={entries}
              total={total}
              paymentAccountId={paymentAccountId}
              paymentAccountType={paymentAccountType}
              paymentAccountName={paymentAccountName}
              accountBalance={accountBalance}
              allAccounts={allAccounts}
              sidebarAccounts={sidebarAccounts}
              filteredSidebarAccounts={filteredSidebarAccounts}
              sidebarSearchValue={sidebarSearchValue}
              setSidebarSearchValue={setSidebarSearchValue}
              sidebarHighlightedIndex={sidebarHighlightedIndex}
              setSidebarHighlightedIndex={setSidebarHighlightedIndex}
              selectedAccountId={selectedAccountId}
              selectedAccountType={selectedAccountType}
              handleSidebarAccountSelect={handleSidebarAccountSelect}
              handleAmountCommit={handleAmountCommit}
              handlePrint={handlePrint}
              onSubmit={onSubmit}
              activeTab="payment"
              activeRowIndex={activeRowIndex}
              setActiveRowIndex={setActiveRowIndex}
            />
          </TabsContent>
        )}

        {!isPOS && (
          <TabsContent value="receipt" className="space-y-4">
            <ReceiptVoucherTab
              form={form}
              fieldArray={fieldArray}
              entries={entries}
              total={total}
              paymentAccountId={paymentAccountId}
              paymentAccountType={paymentAccountType}
              paymentAccountName={paymentAccountName}
              accountBalance={accountBalance}
              allAccounts={allAccounts}
              sidebarAccounts={sidebarAccounts}
              filteredSidebarAccounts={filteredSidebarAccounts}
              sidebarSearchValue={sidebarSearchValue}
              setSidebarSearchValue={setSidebarSearchValue}
              sidebarHighlightedIndex={sidebarHighlightedIndex}
              setSidebarHighlightedIndex={setSidebarHighlightedIndex}
              selectedAccountId={selectedAccountId}
              selectedAccountType={selectedAccountType}
              handleSidebarAccountSelect={handleSidebarAccountSelect}
              handleAmountCommit={handleAmountCommit}
              handlePrint={handlePrint}
              onSubmit={onSubmit}
              activeTab="receipt"
              activeRowIndex={activeRowIndex}
              setActiveRowIndex={setActiveRowIndex}
            />
          </TabsContent>
        )}

        {/* Journal Voucher Tab */}
        {!isPOS && (
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
                                  {field.value ? formatDisplayDate(field.value) : "Pick a date"}
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
                                    <FormControl>
                                      <Input
                                        {...field}
                                        placeholder="DR/CR"
                                        className="uppercase text-center"
                                        maxLength={2}
                                        data-testid={`input-journal-type-${index}`}
                                        onChange={(e) => {
                                          const value = e.target.value.toUpperCase();
                                          if (value === "" || value === "D" || value === "DR" || value === "C" || value === "CR") {
                                            field.onChange(value === "D" ? "DR" : value === "C" ? "CR" : value);
                                          }
                                        }}
                                        onKeyDown={(e) => handleJournalKeyDown(e, index, "type")}
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
                                name={`entries.${index}.accountId`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormControl>
                                      <AccountAutocomplete
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
                                        onTabPressed={() => {
                                          setTimeout(() => {
                                            const amountInput = document.querySelector(`[data-testid="input-journal-amount-${index}"]`) as HTMLInputElement;
                                            if (amountInput) {
                                              amountInput.focus();
                                              amountInput.select();
                                            }
                                          }, 50);
                                        }}
                                        onArrowUp={() => {
                                          if (index > 0) {
                                            setTimeout(() => {
                                              const prevAccountInput = document.querySelector(`[data-testid="input-journal-account-${index - 1}"]`) as HTMLInputElement;
                                              if (prevAccountInput) prevAccountInput.focus();
                                            }, 50);
                                          }
                                        }}
                                        onArrowDown={() => {
                                          if (index < journalFields.length - 1) {
                                            setTimeout(() => {
                                              const nextAccountInput = document.querySelector(`[data-testid="input-journal-account-${index + 1}"]`) as HTMLInputElement;
                                              if (nextAccountInput) nextAccountInput.focus();
                                            }, 50);
                                          }
                                        }}
                                        onArrowRight={() => {
                                          setTimeout(() => {
                                            const amountInput = document.querySelector(`[data-testid="input-journal-amount-${index}"]`) as HTMLInputElement;
                                            if (amountInput) {
                                              amountInput.focus();
                                              amountInput.select();
                                            }
                                          }, 50);
                                        }}
                                        onArrowLeft={() => {
                                          setTimeout(() => {
                                            const typeInput = document.querySelector(`[data-testid="input-journal-type-${index}"]`) as HTMLInputElement;
                                            if (typeInput) {
                                              typeInput.focus();
                                              typeInput.select();
                                            }
                                          }, 50);
                                        }}
                                        allAccounts={allAccounts}
                                        rowIndex={index}
                                        placeholder="Select account..."
                                        testId={`input-journal-account-${index}`}
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

                  {/* Optional checkbox */}
                  <FormField
                    control={journalForm.control}
                    name="optional"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="checkbox-journal-optional"
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
        )}

        <TabsContent value="transfer" className="space-y-4">
          <Form {...stockTransferForm}>
            <form onSubmit={stockTransferForm.handleSubmit(onStockTransferSubmit)}>
              {/* Header Row */}
              <div className="flex items-center gap-4 mb-4">
                {isPOS && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">From:</span>
                    <span className="font-medium">{posLocationName}</span>
                  </div>
                )}
                
                <FormField
                  control={stockTransferForm.control}
                  name="destinationLocationId"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0">
                      <FormLabel className="text-sm text-muted-foreground whitespace-nowrap">To:</FormLabel>
                      <Select
                        value={field.value > 0 ? field.value.toString() : ""}
                        onValueChange={(value) => field.onChange(parseInt(value))}
                      >
                        <FormControl>
                          <SelectTrigger className="w-[200px]" data-testid="select-destination-location">
                            <SelectValue placeholder="Select destination..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {[...locations]
                            .filter(l => l.id !== transferInventorySource)
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((location) => (
                              <SelectItem key={location.id} value={location.id.toString()}>
                                {location.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />

                <FormField
                  control={stockTransferForm.control}
                  name="voucherDate"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0">
                      <FormLabel className="text-sm text-muted-foreground whitespace-nowrap">Date:</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-[160px] justify-start text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                              data-testid="button-transfer-date-picker"
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {field.value ? formatDisplayDate(field.value) : "Pick date"}
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
                    </FormItem>
                  )}
                />

                <div className="flex-1" />

                {!isPOS && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setImportDialogOpen(true)}
                    data-testid="button-open-import-dialog"
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Import
                  </Button>
                )}
              </div>

              <div className="flex gap-4">
                {/* Main Spreadsheet Area */}
                <Card className="flex-1 overflow-hidden">
                  <div className="overflow-x-auto">
                    <div className="min-w-full">
                      {/* Header */}
                      <div className="flex bg-muted/50 border-b sticky top-0 z-10">
                        <div className="w-12 flex items-center justify-center border-r h-10 font-medium text-xs">
                          #
                        </div>
                        {!isPOS && (
                          <div className="w-40 flex items-center px-3 border-r h-10 font-medium text-sm">
                            Source
                          </div>
                        )}
                        <div className="flex-1 min-w-[200px] flex items-center px-3 border-r h-10 font-medium text-sm">
                          Item Name
                        </div>
                        <div className="w-24 flex items-center px-3 border-r h-10 font-medium text-sm">
                          Qty
                        </div>
                        {!isPOS && (
                          <>
                            <div className="w-24 flex items-center px-3 border-r h-10 font-medium text-sm">
                              Rate
                            </div>
                            <div className="w-28 flex items-center px-3 border-r h-10 font-medium text-sm bg-muted/30">
                              Amount
                            </div>
                          </>
                        )}
                        <div className="w-12 flex items-center justify-center h-10" />
                      </div>

                      {/* Rows */}
                      <div className="max-h-[calc(100vh-24rem)] overflow-y-auto">
                        {transferFields.map((field, index) => (
                          <div key={field.id} className="flex border-b hover-elevate">
                            <div className="w-12 flex items-center justify-center border-r h-10 text-xs text-muted-foreground">
                              {index + 1}
                            </div>
                            {!isPOS && (
                              <div className="w-40 border-r h-10">
                                <input
                                  type="text"
                                  value={activeTransferRow === index && activeFieldType === 'source' ? transferSourceSearchTerm : (transferEntries[index]?.sourceLocationName || "")}
                                  onChange={(e) => {
                                    setTransferSourceSearchTerm(e.target.value);
                                    setTransferSourceHighlightedIndex(0);
                                  }}
                                  onFocus={() => {
                                    transferFocusIdRef.current += 1;
                                    setActiveTransferRow(index);
                                    setActiveFieldType('source');
                                    setTransferSourceSearchTerm(transferEntries[index]?.sourceLocationName || "");
                                    setTransferSourceHighlightedIndex(0);
                                    setShowSourceSidebar(true);
                                    setShowItemSidebar(false);
                                  }}
                                  onBlur={() => {
                                    const focusIdAtBlur = transferFocusIdRef.current;
                                    setTimeout(() => {
                                      if (transferFocusIdRef.current === focusIdAtBlur) {
                                        setActiveTransferRow(null);
                                        setActiveFieldType(null);
                                        setTransferSourceSearchTerm("");
                                        setShowSourceSidebar(false);
                                      }
                                    }, 250);
                                  }}
                                  onKeyDown={(e) => {
                                    const filteredLocs = locations
                                      .filter(loc => {
                                        if (!transferSourceSearchTerm.trim()) return true;
                                        const term = transferSourceSearchTerm.toLowerCase();
                                        return loc.name.toLowerCase().includes(term) || loc.code.toLowerCase().includes(term);
                                      })
                                      .sort((a, b) => a.name.localeCompare(b.name));
                                    
                                    if (e.key === "Enter" && filteredLocs.length > 0) {
                                      e.preventDefault();
                                      const selectedLoc = filteredLocs[transferSourceHighlightedIndex] || filteredLocs[0];
                                      stockTransferForm.setValue(`entries.${index}.sourceLocationId`, selectedLoc.id);
                                      stockTransferForm.setValue(`entries.${index}.sourceLocationName`, selectedLoc.name);
                                      setTransferInventorySource(selectedLoc.id);
                                      setTransferSourceSearchTerm("");
                                      setShowSourceSidebar(false);
                                      setTimeout(() => {
                                        const itemInput = document.querySelector(`[data-testid="input-item-name-${index}"]`) as HTMLInputElement;
                                        if (itemInput) { itemInput.focus(); itemInput.select(); }
                                      }, 50);
                                    } else if (e.key === "ArrowUp") {
                                      e.preventDefault();
                                      if (showSourceSidebar && filteredLocs.length > 0) {
                                        setTransferSourceHighlightedIndex(Math.max(0, transferSourceHighlightedIndex - 1));
                                      } else if (index > 0) {
                                        setTimeout(() => {
                                          const prevInput = document.querySelector(`[data-testid="input-source-${index - 1}"]`) as HTMLInputElement;
                                          if (prevInput) { prevInput.focus(); prevInput.select(); }
                                        }, 50);
                                      }
                                    } else if (e.key === "ArrowDown") {
                                      e.preventDefault();
                                      if (showSourceSidebar && filteredLocs.length > 0) {
                                        setTransferSourceHighlightedIndex(Math.min(filteredLocs.length - 1, transferSourceHighlightedIndex + 1));
                                      } else if (index < transferFields.length - 1) {
                                        setTimeout(() => {
                                          const nextInput = document.querySelector(`[data-testid="input-source-${index + 1}"]`) as HTMLInputElement;
                                          if (nextInput) { nextInput.focus(); nextInput.select(); }
                                        }, 50);
                                      }
                                    } else if (e.key === "ArrowRight" || (e.key === "Tab" && !e.shiftKey)) {
                                      e.preventDefault();
                                      setTimeout(() => {
                                        const itemInput = document.querySelector(`[data-testid="input-item-name-${index}"]`) as HTMLInputElement;
                                        if (itemInput) { itemInput.focus(); itemInput.select(); }
                                      }, 50);
                                    }
                                  }}
                                  placeholder="Type location..."
                                  className="w-full h-full px-3 bg-transparent outline-none focus:bg-accent/20"
                                  data-testid={`input-source-${index}`}
                                />
                              </div>
                            )}
                            <div className="flex-1 min-w-[200px] border-r h-10">
                              <input
                                type="text"
                                value={activeTransferRow === index && activeFieldType === 'item' ? transferSearchTerm : (transferEntries[index]?.stockItemName || "")}
                                onChange={(e) => {
                                  setTransferSearchTerm(e.target.value);
                                  setTransferHighlightedIndex(0);
                                  if (!e.target.value) {
                                    stockTransferForm.setValue(`entries.${index}.stockItemId`, 0);
                                    stockTransferForm.setValue(`entries.${index}.stockItemName`, "");
                                  }
                                }}
                                onFocus={() => {
                                  transferFocusIdRef.current += 1;
                                  setActiveTransferRow(index);
                                  setActiveFieldType('item');
                                  setTransferHighlightedIndex(0);
                                  setTransferSearchTerm(transferEntries[index]?.stockItemName || "");
                                  setShowItemSidebar(true);
                                  setShowSourceSidebar(false);
                                  if (transferEntries[index]?.sourceLocationId > 0) {
                                    setTransferInventorySource(transferEntries[index].sourceLocationId);
                                  } else if (isPOS && posLocationId) {
                                    setTransferInventorySource(posLocationId);
                                  } else {
                                    setTransferInventorySource(0);
                                  }
                                }}
                                onBlur={() => {
                                  const focusIdAtBlur = transferFocusIdRef.current;
                                  setTimeout(() => {
                                    if (transferFocusIdRef.current === focusIdAtBlur) {
                                      setActiveTransferRow(null);
                                      setActiveFieldType(null);
                                      setTransferSearchTerm("");
                                      setShowItemSidebar(false);
                                    }
                                  }, 200);
                                }}
                                onKeyDown={(e) => {
                                  const filteredInventory = transferInventory
                                    .filter((item: any) => {
                                      if (!transferSearchTerm.trim()) return true;
                                      const term = transferSearchTerm.toLowerCase();
                                      return (
                                        item.stockItemName?.toLowerCase().includes(term) ||
                                        item.stockItemCode?.toLowerCase().includes(term)
                                      );
                                    })
                                    .sort((a: any, b: any) => a.stockItemName.localeCompare(b.stockItemName));

                                  if (e.key === "ArrowUp" && !e.shiftKey) {
                                    e.preventDefault();
                                    if (showItemSidebar && filteredInventory.length > 0) {
                                      setTransferHighlightedIndex(Math.max(0, transferHighlightedIndex - 1));
                                    } else if (index > 0) {
                                      setTimeout(() => {
                                        const prevInput = document.querySelector(`[data-testid="input-item-name-${index - 1}"]`) as HTMLInputElement;
                                        if (prevInput) { prevInput.focus(); prevInput.select(); }
                                      }, 50);
                                    }
                                  } else if (e.key === "ArrowDown" && !e.shiftKey) {
                                    e.preventDefault();
                                    if (showItemSidebar && filteredInventory.length > 0) {
                                      setTransferHighlightedIndex(Math.min(filteredInventory.length - 1, transferHighlightedIndex + 1));
                                    } else if (index < transferFields.length - 1) {
                                      setTimeout(() => {
                                        const nextInput = document.querySelector(`[data-testid="input-item-name-${index + 1}"]`) as HTMLInputElement;
                                        if (nextInput) { nextInput.focus(); nextInput.select(); }
                                      }, 50);
                                    }
                                  } else if (e.key === "ArrowLeft" && !isPOS) {
                                    e.preventDefault();
                                    setShowItemSidebar(false);
                                    setTransferSearchTerm("");
                                    setTimeout(() => {
                                      const sourceInput = document.querySelector(`[data-testid="input-source-${index}"]`) as HTMLInputElement;
                                      if (sourceInput) { sourceInput.focus(); sourceInput.select(); }
                                    }, 50);
                                  } else if (e.key === "ArrowRight") {
                                    e.preventDefault();
                                    setTimeout(() => {
                                      const qtyInput = document.querySelector(`[data-testid="input-transfer-quantity-${index}"]`) as HTMLInputElement;
                                      if (qtyInput) { qtyInput.focus(); qtyInput.select(); }
                                    }, 50);
                                  } else if (e.key === "Tab" && !e.shiftKey) {
                                    e.preventDefault();
                                    setTimeout(() => {
                                      const qtyInput = document.querySelector(`[data-testid="input-transfer-quantity-${index}"]`) as HTMLInputElement;
                                      if (qtyInput) { qtyInput.focus(); qtyInput.select(); }
                                    }, 50);
                                  } else if (e.key === "Enter") {
                                    e.preventDefault();
                                    const filteredInventory = transferInventory
                                      .filter((item: any) => {
                                        if (!transferSearchTerm.trim()) return true;
                                        const term = transferSearchTerm.toLowerCase();
                                        return (
                                          item.stockItemName?.toLowerCase().includes(term) ||
                                          item.stockItemCode?.toLowerCase().includes(term)
                                        );
                                      })
                                      .sort((a: any, b: any) => a.stockItemName.localeCompare(b.stockItemName));
                                    
                                    if (filteredInventory.length > 0) {
                                      const item = filteredInventory[transferHighlightedIndex] || filteredInventory[0];
                                      const stockItem = stockItems.find(s => s.id === item.stockItemId);
                                      if (stockItem) {
                                        stockTransferForm.setValue(`entries.${index}.stockItemId`, item.stockItemId);
                                        stockTransferForm.setValue(`entries.${index}.stockItemName`, stockItem.name);
                                        stockTransferForm.setValue(`entries.${index}.rate`, item.averageRate || "0");
                                        setTransferSearchTerm("");
                                        
                                        setTimeout(() => {
                                          const quantityInput = document.querySelector(`[data-testid="input-transfer-quantity-${index}"]`) as HTMLInputElement;
                                          if (quantityInput) {
                                            quantityInput.focus();
                                            quantityInput.select();
                                          }
                                        }, 50);
                                      }
                                    }
                                  }
                                }}
                                placeholder="Type to search..."
                                className="w-full h-full px-3 bg-transparent outline-none focus:bg-accent/20"
                                data-testid={`input-item-name-${index}`}
                              />
                            </div>
                            <div className="w-24 border-r h-10">
                              <input
                                type="number"
                                step="0.001"
                                value={transferEntries[index]?.quantity || ""}
                                onChange={(e) => {
                                  stockTransferForm.setValue(`entries.${index}.quantity`, e.target.value);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    if (index > 0) {
                                      setTimeout(() => {
                                        const prevInput = document.querySelector(`[data-testid="input-transfer-quantity-${index - 1}"]`) as HTMLInputElement;
                                        if (prevInput) { prevInput.focus(); prevInput.select(); }
                                      }, 50);
                                    }
                                  } else if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    if (index < transferFields.length - 1) {
                                      setTimeout(() => {
                                        const nextInput = document.querySelector(`[data-testid="input-transfer-quantity-${index + 1}"]`) as HTMLInputElement;
                                        if (nextInput) { nextInput.focus(); nextInput.select(); }
                                      }, 50);
                                    }
                                  } else if (e.key === "ArrowLeft") {
                                    e.preventDefault();
                                    setTimeout(() => {
                                      const nameInput = document.querySelector(`[data-testid="input-item-name-${index}"]`) as HTMLInputElement;
                                      if (nameInput) { nameInput.focus(); nameInput.select(); }
                                    }, 50);
                                  } else if (e.key === "ArrowRight" && !isPOS) {
                                    e.preventDefault();
                                    setTimeout(() => {
                                      const rateInput = document.querySelector(`[data-testid="input-transfer-rate-${index}"]`) as HTMLInputElement;
                                      if (rateInput) { rateInput.focus(); rateInput.select(); }
                                    }, 50);
                                  } else if (e.key === "Tab" && !e.shiftKey) {
                                    e.preventDefault();
                                    if (!isPOS) {
                                      setTimeout(() => {
                                        const rateInput = document.querySelector(`[data-testid="input-transfer-rate-${index}"]`) as HTMLInputElement;
                                        if (rateInput) { rateInput.focus(); rateInput.select(); }
                                      }, 50);
                                    } else if (index < transferFields.length - 1) {
                                      setTimeout(() => {
                                        const nextNameInput = document.querySelector(`[data-testid="input-item-name-${index + 1}"]`) as HTMLInputElement;
                                        if (nextNameInput) { nextNameInput.focus(); nextNameInput.select(); }
                                      }, 50);
                                    }
                                  } else if (e.key === "Enter") {
                                    e.preventDefault();
                                    if (index === transferFields.length - 1) {
                                      appendTransfer({
                                        sourceLocationId: 0,
                                        sourceLocationName: "",
                                        stockItemId: 0,
                                        stockItemName: "",
                                        quantity: "",
                                        rate: "",
                                      });
                                      setTimeout(() => {
                                        const newInput = isPOS 
                                          ? document.querySelector(`[data-testid="input-item-name-${index + 1}"]`) as HTMLInputElement
                                          : document.querySelector(`[data-testid="input-source-${index + 1}"]`) as HTMLInputElement;
                                        if (newInput) newInput.focus();
                                      }, 100);
                                    }
                                  }
                                }}
                                placeholder="0"
                                className="w-full h-full px-3 bg-transparent outline-none focus:bg-accent/20 font-mono text-right"
                                data-testid={`input-transfer-quantity-${index}`}
                              />
                            </div>
                            {!isPOS && (
                              <>
                                <div className="w-24 border-r h-10">
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={transferEntries[index]?.rate || ""}
                                    onChange={(e) => {
                                      stockTransferForm.setValue(`entries.${index}.rate`, e.target.value);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "ArrowUp") {
                                        e.preventDefault();
                                        if (index > 0) {
                                          setTimeout(() => {
                                            const prevInput = document.querySelector(`[data-testid="input-transfer-rate-${index - 1}"]`) as HTMLInputElement;
                                            if (prevInput) { prevInput.focus(); prevInput.select(); }
                                          }, 50);
                                        }
                                      } else if (e.key === "ArrowDown") {
                                        e.preventDefault();
                                        if (index < transferFields.length - 1) {
                                          setTimeout(() => {
                                            const nextInput = document.querySelector(`[data-testid="input-transfer-rate-${index + 1}"]`) as HTMLInputElement;
                                            if (nextInput) { nextInput.focus(); nextInput.select(); }
                                          }, 50);
                                        }
                                      } else if (e.key === "ArrowLeft") {
                                        e.preventDefault();
                                        setTimeout(() => {
                                          const qtyInput = document.querySelector(`[data-testid="input-transfer-quantity-${index}"]`) as HTMLInputElement;
                                          if (qtyInput) { qtyInput.focus(); qtyInput.select(); }
                                        }, 50);
                                      } else if (e.key === "Tab" && !e.shiftKey) {
                                        e.preventDefault();
                                        if (index < transferFields.length - 1) {
                                          setTimeout(() => {
                                            const nextNameInput = document.querySelector(`[data-testid="input-item-name-${index + 1}"]`) as HTMLInputElement;
                                            if (nextNameInput) { nextNameInput.focus(); nextNameInput.select(); }
                                          }, 50);
                                        }
                                      } else if (e.key === "Enter") {
                                        e.preventDefault();
                                        if (index === transferFields.length - 1) {
                                          appendTransfer({
                                            sourceLocationId: 0,
                                            sourceLocationName: "",
                                            stockItemId: 0,
                                            stockItemName: "",
                                            quantity: "",
                                            rate: "",
                                          });
                                          setTimeout(() => {
                                            const newInput = document.querySelector(`[data-testid="input-source-${index + 1}"]`) as HTMLInputElement;
                                            if (newInput) newInput.focus();
                                          }, 100);
                                        }
                                      }
                                    }}
                                    placeholder="0"
                                    className="w-full h-full px-3 bg-transparent outline-none focus:bg-accent/20 font-mono text-right"
                                    data-testid={`input-transfer-rate-${index}`}
                                  />
                                </div>
                                <div className="w-28 border-r h-10 bg-muted/30 flex items-center justify-end px-3 font-mono">
                                  {(parseFloat(transferEntries[index]?.quantity || "0") * parseFloat(transferEntries[index]?.rate || "0")).toFixed(2)}
                                </div>
                              </>
                            )}
                            <div className="w-12 flex items-center justify-center h-10">
                              {transferFields.length > 1 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removeTransfer(index)}
                                  className="h-8 w-8"
                                  data-testid={`button-remove-transfer-${index}`}
                                >
                                  <X className="h-4 w-4 text-destructive" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Total Section */}
                  <div className="border-t bg-muted/20 p-4">
                    <div className="flex justify-end items-center gap-8 max-w-lg ml-auto">
                      <div className="text-xs text-muted-foreground">Total Items:</div>
                      <div className="text-xs font-mono font-medium">
                        {transferEntries.filter(e => e.stockItemId > 0).length}
                      </div>
                      <div className="text-xs text-muted-foreground">Total Qty:</div>
                      <div className="text-xs font-mono font-medium">
                        {Math.floor(transferEntries.reduce((sum, e) => sum + parseFloat(e.quantity || "0"), 0))}
                      </div>
                      {!isPOS && (
                        <>
                          <div className="text-xs font-semibold">Grand Total:</div>
                          <div className="text-sm font-bold font-mono" data-testid="text-transfer-total">
                            ${transferTotal.toFixed(2)}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </Card>

                {/* Right Panel - Item Search */}
                {showItemSidebar && (
                <Card className="w-80 flex flex-col sticky top-4 max-h-[calc(100vh-12rem)] self-start">
                  <div className="p-4 border-b">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold">Search Items</h3>
                      <button onClick={() => setShowItemSidebar(false)} className="text-xs text-muted-foreground hover:text-foreground" data-testid="button-close-item-sidebar">✕</button>
                    </div>
                    {transferInventorySource && (
                      <p className="text-xs text-muted-foreground mb-3">
                        {locations.find(l => l.id === transferInventorySource)?.name}
                      </p>
                    )}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by name or code..."
                        value={transferSearchTerm}
                        onChange={(e) => {
                          setTransferSearchTerm(e.target.value);
                          setTransferHighlightedIndex(0);
                        }}
                        className="pl-9"
                        data-testid="input-transfer-sidebar-search"
                      />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2" ref={transferSidebarRef}>
                    <div className="space-y-1">
                      {!transferInventorySource ? (
                        <div className="text-center py-8 text-sm text-muted-foreground">
                          Select a source location to see available items
                        </div>
                      ) : (() => {
                        const filteredInventory = transferInventory
                          .filter((item: any) => {
                            if (!transferSearchTerm.trim()) return true;
                            const term = transferSearchTerm.toLowerCase();
                            return (
                              item.stockItemName?.toLowerCase().includes(term) ||
                              item.stockItemCode?.toLowerCase().includes(term)
                            );
                          })
                          .sort((a: any, b: any) => a.stockItemName.localeCompare(b.stockItemName));
                        
                        if (filteredInventory.length === 0) {
                          return (
                            <div className="text-center py-8 text-sm text-muted-foreground">
                              No items found
                            </div>
                          );
                        }
                        
                        return filteredInventory.map((item: any, idx: number) => {
                          const stock = parseFloat(item.quantity || "0");
                          const isHighlighted = idx === transferHighlightedIndex && activeTransferRow !== null;
                          
                          return (
                            <button
                              key={item.stockItemId}
                              type="button"
                              className={`w-full text-left px-3 py-3 rounded-md hover-elevate active-elevate-2 ${
                                stock === 0 ? "opacity-60" : ""
                              } ${isHighlighted ? "bg-accent" : ""}`}
                              data-testid={`button-suggest-item-${item.stockItemId}`}
                              onClick={() => {
                                if (activeTransferRow !== null) {
                                  const stockItem = stockItems.find(s => s.id === item.stockItemId);
                                  if (stockItem) {
                                    stockTransferForm.setValue(`entries.${activeTransferRow}.stockItemId`, item.stockItemId);
                                    stockTransferForm.setValue(`entries.${activeTransferRow}.stockItemName`, stockItem.name);
                                    stockTransferForm.setValue(`entries.${activeTransferRow}.rate`, item.averageRate || "0");
                                    setTransferSearchTerm("");
                                    
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
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium mb-1 truncate">{item.stockItemName}</div>
                                  <div className="text-xs text-muted-foreground font-mono">
                                    {item.stockItemCode}
                                  </div>
                                </div>
                                <div className="flex items-center">
                                  <div className={`text-xs font-medium px-2 py-0.5 rounded ${
                                    stock === 0 
                                      ? "bg-destructive/10 text-destructive" 
                                      : stock < 10
                                      ? "bg-chart-3/10 text-chart-3"
                                      : "bg-chart-2/10 text-chart-2"
                                  }`}>
                                    {stock === 0 ? "Out" : `${stock.toFixed(0)}`}
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        });
                      })()}
                    </div>
                  </div>
                </Card>
                )}

                {/* Right Panel - Source Location Search */}
                {!isPOS && showSourceSidebar && (
                  <Card className="w-80 flex flex-col sticky top-4 max-h-[calc(100vh-12rem)] self-start">
                    <div className="p-4 border-b">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold">Select Source</h3>
                        <button onClick={() => setShowSourceSidebar(false)} className="text-xs text-muted-foreground hover:text-foreground" data-testid="button-close-source-sidebar">✕</button>
                      </div>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search locations..."
                          value={transferSourceSearchTerm}
                          onChange={(e) => {
                            setTransferSourceSearchTerm(e.target.value);
                            setTransferSourceHighlightedIndex(0);
                          }}
                          className="pl-9"
                          data-testid="input-transfer-source-search"
                        />
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2">
                      <div className="space-y-1">
                        {(() => {
                          const filteredLocations = locations
                            .filter(loc => {
                              if (!transferSourceSearchTerm.trim()) return true;
                              const term = transferSourceSearchTerm.toLowerCase();
                              return loc.name.toLowerCase().includes(term) || loc.code.toLowerCase().includes(term);
                            })
                            .sort((a, b) => a.name.localeCompare(b.name));
                          
                          if (filteredLocations.length === 0) {
                            return (
                              <div className="text-center py-8 text-sm text-muted-foreground">
                                No locations found
                              </div>
                            );
                          }
                          
                          return filteredLocations.map((loc, idx) => {
                            const isHighlighted = idx === transferSourceHighlightedIndex && activeTransferRow !== null;
                            
                            return (
                              <button
                                key={loc.id}
                                type="button"
                                className={`w-full text-left px-3 py-3 rounded-md hover-elevate active-elevate-2 ${
                                  isHighlighted ? "bg-accent" : ""
                                }`}
                                data-testid={`button-select-source-location-${loc.id}`}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  transferFocusIdRef.current += 1;
                                }}
                                onClick={() => {
                                  if (activeTransferRow !== null) {
                                    const rowIndex = activeTransferRow;
                                    stockTransferForm.setValue(`entries.${rowIndex}.sourceLocationId`, loc.id);
                                    stockTransferForm.setValue(`entries.${rowIndex}.sourceLocationName`, loc.name);
                                    setTransferInventorySource(loc.id);
                                    setTransferSourceSearchTerm("");
                                    setShowSourceSidebar(false);
                                    setActiveTransferRow(null);
                                    setActiveFieldType(null);
                                    
                                    setTimeout(() => {
                                      const itemInput = document.querySelector(`[data-testid="input-item-name-${rowIndex}"]`) as HTMLInputElement;
                                      if (itemInput) {
                                        itemInput.focus();
                                        itemInput.select();
                                      }
                                    }, 50);
                                  }
                                }}
                              >
                                <div className="text-sm font-medium">{loc.name}</div>
                                <div className="text-xs text-muted-foreground font-mono">{loc.code}</div>
                              </button>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  </Card>
                )}
              </div>

              {/* Notes and Options */}
              <div className="mt-4 flex items-start gap-4">
                <FormField
                  control={stockTransferForm.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="Notes (optional)"
                          className="resize-none h-9"
                          data-testid="input-transfer-notes"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={stockTransferForm.control}
                  name="optional"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-transfer-optional"
                        />
                      </FormControl>
                      <FormLabel className="text-sm">Optional</FormLabel>
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  disabled={stockTransferMutation.isPending || transferEntries.filter(e => e.stockItemId > 0).length === 0}
                  data-testid="button-save-transfer-voucher"
                >
                  {stockTransferMutation.isPending ? "Saving..." : "Save Transfer"}
                </Button>
              </div>
            </form>
          </Form>
        </TabsContent>

        {!isPOS && (
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
                              {[...locations].sort((a, b) => a.name.localeCompare(b.name)).map((location) => (
                                <SelectItem key={location.id} value={location.id.toString()}>
                                  {location.name}
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
                                  {field.value ? formatDisplayDate(field.value) : "Pick a date"}
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

                  {/* UNIFIED PRODUCTION/CONSUMPTION TABLE */}
                  <div className="border rounded-md overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-3 font-medium w-[120px]">Type</th>
                          <th className="text-left p-3 font-medium">Stock Item</th>
                          <th className="text-left p-3 font-medium w-[100px]">Quantity</th>
                          <th className="text-left p-3 font-medium w-[100px]">Rate</th>
                          <th className="text-left p-3 font-medium w-[120px]">Total</th>
                          <th className="w-[50px]"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {adjustmentFields.map((field, index) => (
                          <tr key={field.id} className="border-t">
                            <td className="p-2">
                              <FormField
                                control={stockAdjustmentForm.control}
                                name={`entries.${index}.type`}
                                render={({ field }) => (
                                  <FormItem>
                                    <Select
                                      value={field.value}
                                      onValueChange={field.onChange}
                                    >
                                      <FormControl>
                                        <SelectTrigger 
                                          data-testid={`select-adjustment-type-${index}`}
                                          onKeyDown={(e) => handleAdjustmentKeyDown(e, index, "type")}
                                        >
                                          <SelectValue placeholder="Select..." />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        <SelectItem value="CONSUME">Consume</SelectItem>
                                        <SelectItem value="PRODUCE">Produce</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </td>
                            <td className="p-2">
                              <FormField
                                control={stockAdjustmentForm.control}
                                name={`entries.${index}.stockItemId`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormControl>
                                      <StockItemCombobox
                                        value={
                                          adjustmentEntries[index]?.stockItemId > 0
                                            ? {
                                                id: adjustmentEntries[index].stockItemId,
                                                name: adjustmentEntries[index].stockItemName,
                                              }
                                            : null
                                        }
                                        onChange={(id, name) => {
                                          stockAdjustmentForm.setValue(`entries.${index}.stockItemId`, id);
                                          stockAdjustmentForm.setValue(`entries.${index}.stockItemName`, name);
                                          
                                          // Auto-fill rate from location inventory
                                          const inventoryItem = locationInventory.find((inv: any) => inv.stockItemId === id);
                                          if (inventoryItem && inventoryItem.averageRate !== undefined && inventoryItem.averageRate !== null) {
                                            stockAdjustmentForm.setValue(`entries.${index}.rate`, inventoryItem.averageRate);
                                          }
                                        }}
                                        stockItems={stockItems}
                                        rowIndex={index}
                                        testIdPrefix="button-adjustment-stock"
                                        onKeyDown={(e) => handleAdjustmentKeyDown(e, index, "stockItem")}
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
                                        data-testid={`input-adjustment-quantity-${index}`}
                                        onKeyDown={(e) => handleAdjustmentKeyDown(e, index, "quantity")}
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
                                        data-testid={`input-adjustment-rate-${index}`}
                                        onKeyDown={(e) => handleAdjustmentKeyDown(e, index, "rate")}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </td>
                            <td className="p-2">
                              <div className="text-right font-mono">
                                ${(parseFloat(adjustmentEntries[index]?.quantity || "0") * parseFloat(adjustmentEntries[index]?.rate || "0")).toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </div>
                            </td>
                            <td className="p-2">
                              {adjustmentFields.length > 1 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeAdjustment(index)}
                                  data-testid={`button-remove-adjustment-${index}`}
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
                                appendAdjustment({
                                  type: "CONSUME",
                                  stockItemId: 0,
                                  stockItemName: "",
                                  quantity: "",
                                  rate: "",
                                })
                              }
                              data-testid="button-add-adjustment-row"
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Add Row
                            </Button>
                          </td>
                          <td className="p-3">
                            <div className="text-right font-bold font-mono">
                              ${(consumptionTotal + productionTotal).toLocaleString(undefined, {
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

                  {/* Optional checkbox */}
                  <FormField
                    control={stockAdjustmentForm.control}
                    name="optional"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="checkbox-adjustment-optional"
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
                      disabled={stockAdjustmentMutation.isPending || adjustmentEntries.length === 0}
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
        )}

      </Tabs>

      {/* Voucher Edit Dialog */}
      <VoucherEditDialog
        voucherId={editVoucherId}
        open={editDialogOpen}
        onOpenChange={(open) => {
          setEditDialogOpen(open);
          if (!open) {
            setEditVoucherId(null);
          }
        }}
      />

      {/* Stock Transfer Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Import Stock Transfer from Excel
            </DialogTitle>
            <DialogDescription>
              Upload an Excel file with columns: Source Location, Barcode, Quantity. Each row can have a different source location.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <Label htmlFor="import-file">Excel File</Label>
                <Input
                  id="import-file"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleImportFileChange}
                  className="mt-1"
                  data-testid="input-import-file"
                />
                {importFile && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Selected: {importFile.name}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={downloadImportTemplate}
                className="mt-6"
                data-testid="button-download-import-template"
              >
                <Download className="h-4 w-4 mr-2" />
                Template
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="import-dest-location">Destination Location</Label>
                <Select value={importDestLocation} onValueChange={setImportDestLocation}>
                  <SelectTrigger id="import-dest-location" className="mt-1" data-testid="select-import-dest-location">
                    <SelectValue placeholder="Select destination..." />
                  </SelectTrigger>
                  <SelectContent>
                    {[...locations].sort((a, b) => a.name.localeCompare(b.name)).map((location) => (
                      <SelectItem key={location.id} value={location.id.toString()}>
                        {location.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="import-date">Transfer Date</Label>
                <Input
                  id="import-date"
                  type="date"
                  value={importDate}
                  onChange={(e) => setImportDate(e.target.value)}
                  className="mt-1"
                  data-testid="input-import-date"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="import-notes">Notes (Optional)</Label>
              <Textarea
                id="import-notes"
                value={importNotes}
                onChange={(e) => setImportNotes(e.target.value)}
                placeholder="Optional notes for this transfer..."
                rows={2}
                className="mt-1"
                data-testid="input-import-notes"
              />
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button
                onClick={handleImportParse}
                disabled={!importFile || importParseMutation.isPending}
                variant="outline"
                data-testid="button-import-parse"
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                {importParseMutation.isPending ? "Parsing..." : "Parse File"}
              </Button>

              <Button
                onClick={handleImportValidate}
                disabled={!importPreview || !importDestLocation || importValidateMutation.isPending}
                variant="outline"
                data-testid="button-import-validate"
              >
                {importIsValidated ? (
                  importHasErrors ? (
                    <XCircle className="h-4 w-4 mr-2 text-destructive" />
                  ) : (
                    <CheckCircle className="h-4 w-4 mr-2 text-green-600" />
                  )
                ) : null}
                {importValidateMutation.isPending ? "Validating..." : "Validate"}
              </Button>

              <Button
                onClick={handleImportSubmit}
                disabled={!importIsValidated || importMutation.isPending}
                data-testid="button-import-submit"
              >
                <Upload className="h-4 w-4 mr-2" />
                {importMutation.isPending ? "Importing..." : importHasErrors ? `Import Transfer (${importValidItemsCount} valid)` : "Import Transfer"}
              </Button>
            </div>

            {importValidationResult?.errors && importValidationResult.errors.length > 0 && (
              <div className="p-3 border border-destructive rounded-md bg-destructive/10">
                <p className="font-medium text-destructive mb-2">Validation Errors:</p>
                <ul className="list-disc list-inside space-y-1">
                  {importValidationResult.errors.map((error: string, index: number) => (
                    <li key={index} className="text-sm text-destructive">
                      {error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {importPreview && (
              <div className="border rounded-md">
                <div className="p-3 border-b bg-muted/50">
                  <p className="font-medium">Preview ({importPreview.items.length} items)</p>
                </div>
                <div className="max-h-60 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source Location</TableHead>
                        <TableHead>Barcode</TableHead>
                        <TableHead>Item Name</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Available</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importPreview.items.map((item: any, index: number) => {
                        const validation = importValidationResult?.validatedItems?.[index];
                        const hasError = validation?.error;

                        return (
                          <TableRow key={index} className={hasError ? "bg-destructive/10" : ""} data-testid={`import-preview-row-${index}`}>
                            <TableCell>{item.sourceLocation || "-"}</TableCell>
                            <TableCell className="font-mono">{item.barcode}</TableCell>
                            <TableCell>
                              {validation?.stockItemName || (
                                <span className="text-muted-foreground italic">Unknown</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">{item.quantity}</TableCell>
                            <TableCell className="text-right">
                              {validation?.currentStock !== undefined ? validation.currentStock.toFixed(2) : "-"}
                            </TableCell>
                            <TableCell>
                              {validation ? (
                                hasError ? (
                                  <div className="flex items-center gap-1 text-destructive">
                                    <XCircle className="h-4 w-4" />
                                    <span className="text-sm">{validation.error}</span>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1 text-green-600">
                                    <CheckCircle className="h-4 w-4" />
                                    <span className="text-sm">OK</span>
                                  </div>
                                )
                              ) : (
                                <span className="text-sm text-muted-foreground">Not validated</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Confirmation Dialog */}
      <AlertDialog open={importConfirmDialogOpen} onOpenChange={setImportConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import with Validation Errors?</AlertDialogTitle>
            <AlertDialogDescription>
              {importValidItemsCount === 0 ? (
                <>All {importTotalItemsCount} items have validation errors. Nothing will be imported.</>
              ) : (
                <>
                  {importTotalItemsCount - importValidItemsCount} of {importTotalItemsCount} items have validation errors and will be skipped.
                  <br /><br />
                  <strong>{importValidItemsCount} valid item(s)</strong> will be transferred.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-import-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmedImport}
              data-testid="button-import-confirm"
            >
              {importValidItemsCount === 0 ? "OK" : `Import ${importValidItemsCount} Item(s)`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
