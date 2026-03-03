import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Book,
  Filter,
  X,
  Eye,
  Edit,
  Trash2,
  Plus,
  ChevronDown,
  Check,
  ChevronsUpDown,
  FileDown,
  Package,
  ExternalLink,
} from "lucide-react";
import { format, parseISO, isToday, addDays } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/formatNumber";
import { utils, writeFile } from "@/lib/excelHelper";
import { PeriodFilter, PeriodFilterValue, getDefaultPeriodValue } from "@/components/ui/period-filter";

// Account types
interface LedgerAccount {
  id: number;
  code: string;
  name: string;
  accountType: string;
}

interface BankAccount {
  id: number;
  code: string;
  name: string;
  accountNumber: string;
  bankName: string;
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
}

interface FixedAsset {
  id: number;
  assetCode: string;
  assetName: string;
}

// Zod schema for new entry rows
const newEntryRowSchema = z.object({
  accountType: z.enum(["ledger", "bank", "supplier", "employee", "fixedAsset"]),
  accountId: z.number().min(1, "Please select an account"),
  accountName: z.string(),
  debitAmount: z
    .string()
    .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, {
      message: "Must be a valid number",
    }),
  creditAmount: z
    .string()
    .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, {
      message: "Must be a valid number",
    }),
  narration: z.string().optional(),
});

// Zod schema for creating vouchers with entries
const createVoucherSchema = z
  .object({
    voucherType: z.enum(
      [
        "Journal",
        "Payment",
        "Receipt",
        "Stock Transfer",
        "Sales",
        "Purchase",
        "Contra",
      ],
      {
        required_error: "Voucher type is required",
      },
    ),
    voucherDate: z.string().min(1, "Voucher date is required"),
    description: z.string().optional(),
    optional: z.boolean().default(false),
    entries: z.array(newEntryRowSchema).min(2, "At least 2 entries required"),
  })
  .refine(
    (data) => {
      // Calculate total debits and credits
      const totalDebits = data.entries.reduce(
        (sum, entry) => sum + parseFloat(entry.debitAmount || "0"),
        0,
      );
      const totalCredits = data.entries.reduce(
        (sum, entry) => sum + parseFloat(entry.creditAmount || "0"),
        0,
      );
      return Math.abs(totalDebits - totalCredits) < 0.01; // Allow for floating point precision
    },
    {
      message: "Total debits must equal total credits",
      path: ["entries"],
    },
  );

type CreateVoucherForm = z.infer<typeof createVoucherSchema>;
type EditVoucherForm = CreateVoucherForm;

interface Voucher {
  id: number;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  description: string | null;
  totalAmount: string;
  optional: boolean;
  createdAt: string;
  locationName?: string;
}

interface OffloadListItem {
  id: number;
  containerId: number;
  containerNumber: string;
  locationId: number;
  locationName: string | null;
  duties: string;
  officeCharges: string;
  transferCharges: string;
  transportFees: string;
  totalCharges: string;
  totalBales: string;
  additionalCostPerBale: string;
  offloadedAt: string;
  itemsTotal: string;
}

interface OffloadDetail extends OffloadListItem {
  items: Array<{
    id: number;
    stockItemId: number;
    stockItemName: string | null;
    stockItemCode: string | null;
    quantity: string;
    rate: string;
    totalValue: string;
  }>;
}

type DaybookRow =
  | { _type: "voucher"; data: Voucher }
  | { _type: "offload"; data: OffloadListItem };

interface VoucherEntry {
  id: number;
  voucherId: number;
  accountType: string;
  accountId: number;
  accountCode: string;
  accountName: string;
  debitAmount: string;
  creditAmount: string;
  narration: string | null;
}

interface ViewVoucherEntry {
  id: number;
  accountName: string;
  debitAmount: string;
  creditAmount: string;
  narration: string | null;
  isStockItem?: boolean;
  stockItemId?: number;
  stockItemCode?: string;
  stockItemName?: string;
  ledgerAccountId?: number;
  bankAccountId?: number;
  employeeId?: number;
  isPurchaseItem?: boolean;
  quantity?: string;
  rate?: string;
  totalAmount?: string;
  sellingPrice?: string;
  totalSales?: string;
  adjustmentType?: string;
}

// Account Combobox Component
function AccountCombobox({
  value,
  onChange,
  ledgerAccounts,
  bankAccounts,
  suppliers,
  employees,
  fixedAssets,
  rowIndex,
  testIdPrefix = "button-account",
}: {
  value: { type: string; id: number; name: string } | null;
  onChange: (
    type: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset",
    id: number,
    name: string,
  ) => void;
  ledgerAccounts: LedgerAccount[];
  bankAccounts: BankAccount[];
  suppliers: Supplier[];
  employees: Employee[];
  fixedAssets: FixedAsset[];
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
    ...employees.map((e) => ({
      type: "employee" as const,
      id: e.id,
      name: `${e.firstName} ${e.lastName}`,
    })),
    ...fixedAssets.map((f) => ({
      type: "fixedAsset" as const,
      id: f.id,
      name: f.assetName,
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
      <PopoverContent className="w-[min(400px,calc(100vw-2rem))] p-0 bg-popover text-popover-foreground">
        <Command className="bg-popover text-popover-foreground">
          <CommandInput
            placeholder="Search accounts..."
            className="bg-popover text-popover-foreground"
          />
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
                        : "opacity-0",
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

export default function Daybook({ user }: { user?: any } = {}) {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const { formatDisplayDate } = useDateFormat();
  const { formatAmount } = useCurrencyContext();
  const [, navigate] = useLocation();
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>(getDefaultPeriodValue("today"));
  const [filters, setFilters] = useState({
    voucherType: "all",
    searchQuery: "",
    sortOrder: "desc" as "asc" | "desc",
  });
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedVoucher, setSelectedVoucher] = useState<Voucher | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [voucherToEdit, setVoucherToEdit] = useState<Voucher | null>(null);
  const [editFormInitialized, setEditFormInitialized] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [voucherToDelete, setVoucherToDelete] = useState<Voucher | null>(null);
  const [offloadViewOpen, setOffloadViewOpen] = useState(false);
  const [selectedOffload, setSelectedOffload] = useState<OffloadListItem | null>(null);

  // Fetch ledger accounts, bank accounts, and suppliers for dropdowns
  const { data: ledgerAccounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger-accounts", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({
    queryKey: ["/api/bank-accounts", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  const { data: fixedAssets = [] } = useQuery<FixedAsset[]>({
    queryKey: ["/api/fixed-assets", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  // State for purchase order data (for Purchase vouchers)
  const [purchaseOrderData, setPurchaseOrderData] = useState<any>(null);

  // Fetch voucher entries when viewing (includes account names and stock items)
  const { data: viewVoucherEntriesRaw, isLoading: viewEntriesLoading } =
    useQuery<any>({
      queryKey: selectedVoucher
        ? [`/api/vouchers/${selectedVoucher.id}/view-entries`]
        : [],
      enabled: !!selectedVoucher && viewDialogOpen,
    });

  // Handle the response which can be either array (most types) or object with entries/purchaseOrder (Purchase type)
  const viewVoucherEntries: ViewVoucherEntry[] = useMemo(() => {
    if (!viewVoucherEntriesRaw) return [];
    if (Array.isArray(viewVoucherEntriesRaw)) {
      return viewVoucherEntriesRaw;
    }
    if (viewVoucherEntriesRaw.entries) {
      return viewVoucherEntriesRaw.entries;
    }
    return [];
  }, [viewVoucherEntriesRaw]);

  // Update purchaseOrderData when response changes (avoid setState in useMemo)
  useEffect(() => {
    if (!viewVoucherEntriesRaw) {
      setPurchaseOrderData(null);
    } else if (
      !Array.isArray(viewVoucherEntriesRaw) &&
      viewVoucherEntriesRaw.purchaseOrder
    ) {
      setPurchaseOrderData(viewVoucherEntriesRaw.purchaseOrder);
    } else {
      setPurchaseOrderData(null);
    }
  }, [viewVoucherEntriesRaw]);

  // Extract cash account ID for fetching balance (works for Sales, POS, Payment, Receipt, and Journal)
  // Note: viewVoucherEntries has ledgerAccountId, bankAccountId, etc. NOT accountId
  const cashAccountId = useMemo(() => {
    if (!selectedVoucher) return null;

    // For Sales and POS vouchers, find the cash entry (debit > 0)
    if (
      selectedVoucher.voucherType === "Sales" ||
      selectedVoucher.voucherType === "POS"
    ) {
      const ledgerEntries = viewVoucherEntries.filter(
        (e: ViewVoucherEntry) => !e.isStockItem && !e.stockItemId,
      );
      const cashEntry = ledgerEntries.find(
        (e: ViewVoucherEntry) => parseFloat(e.debitAmount || "0") > 0,
      );
      // Use ledgerAccountId or bankAccountId (the actual field names from storage)
      return cashEntry?.ledgerAccountId || cashEntry?.bankAccountId || null;
    }

    // For Payment vouchers, find the source account (credit > 0 - money going out)
    if (selectedVoucher.voucherType === "Payment") {
      const sourceEntry = viewVoucherEntries.find(
        (e: ViewVoucherEntry) => parseFloat(e.creditAmount || "0") > 0,
      );
      return sourceEntry?.ledgerAccountId || sourceEntry?.bankAccountId || null;
    }

    // For Receipt vouchers, find the source account (debit > 0 - money going in)
    if (selectedVoucher.voucherType === "Receipt") {
      const sourceEntry = viewVoucherEntries.find(
        (e: ViewVoucherEntry) => parseFloat(e.debitAmount || "0") > 0,
      );
      return sourceEntry?.ledgerAccountId || sourceEntry?.bankAccountId || null;
    }

    // For Journal vouchers, find the first account (any debit or credit)
    if (selectedVoucher.voucherType === "Journal") {
      const firstEntry = viewVoucherEntries.find(
        (e: ViewVoucherEntry) => !e.isStockItem && !e.stockItemId,
      );
      return firstEntry?.ledgerAccountId || firstEntry?.bankAccountId || null;
    }

    return null;
  }, [selectedVoucher, viewVoucherEntries]);

  // State to store cash account balance
  const [cashAccountBalance, setCashAccountBalance] = useState<string>("0");

  // State to store per-entry balances for the entries table
  const [entryBalances, setEntryBalances] = useState<Record<number, string>>({});

  // Fetch balance when cash account ID is available and dialog is open
  useEffect(() => {
    const fetchBalance = async () => {
      if (!cashAccountId || !viewDialogOpen) {
        return;
      }
      try {
        const res = await fetch(
          `/api/accounts/ledger/${cashAccountId}/balance`,
          { credentials: "include" },
        );
        if (res.ok) {
          const data = await res.json();
          setCashAccountBalance(data.balance?.toString() || "0");
        }
      } catch (error) {
        console.error("Error fetching balance:", error);
      }
    };
    fetchBalance();
  }, [cashAccountId, viewDialogOpen]);

  // Fetch balances for all displayed entries in Payment/Receipt/Journal vouchers
  // Keyed by entry.id to avoid collisions between ledger/bank/employee numeric IDs
  useEffect(() => {
    if (!viewDialogOpen || !selectedVoucher) {
      setEntryBalances({});
      return;
    }
    const type = selectedVoucher.voucherType;
    if (type !== "Payment" && type !== "Receipt" && type !== "Journal") {
      setEntryBalances({});
      return;
    }

    const displayEntries = viewVoucherEntries.filter((entry: ViewVoucherEntry) => {
      if (type === "Payment") return parseFloat(entry.debitAmount || "0") > 0;
      if (type === "Receipt") return parseFloat(entry.creditAmount || "0") > 0;
      return true;
    });

    const fetchAll = async () => {
      const results: Record<number, string> = {};
      await Promise.all(
        displayEntries.map(async (entry: ViewVoucherEntry) => {
          try {
            let url: string | null = null;
            if (entry.ledgerAccountId) {
              url = `/api/accounts/ledger/${entry.ledgerAccountId}/balance`;
            } else if (entry.bankAccountId) {
              url = `/api/accounts/ledger/${entry.bankAccountId}/balance`;
            } else if (entry.employeeId) {
              url = `/api/employees/${entry.employeeId}/balance`;
            } else if (entry.supplierId) {
              url = `/api/suppliers/${entry.supplierId}/balance`;
            }
            if (!url) return;
            const res = await fetch(url, { credentials: "include" });
            if (res.ok) {
              const data = await res.json();
              results[entry.id] = data.balance?.toString() || "0";
            }
          } catch {
            // ignore individual failures
          }
        })
      );
      setEntryBalances(results);
    };
    fetchAll();
  }, [viewDialogOpen, selectedVoucher, viewVoucherEntries]);

  // Fetch voucher entries when editing
  const { data: voucherEntries = [], isLoading: entriesLoading } = useQuery<
    VoucherEntry[]
  >({
    queryKey: voucherToEdit
      ? [`/api/vouchers/${voucherToEdit.id}/entries`]
      : [],
    enabled: !!voucherToEdit && editDialogOpen,
  });

  // Edit form with react-hook-form and zod
  const editForm = useForm<EditVoucherForm>({
    resolver: zodResolver(createVoucherSchema),
    defaultValues: {
      voucherType: "Journal",
      voucherDate: format(new Date(), "yyyy-MM-dd"),
      description: "",
      optional: false,
      entries: [],
    },
  });

  const {
    fields: editFields,
    append: editAppend,
    remove: editRemove,
  } = useFieldArray({
    control: editForm.control,
    name: "entries",
  });

  // Populate form with entries when they're loaded (only once per voucher)
  useEffect(() => {
    if (
      voucherToEdit &&
      voucherEntries.length > 0 &&
      !entriesLoading &&
      !editFormInitialized
    ) {
      editForm.reset({
        voucherType: voucherToEdit.voucherType as any,
        voucherDate: voucherToEdit.voucherDate,
        description: voucherToEdit.description || "",
        optional: voucherToEdit.optional,
        entries: voucherEntries.map((entry) => ({
          accountType: entry.accountType as
            | "ledger"
            | "bank"
            | "supplier"
            | "employee"
            | "fixedAsset",
          accountId: entry.accountId,
          accountName: entry.accountName,
          debitAmount: entry.debitAmount || "0",
          creditAmount: entry.creditAmount || "0",
          narration: entry.narration || "",
        })),
      });
      setEditFormInitialized(true);
    }
  }, [
    voucherToEdit,
    voucherEntries,
    entriesLoading,
    editFormInitialized,
    editForm,
  ]);

  // State to cache first account names for Payment/Receipt/Journal vouchers
  const [accountNameCache, setAccountNameCache] = useState<
    Record<number, string>
  >({});

  // Fetch all vouchers with date filtering
  const { data: vouchers = [], isLoading } = useQuery<Voucher[]>({
    queryKey: ["/api/vouchers", selectedCompany?.id, periodFilter.fromDate, periodFilter.toDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (periodFilter.fromDate) params.append("startDate", periodFilter.fromDate);
      if (periodFilter.toDate) params.append("endDate", periodFilter.toDate);
      const url = `/api/vouchers${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch vouchers");
      return res.json();
    },
    enabled: !!selectedCompany,
  });

  // Fetch offloads for the same date range
  const { data: offloads = [], isLoading: offloadsLoading } = useQuery<OffloadListItem[]>({
    queryKey: ["/api/offloads", selectedCompany?.id, periodFilter.fromDate, periodFilter.toDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (periodFilter.fromDate) params.append("startDate", periodFilter.fromDate);
      if (periodFilter.toDate) params.append("endDate", periodFilter.toDate);
      const url = `/api/offloads${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch offloads");
      return res.json();
    },
    enabled: !!selectedCompany,
  });

  // Fetch full offload detail when viewing
  const { data: offloadDetail, isLoading: offloadDetailLoading } = useQuery<OffloadDetail>({
    queryKey: selectedOffload ? [`/api/offloads/${selectedOffload.id}`] : [],
    enabled: !!selectedOffload && offloadViewOpen,
  });

  // Fetch account names for Payment/Receipt/Journal vouchers
  useEffect(() => {
    const paymentVouchers = vouchers.filter(
      (v) =>
        v.voucherType === "Payment" ||
        v.voucherType === "Receipt" ||
        v.voucherType === "Journal",
    );

    const fetchAccountNames = async () => {
      const newCache = { ...accountNameCache };
      for (const voucher of paymentVouchers) {
        if (!(voucher.id in newCache)) {
          try {
            const res = await fetch(
              `/api/vouchers/${voucher.id}/view-entries`,
              {
                credentials: "include",
              },
            );
            if (res.ok) {
              const entries = await res.json();
              if (entries.length > 0) {
                newCache[voucher.id] = entries[0].accountName || "Unknown";
              }
            }
          } catch (error) {
            console.error("Error fetching account name:", error);
          }
        }
      }
      setAccountNameCache(newCache);
    };

    if (paymentVouchers.length > 0) {
      fetchAccountNames();
    }
  }, [vouchers, accountNameCache]);

  // Keyboard date navigation: "-" = back 1 day, Shift+"+" = forward 1 day
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const fmt = "yyyy-MM-dd";
      if (e.key === "-") {
        e.preventDefault();
        setPeriodFilter((prev) => ({
          fromDate: format(addDays(new Date(prev.fromDate), -1), fmt),
          toDate: format(addDays(new Date(prev.toDate), -1), fmt),
          preset: "custom",
        }));
      } else if (e.key === "+" && e.shiftKey) {
        e.preventDefault();
        setPeriodFilter((prev) => ({
          fromDate: format(addDays(new Date(prev.fromDate), 1), fmt),
          toDate: format(addDays(new Date(prev.toDate), 1), fmt),
          preset: "custom",
        }));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Apply filters (date filtering is now done server-side via periodFilter)
  const filteredVouchers = useMemo(() => {
    if (filters.voucherType === "Offload") return [];
    return vouchers
      .filter((voucher) => {
        // Voucher type filter
        if (
          filters.voucherType !== "all" &&
          voucher.voucherType !== filters.voucherType
        ) {
          return false;
        }

        // Search query filter
        if (filters.searchQuery) {
          const query = (filters.searchQuery || "").toLowerCase();
          return (
            (voucher.voucherNumber || "").toLowerCase().includes(query) ||
            (voucher.description || "").toLowerCase().includes(query) ||
            (voucher.voucherType || "").toLowerCase().includes(query)
          );
        }

        // Hide charge-related vouchers (they appear grouped under PO instead)
        const chargePatterns = [
          "Freight -",
          "Document Charges -",
          "Fumigation -",
          "Discount -",
          "Surcharge -",
        ];
        if (
          voucher.description &&
          chargePatterns.some((pattern) =>
            voucher.description!.startsWith(pattern),
          )
        ) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Sort by date, then by voucher type, then by voucher number
        const dateCompare = a.voucherDate.localeCompare(b.voucherDate);
        if (dateCompare !== 0)
          return filters.sortOrder === "desc" ? -dateCompare : dateCompare;
        const typeCompare = a.voucherType.localeCompare(b.voucherType);
        if (typeCompare !== 0) return typeCompare;
        return a.voucherNumber.localeCompare(b.voucherNumber);
      });
  }, [vouchers, filters]);

  // Filtered offloads
  const filteredOffloads = useMemo(() => {
    if (filters.voucherType !== "all" && filters.voucherType !== "Offload") return [];
    const query = (filters.searchQuery || "").toLowerCase();
    return offloads.filter((o) => {
      if (!query) return true;
      return o.containerNumber.toLowerCase().includes(query);
    });
  }, [offloads, filters]);

  // Combined rows for display (vouchers + offloads), sorted by date desc
  const allRows = useMemo((): DaybookRow[] => {
    const voucherRows: DaybookRow[] = filteredVouchers.map((v) => ({ _type: "voucher", data: v }));
    const offloadRows: DaybookRow[] = filteredOffloads.map((o) => ({ _type: "offload", data: o }));
    return [...voucherRows, ...offloadRows].sort((a, b) => {
      const dateA = a._type === "voucher" ? a.data.voucherDate : a.data.offloadedAt.slice(0, 10);
      const dateB = b._type === "voucher" ? b.data.voucherDate : b.data.offloadedAt.slice(0, 10);
      const cmp = dateA.localeCompare(dateB);
      return filters.sortOrder === "desc" ? -cmp : cmp;
    });
  }, [filteredVouchers, filteredOffloads, filters.sortOrder]);

  // Check if user can edit a voucher based on role and date
  const canEdit = (voucher: Voucher): boolean => {
    if (!user) return false;

    // Admin and Owner can edit all transactions
    if (user.role === "Admin" || user.role === "Owner") {
      return true;
    }

    // Manager can edit only today's transactions
    if (user.role === "Manager") {
      return isToday(parseISO(voucher.voucherDate));
    }

    return false;
  };

  // Check if user can delete a voucher (only Admin)
  const canDelete = (): boolean => {
    return user?.role === "Admin";
  };

  // Edit voucher mutation
  const editMutation = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: number;
      updates: EditVoucherForm;
    }) => {
      // Transform entries to match API format
      const transformedEntries = updates.entries.map((entry) => ({
        ledgerAccountId:
          entry.accountType === "ledger" ? entry.accountId : null,
        bankAccountId: entry.accountType === "bank" ? entry.accountId : null,
        supplierId: entry.accountType === "supplier" ? entry.accountId : null,
        employeeId: entry.accountType === "employee" ? entry.accountId : null,
        fixedAssetId:
          entry.accountType === "fixedAsset" ? entry.accountId : null,
        debitAmount: entry.debitAmount,
        creditAmount: entry.creditAmount,
        narration: entry.narration || null,
      }));

      // Update entire voucher with entries
      return await apiRequest("PUT", `/api/vouchers/${id}/with-entries`, {
        voucher: {
          voucherType: updates.voucherType,
          voucherDate: updates.voucherDate,
          description: updates.description,
          optional: updates.optional,
        },
        entries: transformedEntries,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/vouchers", selectedCompany?.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/accounts/all", selectedCompany?.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/ledger-accounts", selectedCompany?.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/employees", selectedCompany?.id],
        refetchType: "all",
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/employees", selectedCompany?.id],
        refetchType: "all",
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/payroll/employees-with-balances", selectedCompany?.id],
        refetchType: "all",
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/suppliers", selectedCompany?.id],
      });
      if (cashAccountId) {
        queryClient.invalidateQueries({
          queryKey: [`/api/ledger-accounts/${cashAccountId}`],
        });
      }
      toast({
        title: "Success",
        description: "Voucher updated successfully",
      });
      setEditDialogOpen(false);
      setVoucherToEdit(null);
      setEditFormInitialized(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update voucher",
        variant: "destructive",
      });
    },
  });

  // Delete voucher mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/vouchers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/vouchers", selectedCompany?.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/accounts/all", selectedCompany?.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/ledger-accounts", selectedCompany?.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/employees", selectedCompany?.id],
        refetchType: "all",
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/employees", selectedCompany?.id],
        refetchType: "all",
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/payroll/employees-with-balances", selectedCompany?.id],
        refetchType: "all",
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/suppliers", selectedCompany?.id],
      });
      if (cashAccountId) {
        queryClient.invalidateQueries({
          queryKey: [`/api/ledger-accounts/${cashAccountId}`],
        });
      }
      toast({
        title: "Success",
        description: "Voucher deleted successfully",
      });
      setDeleteDialogOpen(false);
      setVoucherToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete voucher",
        variant: "destructive",
      });
    },
  });

  // Handler functions
  const handleView = (voucher: Voucher) => {
    setSelectedVoucher(voucher);
    setViewDialogOpen(true);
  };

  const handleEdit = (voucher: Voucher) => {
    // Sales vouchers use the dedicated edit page
    if (voucher.voucherType === "Sales") {
      navigate(`/vouchers/${voucher.id}/edit`);
      return;
    }

    // Purchase vouchers should be edited via the Containers page
    if (voucher.voucherType === "Purchase") {
      // Navigate to containers page - the PO can be edited there
      navigate(`/containers`);
      toast({
        title: "Edit Purchase Order",
        description:
          "Please find and edit the purchase order in the container that this voucher is linked to.",
      });
      return;
    }

    // Other voucher types navigate to vouchers page with edit mode
    const voucherTypeMap: Record<string, string> = {
      Payment: "payment",
      Receipt: "receipt",
      Journal: "journal",
      Consumption: "adjustment",
      Production: "adjustment",
      Mixed: "adjustment",
      StockTransfer: "transfer",
      "Stock Transfer": "transfer",
      "Credit Note": "credit-note",
      "Debit Note": "credit-note",
    };

    const tabName = voucherTypeMap[voucher.voucherType];
    if (tabName) {
      navigate(`/vouchers?edit=${voucher.id}&tab=${tabName}`);
    } else {
      // Fallback for unsupported types
      toast({
        title: "Info",
        description: `Editing ${voucher.voucherType} vouchers is not yet supported. Please contact support.`,
        variant: "destructive",
      });
    }
  };

  const handleSaveEdit = (data: EditVoucherForm) => {
    if (!voucherToEdit) return;

    editMutation.mutate({
      id: voucherToEdit.id,
      updates: data,
    });
  };

  const handleDelete = (voucher: Voucher) => {
    setVoucherToDelete(voucher);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (voucherToDelete) {
      deleteMutation.mutate(voucherToDelete.id);
    }
  };

  const handleExportToExcel = () => {
    if (filteredVouchers.length === 0) {
      toast({
        title: "No data to export",
        description:
          "There are no vouchers to export based on current filters.",
        variant: "destructive",
      });
      return;
    }

    const exportData = filteredVouchers.map((voucher) => ({
      "Voucher Number": voucher.voucherNumber,
      Date: format(parseISO(voucher.voucherDate), "yyyy-MM-dd"),
      Type: voucher.voucherType,
      Description: voucher.description || "",
      "Total Amount": formatAmount(voucher.totalAmount),
      Optional: voucher.optional ? "Yes" : "No",
    }));

    const worksheet = utils.json_to_sheet(exportData);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, "Daybook");

    const fileName = `Daybook_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
    writeFile(workbook, fileName);

    toast({
      title: "Export successful",
      description: `Downloaded ${fileName} with ${filteredVouchers.length} records.`,
    });
  };

  const [isExportingDetailed, setIsExportingDetailed] = useState(false);

  const handleExportDetailedToExcel = async () => {
    if (filteredVouchers.length === 0) {
      toast({
        title: "No data to export",
        description:
          "There are no vouchers to export based on current filters.",
        variant: "destructive",
      });
      return;
    }

    setIsExportingDetailed(true);

    try {
      const detailedData: Array<{
        "Voucher Number": string;
        Date: string;
        Type: string;
        Description: string;
        Location: string;
        Optional: string;
        "Account Name": string;
        "Account Type": string;
        "Item Code": string;
        "Item Name": string;
        Debit: string;
        Credit: string;
        Narration: string;
      }> = [];

      // Fetch entries for each voucher
      for (const voucher of filteredVouchers) {
        try {
          const res = await fetch(`/api/vouchers/${voucher.id}/view-entries`, {
            credentials: "include",
          });

          if (res.ok) {
            const response = await res.json();
            const entries = Array.isArray(response)
              ? response
              : response.entries || [];

            if (entries.length === 0) {
              // Voucher with no entries - still add a row
              detailedData.push({
                "Voucher Number": voucher.voucherNumber,
                Date: format(parseISO(voucher.voucherDate), "yyyy-MM-dd"),
                Type: voucher.voucherType,
                Description: voucher.description || "",
                Location: (voucher as any).locationName || "",
                Optional: voucher.optional ? "Yes" : "No",
                "Account Name": "",
                "Account Type": "",
                "Item Code": "",
                "Item Name": "",
                Debit: "",
                Credit: "",
                Narration: "",
              });
            } else {
              // Add a row for each entry (including stock items)
              for (const entry of entries) {
                // Determine account name - could be ledger account, stock item, supplier, employee, or asset
                let accountName = "";
                let accountType = "";

                if (entry.isStockItem || entry.stockItemId) {
                  accountName = entry.stockItemName || entry.accountName || "";
                  accountType = "Stock Item";
                } else if (entry.supplierName) {
                  accountName = entry.supplierName;
                  accountType = "Supplier";
                } else if (entry.employeeName) {
                  accountName = entry.employeeName;
                  accountType = "Employee";
                } else if (entry.assetName) {
                  accountName = entry.assetName;
                  accountType = "Fixed Asset";
                } else {
                  accountName = entry.accountName || "";
                  accountType = entry.accountType || "";
                }

                detailedData.push({
                  "Voucher Number": voucher.voucherNumber,
                  Date: format(parseISO(voucher.voucherDate), "yyyy-MM-dd"),
                  Type: voucher.voucherType,
                  Description: voucher.description || "",
                  Location: (voucher as any).locationName || "",
                  Optional: voucher.optional ? "Yes" : "No",
                  "Account Name": accountName,
                  "Account Type": accountType,
                  "Item Code": (entry.isStockItem || entry.stockItemId) ? (entry.stockItemCode || "") : "",
                  "Item Name": (entry.isStockItem || entry.stockItemId) ? (entry.stockItemName || "") : "",
                  Debit:
                    entry.debitAmount && parseFloat(entry.debitAmount) > 0
                      ? formatAmount(entry.debitAmount)
                      : "",
                  Credit:
                    entry.creditAmount && parseFloat(entry.creditAmount) > 0
                      ? formatAmount(entry.creditAmount)
                      : "",
                  Narration: entry.narration || "",
                });
              }
            }
          }
        } catch (error) {
          console.error(
            `Error fetching entries for voucher ${voucher.id}:`,
            error,
          );
        }
      }

      if (detailedData.length === 0) {
        toast({
          title: "No data to export",
          description: "Could not fetch voucher details.",
          variant: "destructive",
        });
        return;
      }

      // Group data by voucher type for separate sheets
      const dataByType: { [key: string]: typeof detailedData } = {};
      for (const row of detailedData) {
        const type = row.Type || "Other";
        if (!dataByType[type]) {
          dataByType[type] = [];
        }
        dataByType[type].push(row);
      }

      const workbook = utils.book_new();

      // Auto-size columns config
      const colWidths = [
        { wch: 15 }, // Voucher Number
        { wch: 12 }, // Date
        { wch: 12 }, // Type
        { wch: 30 }, // Description
        { wch: 15 }, // Location
        { wch: 8 }, // Optional
        { wch: 30 }, // Account Name
        { wch: 15 }, // Account Type
        { wch: 15 }, // Item Code
        { wch: 30 }, // Item Name
        { wch: 15 }, // Debit
        { wch: 15 }, // Credit
        { wch: 30 }, // Narration
      ];

      // Create a sheet for each voucher type
      const voucherTypeOrder = [
        "Sales",
        "Purchase",
        "Payment",
        "Receipt",
        "Journal",
        "Stock Transfer",
        "Production",
        "Consumption",
        "Contra",
        "Credit Note",
      ];
      const sortedTypes = Object.keys(dataByType).sort((a, b) => {
        const indexA = voucherTypeOrder.indexOf(a);
        const indexB = voucherTypeOrder.indexOf(b);
        if (indexA === -1 && indexB === -1) return a.localeCompare(b);
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
      });

      for (const type of sortedTypes) {
        const typeData = dataByType[type];
        const worksheet = utils.json_to_sheet(typeData);
        worksheet["!cols"] = colWidths;
        // Sheet name max 31 chars, sanitize for Excel
        const sheetName = type.substring(0, 31).replace(/[\\/*?[\]:]/g, "_");
        utils.book_append_sheet(workbook, worksheet, sheetName);
      }

      const fileName = `Daybook_Detailed_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
      writeFile(workbook, fileName);

      toast({
        title: "Export successful",
        description: `Downloaded ${fileName} with ${detailedData.length} entries from ${filteredVouchers.length} vouchers across ${sortedTypes.length} sheets.`,
      });
    } catch (error) {
      console.error("Export error:", error);
      toast({
        title: "Export failed",
        description: "An error occurred while exporting.",
        variant: "destructive",
      });
    } finally {
      setIsExportingDetailed(false);
    }
  };

  const clearFilters = () => {
    setPeriodFilter(getDefaultPeriodValue("today"));
    setFilters({
      voucherType: "all",
      searchQuery: "",
      sortOrder: "desc",
    });
  };

  const hasActiveFilters =
    periodFilter.preset !== "today" ||
    filters.voucherType !== "all" ||
    filters.searchQuery;

  const getVoucherTypeBadge = (type: string): { variant: "default" | "secondary" | "destructive" | "outline"; className?: string } => {
    switch (type) {
      case "Sales":    return { variant: "default" };
      case "Purchase": return { variant: "secondary" };
      case "Payment":  return { variant: "destructive" };
      case "Receipt":  return { variant: "default" };
      case "Journal":  return { variant: "outline" };
      case "Contra":   return { variant: "secondary" };
      case "Stock Transfer": return { variant: "outline", className: "bg-green-500 text-white border-green-500 dark:bg-green-600 dark:border-green-600" };
      default:         return { variant: "outline" };
    }
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6 p-3 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <Book className="w-6 h-6 md:w-8 md:h-8" />
            Daybook
          </h1>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">
            View all accounting transactions chronologically
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                disabled={filteredVouchers.length === 0 || isExportingDetailed}
                data-testid="button-export-excel"
                className="gap-2"
              >
                <FileDown className="w-4 h-4" />
                {isExportingDetailed ? "Exporting..." : "Export"}
                <ChevronDown className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={handleExportToExcel}
                data-testid="export-simple"
              >
                Summary Export
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleExportDetailedToExcel}
                data-testid="export-detailed"
              >
                Detailed Export (with entries)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            onClick={() => navigate("/vouchers")}
            data-testid="button-new-voucher"
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            New Voucher
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5" />
              <CardTitle>Filters</CardTitle>
            </div>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                data-testid="button-clear-filters"
                className="gap-1"
              >
                <X className="w-4 h-4" />
                Clear Filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label>Period</Label>
              <PeriodFilter
                value={periodFilter}
                onChange={setPeriodFilter}
                data-testid="period-filter"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="voucher-type">Voucher Type</Label>
              <Select
                value={filters.voucherType}
                onValueChange={(value) =>
                  setFilters({ ...filters, voucherType: value })
                }
              >
                <SelectTrigger
                  id="voucher-type"
                  data-testid="select-voucher-type"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="Sales">Sales</SelectItem>
                  <SelectItem value="Purchase">Purchase</SelectItem>
                  <SelectItem value="Payment">Payment</SelectItem>
                  <SelectItem value="Receipt">Receipt</SelectItem>
                  <SelectItem value="Journal">Journal</SelectItem>
                  <SelectItem value="Contra">Contra</SelectItem>
                  <SelectItem value="Offload">Offload</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 flex-1 min-w-0 w-full md:min-w-[200px] md:w-auto">
              <Label htmlFor="search">Search</Label>
              <Input
                id="search"
                placeholder="Voucher # or description..."
                value={filters.searchQuery}
                onChange={(e) =>
                  setFilters({ ...filters, searchQuery: e.target.value })
                }
                data-testid="input-search"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Vouchers Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Transactions
            {allRows.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({allRows.length}{" "}
                {allRows.length === 1 ? "entry" : "entries"})
              </span>
            )}
          </CardTitle>
          <CardDescription>
            All accounting vouchers and transactions
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading || offloadsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : allRows.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {hasActiveFilters ? (
                <div>
                  <p className="mb-2">
                    No transactions found matching your filters.
                  </p>
                  <Button
                    variant="outline"
                    onClick={clearFilters}
                    data-testid="button-clear-filters-empty"
                  >
                    Clear Filters
                  </Button>
                </div>
              ) : (
                <p>
                  No transactions found. Create your first voucher to get
                  started.
                </p>
              )}
            </div>
          ) : (
            <>
            {/* Mobile Card View */}
            <div className="md:hidden space-y-3">
              {allRows.map((row) => {
                if (row._type === "offload") {
                  const o = row.data;
                  return (
                    <div
                      key={`offload-${o.id}`}
                      className="border rounded-md p-3 space-y-2"
                      data-testid={`card-offload-${o.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30">
                          <Package className="w-3 h-3 mr-1" />
                          Offload
                        </Badge>
                        <span className="font-mono font-medium text-sm whitespace-nowrap">
                          {formatAmount(Number(o.itemsTotal) + Number(o.totalCharges))}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {formatDisplayDate(parseISO(o.offloadedAt.slice(0, 10)))}
                      </div>
                      <p className="text-sm font-medium">{o.containerNumber}</p>
                      {o.locationName && <p className="text-xs text-muted-foreground">{o.locationName}</p>}
                      <div className="flex items-center gap-1 pt-1 border-t">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => { setSelectedOffload(o); setOffloadViewOpen(true); }}
                          data-testid={`button-view-offload-${o.id}`}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => navigate(`/containers/${o.containerId}`)}
                          data-testid={`button-edit-offload-${o.id}`}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  );
                }
                const voucher = row.data as Voucher;
                return (
                  <div
                    key={`voucher-${voucher.id}`}
                    className="border rounded-md p-3 space-y-2"
                    data-testid={`card-voucher-${voucher.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge
                          {...getVoucherTypeBadge(voucher.voucherType)}
                          data-testid={`badge-type-${voucher.id}`}
                        >
                          {voucher.voucherType}
                        </Badge>
                        {voucher.optional && (
                          <Badge
                            variant="outline"
                            data-testid={`badge-optional-${voucher.id}`}
                            className="text-xs"
                          >
                            Optional
                          </Badge>
                        )}
                      </div>
                      <span className="font-mono font-medium text-sm whitespace-nowrap">
                        {formatAmount(voucher.totalAmount)}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {formatDisplayDate(parseISO(voucher.voucherDate))}
                      <span className="ml-2 text-xs">{format(new Date(voucher.createdAt), "hh:mm a")}</span>
                    </div>
                    <p className="text-sm truncate">
                      {voucher.description ||
                        (voucher.voucherType === "Payment" ||
                        voucher.voucherType === "Receipt" ||
                        voucher.voucherType === "Journal"
                          ? `${voucher.voucherType}${accountNameCache[voucher.id] ? ` (${accountNameCache[voucher.id]})` : ""}`
                          : "-")}
                    </p>
                    <div className="flex items-center gap-1 pt-1 border-t">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleView(voucher)}
                        data-testid={`button-view-${voucher.id}`}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      {canEdit(voucher) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(voucher)}
                          data-testid={`button-edit-${voucher.id}`}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                      )}
                      {canDelete() && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(voucher)}
                          data-testid={`button-delete-${voucher.id}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block border rounded-md overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-background">
                  <TableRow>
                    <TableHead className="sticky left-0 bg-muted z-10">
                      Date
                    </TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allRows.map((row) => {
                    if (row._type === "offload") {
                      const o = row.data;
                      return (
                        <TableRow key={`offload-${o.id}`} data-testid={`row-offload-${o.id}`}>
                          <TableCell className="font-medium sticky left-0 bg-background z-10">
                            {formatDisplayDate(parseISO(o.offloadedAt.slice(0, 10)))}
                          </TableCell>
                          <TableCell>
                            <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30">
                              <Package className="w-3 h-3 mr-1" />
                              Offload
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-md truncate">
                            {o.containerNumber}{o.locationName ? ` — ${o.locationName}` : ""}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatAmount(Number(o.itemsTotal) + Number(o.totalCharges))}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => { setSelectedOffload(o); setOffloadViewOpen(true); }}
                                data-testid={`button-view-offload-${o.id}`}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => navigate(`/containers/${o.containerId}`)}
                                data-testid={`button-goto-container-${o.id}`}
                              >
                                <ExternalLink className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    }
                    const voucher = row.data as Voucher;
                    return (
                      <TableRow
                        key={`voucher-${voucher.id}`}
                        data-testid={`row-voucher-${voucher.id}`}
                      >
                        <TableCell className="font-medium sticky left-0 bg-background z-10">
                          <div className="flex flex-col">
                            <span>{formatDisplayDate(parseISO(voucher.voucherDate))}</span>
                            <span className="text-xs text-muted-foreground">{format(new Date(voucher.createdAt), "hh:mm a")}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge
                              {...getVoucherTypeBadge(voucher.voucherType)}
                              data-testid={`badge-type-${voucher.id}`}
                            >
                              {voucher.voucherType}
                            </Badge>
                            {voucher.optional && (
                              <Badge
                                variant="outline"
                                data-testid={`badge-optional-${voucher.id}`}
                                className="text-xs"
                              >
                                Optional
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-md truncate">
                          {voucher.description ||
                            (voucher.voucherType === "Payment" ||
                            voucher.voucherType === "Receipt" ||
                            voucher.voucherType === "Journal"
                              ? `${voucher.voucherType}${accountNameCache[voucher.id] ? ` (${accountNameCache[voucher.id]})` : ""}`
                              : "-")}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {formatAmount(voucher.totalAmount)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleView(voucher)}
                              data-testid={`button-view-${voucher.id}`}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            {canEdit(voucher) && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleEdit(voucher)}
                                data-testid={`button-edit-${voucher.id}`}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                            )}
                            {canDelete() && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDelete(voucher)}
                                data-testid={`button-delete-${voucher.id}`}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* View Voucher Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="w-full max-w-[95vw] md:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Voucher Details</DialogTitle>
            <DialogDescription>View voucher information</DialogDescription>
          </DialogHeader>
          {selectedVoucher && (
            <div className="space-y-4 md:space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Date</p>
                  <p className="font-medium">
                    {formatDisplayDate(parseISO(selectedVoucher.voucherDate))}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Type</p>
                  <div className="flex gap-2 items-center">
                    <Badge
                      {...getVoucherTypeBadge(selectedVoucher.voucherType)}
                    >
                      {selectedVoucher.voucherType}
                    </Badge>
                    {selectedVoucher.optional && (
                      <Badge variant="outline" className="text-xs">
                        Optional
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              {selectedVoucher.description && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">
                    Description
                  </p>
                  <p className="text-sm">{selectedVoucher.description}</p>
                </div>
              )}
              {selectedVoucher.locationName && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Location</p>
                  <p className="text-sm">{selectedVoucher.locationName}</p>
                </div>
              )}

              {/* Payment/Receipt Source Account Summary */}
              {(selectedVoucher.voucherType === "Payment" ||
                selectedVoucher.voucherType === "Receipt") &&
                !viewEntriesLoading &&
                viewVoucherEntries.length > 0 &&
                (() => {
                  // For Payment: credit entry is the source (cash/bank account where money comes FROM)
                  // For Receipt: debit entry is the source (cash/bank account where money goes INTO)
                  const sourceEntry =
                    selectedVoucher.voucherType === "Payment"
                      ? viewVoucherEntries.find(
                          (e: any) => parseFloat(e.creditAmount || "0") > 0,
                        )
                      : viewVoucherEntries.find(
                          (e: any) => parseFloat(e.debitAmount || "0") > 0,
                        );

                  // Total = sum of the opposite side entries
                  const totalAmount =
                    selectedVoucher.voucherType === "Payment"
                      ? viewVoucherEntries.reduce(
                          (sum: number, e: any) =>
                            sum + parseFloat(e.debitAmount || "0"),
                          0,
                        )
                      : viewVoucherEntries.reduce(
                          (sum: number, e: any) =>
                            sum + parseFloat(e.creditAmount || "0"),
                          0,
                        );

                  if (!sourceEntry) return null;

                  return (
                    <div className="p-3 md:p-4 bg-muted/50 rounded-md mb-4">
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                        <div>
                          <p className="text-sm text-muted-foreground mb-1">
                            {selectedVoucher.voucherType === "Payment"
                              ? "Paid From"
                              : "Received In"}
                          </p>
                          <div className="font-medium text-base md:text-lg">
                            {sourceEntry.accountName}
                          </div>
                          <div className="text-sm font-mono mt-2">
                            Balance: {formatAmount(cashAccountBalance)}
                          </div>
                        </div>
                        <div className="sm:text-right">
                          <p className="text-sm text-muted-foreground mb-1">
                            Total Amount
                          </p>
                          <div className="text-xl md:text-2xl font-bold font-mono">
                            {formatAmount(totalAmount)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

              {/* Voucher Entries Table */}
              <div>
                <h3 className="font-semibold mb-3">Entries</h3>
                {viewEntriesLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : viewVoucherEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No entries found
                  </p>
                ) : selectedVoucher.voucherType === "Sales" ? (
                  // Special rendering for Sales vouchers
                  (() => {
                    // Separate ledger entries (cash/revenue) from sales items
                    const ledgerEntries = viewVoucherEntries.filter(
                      (e: ViewVoucherEntry) => !e.isStockItem && !e.stockItemId,
                    );
                    const salesItems = viewVoucherEntries.filter(
                      (e: ViewVoucherEntry) => e.isStockItem || e.stockItemId,
                    );

                    // Find cash entry (debit) and revenue entry (credit)
                    const cashEntry = ledgerEntries.find(
                      (e: ViewVoucherEntry) => parseFloat(e.debitAmount || "0") > 0,
                    );
                    const revenueEntry = ledgerEntries.find(
                      (e: ViewVoucherEntry) => parseFloat(e.creditAmount || "0") > 0,
                    );

                    return (
                      <div className="space-y-4">
                        {/* Cash Account Summary */}
                        {cashEntry && (
                          <div className="p-3 bg-muted/50 rounded-md mb-4">
                            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                              <div>
                                <div className="font-medium">
                                  {cashEntry.accountName}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-sm text-muted-foreground mb-1">
                                  Balance
                                </div>
                                <div className="font-mono font-bold">
                                  {formatAmount(cashAccountBalance)}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Sales Items Table */}
                        {salesItems.length > 0 && (
                          <div className="border rounded-md">
                            <Table>
                              <TableHeader className="sticky top-0 z-10 bg-background">
                                <TableRow>
                                  <TableHead>Item Name</TableHead>
                                  <TableHead className="text-right">
                                    Qty
                                  </TableHead>
                                  <TableHead className="text-right">
                                    Rate
                                  </TableHead>
                                  <TableHead className="text-right">
                                    Total Amount
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {salesItems.map((item: ViewVoucherEntry) => {
                                  const qty = parseFloat(item.quantity || "0");
                                  const rate = parseFloat(
                                    item.rate || item.sellingPrice || "0",
                                  );
                                  const totalAmount = parseFloat(
                                    item.totalSales || item.creditAmount || "0",
                                  );
                                  return (
                                    <TableRow key={item.id}>
                                      <TableCell>
                                        <div className="font-medium">
                                          {item.stockItemName ||
                                            item.accountName}
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-right font-mono">
                                        {formatNumber(qty)}
                                      </TableCell>
                                      <TableCell className="text-right font-mono">
                                        {formatAmount(rate)}
                                      </TableCell>
                                      <TableCell className="text-right font-mono">
                                        {formatAmount(totalAmount)}
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                                {/* Totals Row */}
                                <TableRow className="font-bold bg-muted/50">
                                  <TableCell>Total</TableCell>
                                  <TableCell className="text-right font-mono">
                                    {formatNumber(
                                      salesItems.reduce(
                                        (sum: number, item: ViewVoucherEntry) =>
                                          sum +
                                          parseFloat(item.quantity || "0"),
                                        0,
                                      ),
                                    )}
                                  </TableCell>
                                  <TableCell></TableCell>
                                  <TableCell className="text-right font-mono">
                                    {formatAmount(
                                      salesItems.reduce(
                                        (sum: number, item: ViewVoucherEntry) =>
                                          sum +
                                          parseFloat(
                                            item.totalSales ||
                                              item.creditAmount ||
                                              "0",
                                          ),
                                        0,
                                      ),
                                    )}
                                  </TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : selectedVoucher.voucherType === "Purchase" ? (
                  // Special rendering for Purchase vouchers - show items with supplier info
                  (() => {
                    // SECURITY: Hide cost prices for POS users (default to hiding if user is undefined during load)
                    const isPOSUser = !user || user?.role?.startsWith("POS");

                    // Separate ledger entries from purchase items
                    // Use positive allow-list to keep only charge-type accounts (Freight, Fumigation, Surcharge, Discount, etc.)
                    const chargeKeywords = [
                      "freight",
                      "fumigation",
                      "surcharge",
                      "discount",
                      "other charges",
                      "handling",
                      "insurance",
                      "customs",
                      "duty",
                    ];
                    const ledgerEntries = viewVoucherEntries.filter((e: ViewVoucherEntry) => {
                      if (e.isPurchaseItem || e.isStockItem) return false;
                      const name = (e.accountName || "").toLowerCase();
                      // Keep only entries that start with known charge types
                      return chargeKeywords.some((keyword) =>
                        name.startsWith(keyword),
                      );
                    });
                    const purchaseItems = viewVoucherEntries.filter(
                      (e: ViewVoucherEntry) => e.isPurchaseItem || e.isStockItem,
                    );

                    return (
                      <div className="space-y-4">
                        {/* Purchase Order Info - Show supplier name and container tracking number */}
                        {purchaseOrderData && (
                          <div className="p-3 bg-muted/50 rounded-md space-y-2">
                            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                              <div>
                                <div className="font-medium">
                                  {purchaseOrderData.supplierName}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  Container: {purchaseOrderData.containerNumber}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                {!isPOSUser && purchaseOrderData.itemsTotal && (
                                  <div className="font-mono font-bold">
                                    {formatAmount(
                                      parseFloat(
                                        purchaseOrderData.itemsTotal || "0",
                                      ),
                                    )}
                                  </div>
                                )}
                                <Badge
                                  variant={
                                    purchaseOrderData.status === "Closed"
                                      ? "secondary"
                                      : "default"
                                  }
                                >
                                  {purchaseOrderData.status}
                                </Badge>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setViewDialogOpen(false);
                                    navigate(
                                      `/purchase-orders/${purchaseOrderData.id}/edit`,
                                    );
                                  }}
                                  data-testid="button-edit-po"
                                >
                                  Edit PO
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Purchase Items + Charges Table */}
                        {purchaseItems.length > 0 ||
                        ledgerEntries.length > 0 ? (
                          <div className="border rounded-md">
                            <Table>
                              <TableHeader className="sticky top-0 z-10 bg-background">
                                <TableRow>
                                  <TableHead>Item Name</TableHead>
                                  <TableHead className="text-right">
                                    Qty
                                  </TableHead>
                                  {!isPOSUser && (
                                    <>
                                      <TableHead className="text-right">
                                        Rate
                                      </TableHead>
                                      <TableHead className="text-right">
                                        Total
                                      </TableHead>
                                    </>
                                  )}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {/* Purchase Items */}
                                {purchaseItems.map((item: ViewVoucherEntry) => {
                                  const qty = parseFloat(item.quantity || "0");
                                  const rate =
                                    item.rate != null
                                      ? parseFloat(item.rate)
                                      : 0;
                                  const totalAmount =
                                    item.totalAmount != null
                                      ? parseFloat(item.totalAmount)
                                      : 0;
                                  return (
                                    <TableRow key={item.id}>
                                      <TableCell>
                                        <div className="font-medium">
                                          {item.stockItemName ||
                                            item.accountName}
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-right font-mono">
                                        {Math.round(qty).toLocaleString()}
                                      </TableCell>
                                      {!isPOSUser && (
                                        <>
                                          <TableCell className="text-right font-mono">
                                            {formatAmount(rate)}
                                          </TableCell>
                                          <TableCell className="text-right font-mono">
                                            {formatAmount(totalAmount)}
                                          </TableCell>
                                        </>
                                      )}
                                    </TableRow>
                                  );
                                })}

                                {/* Items Subtotal */}
                                {purchaseItems.length > 0 && (
                                  <TableRow className="bg-muted/30">
                                    <TableCell className="font-semibold">
                                      Items Subtotal
                                    </TableCell>
                                    <TableCell className="text-right font-mono">
                                      {Math.round(
                                        purchaseItems.reduce(
                                          (sum: number, item: ViewVoucherEntry) =>
                                            sum +
                                            parseFloat(item.quantity || "0"),
                                          0,
                                        ),
                                      ).toLocaleString()}
                                    </TableCell>
                                    {!isPOSUser && (
                                      <>
                                        <TableCell></TableCell>
                                        <TableCell className="text-right font-mono font-semibold">
                                          {formatAmount(
                                            purchaseItems.reduce(
                                              (sum: number, item: ViewVoucherEntry) =>
                                                sum +
                                                (item.totalAmount != null
                                                  ? parseFloat(item.totalAmount)
                                                  : 0),
                                              0,
                                            ),
                                          )}
                                        </TableCell>
                                      </>
                                    )}
                                  </TableRow>
                                )}

                                {/* Individual Charges from Purchase Order */}
                                {purchaseOrderData &&
                                  (() => {
                                    const charges = [
                                      {
                                        label: "Freight",
                                        amount: parseFloat(
                                          purchaseOrderData.freight || "0",
                                        ),
                                      },
                                      {
                                        label: "Fumigation",
                                        amount: parseFloat(
                                          purchaseOrderData.fumigation || "0",
                                        ),
                                      },
                                      {
                                        label: "Surcharge",
                                        amount: parseFloat(
                                          purchaseOrderData.surcharge || "0",
                                        ),
                                      },
                                      {
                                        label: "Document Charges",
                                        amount: parseFloat(
                                          purchaseOrderData.documentCharges ||
                                            "0",
                                        ),
                                      },
                                      {
                                        label: "Other Charges",
                                        amount: parseFloat(
                                          purchaseOrderData.otherCharges || "0",
                                        ),
                                      },
                                      {
                                        label: "Discount",
                                        amount: -parseFloat(
                                          purchaseOrderData.discount || "0",
                                        ),
                                      },
                                    ].filter((c) => c.amount !== 0);

                                    return charges.map((charge, idx) => (
                                      <TableRow
                                        key={`charge-${idx}`}
                                        className="bg-muted/20"
                                      >
                                        <TableCell>
                                          <div className="font-medium text-sm">
                                            {charge.label}
                                          </div>
                                        </TableCell>
                                        <TableCell></TableCell>
                                        {!isPOSUser && (
                                          <>
                                            <TableCell></TableCell>
                                            <TableCell className="text-right font-mono">
                                              {charge.amount < 0
                                                ? `-${formatAmount(Math.abs(charge.amount))}`
                                                : formatAmount(charge.amount)}
                                            </TableCell>
                                          </>
                                        )}
                                      </TableRow>
                                    ));
                                  })()}

                                {/* Grand Total Row */}
                                <TableRow className="font-bold bg-muted/50">
                                  <TableCell>GRAND TOTAL</TableCell>
                                  <TableCell className="text-right font-mono">
                                    {Math.round(
                                      purchaseItems.reduce(
                                        (sum: number, item: ViewVoucherEntry) =>
                                          sum +
                                          parseFloat(item.quantity || "0"),
                                        0,
                                      ),
                                    ).toLocaleString()}
                                  </TableCell>
                                  {!isPOSUser && (
                                    <>
                                      <TableCell></TableCell>
                                      <TableCell className="text-right font-mono">
                                        {formatAmount(
                                          purchaseItems.reduce(
                                            (sum: number, item: ViewVoucherEntry) =>
                                              sum +
                                              (item.totalAmount != null
                                                ? parseFloat(item.totalAmount)
                                                : 0),
                                            0,
                                          ) +
                                            (purchaseOrderData
                                              ? parseFloat(
                                                  purchaseOrderData.freight ||
                                                    "0",
                                                ) +
                                                parseFloat(
                                                  purchaseOrderData.fumigation ||
                                                    "0",
                                                ) +
                                                parseFloat(
                                                  purchaseOrderData.surcharge ||
                                                    "0",
                                                ) +
                                                parseFloat(
                                                  purchaseOrderData.documentCharges ||
                                                    "0",
                                                ) +
                                                parseFloat(
                                                  purchaseOrderData.otherCharges ||
                                                    "0",
                                                ) -
                                                parseFloat(
                                                  purchaseOrderData.discount ||
                                                    "0",
                                                )
                                              : 0),
                                        )}
                                      </TableCell>
                                    </>
                                  )}
                                </TableRow>
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          // Fallback to ledger entries if no purchase items found
                          <div className="border rounded-md">
                            <Table>
                              <TableHeader className="sticky top-0 z-10 bg-background">
                                <TableRow>
                                  <TableHead>Account</TableHead>
                                  {!isPOSUser && (
                                    <>
                                      <TableHead className="text-right">
                                        Debit
                                      </TableHead>
                                      <TableHead className="text-right">
                                        Credit
                                      </TableHead>
                                    </>
                                  )}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {ledgerEntries.map((entry: ViewVoucherEntry) => (
                                  <TableRow key={entry.id}>
                                    <TableCell>
                                      <div className="font-medium">
                                        {entry.accountName}
                                      </div>
                                    </TableCell>
                                    {!isPOSUser && (
                                      <>
                                        <TableCell className="text-right font-mono">
                                          {parseFloat(entry.debitAmount) > 0
                                            ? formatAmount(entry.debitAmount)
                                            : "-"}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                          {parseFloat(entry.creditAmount) > 0
                                            ? formatAmount(entry.creditAmount)
                                            : "-"}
                                        </TableCell>
                                      </>
                                    )}
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <div className="border rounded-md">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-background">
                        <TableRow>
                          {selectedVoucher.voucherType === "Consumption" ||
                          selectedVoucher.voucherType === "Production" ||
                          selectedVoucher.voucherType === "Mixed" ||
                          selectedVoucher.voucherType === "Stock Transfer" ||
                          selectedVoucher.voucherType === "StockTransfer" ? (
                            <>
                              <TableHead>Item Name</TableHead>
                              {selectedVoucher.voucherType === "Mixed" && (
                                <TableHead>Type</TableHead>
                              )}
                              <TableHead className="text-right">Qty</TableHead>
                              {user && !user?.role?.startsWith("POS") && (
                                <>
                                  <TableHead className="text-right">
                                    Amount
                                  </TableHead>
                                  <TableHead className="text-right">
                                    Total Amount
                                  </TableHead>
                                </>
                              )}
                            </>
                          ) : selectedVoucher.voucherType === "Payment" ||
                            selectedVoucher.voucherType === "Receipt" ||
                            selectedVoucher.voucherType === "Journal" ? (
                            <>
                              <TableHead>Account</TableHead>
                              <TableHead className="text-right">
                                Amount
                              </TableHead>
                            </>
                          ) : (
                            <>
                              <TableHead>Account</TableHead>
                              <TableHead className="text-right">
                                Debit
                              </TableHead>
                              <TableHead className="text-right">
                                Credit
                              </TableHead>
                              <TableHead>Narration</TableHead>
                            </>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(() => {
                          const isPOSUser =
                            !user || user?.role?.startsWith("POS");

                          // For Consumption/Production/Mixed/Stock Transfer, show stock items
                          if (
                            selectedVoucher.voucherType === "Consumption" ||
                            selectedVoucher.voucherType === "Production" ||
                            selectedVoucher.voucherType === "Mixed" ||
                            selectedVoucher.voucherType === "Stock Transfer" ||
                            selectedVoucher.voucherType === "StockTransfer"
                          ) {
                            return viewVoucherEntries.map((entry: ViewVoucherEntry) => {
                              const qty = parseFloat(entry.quantity || "0");
                              const rate =
                                entry.rate != null ? parseFloat(entry.rate) : 0;
                              const totalAmount =
                                entry.totalAmount != null
                                  ? parseFloat(entry.totalAmount)
                                  : qty * rate;
                              return (
                                <TableRow key={entry.id}>
                                  <TableCell>
                                    <div className="font-medium">
                                      {entry.stockItemName || entry.accountName}
                                    </div>
                                  </TableCell>
                                  {selectedVoucher.voucherType === "Mixed" && (
                                    <TableCell>
                                      <Badge
                                        variant={
                                          entry.adjustmentType === "Production"
                                            ? "default"
                                            : "secondary"
                                        }
                                      >
                                        {entry.adjustmentType ||
                                          (qty > 0
                                            ? "Production"
                                            : "Consumption")}
                                      </Badge>
                                    </TableCell>
                                  )}
                                  <TableCell className="text-right font-mono">
                                    {Math.round(Math.abs(qty)).toLocaleString()}
                                  </TableCell>
                                  {!isPOSUser && (
                                    <>
                                      <TableCell className="text-right font-mono">
                                        {formatAmount(rate)}
                                      </TableCell>
                                      <TableCell className="text-right font-mono">
                                        {formatAmount(totalAmount)}
                                      </TableCell>
                                    </>
                                  )}
                                </TableRow>
                              );
                            });
                          }

                          // For Payment/Receipt/Journal, filter out the cash source entries
                          const displayEntries =
                            selectedVoucher.voucherType === "Payment" ||
                            selectedVoucher.voucherType === "Receipt" ||
                            selectedVoucher.voucherType === "Journal"
                              ? viewVoucherEntries.filter((entry: ViewVoucherEntry) => {
                                  // Payment: show only debit entries (accounts being paid)
                                  // Receipt: show only credit entries (accounts receiving)
                                  // Journal: show all entries (no filtering)
                                  if (
                                    selectedVoucher.voucherType === "Payment"
                                  ) {
                                    return (
                                      parseFloat(entry.debitAmount || "0") > 0
                                    );
                                  } else if (
                                    selectedVoucher.voucherType === "Receipt"
                                  ) {
                                    return (
                                      parseFloat(entry.creditAmount || "0") > 0
                                    );
                                  } else {
                                    // Journal: show all entries
                                    return true;
                                  }
                                })
                              : viewVoucherEntries;

                          return displayEntries.map((entry: ViewVoucherEntry) => (
                            <TableRow key={entry.id}>
                              <TableCell>
                                <div className="font-medium">
                                  {entry.accountName}
                                </div>
                                {(selectedVoucher.voucherType === "Payment" ||
                                  selectedVoucher.voucherType === "Receipt" ||
                                  selectedVoucher.voucherType === "Journal") && (
                                  <div className="text-xs text-muted-foreground mt-0.5">
                                    Balance: {formatAmount(entryBalances[entry.id] ?? "0")}
                                  </div>
                                )}
                              </TableCell>
                              {selectedVoucher.voucherType === "Payment" ||
                              selectedVoucher.voucherType === "Receipt" ||
                              selectedVoucher.voucherType === "Journal" ? (
                                <TableCell className="text-right font-mono">
                                  {formatAmount(
                                    Math.max(
                                      parseFloat(entry.debitAmount || "0"),
                                      parseFloat(entry.creditAmount || "0"),
                                    ),
                                  )}
                                </TableCell>
                              ) : (
                                <>
                                  <TableCell className="text-right font-mono">
                                    {parseFloat(entry.debitAmount) > 0
                                      ? formatAmount(entry.debitAmount)
                                      : "-"}
                                  </TableCell>
                                  <TableCell className="text-right font-mono">
                                    {parseFloat(entry.creditAmount) > 0
                                      ? formatAmount(entry.creditAmount)
                                      : "-"}
                                  </TableCell>
                                  <TableCell className="text-sm text-muted-foreground">
                                    {entry.narration || "-"}
                                  </TableCell>
                                </>
                              )}
                            </TableRow>
                          ));
                        })()}
                        {/* Totals Row */}
                        <TableRow className="font-bold bg-muted/50">
                          {selectedVoucher.voucherType === "Consumption" ||
                          selectedVoucher.voucherType === "Production" ||
                          selectedVoucher.voucherType === "Stock Transfer" ||
                          selectedVoucher.voucherType === "StockTransfer" ? (
                            <>
                              <TableCell>Total</TableCell>
                              <TableCell className="text-right font-mono">
                                {viewVoucherEntries
                                  .reduce(
                                    (sum: number, e: ViewVoucherEntry) =>
                                      sum +
                                      Math.abs(parseFloat(e.quantity || "0")),
                                    0,
                                  )
                                  .toFixed(3)}
                              </TableCell>
                              {user && !user?.role?.startsWith("POS") && (
                                <>
                                  <TableCell></TableCell>
                                  <TableCell className="text-right font-mono">
                                    {formatAmount(
                                      viewVoucherEntries.reduce((sum: number, e: ViewVoucherEntry) => {
                                        if (e.totalAmount != null) {
                                          return (
                                            sum +
                                            Math.abs(parseFloat(e.totalAmount))
                                          );
                                        }
                                        const qty = Math.abs(
                                          parseFloat(e.quantity || "0"),
                                        );
                                        const rate =
                                          e.rate != null
                                            ? parseFloat(e.rate)
                                            : 0;
                                        return sum + qty * rate;
                                      }, 0),
                                    )}
                                  </TableCell>
                                </>
                              )}
                            </>
                          ) : selectedVoucher.voucherType === "Payment" ||
                            selectedVoucher.voucherType === "Receipt" ||
                            selectedVoucher.voucherType === "Journal" ? (
                            <>
                              <TableCell>Total</TableCell>
                              <TableCell className="text-right font-mono">
                                {formatAmount(
                                  Math.max(
                                    viewVoucherEntries.reduce(
                                      (sum: number, e: ViewVoucherEntry) =>
                                        sum + parseFloat(e.debitAmount || "0"),
                                      0,
                                    ),
                                    viewVoucherEntries.reduce(
                                      (sum: number, e: ViewVoucherEntry) =>
                                        sum + parseFloat(e.creditAmount || "0"),
                                      0,
                                    ),
                                  ),
                                )}
                              </TableCell>
                            </>
                          ) : (
                            <>
                              <TableCell>Total</TableCell>
                              <TableCell className="text-right font-mono">
                                {formatAmount(
                                  viewVoucherEntries.reduce(
                                    (sum: number, e: ViewVoucherEntry) =>
                                      sum + parseFloat(e.debitAmount || "0"),
                                    0,
                                  ),
                                )}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatAmount(
                                  viewVoucherEntries.reduce(
                                    (sum: number, e: ViewVoucherEntry) =>
                                      sum + parseFloat(e.creditAmount || "0"),
                                    0,
                                  ),
                                )}
                              </TableCell>
                              <TableCell></TableCell>
                            </>
                          )}
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Voucher Dialog */}
      <Dialog
        open={editDialogOpen}
        onOpenChange={(open) => {
          setEditDialogOpen(open);
          if (!open) {
            setEditFormInitialized(false);
          }
        }}
      >
        <DialogContent className="w-full max-w-[95vw] md:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Voucher</DialogTitle>
            <DialogDescription>
              Edit all voucher details. Debits must equal credits.
            </DialogDescription>
          </DialogHeader>
          {voucherToEdit && !entriesLoading && (
            <Form {...editForm}>
              <form
                onSubmit={editForm.handleSubmit(handleSaveEdit)}
                className="space-y-4"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">
                      Voucher Number
                    </p>
                    <p className="font-mono font-medium">
                      {voucherToEdit.voucherNumber}
                    </p>
                  </div>

                  <FormField
                    control={editForm.control}
                    name="voucherDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            {...field}
                            data-testid="input-edit-voucher-date"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={editForm.control}
                    name="voucherType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-edit-voucher-type">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Journal">Journal</SelectItem>
                            <SelectItem value="Payment">Payment</SelectItem>
                            <SelectItem value="Receipt">Receipt</SelectItem>
                            <SelectItem value="Stock Transfer">
                              Stock Transfer
                            </SelectItem>
                            <SelectItem value="Sales">Sales</SelectItem>
                            <SelectItem value="Purchase">Purchase</SelectItem>
                            <SelectItem value="Contra">Contra</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={editForm.control}
                    name="optional"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-md border p-3 space-y-0">
                        <div className="space-y-0.5">
                          <FormLabel className="text-sm">Optional</FormLabel>
                          <div className="text-xs text-muted-foreground">
                            Does not affect books
                          </div>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-edit-optional"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={editForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="Enter voucher description (optional)"
                          rows={2}
                          data-testid="textarea-edit-description"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Entry Rows */}
                <div className="border rounded-md p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Voucher Entries</h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        editAppend({
                          accountType: "ledger",
                          accountId: 0,
                          accountName: "",
                          debitAmount: "0",
                          creditAmount: "0",
                          narration: "",
                        })
                      }
                      data-testid="button-edit-add-entry"
                      className="gap-1"
                    >
                      <Plus className="w-4 h-4" />
                      Add Entry
                    </Button>
                  </div>

                  {editFields.map((field, index) => (
                    <div
                      key={field.id}
                      className="border rounded-md p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-muted-foreground">
                          Entry {index + 1}
                        </span>
                        {editFields.length > 2 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => editRemove(index)}
                            data-testid={`button-edit-remove-entry-${index}`}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>

                      <FormField
                        control={editForm.control}
                        name={`entries.${index}.accountType`}
                        render={({ field: typeField }) => (
                          <FormItem>
                            <FormLabel>Account</FormLabel>
                            <FormControl>
                              <AccountCombobox
                                value={
                                  editForm.watch(`entries.${index}.accountId`)
                                    ? {
                                        type: typeField.value,
                                        id: editForm.watch(
                                          `entries.${index}.accountId`,
                                        ),
                                        name: editForm.watch(
                                          `entries.${index}.accountName`,
                                        ),
                                      }
                                    : null
                                }
                                onChange={(type, id, name) => {
                                  editForm.setValue(
                                    `entries.${index}.accountType`,
                                    type,
                                  );
                                  editForm.setValue(
                                    `entries.${index}.accountId`,
                                    id,
                                  );
                                  editForm.setValue(
                                    `entries.${index}.accountName`,
                                    name,
                                  );
                                }}
                                ledgerAccounts={ledgerAccounts}
                                bankAccounts={bankAccounts}
                                suppliers={suppliers}
                                employees={employees}
                                fixedAssets={fixedAssets}
                                rowIndex={index}
                                testIdPrefix="button-edit-account"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {editForm.watch("voucherType") === "Payment" ||
                      editForm.watch("voucherType") === "Receipt" ? (
                        <FormItem>
                          <FormLabel>Amount</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              className="font-mono"
                              data-testid={`input-edit-amount-${index}`}
                              value={
                                parseFloat(
                                  editForm.watch(
                                    `entries.${index}.debitAmount`,
                                  ) || "0",
                                ) > 0
                                  ? editForm.watch(
                                      `entries.${index}.debitAmount`,
                                    )
                                  : editForm.watch(
                                      `entries.${index}.creditAmount`,
                                    ) || ""
                              }
                              onChange={(e) => {
                                const voucherType =
                                  editForm.watch("voucherType");
                                if (voucherType === "Payment") {
                                  editForm.setValue(
                                    `entries.${index}.debitAmount`,
                                    e.target.value,
                                  );
                                  editForm.setValue(
                                    `entries.${index}.creditAmount`,
                                    "0",
                                  );
                                } else {
                                  editForm.setValue(
                                    `entries.${index}.creditAmount`,
                                    e.target.value,
                                  );
                                  editForm.setValue(
                                    `entries.${index}.debitAmount`,
                                    "0",
                                  );
                                }
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      ) : (
                        <>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <FormField
                              control={editForm.control}
                              name={`entries.${index}.debitAmount`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Debit Amount</FormLabel>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      className="font-mono"
                                      data-testid={`input-edit-debit-${index}`}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={editForm.control}
                              name={`entries.${index}.creditAmount`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Credit Amount</FormLabel>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      className="font-mono"
                                      data-testid={`input-edit-credit-${index}`}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>

                          <FormField
                            control={editForm.control}
                            name={`entries.${index}.narration`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Narration (Optional)</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder="Enter narration"
                                    data-testid={`input-edit-narration-${index}`}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </>
                      )}
                    </div>
                  ))}

                  {/* Totals Display */}
                  {editForm.watch("entries") &&
                    editForm.watch("entries").length > 0 && (
                      <div className="mt-4 pt-4 border-t">
                        {editForm.watch("voucherType") === "Payment" ||
                        editForm.watch("voucherType") === "Receipt" ? (
                          <div className="text-right text-sm font-mono">
                            <span className="text-muted-foreground mr-2">
                              Total:
                            </span>
                            <span className="font-bold">
                              $
                              {formatAmount(
                                Math.max(
                                  editForm
                                    .watch("entries")
                                    .reduce(
                                      (sum, e) =>
                                        sum + parseFloat(e?.debitAmount || "0"),
                                      0,
                                    ),
                                  editForm
                                    .watch("entries")
                                    .reduce(
                                      (sum, e) =>
                                        sum +
                                        parseFloat(e?.creditAmount || "0"),
                                      0,
                                    ),
                                ),
                              )}
                            </span>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm font-mono">
                            <div className="text-right">
                              <span className="text-muted-foreground mr-2">
                                Total Debits:
                              </span>
                              <span className="font-bold">
                                $
                                {formatAmount(
                                  editForm
                                    .watch("entries")
                                    .reduce(
                                      (sum, e) =>
                                        sum + parseFloat(e?.debitAmount || "0"),
                                      0,
                                    ),
                                )}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="text-muted-foreground mr-2">
                                Total Credits:
                              </span>
                              <span className="font-bold">
                                $
                                {formatAmount(
                                  editForm
                                    .watch("entries")
                                    .reduce(
                                      (sum, e) =>
                                        sum +
                                        parseFloat(e?.creditAmount || "0"),
                                      0,
                                    ),
                                )}
                              </span>
                            </div>
                          </div>
                        )}
                        {editForm.formState.errors.entries && (
                          <p className="text-sm text-destructive mt-2 text-center">
                            {editForm.formState.errors.entries.message}
                          </p>
                        )}
                      </div>
                    )}
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditDialogOpen(false)}
                    data-testid="button-cancel-edit"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={editMutation.isPending}
                    data-testid="button-save-edit"
                  >
                    {editMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </form>
            </Form>
          )}
          {entriesLoading && (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Offload View Dialog */}
      <Dialog open={offloadViewOpen} onOpenChange={setOffloadViewOpen}>
        <DialogContent className="w-full max-w-[95vw] md:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Offload Details</DialogTitle>
            <DialogDescription>
              {selectedOffload ? `Container ${selectedOffload.containerNumber}` : ""}
            </DialogDescription>
          </DialogHeader>
          {selectedOffload && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Date</p>
                  <p className="font-medium">{formatDisplayDate(parseISO(selectedOffload.offloadedAt.slice(0, 10)))}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Container</p>
                  <p className="font-medium">{selectedOffload.containerNumber}</p>
                </div>
                {selectedOffload.locationName && (
                  <div>
                    <p className="text-sm text-muted-foreground">Location</p>
                    <p className="font-medium">{selectedOffload.locationName}</p>
                  </div>
                )}
              </div>

              {offloadDetailLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : offloadDetail?.items && offloadDetail.items.length > 0 ? (
                <div>
                  <p className="text-sm font-medium mb-2">Stock Items</p>
                  <div className="border rounded-md overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/40">
                          <th className="text-left p-3 font-medium">Item</th>
                          <th className="text-right p-3 font-medium">Qty</th>
                          <th className="text-right p-3 font-medium">Rate</th>
                          <th className="text-right p-3 font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {offloadDetail.items.map((item) => (
                          <tr key={item.id} className="border-b last:border-0">
                            <td className="p-3">{item.stockItemName || item.stockItemCode || `Item #${item.stockItemId}`}</td>
                            <td className="p-3 text-right font-mono">{formatNumber(Number(item.quantity))}</td>
                            <td className="p-3 text-right font-mono">{formatAmount(Number(item.rate))}</td>
                            <td className="p-3 text-right font-mono">{formatAmount(Number(item.totalValue))}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 bg-muted/20 font-medium">
                          <td className="p-3">Total</td>
                          <td className="p-3 text-right font-mono">{formatNumber(offloadDetail.items.reduce((s, i) => s + Number(i.quantity), 0))}</td>
                          <td></td>
                          <td className="p-3 text-right font-mono">{formatAmount(offloadDetail.items.reduce((s, i) => s + Number(i.totalValue), 0))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm mt-3">
                    <div>
                      <p className="text-muted-foreground">Total Bales</p>
                      <p className="font-medium font-mono">{formatNumber(Number(selectedOffload.totalBales))}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Additional Cost / Bale</p>
                      <p className="font-medium font-mono">{formatAmount(Number(selectedOffload.additionalCostPerBale))}</p>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="border rounded-md">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left p-3 font-medium">Charge</th>
                      <th className="text-right p-3 font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Number(selectedOffload.duties) !== 0 && (
                      <tr className="border-b">
                        <td className="p-3">Duties</td>
                        <td className="p-3 text-right font-mono">{formatAmount(Number(selectedOffload.duties))}</td>
                      </tr>
                    )}
                    {Number(selectedOffload.officeCharges) !== 0 && (
                      <tr className="border-b">
                        <td className="p-3">Office Charges</td>
                        <td className="p-3 text-right font-mono">{formatAmount(Number(selectedOffload.officeCharges))}</td>
                      </tr>
                    )}
                    {Number(selectedOffload.transferCharges) !== 0 && (
                      <tr className="border-b">
                        <td className="p-3">Transfer Charges</td>
                        <td className="p-3 text-right font-mono">{formatAmount(Number(selectedOffload.transferCharges))}</td>
                      </tr>
                    )}
                    {Number(selectedOffload.transportFees) !== 0 && (
                      <tr className="border-b">
                        <td className="p-3">Transport Fees</td>
                        <td className="p-3 text-right font-mono">{formatAmount(Number(selectedOffload.transportFees))}</td>
                      </tr>
                    )}
                    <tr className="bg-muted/20 font-medium">
                      <td className="p-3">Total Charges</td>
                      <td className="p-3 text-right font-mono">{formatAmount(Number(selectedOffload.totalCharges))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => { setOffloadViewOpen(false); navigate(`/containers/${selectedOffload.containerId}`); }}
                  data-testid="button-goto-container-dialog"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open Container
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete voucher{" "}
              <span className="font-mono font-semibold">
                {voucherToDelete?.voucherNumber}
              </span>
              . This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
