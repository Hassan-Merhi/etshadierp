import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { ExchangeRateInput } from "@/components/ExchangeRateInput";
import { formatNumber } from "@/lib/formatNumber";
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
import { CreditNoteTab } from "@/components/vouchers/CreditNoteTab";
import { CreateAccountModal } from "@/components/vouchers/CreateAccountModal";
import { PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import { queryClient, keyStartsWith } from "@/lib/queryClient";
import { useAppMode, useModePrefix } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { useFormDraft } from "@/hooks/useFormDraft";
import { DraftRestorePrompt } from "@/components/DraftRestorePrompt";
import { CalendarIcon, Printer, Plus, Check, ChevronsUpDown, Pencil, Upload, FileSpreadsheet, Download, CheckCircle, AlertTriangle, XCircle, X, Search, ChevronDown, ChevronUp, FileDown, Loader2, ArrowDownCircle, ArrowUpCircle, BookOpen, ArrowLeftRight, SlidersHorizontal, FileText, LayoutGrid, ClipboardList, GitBranch, History } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { utils, writeFile } from "@/lib/excelHelper";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import StockTransferOrder from "@/pages/StockTransferOrder";
import { AccountCombobox } from "@/components/vouchers/AccountCombobox";
import { StockItemCombobox } from "@/components/vouchers/StockItemCombobox";
import { PrintTemplate, parseDateLocal } from "@/components/vouchers/PrintTemplate";

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

interface Customer {
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

interface FactorySupplierBasic {
  id: number;
  name: string;
  parentId: number | null;
}

interface VoucherEntry {
  accountType: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset" | "customer" | "factorySupplier";
  accountId: number;
  accountName: string;
  amount: string;
}

interface JournalEntry {
  type: "DR" | "CR";
  accountType: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset" | "customer" | "factorySupplier";
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
  code?: string;
  name: string;
}

interface StockTransferEntry {
  sourceLocationId: number;
  sourceLocationName: string;
  stockItemId: number;
  stockItemCode: string;
  stockItemName: string;
  quantity: string;
  rate: string;
}

interface StockAdjustmentEntry {
  stockItemId: number;
  stockItemCode: string;
  stockItemName: string;
  quantity: string;
  rate: string;
}

const voucherEntrySchema = z.object({
  accountType: z.enum(["ledger", "bank", "supplier", "employee", "fixedAsset", "customer", "factorySupplier"]),
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
  accountType: z.enum(["ledger", "bank", "supplier", "employee", "fixedAsset", "customer", "factorySupplier"]),
  accountId: z.number().min(1, "Please select an account"),
  accountName: z.string(),
  amount: z.string()
    .min(1, "Amount required")
    .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
      message: "Amount must be a positive number",
    }),
  narration: z.string().optional(),
});

const voucherFormSchema = z.object({
  paymentAccountType: z.enum(["ledger", "bank", "supplier", "employee", "fixedAsset", "customer", "factorySupplier"]),
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
  sourceLocationId: z.coerce.number(), // Coerce to handle strings, validated in onStockTransferSubmit
  sourceLocationName: z.string(),
  stockItemId: z.coerce.number(),
  stockItemCode: z.string().default(""),
  stockItemName: z.string(),
  quantity: z.string(),
  rate: z.string(),
});

const stockTransferFormSchema = z.object({
  voucherDate: z.date(),
  destinationLocationId: z.number(),
  entries: z.array(stockTransferEntrySchema),
  notes: z.string().optional(),
  optional: z.boolean().default(false),
});

const stockAdjustmentEntrySchema = z.object({
  type: z.enum(["CONSUME", "PRODUCE"]),
  stockItemId: z.number().min(1, "Please select a stock item"),
  stockItemCode: z.string().default(""),
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
export default function Vouchers({ posUser }: VouchersProps = {}) {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const isFactoryCompany = selectedCompany?.companyType === "factory";
  const { data: myErpPages } = useQuery<{ hiddenErpCostFields?: string[] }>({ queryKey: ["/api/my-erp-pages"] });
  const hideVoucherAmounts = (myErpPages?.hiddenErpCostFields ?? []).includes("voucher_amounts");
  const [isAutoCreating, setIsAutoCreating] = useState(false);
  const { formatDisplayDate } = useDateFormat();
  const { formatAmount, selectedCurrency, convertToUSD, exchangeRate: dailyExchangeRate } = useCurrencyContext();
  // Transaction-specific exchange rate (allows override of daily rate for rate-locking)
  const [transactionRate, setTransactionRate] = useState<number | null>(null);
  // Use transaction rate if set, otherwise fall back to daily rate
  const exchangeRate = transactionRate || dailyExchangeRate;
  const [location, setLocation] = useLocation();
  const printRef = useRef<HTMLDivElement>(null);
  const hydratedVoucherIdRef = useRef<number | null>(null);
  const isPOS = !!posUser;
  const posLocationId = posUser?.assignedLocationId;

  const sidebarGroups: { label: string; color: string; items: { key: string; label: string; icon: LucideIcon }[] }[] = [
    {
      label: "Financial",
      color: "#3b82f6",
      items: [
        { key: "payment", label: "Payment", icon: ArrowDownCircle },
        { key: "receipt", label: "Receipt", icon: ArrowUpCircle },
        { key: "journal", label: "Journal", icon: BookOpen },
      ],
    },
    {
      label: "Adjustments",
      color: "#f59e0b",
      items: [
        { key: "transfer", label: "Stock Transfer", icon: ArrowLeftRight },
        { key: "transferorder", label: "Transfer Order", icon: ClipboardList },
        { key: "adjustment", label: "Adjustment", icon: SlidersHorizontal },
        { key: "creditnote", label: "Credit Note", icon: FileText },
      ],
    },
  ];

  // Parse URL parameters for edit mode (use window.location.search since wouter doesn't include query params)
  const searchParams = new URLSearchParams(window.location.search);
  const editParam = searchParams.get('edit');
  const tabParam = searchParams.get('tab');
  const voucherIdToEdit = editParam ? parseInt(editParam) : null;
  
  const [activeTab, setActiveTab] = useState<"payment" | "receipt" | "journal" | "transfer" | "transferorder" | "adjustment" | "creditnote">(
    (tabParam as any) || "payment"
  );
  const [editVoucherId, setEditVoucherId] = useState<number | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  // Suppliers and customers are deferred until the user opens an account picker
  // or an existing voucher is being edited. Declared before the queries so we
  // can reference it in the enabled flags.
  // Lazy initializer: when voucherIdToEdit is already in the URL on mount
  // (edit mode), start as true so suppliers/customers fetch on the FIRST
  // render — before the hydration effect runs — avoiding a hydration race.
  const [accountPickersNeeded, setAccountPickersNeeded] = useState(() => !!voucherIdToEdit);

  const isFactoryMode = appMode === "factory";
  const visibleSidebarGroups = isFactoryMode
    ? sidebarGroups.filter((g) => g.label !== "Adjustments")
    : sidebarGroups;
  const modePrefix = useModePrefix();

  // Handle opening voucher for editing
  const handleEditVoucher = async (voucherId: number) => {
    setLocation(`${modePrefix}/vouchers/${voucherId}/edit`);
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
      hydratedVoucherIdRef.current = null;
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
  const [waPendingPrompt, setWaPendingPrompt] = useState<{ accountId: number; month: string } | null>(null);

  // Fetch data - include selectedCompany?.id in query keys for proper cache invalidation on company switch
  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({
    queryKey: ["/api/bank-accounts", selectedCompany?.id],
  });

  const { data: ledgerAccounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger-accounts", selectedCompany?.id],
  });

  // Suppliers and customers are deferred until the user opens an account picker
  // (payment sidebar, receipt sidebar, or journal entry row) or edits an
  // existing voucher. Two useEffects below set accountPickersNeeded when those
  // triggers fire; staleTime prevents re-fetches on subsequent navigation.
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers", selectedCompany?.id],
    enabled: accountPickersNeeded && !!selectedCompany,
    staleTime: 5 * 60 * 1000,
  });

  const { data: factorySuppliersList = [] } = useQuery<FactorySupplierBasic[]>({
    queryKey: ["/api/factory/suppliers", selectedCompany?.id],
    enabled: isFactoryCompany,
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers", selectedCompany?.id],
    enabled: accountPickersNeeded && !!selectedCompany,
    staleTime: 5 * 60 * 1000,
  });

  // Only load stock items and locations when the user is on a tab that needs them.
  // The default tab is "payment" — deferring these avoids 2 large queries on every page open.
  const needsStockData = isPOS || activeTab === "transfer" || activeTab === "transferorder" || activeTab === "adjustment";
  const { data: stockItems = [] } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items", selectedCompany?.id],
    enabled: needsStockData,
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations", selectedCompany?.id],
    enabled: needsStockData,
  });

  // Get POS user's location name for auto-populating source location
  const posLocation = isPOS && posLocationId ? locations.find(l => l.id === posLocationId) : null;
  const posLocationName = posLocation?.name || "";

  // Fetch all locations this POS user has access to (for multi-location source selection)
  const { data: myLocations = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/my-locations"],
    enabled: isPOS,
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees", selectedCompany?.id],
  });

  const { data: fixedAssets = [] } = useQuery<FixedAsset[]>({
    queryKey: ["/api/fixed-assets", selectedCompany?.id],
  });

  // Live search state for supplier/customer lookup from account pickers.
  // Updated by the "pay from" AccountAutocomplete (via onAccountSearchChange prop)
  // and by the journal account search term (via useEffect below).
  const [liveAccountSearch, setLiveAccountSearch] = useState("");
  const [debouncedAccountSearch, setDebouncedAccountSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedAccountSearch(liveAccountSearch), 300);
    return () => clearTimeout(timer);
  }, [liveAccountSearch]);

  // Fetch matching suppliers/customers when the user types ≥2 chars in any
  // account picker. Results are merged into allAccounts below.
  // Explicit queryFn required so that ?search= is included — the global fetcher
  // only uses queryKey[0] as the URL which would strip the search parameter.
  const { data: supplierSearchResults = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers", "live-search", debouncedAccountSearch, selectedCompany?.id],
    enabled: debouncedAccountSearch.length >= 2 && !!selectedCompany,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const res = await fetch(
        `/api/suppliers?search=${encodeURIComponent(debouncedAccountSearch)}&limit=50`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to search suppliers");
      return res.json();
    },
  });
  const { data: customerSearchResults = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers", "live-search", debouncedAccountSearch, selectedCompany?.id],
    enabled: debouncedAccountSearch.length >= 2 && !!selectedCompany,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const res = await fetch(
        `/api/customers?search=${encodeURIComponent(debouncedAccountSearch)}&limit=50`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to search customers");
      return res.json();
    },
  });

  // Activate supplier/customer loading when editing an existing voucher.
  useEffect(() => {
    if (voucherIdToEdit) setAccountPickersNeeded(true);
  }, [voucherIdToEdit]);

  // Activate when any entry row becomes active (entry rows always expose the
  // account picker). activeRowIndex is declared before the queries so is safe here.
  useEffect(() => {
    if (activeRowIndex !== null) setAccountPickersNeeded(true);
  }, [activeRowIndex]);

  // Activate supplier/customer loading when the payment/receipt account sidebar
  // opens — sidebarSearchValue is set (to the current account name or "") when the
  // user focuses the account-name input inside PaymentReceiptTab/VoucherEntriesTable.
  // Also covers the "pay from" sidebar opening when user types to search.
  useEffect(() => {
    if (sidebarSearchValue !== "") setAccountPickersNeeded(true);
  }, [sidebarSearchValue]);

  // Fetch accounts for sidebar (with balances)
  const { data: sidebarAccounts = [] } = useQuery<Account[]>({
    queryKey: ["/api/accounts/voucher-sidebar", selectedCompany?.id],
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
    staleTime: 15000,
  });

  // Stable transfer ID ref — prevents revision query key from going undefined during
  // background refetch of stockTransferToEdit, which would cause transferRevisions to
  // flash empty and collapse the revision history panel.
  const lastKnownTransferIdRef = useRef<number | null>(null);
  if (stockTransferToEdit?.id) lastKnownTransferIdRef.current = stockTransferToEdit.id;
  const stableTransferId = stockTransferToEdit?.id ?? lastKnownTransferIdRef.current;

  // Fetch revisions for stock transfer being edited
  const { data: transferRevisions = [] } = useQuery<any[]>({
    queryKey: ["/api/stock-transfers", stableTransferId, "revisions"],
    queryFn: async () => {
      const res = await fetch(`/api/stock-transfers/${stableTransferId}/revisions`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch revisions");
      return res.json();
    },
    enabled: !!stableTransferId,
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
      // Merge live search results that are not already in the preloaded list.
      // When accountPickersNeeded=false (initial load), suppliers/customers are
      // empty so search results are the only source for those account types.
      ...supplierSearchResults
        .filter(s => !suppliers.find(p => p.id === s.id))
        .map((s) => ({
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
      ...customers.map((c: any) => ({
        type: "customer" as const,
        id: c.id,
        name: c.legalName,
        code: c.code,
        openingBalance: c.openingBalance,
      })),
      ...customerSearchResults
        .filter((c: any) => !customers.find((p: any) => p.id === c.id))
        .map((c: any) => ({
          type: "customer" as const,
          id: c.id,
          name: c.legalName,
          code: c.code,
          openingBalance: c.openingBalance,
        })),
      ...factorySuppliersList.map((s) => ({
        type: "factorySupplier" as const,
        id: s.id,
        name: s.name,
        code: String(s.id),
      })),
    ];
    return accounts.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [ledgerAccounts, bankAccounts, suppliers, supplierSearchResults, employees, fixedAssets, customers, customerSearchResults, factorySuppliersList]);

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
  const watchedEntries = useWatch({ control: form.control, name: "entries" });
  const total = entries.reduce(
    (sum, entry) => sum + (parseFloat(entry.amount) || 0),
    0
  );

  // Original total of the voucher being edited — used for projected-balance correction.
  // voucherToEdit.totalAmount is the server-side total before any edits begin.
  const originalTotal = useMemo(() => {
    if (!voucherIdToEdit || !voucherToEdit) return 0;
    const parsed = parseFloat(String(voucherToEdit.totalAmount ?? "0"));
    return isNaN(parsed) ? 0 : parsed;
  }, [voucherIdToEdit, voucherToEdit]);

  // Draft autosave for new vouchers (not edit mode)
  const paymentDraftMode = isFactoryMode ? "factory" : "erp";
  const paymentDraftType = activeTab === "payment" ? "voucher-payment" : "voucher-receipt";
  const { hasDraft: hasPaymentDraft, draftAge: paymentDraftAge, draft: paymentDraft, scheduleSave: schedulePaymentSave, discardDraft: discardPaymentDraft } = useFormDraft({
    entityType: paymentDraftType,
    mode: paymentDraftMode,
    companyId: selectedCompany?.id ?? null,
    enabled: !voucherIdToEdit,
  });

  const allFormValues = form.watch();
  useEffect(() => {
    if (voucherIdToEdit) return;
    schedulePaymentSave(allFormValues);
  }, [JSON.stringify(allFormValues), voucherIdToEdit]);

  // Pre-populate form when editing
  useEffect(() => {
    if (voucherToEdit && voucherToEdit.entries && allAccounts.length > 0) {
      if (hydratedVoucherIdRef.current === voucherToEdit.id) return;
      // Wait for factorySuppliersList to load if any entry references one
      const needsFactorySuppliers = voucherToEdit.entries.some((e: any) => e.factorySupplierId);
      if (needsFactorySuppliers && factorySuppliersList.length === 0) return;
      // Identify the payment account entry.
      // For asset-type payment accounts: Payment=CR, Receipt=DR
      // For liability-type payment accounts (supplier/employee): Payment=DR, Receipt=CR
      // We identify the payment entry by finding a pair of entries (same amount) and picking
      // the one that matches the expected pattern. For simplicity, group entries by amount
      // and identify by account type.
      const allEntries = voucherToEdit.entries;
      let paymentEntry: any = null;

      // Try to find the payment account entry:
      // In a standard voucher, entries come in pairs. The payment account entry is:
      // - For Payment: the entry with CR > 0 (or DR > 0 if supplier/employee)
      // - For Receipt: the entry with DR > 0 (or CR > 0 if supplier/employee)
      // Since we can't easily distinguish, use the heuristic: for each pair, 
      // the payment account tends to be bank/cash or the one that appears in both entries of a pair.
      // Simpler approach: find entries where the amount appears exactly twice (a pair),
      // and pick based on account type priority (bank > ledger > supplier > employee)
      if (voucherToEdit.voucherType === "Payment") {
        // Payment: Pay From is the account money leaves from.
        // Standard case: non-liability (cash/bank/ledger) with CR > 0.
        // Fallback: liability (supplier/employee/factorySupplier) with DR > 0 (paying down a liability).
        paymentEntry = allEntries.find((entry: any) => {
          const cr = parseFloat(entry.creditAmount || "0");
          const isLiability = entry.supplierId || entry.employeeId || entry.factorySupplierId;
          return !isLiability && cr > 0;
        });
        if (!paymentEntry) {
          paymentEntry = allEntries.find((entry: any) => {
            const dr = parseFloat(entry.debitAmount || "0");
            const isLiability = entry.supplierId || entry.employeeId || entry.factorySupplierId;
            return isLiability && dr > 0;
          });
        }
      } else if (voucherToEdit.voucherType === "Receipt") {
        // Receipt: Pay Into is the account money arrives in.
        // Standard case: non-liability (cash/bank/ledger) with DR > 0.
        // Fallback: liability (supplier/employee/factorySupplier) with CR > 0.
        paymentEntry = allEntries.find((entry: any) => {
          const dr = parseFloat(entry.debitAmount || "0");
          const isLiability = entry.supplierId || entry.employeeId || entry.factorySupplierId;
          return !isLiability && dr > 0;
        });
        if (!paymentEntry) {
          paymentEntry = allEntries.find((entry: any) => {
            const cr = parseFloat(entry.creditAmount || "0");
            const isLiability = entry.supplierId || entry.employeeId || entry.factorySupplierId;
            return isLiability && cr > 0;
          });
        }
      }

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
      } else if (paymentEntry.factorySupplierId) {
        paymentType = "factorySupplier";
        paymentId = paymentEntry.factorySupplierId;
        const fs = factorySuppliersList.find(s => s.id === paymentId);
        paymentName = fs?.name || "";
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

      // Identify the Pay From account's identity to filter duplicate Pay From entries
      const payFromCustomerId = paymentEntry.customerId || null;
      const payFromLedgerId = paymentEntry.ledgerAccountId || null;
      const payFromBankId = paymentEntry.bankAccountId || null;
      const payFromSupplierId = paymentEntry.supplierId || null;
      const payFromFactorySupplierId = paymentEntry.factorySupplierId || null;
      const payFromEmployeeId = paymentEntry.employeeId || null;

      // Convert contra entries (all entries except payment entry and duplicate Pay From entries) to form format
      const formEntries = voucherToEdit.entries
        .filter((entry: any) => {
          if (entry === paymentEntry) return false;
          // Exclude duplicate Pay From entries (same account, same side as paymentEntry)
          if (payFromLedgerId && entry.ledgerAccountId === payFromLedgerId) return false;
          if (payFromBankId && entry.bankAccountId === payFromBankId) return false;
          if (payFromSupplierId && entry.supplierId === payFromSupplierId) return false;
          if (payFromFactorySupplierId && entry.factorySupplierId === payFromFactorySupplierId) return false;
          if (payFromEmployeeId && entry.employeeId === payFromEmployeeId) return false;
          if (payFromCustomerId && entry.customerId === payFromCustomerId) return false;
          return true;
        })
        .map((entry: any) => {
        let accountType: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset" | "customer" | "factorySupplier" = "ledger";
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
        } else if (entry.factorySupplierId) {
          accountType = "factorySupplier";
          accountId = entry.factorySupplierId;
          const fs = factorySuppliersList.find(s => s.id === accountId);
          accountName = fs?.name || "";
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
        } else if (entry.customerId) {
          accountType = "customer";
          accountId = entry.customerId;
          const customer = customers.find(c => c.id === accountId);
          accountName = customer?.legalName || "";
        }

        // Extract the amount from the contra entry
        // For asset payment accounts: Payment contra=DR, Receipt contra=CR
        // For liability payment accounts: Payment contra=CR, Receipt contra=DR
        const isLiabilityPayment = paymentEntry.supplierId || paymentEntry.employeeId || paymentEntry.customerId || paymentEntry.factorySupplierId;
        if (voucherToEdit.voucherType === "Payment") {
          amount = isLiabilityPayment ? (entry.creditAmount || "0") : (entry.debitAmount || "0");
        } else if (voucherToEdit.voucherType === "Receipt") {
          amount = isLiabilityPayment ? (entry.debitAmount || "0") : (entry.creditAmount || "0");
        }

        return {
          accountType,
          accountId,
          accountName,
          amount,
        };
      })
      .filter((entry: any) => parseFloat(entry.amount || "0") > 0); // exclude zero-amount entries

      // Reset form with voucher data
      form.reset({
        paymentAccountType: paymentType as any,
        paymentAccountId: paymentId,
        paymentAccountName: paymentName,
        voucherDate: parseDateLocal(voucherToEdit.voucherDate),
        entries: formEntries.length > 0 ? formEntries : [{
          accountType: "ledger",
          accountId: 0,
          accountName: "",
          amount: "",
        }],
        notes: voucherToEdit.description || "",
        optional: voucherToEdit.optional || false,
      });
      
      hydratedVoucherIdRef.current = voucherToEdit.id;
      
      // Initialize transaction rate from voucher's rate-locked exchange rate
      if (voucherToEdit.exchangeRate) {
        setTransactionRate(parseFloat(voucherToEdit.exchangeRate));
      }
    }
  }, [voucherToEdit, allAccounts, bankAccounts, ledgerAccounts, suppliers, employees, fixedAssets, customers, factorySuppliersList, form]);

  // Get selected payment account - moved up to use in filtered accounts
  const paymentAccountType = form.watch("paymentAccountType");
  const paymentAccountId = form.watch("paymentAccountId");
  const paymentAccountName = form.watch("paymentAccountName");

  // Compute filtered accounts based on search (lifted from AccountSidebar)
  // Also exclude the currently selected payment account to prevent duplicate entries
  const filteredSidebarAccounts = useMemo(() => {
    const searchLower = sidebarSearchValue.toLowerCase().trim();
    return sidebarAccounts
      .filter((acc) => {
        // Never show customer accounts in the voucher account selector
        if (acc.type === "customer") return false;
        // Exclude the currently selected payment account from the entries list
        if (paymentAccountId > 0 && acc.id === paymentAccountId && acc.type === paymentAccountType) {
          return false;
        }
        // Only show employees when user is actively searching for them
        if (acc.type === "employee" && !searchLower) {
          return false;
        }
        return (acc.name || '').toLowerCase().includes(searchLower) ||
          (acc.code || '').toLowerCase().includes(searchLower);
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [sidebarAccounts, sidebarSearchValue, paymentAccountId, paymentAccountType]);

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
      } else if (paymentAccountType === "customer") {
        const customerRes = await fetch(`/api/customers/${paymentAccountId}`);
        const customer = await customerRes.json();
        const transRes = await fetch(`/api/accounts/customer/${paymentAccountId}/transactions`);
        const transactions = await transRes.json();
        const openingBalance = parseFloat(customer.openingBalance || "0");
        const balance = transactions.reduce((sum: number, t: any) => {
          const debit = parseFloat(t.debitAmount || "0");
          const credit = parseFloat(t.creditAmount || "0");
          return sum + debit - credit;
        }, openingBalance);
        return balance;
      } else if (paymentAccountType === "factorySupplier") {
        const res = await fetch(`/api/factory/suppliers/${paymentAccountId}/balance`);
        const data = await res.json();
        // outstandingUsd is positive when we owe them (payable). Return as positive so it
        // shows as a positive balance that gets reduced when making a payment.
        return parseFloat(data.outstandingUsd || "0");
      }
      return 0;
    },
  });

  // Per-currency balance breakdown for supplier and factorySupplier accounts
  const { data: accountCurrencyBalances } = useQuery<{ currency: string; balance: number }[] | null>({
    queryKey: ["/api/accounts", paymentAccountType, paymentAccountId, "currencyBalances"],
    enabled: paymentAccountId > 0 && (paymentAccountType === "supplier" || paymentAccountType === "factorySupplier"),
    queryFn: async () => {
      if (paymentAccountType === "supplier") {
        const [supplierRes, transRes] = await Promise.all([
          fetch(`/api/suppliers/${paymentAccountId}`, { credentials: "include" }),
          fetch(`/api/accounts/supplier/${paymentAccountId}/transactions`, { credentials: "include" }),
        ]);
        const supplier = await supplierRes.json();
        const transactions: any[] = await transRes.json();
        const openingBalance = parseFloat(supplier.openingBalance || "0");

        const currMap = new Map<string, number>();
        transactions.forEach((t) => {
          const curr = t.currency || "USD";
          const credit = parseFloat(t.creditAmount || "0");
          const debit = parseFloat(t.debitAmount || "0");
          currMap.set(curr, (currMap.get(curr) ?? 0) + credit - debit);
        });
        // Opening balance is in USD
        currMap.set("USD", (currMap.get("USD") ?? 0) + openingBalance);

        const result = Array.from(currMap.entries())
          .map(([currency, balance]) => ({ currency, balance }))
          .filter((r) => Math.abs(r.balance) >= 0.005);

        // Only return multi-currency array if there are non-USD currencies
        const hasNonUsd = result.some((r) => r.currency !== "USD");
        return hasNonUsd ? result : null;
      } else if (paymentAccountType === "factorySupplier") {
        const res = await fetch(`/api/factory/suppliers/${paymentAccountId}/broker-statement`, { credentials: "include" });
        if (!res.ok) return null;
        const data = await res.json();
        const ledgers: any[] = data.currencyLedgers || [];
        if (ledgers.length <= 1) return null;
        return ledgers
          .map((section: any) => ({
            currency: section.currencyCode,
            balance: parseFloat(section.netBalance || "0"),
          }))
          .filter((r) => Math.abs(r.balance) >= 0.005);
      }
      return null;
    },
  });

  // Save mutation (handles both create and update) - OPTIMIZED to use batch endpoint
  const saveMutation = useMutation({
    mutationFn: async (formData: VoucherFormData) => {
      const data = formData;
      const voucherType = activeTab === "payment" ? "Payment" : "Receipt";
      const isEditMode = !!voucherIdToEdit;

      // Prepare request payload - include exchange rate for rate-locking
      const autoDesc = data.notes?.trim()
        ? data.notes.trim()
        : `${voucherType} (${data.paymentAccountName || "—"})`;

      const payload = {
        voucherType,
        voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
        paymentAccountType: data.paymentAccountType,
        paymentAccountId: data.paymentAccountId,
        paymentAccountName: data.paymentAccountName,
        entries: data.entries,
        notes: autoDesc,
        optional: data.optional,
        currency: selectedCurrency,
        exchangeRate: exchangeRate ? exchangeRate.toString() : undefined,
      };

      // Use batch endpoint for both create and update
      if (isEditMode) {
        const res = await modeApiRequest("PATCH", `/api/vouchers/${voucherIdToEdit}/payment-receipt`, payload);
        return await res.json();
      } else {
        const res = await modeApiRequest("POST", "/api/vouchers/payment-receipt", payload);
        return await res.json();
      }
    },
    onSuccess: async (data: any) => {
      const isEditMode = !!voucherIdToEdit;
      toast({
        title: "Success",
        description: `${activeTab === "payment" ? "Payment" : "Receipt"} voucher ${isEditMode ? "updated" : "created"} successfully`,
      });
      if (data?.whatsapp?.prompt && data.whatsapp.accountId && data.whatsapp.month) {
        setWaPendingPrompt({ accountId: data.whatsapp.accountId, month: data.whatsapp.month });
      }
      discardPaymentDraft();
      
      // Invalidate only essential queries for faster saves
      // Balances are updated via voucher-sidebar, full account lists don't change
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/voucher-sidebar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", paymentAccountType, paymentAccountId, "balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers/stats", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/net-profit"] });
      
      // Clear edit mode and navigate back to daybook
      if (isEditMode) {
        setLocation(`${modePrefix}/daybook`);
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
    onError: (error: any, formData: VoucherFormData) => {
      if (error.name === "OfflineQueued") {
        const voucherType = activeTab === "payment" ? "Payment" : "Receipt";
        const voucherDate = format(formData.voucherDate, "yyyy-MM-dd");
        const totalAmount = formData.entries
          .filter((e: any) => parseFloat(e.amount || "0") > 0)
          .reduce((sum: number, e: any) => sum + parseFloat(e.amount || "0"), 0)
          .toFixed(2);
        const syntheticVoucher: any = {
          id: -Date.now(),
          voucherNumber: "PENDING",
          voucherType,
          voucherDate,
          description: formData.notes || `${voucherType} (pending sync)`,
          totalAmount,
          optional: formData.optional || false,
          createdAt: new Date().toISOString(),
        };
        queryClient.setQueriesData(
          { queryKey: ["/api/vouchers"] },
          (old: any) => Array.isArray(old) ? [syntheticVoucher, ...old] : old
        );
        discardPaymentDraft();
        form.reset({
          paymentAccountType: "ledger",
          paymentAccountId: 0,
          paymentAccountName: "",
          voucherDate: new Date(),
          entries: [{ accountType: "ledger", accountId: 0, accountName: "", amount: "" }],
          notes: "",
          optional: false,
        });
        return;
      }
      const isEditMode = !!voucherIdToEdit;
      if ((error as any)._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || `Failed to ${isEditMode ? "update" : "create"} voucher`,
        variant: "destructive",
      });
    },
  });

  const sendWaStatementMutation = useMutation({
    mutationFn: async ({ accountId, month }: { accountId: number; month: string }) => {
      const res = await modeApiRequest("POST", `/api/factory/accounts/${accountId}/send-statement-whatsapp`, { month });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to send WhatsApp");
      return json;
    },
    onSuccess: () => {
      toast({ title: "Statement sent to WhatsApp" });
      setWaPendingPrompt(null);
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "WhatsApp send failed", description: error.message, variant: "destructive" });
      setWaPendingPrompt(null);
    },
  });

  // Handle account selection from sidebar
  const handleSidebarAccountSelect = async (account: Account) => {
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
  const handleAmountCommit = async (rowIndex: number) => {
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

  // Handle opening the create account modal
  const handleOpenCreateAccountModal = async (tab: "payment" | "receipt" | "journal", rowIndex?: number) => {
    setCreateAccountContext({ tab, rowIndex });
    setShowCreateAccountModal(true);
  };

  // Handle account created - auto-select in the appropriate field
  const handleAccountCreated = async (account: { id: number; name: string; type: string }) => {
    if (!createAccountContext) return;

    if (createAccountContext.tab === "payment" || createAccountContext.tab === "receipt") {
      // For Payment/Receipt tabs, use the sidebar account select logic
      const accountObj: Account = {
        id: account.id,
        name: account.name,
        type: account.type as "ledger" | "bank" | "supplier" | "employee" | "fixedAsset" | "factorySupplier",
        code: "",
      };
      handleSidebarAccountSelect(accountObj);
    } else if (createAccountContext.tab === "journal" && createAccountContext.rowIndex !== undefined) {
      // For Journal tab, update the specific row
      const rowIndex = createAccountContext.rowIndex;
      // Newly created accounts are always ledger type
      journalForm.setValue(`entries.${rowIndex}.accountType`, "ledger");
      journalForm.setValue(`entries.${rowIndex}.accountId`, account.id);
      journalForm.setValue(`entries.${rowIndex}.accountName`, account.name);
      setShowAccountSidebar(false);
      
      // Focus the amount input
      requestAnimationFrame(() => {
        const amountInput = document.querySelector(
          `[data-testid="input-journal-amount-${rowIndex}"]`
        ) as HTMLInputElement;
        if (amountInput) {
          amountInput.focus();
          amountInput.select();
        }
      });
    }

    setCreateAccountContext(null);
  };

  // Auto-create expense account for FACTORY companies
  // This allows typing a new expense name and pressing Enter to auto-create under Indirect Expense
  const handleAutoCreateAccount = async (name: string): Promise<Account | null> => {
    if (!selectedCompany?.id || !name.trim()) return null;

    setIsAutoCreating(true);
    try {
      // Check if account already exists (case-insensitive search in sidebar accounts)
      const normalizedName = name.trim().toLowerCase();
      const existingAccount = sidebarAccounts.find(
        (acc) => acc.name.toLowerCase() === normalizedName
      );

      if (existingAccount) {
        // Account exists, just return it
        return existingAccount;
      }

      // Create new expense account under Indirect Expense
      const payload = {
        name: name.trim(),
        accountType: "Indirect Expense",
        companyId: selectedCompany.id,
      };

      const response = await fetch("/api/ledger-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create account");
      }

      const newAccount = await response.json();

      // Invalidate cache to refresh account lists
      await queryClient.invalidateQueries({ queryKey: ["/api/accounts/voucher-sidebar", selectedCompany.id] });
      await queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts", selectedCompany.id] });

      toast({
        title: "Account created",
        description: `"${newAccount.name}" created as Indirect Expense.`,
      });

      // Return as Account type for sidebar
      return {
        id: newAccount.id,
        name: newAccount.name,
        type: "ledger" as const,
        code: newAccount.code || "",
        balance: 0,
      };
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to create account",
      });
      return null;
    } finally {
      setIsAutoCreating(false);
    }
  };

  // Sync active row's accountName to sidebar search (like POS does with itemName)
  useEffect(() => {
    if (activeRowIndex !== null) {
      const activeEntry = watchedEntries[activeRowIndex];
      if (activeEntry) {
        setSidebarSearchValue(activeEntry.accountName || "");
        setSidebarHighlightedIndex(0);
      }
    }
  }, [watchedEntries, activeRowIndex]);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `${activeTab === "payment" ? "Payment" : "Receipt"}-Voucher-${format(
      form.watch("voucherDate"),
      "yyyy-MM-dd"
    )}`,
  });

  // Export current Payment/Receipt voucher to Excel
  const handleExportVoucher = async (detailed: boolean) => {
    const formData = form.getValues();
    const voucherType = activeTab === "payment" ? "Payment" : "Receipt";
    const voucherDate = formData.voucherDate ? format(formData.voucherDate, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
    const validEntries = formData.entries.filter((e: any) => e.accountId > 0 && parseFloat(e.amount) > 0);
    
    if (validEntries.length === 0) {
      toast({
        title: "No data to export",
        description: "Add at least one entry before exporting.",
        variant: "destructive",
      });
      return;
    }
    
    const total = validEntries.reduce((sum: number, e: any) => sum + (parseFloat(e.amount) || 0), 0);
    
    if (detailed) {
      // Detailed export - one row per entry
      const exportData = validEntries.map((entry: any) => ({
        "Voucher Type": voucherType,
        "Date": voucherDate,
        "Pay From/Receive In": formData.paymentAccountName || "",
        "Account": entry.accountName || "",
        "Account Type": entry.accountType || "",
        "Amount": parseFloat(entry.amount).toFixed(2),
        "Notes": formData.notes || "",
        "Optional": formData.optional ? "Yes" : "No",
      }));
      
      const worksheet = utils.json_to_sheet(exportData);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, `${voucherType} Detailed`);
      const fileName = `${voucherType}_Voucher_Detailed_${voucherDate}.xlsx`;
      await writeFile(workbook, fileName);
      
      toast({
        title: "Export successful",
        description: `Downloaded ${fileName} with ${validEntries.length} entries.`,
      });
    } else {
      // Summary export - one row for the voucher
      const exportData = [{
        "Voucher Type": voucherType,
        "Date": voucherDate,
        "Pay From/Receive In": formData.paymentAccountName || "",
        "Total Amount": total.toFixed(2),
        "Number of Entries": validEntries.length,
        "Notes": formData.notes || "",
        "Optional": formData.optional ? "Yes" : "No",
      }];
      
      const worksheet = utils.json_to_sheet(exportData);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, `${voucherType} Summary`);
      const fileName = `${voucherType}_Voucher_Summary_${voucherDate}.xlsx`;
      await writeFile(workbook, fileName);
      
      toast({
        title: "Export successful",
        description: `Downloaded ${fileName}.`,
      });
    }
  };

  const onSubmit = async (data: VoucherFormData) => {
    // Filter to only valid rows: must have a real account and a positive numeric amount
    const validEntries = data.entries.filter(
      entry => entry.accountId > 0 && parseFloat(entry.amount || "0") > 0
    );

    if (validEntries.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please add at least one entry with an account and a positive amount.",
        variant: "destructive",
      });
      return;
    }

    // Calculate total from valid entries only
    const totalDebits = validEntries.reduce((sum, entry) => {
      const amount = parseFloat(entry.amount);
      return sum + (isNaN(amount) ? 0 : amount);
    }, 0);

    if (isNaN(totalDebits) || totalDebits <= 0) {
      toast({
        title: "Validation Error",
        description: "Invalid amounts detected. Please check your entries.",
        variant: "destructive",
      });
      return;
    }

    // Pass only the valid, non-blank entries to the mutation — never send zero/blank rows
    saveMutation.mutate({ ...data, entries: validEntries });
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

  // Draft autosave for journal form (new journals only)
  const journalDraftMode = isFactoryMode ? "factory" : "erp";
  const { hasDraft: hasJournalDraft, draftAge: journalDraftAge, draft: journalDraft, scheduleSave: scheduleJournalSave, discardDraft: discardJournalDraft } = useFormDraft({
    entityType: "voucher-journal",
    mode: journalDraftMode,
    companyId: selectedCompany?.id ?? null,
    enabled: !voucherIdToEdit,
  });

  const allJournalValues = journalForm.watch();
  useEffect(() => {
    if (voucherIdToEdit) return;
    scheduleJournalSave(allJournalValues);
  }, [JSON.stringify(allJournalValues), voucherIdToEdit]);

  // Journal sidebar state for account selection (like Stock Transfer's item sidebar)
  const [activeJournalRow, setActiveJournalRow] = useState<number | null>(null);
  const [showAccountSidebar, setShowAccountSidebar] = useState(false);
  const [journalAccountSearchTerm, setJournalAccountSearchTerm] = useState("");
  const [journalAccountHighlightedIndex, setJournalAccountHighlightedIndex] = useState(0);
  const journalSidebarRef = useRef<HTMLDivElement>(null);

  // Keep liveAccountSearch in sync with the journal account search so that
  // typing in a journal row also triggers the debounced supplier/customer API call.
  useEffect(() => {
    setLiveAccountSearch(journalAccountSearchTerm);
  }, [journalAccountSearchTerm]);

  // Create account modal state
  const [showCreateAccountModal, setShowCreateAccountModal] = useState(false);
  const [createAccountContext, setCreateAccountContext] = useState<{
    tab: "payment" | "receipt" | "journal";
    rowIndex?: number;
  } | null>(null);

  // Filter accounts for journal sidebar
  const filteredJournalAccounts = useMemo(() => {
    if (!journalAccountSearchTerm.trim()) return allAccounts;
    const term = journalAccountSearchTerm.toLowerCase();
    return allAccounts.filter((acc) =>
      (acc.name || '').toLowerCase().includes(term) ||
      (acc.code || '').toLowerCase().includes(term)
    );
  }, [allAccounts, journalAccountSearchTerm]);

  // Handle account selection from sidebar
  const handleJournalAccountSelect = async (account: CombinedAccount) => {
    if (activeJournalRow !== null) {
      journalForm.setValue(`entries.${activeJournalRow}.accountType`, account.type);
      journalForm.setValue(`entries.${activeJournalRow}.accountId`, account.id);
      journalForm.setValue(`entries.${activeJournalRow}.accountName`, account.name);
      
      
      // Focus the amount field after selection
      setTimeout(() => {
        const amountInput = document.querySelector(`[data-testid="input-journal-amount-${activeJournalRow}"]`) as HTMLInputElement;
        if (amountInput) {
          amountInput.focus();
          amountInput.select();
        }
      }, 50);
    }
  };

  // Helper function to get account balance from sidebarAccounts
  const getAccountBalance = (accountType: string, accountId: number): number => {
    const account = sidebarAccounts.find(
      (acc) => acc.type === accountType && acc.id === accountId
    );
    return account?.balance ?? 0;
  };

  // Calculate the remaining CR amount to balance the journal
  const remainingCrAmount = totalDebit - totalCredit;

  // Auto-fill CR amount when the user switches to CR on a row
  const handleJournalTypeChange = async (index: number, newType: "DR" | "CR") => {
    // Get fresh values from form, not from watched values which may be stale
    const currentEntries = journalForm.getValues("entries");
    const currentAmount = parseFloat(currentEntries[index]?.amount || "0");
    
    // Set the new type first
    journalForm.setValue(`entries.${index}.type`, newType);
    
    // If switching to CR and there's a balance to fill, auto-fill the remaining amount
    if (newType === "CR") {
      // Create a modified entries array that reflects the type change we just made
      const updatedEntries = currentEntries.map((entry, i) => 
        i === index ? { ...entry, type: newType } : entry
      );
      
      // Calculate total debits from all entries (now that current row is CR, it won't be counted)
      const totalDebits = updatedEntries.reduce(
        (sum, entry) => sum + (entry.type === "DR" ? (parseFloat(entry.amount) || 0) : 0),
        0
      );
      
      // Calculate credits from other rows only (not the current row being changed)
      const otherCredits = updatedEntries.reduce(
        (sum, entry, i) => i !== index && entry.type === "CR" ? sum + (parseFloat(entry.amount) || 0) : sum,
        0
      );
      
      const remainingToBalance = totalDebits - otherCredits;
      
      // Only auto-fill if current amount is 0 and there's a positive remaining amount
      if (currentAmount === 0 && remainingToBalance > 0) {
        journalForm.setValue(`entries.${index}.amount`, formatNumber(remainingToBalance));
      }
    }
    
    // Focus the account field after type change
    setTimeout(() => {
      const accountInput = document.querySelector(`[data-testid="input-journal-account-${index}"]`) as HTMLInputElement;
      if (accountInput) {
        accountInput.focus();
      }
    }, 50);
  };

  // Pre-populate journal form when editing
  useEffect(() => {
    if (voucherToEdit && voucherToEdit.voucherType === "Journal" && Array.isArray(voucherToEdit.entries) && voucherToEdit.entries.length > 0 && allAccounts.length > 0) {
      if (hydratedVoucherIdRef.current === voucherToEdit.id) return;
      // Wait for factorySuppliersList to load if any entry references one
      const needsFactorySuppliers = voucherToEdit.entries.some((e: any) => e.factorySupplierId);
      if (needsFactorySuppliers && factorySuppliersList.length === 0) return;
      const formEntries = voucherToEdit.entries.map((entry: any) => {
        let accountType: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset" | "customer" | "factorySupplier" = "ledger";
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
        } else if (entry.factorySupplierId) {
          accountType = "factorySupplier";
          accountId = entry.factorySupplierId;
          const fs = factorySuppliersList.find(s => s.id === accountId);
          accountName = fs?.name || "";
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
        } else if (entry.customerId) {
          accountType = "customer";
          accountId = entry.customerId;
          const customer = customers.find(c => c.id === accountId);
          accountName = customer?.legalName || "";
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
          narration: entry.narration || "",
        };
      });

      journalForm.reset({
        voucherDate: parseDateLocal(voucherToEdit.voucherDate),
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
      hydratedVoucherIdRef.current = voucherToEdit.id;
    }
  }, [voucherToEdit, allAccounts, bankAccounts, ledgerAccounts, suppliers, employees, fixedAssets, customers, factorySuppliersList, journalForm]);

  // Journal save mutation (handles both create and update) - OPTIMIZED to use batch endpoint
  const journalMutation = useMutation({
    mutationFn: async (formData: JournalFormData) => {
      const data = formData;
      const isEditMode = !!voucherIdToEdit;

      // Filter out empty entries
      const validEntries = data.entries.filter((entry) => entry.accountId > 0);

      // Prepare request payload - include exchange rate for rate-locking
      const payload = {
        voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
        entries: validEntries,
        notes: data.notes,
        optional: data.optional,
        currency: selectedCurrency,
        exchangeRate: exchangeRate ? exchangeRate.toString() : undefined,
      };

      // Use batch endpoint for both create and update
      if (isEditMode) {
        const res = await modeApiRequest("PATCH", `/api/vouchers/${voucherIdToEdit}/journal`, payload);
        return await res.json();
      } else {
        const res = await modeApiRequest("POST", "/api/vouchers/journal", payload);
        return await res.json();
      }
    },
    onSuccess: async (data: any) => {
      const isEditMode = !!voucherIdToEdit;
      toast({
        title: "Success",
        description: `Journal voucher ${isEditMode ? "updated" : "created"} successfully`,
      });
      if (data?.whatsapp?.prompt && data.whatsapp.accountId && data.whatsapp.month) {
        setWaPendingPrompt({ accountId: data.whatsapp.accountId, month: data.whatsapp.month });
      }
      discardJournalDraft();
      
      // Invalidate only essential queries for faster saves
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/voucher-sidebar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", paymentAccountType, paymentAccountId, "balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers/stats", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/net-profit"] });
      // Invalidate customer statements and factory customer orders so journal entries
      // linked to a customer account are reflected immediately
      queryClient.invalidateQueries({ predicate: keyStartsWith('/api/factory/customers/') });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customers"] });
      queryClient.invalidateQueries({ predicate: keyStartsWith('/api/factory/customer-orders') });
      
      // Clear edit mode and navigate back to daybook or reset form
      if (isEditMode) {
        setLocation(`${modePrefix}/daybook`);
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
    onError: (error: any, formData: JournalFormData) => {
      if (error.name === "OfflineQueued") {
        const voucherDate = format(formData.voucherDate, "yyyy-MM-dd");
        const totalAmount = formData.entries
          .filter((e: any) => parseFloat(e.amount || "0") > 0)
          .reduce((sum: number, e: any) => sum + parseFloat(e.amount || "0"), 0)
          .toFixed(2);
        const syntheticVoucher: any = {
          id: -Date.now(),
          voucherNumber: "PENDING",
          voucherType: "Journal",
          voucherDate,
          description: formData.notes || "Journal (pending sync)",
          totalAmount,
          optional: formData.optional || false,
          createdAt: new Date().toISOString(),
        };
        queryClient.setQueriesData(
          { queryKey: ["/api/vouchers"] },
          (old: any) => Array.isArray(old) ? [syntheticVoucher, ...old] : old
        );
        discardJournalDraft();
        journalForm.reset({
          voucherDate: new Date(),
          entries: [{ type: "DR", accountType: "ledger", accountId: 0, accountName: "", amount: "" }],
          notes: "",
          optional: false,
        });
        return;
      }
      const isEditMode = !!voucherIdToEdit;
      if ((error as any)._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || `Failed to ${isEditMode ? "update" : "create"} journal voucher`,
        variant: "destructive",
      });
    },
  });

  // Export current Journal voucher to Excel
  const handleExportJournalVoucher = async (detailed: boolean) => {
    const formData = journalForm.getValues();
    const voucherDate = formData.voucherDate ? format(formData.voucherDate, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
    const validEntries = formData.entries.filter((e: any) => e.accountId > 0 && parseFloat(e.amount) > 0);
    
    if (validEntries.length === 0) {
      toast({
        title: "No data to export",
        description: "Add at least one entry before exporting.",
        variant: "destructive",
      });
      return;
    }
    
    if (detailed) {
      // Detailed export - one row per entry
      const exportData = validEntries.map((entry: any) => ({
        "Voucher Type": "Journal",
        "Date": voucherDate,
        "DR/CR": entry.type,
        "Account": entry.accountName || "",
        "Account Type": entry.accountType || "",
        "Amount": parseFloat(entry.amount).toFixed(2),
        "Notes": formData.notes || "",
        "Optional": formData.optional ? "Yes" : "No",
      }));
      
      const worksheet = utils.json_to_sheet(exportData);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Journal Detailed");
      const fileName = `Journal_Voucher_Detailed_${voucherDate}.xlsx`;
      await writeFile(workbook, fileName);
      
      toast({
        title: "Export successful",
        description: `Downloaded ${fileName} with ${validEntries.length} entries.`,
      });
    } else {
      // Summary export
      const totalDr = validEntries.filter((e: any) => e.type === "DR").reduce((sum: number, e: any) => sum + (parseFloat(e.amount) || 0), 0);
      const totalCr = validEntries.filter((e: any) => e.type === "CR").reduce((sum: number, e: any) => sum + (parseFloat(e.amount) || 0), 0);
      
      const exportData = [{
        "Voucher Type": "Journal",
        "Date": voucherDate,
        "Total Debit": totalDr.toFixed(2),
        "Total Credit": totalCr.toFixed(2),
        "Number of Entries": validEntries.length,
        "Notes": formData.notes || "",
        "Optional": formData.optional ? "Yes" : "No",
      }];
      
      const worksheet = utils.json_to_sheet(exportData);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Journal Summary");
      const fileName = `Journal_Voucher_Summary_${voucherDate}.xlsx`;
      await writeFile(workbook, fileName);
      
      toast({
        title: "Export successful",
        description: `Downloaded ${fileName}.`,
      });
    }
  };

  const onJournalSubmit = async (data: JournalFormData) => {
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
        description: `Debits (${formatAmount(totalDebit)}) must equal Credits (${formatAmount(totalCredit)})`,
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
          stockItemCode: "",
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

  // For multi-location POS users: which location they are sending FROM
  const [posSelectedSourceId, setPosSelectedSourceId] = useState<number | null>(posLocationId ?? null);
  const posSelectedSourceName = isPOS
    ? (locations.find(l => l.id === posSelectedSourceId)?.name || posLocationName)
    : "";

  // For POS users, auto-set source location when posSelectedSourceId or locations change
  useEffect(() => {
    if (isPOS && posSelectedSourceId && posSelectedSourceName) {
      // Update all entries to use the chosen source location
      const entries = stockTransferForm.getValues("entries");
      entries.forEach((_, index) => {
        stockTransferForm.setValue(`entries.${index}.sourceLocationId`, posSelectedSourceId);
        stockTransferForm.setValue(`entries.${index}.sourceLocationName`, posSelectedSourceName);
      });
      // Set inventory source for sidebar
      setTransferInventorySource(posSelectedSourceId);
    }
  }, [isPOS, posSelectedSourceId, posSelectedSourceName]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stock Transfer Import state
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [transferRevisionDialogOpen, setTransferRevisionDialogOpen] = useState(false);
  const [transferRevisionNote, setTransferRevisionNote] = useState("");
  const [isTransferSavingRevision, setIsTransferSavingRevision] = useState(false);
  const [transferRevisionsExpanded, setTransferRevisionsExpanded] = useState(false);
  const [approveRevisionTarget, setApproveRevisionTarget] = useState<any | null>(null);

  const approveRevisionMutation = useMutation({
    mutationFn: async (revisionId: number) => {
      const res = await modeApiRequest("POST", `/api/stock-transfer-revisions/${revisionId}/approve`, {});
      return res;
    },
    onSuccess: () => {
      toast({ title: "Revision approved", description: "Quantities have been updated." });
      setApproveRevisionTarget(null);
      // Keep revision history panel open after approval
      setTransferRevisionsExpanded(true);
      // Reset the hydration guard so the form re-loads with the new quantities
      hydratedVoucherIdRef.current = null;
      // Use lastKnownTransferIdRef so the revision query key remains stable even
      // while stockTransferToEdit is in a background-refetch state
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers", lastKnownTransferIdRef.current, "revisions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers", voucherIdToEdit] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers/list"] });
    },
    onError: (err: any) => {
      toast({ title: "Approval failed", description: err.message, variant: "destructive" });
    },
  });
  const [transferQtyDraft, setTransferQtyDraft] = useState<Record<number, string>>({});
  const [importValidationResult, setImportValidationResult] = useState<any>(null);
  const [importDestLocation, setImportDestLocation] = useState<string>("");
  const [importDate, setImportDate] = useState<string>(new Date().toLocaleDateString('en-CA'));
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
      if (error?._handledGlobally) return;
      toast({
        title: "Parse error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const importValidateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await modeApiRequest("POST", "/api/stock-transfer-import/validate-multi-source", data);
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
      if (error?._handledGlobally) return;
      toast({
        title: "Validation error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await modeApiRequest("POST", "/api/stock-transfer-import/import-multi-source", data);
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
      queryClient.invalidateQueries({ queryKey: ["/api/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/location-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers/list"] });
      // Reset import state
      setImportDialogOpen(false);
      setImportFile(null);
      setImportPreview(null);
      setImportValidationResult(null);
      setImportDestLocation("");
      setImportNotes("");
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({
        title: "Import error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setImportFile(selectedFile);
      setImportPreview(null);
      setImportValidationResult(null);
    }
  };

  const handleImportParse = async () => {
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

  const handleImportValidate = async () => {
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

  const handleImportSubmit = async () => {
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
  
  const handleConfirmedImport = async () => {
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
      setImportDate(new Date().toLocaleDateString('en-CA'));
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

  const downloadImportTemplate = async () => {
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
    if (stockTransferToEdit && stockTransferToEdit.items && voucherToEdit && locations.length > 0 && stockItems.length > 0) {
      if (hydratedVoucherIdRef.current === voucherIdToEdit) return;
      // Map stock transfer items to form entries
      const formEntries = stockTransferToEdit.items.map((item: any) => {
        const sourceLocation = locations.find(l => l.id === item.sourceLocationId);
        const stockItem = stockItems.find(s => s.id === item.stockItemId);
        
        return {
          sourceLocationId: item.sourceLocationId || 0,
          sourceLocationName: sourceLocation?.name || "",
          stockItemId: item.stockItemId || 0,
          stockItemCode: stockItem?.code || "",
          stockItemName: stockItem?.name || "",
          quantity: item.quantity || "0",
          rate: item.rate || "0",
        };
      });

      // Reset form with stock transfer data
      stockTransferForm.reset({
        voucherDate: voucherToEdit ? parseDateLocal(voucherToEdit.voucherDate) : new Date(),
        destinationLocationId: stockTransferToEdit.destinationLocationId || 0,
        entries: formEntries.length > 0 ? formEntries : [{
          sourceLocationId: 0,
          sourceLocationName: "",
          stockItemId: 0,
          stockItemCode: "",
          stockItemName: "",
          quantity: "",
          rate: "",
        }],
        notes: stockTransferToEdit.notes || "",
        optional: voucherToEdit?.optional || false,
      });
      hydratedVoucherIdRef.current = voucherIdToEdit;
    }
  }, [stockTransferToEdit, voucherToEdit, locations, stockItems, stockTransferForm]);

  // Helper function to lookup account by code
  const lookupAccountByCode = (code: string): { type: "ledger" | "bank" | "supplier"; id: number; name: string } | null => {
    if (!code || code.trim() === "") return null;
    
    const searchCode = code.trim().toLowerCase();
    
    // Search ledger accounts by code
    const ledgerAccount = ledgerAccounts.find(
      (a) => a.code && a.code.toLowerCase() === searchCode
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
      (a) => a.accountNumber && a.accountNumber.toLowerCase() === searchCode
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
      (s) => s.code && s.code.toLowerCase() === searchCode
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
  const lookupLocationByCode = async (code: string) => {
    const location = locations.find(
      (l) => l.code && l.code.toLowerCase() === code.toLowerCase()
    );
    return location;
  };

  // Helper function to lookup stock item by code
  const lookupStockItemByCode = async (code: string) => {
    const item = stockItems.find(
      (s) => s.code && s.code.toLowerCase() === code.toLowerCase()
    );
    return item;
  };

  // Define the mutation input type with all required data passed explicitly
  type StockTransferMutationInput = StockTransferFormData & {
    allowNegativeInventory?: boolean;
    _companyId: number | undefined;
    _transferTotal: number;
    _voucherIdToEdit: number | null;
    _stockTransferToEditId: number | null;
    _locations: typeof locations;
  };

  // Stock Transfer mutation (handles both create and update)
  const stockTransferMutation = useMutation({
    mutationFn: async (input: StockTransferMutationInput) => {
      try {
        // Extract all data from input (not from closures)
        const { 
          allowNegativeInventory, 
          _companyId,
          _transferTotal,
          _voucherIdToEdit,
          _stockTransferToEditId,
          _locations,
          ...data 
        } = input;
        
        
        const isEditMode = !!_voucherIdToEdit;
        
        // Validate required data before proceeding
        if (!data.entries || !Array.isArray(data.entries)) {
          throw new Error("Invalid form data: entries is missing or not an array");
        }
        if (!data.destinationLocationId) {
          throw new Error("Destination location is required");
        }
        if (!_companyId && !isEditMode) {
          throw new Error("No company selected");
        }
        
        
        // Get unique source locations for description
        const validEntries = data.entries.filter(e => e.sourceLocationId > 0 && e.stockItemId > 0);
        const uniqueSources = Array.from(new Set(validEntries.map(e => e.sourceLocationId)));
        const sourceNames = uniqueSources.map(id => _locations.find(l => l.id === id)?.name).filter(Boolean).join(", ") || "Unknown";
        const destName = _locations.find(l => l.id === data.destinationLocationId)?.name || "Unknown";
        
        if (isEditMode) {
          // UPDATE MODE: Use PATCH to update existing voucher and stock transfer
          // Ensure voucherDate is a Date object before formatting
          const editVoucherDateObj = data.voucherDate instanceof Date 
            ? data.voucherDate 
            : new Date(data.voucherDate);
          const editFormattedVoucherDate = format(editVoucherDateObj, "yyyy-MM-dd");
          
          const voucherRes = await modeApiRequest("PATCH", `/api/vouchers/${_voucherIdToEdit}`, {
            voucherDate: editFormattedVoucherDate,
            description: `Stock transfer from ${sourceNames} to ${destName}`,
            totalAmount: _transferTotal.toString(),
            optional: data.optional,
          });
          
          // Update stock transfer
          if (_stockTransferToEditId) {
            await modeApiRequest("PUT", `/api/stock-transfers/${_stockTransferToEditId}`, {
              destinationLocationId: data.destinationLocationId,
              notes: data.notes || "",
              items: validEntries.map(entry => ({
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
          // Ensure voucherDate is a Date object before formatting
          const voucherDateObj = data.voucherDate instanceof Date 
            ? data.voucherDate 
            : new Date(data.voucherDate);
          const formattedVoucherDate = format(voucherDateObj, "yyyy-MM-dd");
          
          const voucherPayload = {
            companyId: _companyId,
            voucherType: "StockTransfer",
            voucherNumber: `TRANSFER-${Date.now()}`,
            voucherDate: formattedVoucherDate,
            description: `Stock transfer from ${sourceNames} to ${destName}`,
            totalAmount: _transferTotal.toString(),
            optional: data.optional,
            currency: selectedCurrency,
            exchangeRate: exchangeRate ? exchangeRate.toString() : undefined,
          };
          
          let voucherRes;
          try {
            voucherRes = await modeApiRequest("POST", "/api/vouchers", voucherPayload);
          } catch (apiError: any) {
            throw apiError;
          }
          const voucher = await voucherRes.json();

          // Create stock transfer with items (including per-item source locations)
          await modeApiRequest("POST", "/api/stock-transfers", {
            voucherId: voucher.id,
            destinationLocationId: data.destinationLocationId,
            notes: data.notes || "",
            allowNegativeInventory: allowNegativeInventory || false,
            items: validEntries.map(entry => ({
              sourceLocationId: entry.sourceLocationId,
              stockItemId: entry.stockItemId,
              quantity: entry.quantity,
              rate: entry.rate,
            })),
          });

          return voucher;
        }
      } catch (error: any) {
        throw error;
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
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers/list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-by-location"] });
      queryClient.invalidateQueries({ queryKey: ["/api/location-summary"] });
      
      // Clear edit mode and navigate back to daybook or reset form
      if (isEditMode) {
        setLocation(`${modePrefix}/daybook`);
      } else {
        stockTransferForm.reset({
          voucherDate: new Date(),
          destinationLocationId: 0,
          entries: [
            {
              sourceLocationId: 0,
              sourceLocationName: "",
              stockItemId: 0,
              stockItemCode: "",
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
      if (error?._handledGlobally) return;
      const isEditMode = !!voucherIdToEdit;
      toast({
        title: "Error",
        description: error.message || `Failed to ${isEditMode ? "update" : "create"} stock transfer`,
        variant: "destructive",
      });
    },
  });

  const computeTransferRevisionItems = () => {
    if (!stockTransferToEdit?.items) return [];
    type RevKey = string;
    const originalMap = new Map<RevKey, { qty: number; stockItemId: number; stockItemName: string; sourceLocationId: number; sourceLocationName: string }>();
    for (const item of stockTransferToEdit.items) {
      const key: RevKey = `${item.stockItemId}-${item.sourceLocationId ?? "null"}`;
      const si = stockItems.find((s: any) => s.id === item.stockItemId);
      const sl = locations.find((l: any) => l.id === item.sourceLocationId);
      originalMap.set(key, {
        qty: parseFloat(item.quantity) || 0,
        stockItemId: item.stockItemId,
        stockItemName: si?.name || "",
        sourceLocationId: item.sourceLocationId ?? null,
        sourceLocationName: sl?.name || "",
      });
    }
    const currentEntries = stockTransferForm.getValues("entries");
    const currentMap = new Map<RevKey, (typeof currentEntries)[0]>();
    for (const entry of currentEntries) {
      if (!entry.stockItemId || entry.stockItemId <= 0) continue;
      const key: RevKey = `${entry.stockItemId}-${entry.sourceLocationId ?? "null"}`;
      currentMap.set(key, entry);
    }
    const allKeys = new Set([...originalMap.keys(), ...currentMap.keys()]);
    const result: Array<{
      stockItemId: number; stockItemName: string;
      sourceLocationId: number | null; sourceLocationName: string;
      originalQuantity: number; delta: number; newQuantity: number;
    }> = [];
    for (const key of allKeys) {
      const orig = originalMap.get(key);
      const cur = currentMap.get(key);
      const origQty = orig?.qty ?? 0;
      const curQty = parseFloat(cur?.quantity || "0");
      const delta = curQty - origQty;
      if (Math.abs(delta) < 0.001) continue;
      result.push({
        stockItemId: cur?.stockItemId ?? orig?.stockItemId ?? 0,
        stockItemName: cur?.stockItemName || orig?.stockItemName || "",
        sourceLocationId: cur?.sourceLocationId ?? orig?.sourceLocationId ?? null,
        sourceLocationName: cur?.sourceLocationName || orig?.sourceLocationName || "",
        originalQuantity: origQty,
        delta,
        newQuantity: curQty,
      });
    }
    return result;
  };

  const handleTransferSaveAsRevision = () => {
    if (!voucherIdToEdit || !stockTransferToEdit?.id) return;
    setTransferRevisionDialogOpen(true);
  };

  const confirmTransferSaveAsRevision = async () => {
    const revisionItems = computeTransferRevisionItems();
    if (revisionItems.length === 0) {
      toast({ title: "No Changes", description: "No differences found compared to the saved order", variant: "destructive" });
      setTransferRevisionDialogOpen(false);
      return;
    }
    setIsTransferSavingRevision(true);
    try {
      await stockTransferForm.handleSubmit(async (data) => {
        await onStockTransferSubmit(data);
      })();
      await modeApiRequest("POST", `/api/stock-transfers/${stockTransferToEdit!.id}/revisions`, {
        note: transferRevisionNote.trim() || null,
        items: revisionItems,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers", lastKnownTransferIdRef.current, "revisions"] });
      setTransferRevisionNote("");
      setTransferRevisionDialogOpen(false);
      setTransferRevisionsExpanded(true);
      const nextRevNum = transferRevisions.length + 1;
      toast({ title: "Revision Saved", description: `Rev ${nextRevNum} recorded and transfer updated` });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to save revision", variant: "destructive" });
    } finally {
      setIsTransferSavingRevision(false);
    }
  };

  const onStockTransferSubmit = async (data: StockTransferFormData) => {
    
    // Validate destination location
    if (!data.destinationLocationId || data.destinationLocationId <= 0) {
      toast({
        title: "Validation Error",
        description: "Please select a destination location",
        variant: "destructive",
      });
      return;
    }
    
    // Validate entries
    const validEntries = data.entries.filter(
      (entry) => entry.stockItemId > 0 && entry.sourceLocationId > 0 && parseFloat(entry.quantity || "0") > 0
    );

    if (validEntries.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please add at least one valid entry with source location, item, and quantity",
        variant: "destructive",
      });
      return;
    }
    

    // Auto-fill missing rates from inventory before proceeding
    const entriesWithMissingRates = validEntries.filter(entry => !entry.rate || entry.rate === "" || entry.rate === "0");
    if (entriesWithMissingRates.length > 0) {
      
      // Fetch rates from inventory for each entry with missing rate
      const ratePromises = entriesWithMissingRates.map(async (entry) => {
        try {
          const res = await fetch(`/api/locations/${entry.sourceLocationId}/inventory`);
          if (res.ok) {
            const inventory = await res.json();
            const inventoryItem = inventory.find((item: any) => item.stockItemId === entry.stockItemId);
            return {
              stockItemId: entry.stockItemId,
              sourceLocationId: entry.sourceLocationId,
              rate: inventoryItem?.averageRate || "0"
            };
          }
        } catch (err) {
        }
        return {
          stockItemId: entry.stockItemId,
          sourceLocationId: entry.sourceLocationId,
          rate: "0"
        };
      });

      const fetchedRates = await Promise.all(ratePromises);
      
      // Update validEntries with fetched rates
      for (const entry of validEntries) {
        if (!entry.rate || entry.rate === "" || entry.rate === "0") {
          const fetchedRate = fetchedRates.find(
            r => r.stockItemId === entry.stockItemId && r.sourceLocationId === entry.sourceLocationId
          );
          if (fetchedRate) {
            entry.rate = fetchedRate.rate;
          }
        }
      }
      
    }

    // Silently remove zero-quantity entries instead of blocking
    data.entries = data.entries.filter(
      (entry) => !(entry.stockItemId > 0 && entry.sourceLocationId > 0 && parseFloat(entry.quantity) === 0)
    );

    // Validate quantities against available inventory
    // When editing, we need to add back the original transfer quantities to available stock
    const isEditMode = !!voucherIdToEdit;

    // IMPORTANT: in edit mode, make sure we actually have the original stock transfer loaded.
    // If it's not in cache yet (common when you only change destination and submit quickly),
    // fetch it so the "add back original qty" logic works reliably.
    let originalItems: any[] = [];
    if (isEditMode && voucherIdToEdit) {
      let st = stockTransferToEdit as any | undefined;

      if (!st) {
        try {
          const res = await fetch(`/api/stock-transfers?voucherId=${voucherIdToEdit}`);
          if (res.ok) {
            const data = await res.json();
            st = Array.isArray(data) ? data[0] : data;
          }
        } catch (e) {
          // ignore - we'll handle empty originalItems below
        }
      }

      originalItems = st?.items || [];
      
      if (!originalItems.length) {
        toast({
          title: "Loading",
          description: "Original stock transfer details are still loading. Please try again in a moment.",
        });
        return;
      }
    }
    
    // Build a map of original quantities: key = "stockItemId" or "stockItemId-sourceLocationId"
    // This aggregates ALL original quantities per stockItemId for proper restoration
    const originalQtyMap = new Map<string, number>();
    const originalQtyByStockItemOnly = new Map<number, number>();
    
    originalItems.forEach((orig: any) => {
      const qty = parseFloat(orig.quantity || "0");
      const stockItemId = Number(orig.stockItemId);
      const sourceLocId = orig.sourceLocationId != null ? Number(orig.sourceLocationId) : null;
      
      // Always aggregate by stockItemId alone (for fallback matching)
      originalQtyByStockItemOnly.set(
        stockItemId, 
        (originalQtyByStockItemOnly.get(stockItemId) || 0) + qty
      );
      
      // Also aggregate by stockItemId + sourceLocationId (for precise matching)
      if (sourceLocId && sourceLocId > 0) {
        const key = `${stockItemId}-${sourceLocId}`;
        originalQtyMap.set(key, (originalQtyMap.get(key) || 0) + qty);
      }
    });
    
    // Use DELTA-based validation: only check for the NET INCREASE over original quantity
    // This allows edits without increasing quantity to always succeed, even with negative inventory
    // IMPORTANT: Only use original qty if source location matches exactly (precise key match)
    // If source location changed, treat as a new transfer requiring full inventory check
    const inventoryValidationPromises = validEntries.map(entry => {
      const entryStockItemId = Number(entry.stockItemId);
      const entrySourceLocId = Number(entry.sourceLocationId);
      const requestedQty = parseFloat(entry.quantity);
      
      // Get the original quantity for this EXACT item + source location combination
      // Only use precise match - if source location changed, treat as new (delta = full qty)
      let originalQtyForItem = 0;
      if (isEditMode) {
        const preciseKey = `${entryStockItemId}-${entrySourceLocId}`;
        if (originalQtyMap.has(preciseKey)) {
          // Same source location as original - use that qty for delta
          originalQtyForItem = originalQtyMap.get(preciseKey)!;
        }
        // If no precise match (source location changed or new item), originalQtyForItem stays 0
        // This means delta = requestedQty, requiring full inventory check
      }
      
      // Calculate delta: how much MORE are we requesting than the original?
      const delta = requestedQty - originalQtyForItem;
      
      return fetch(`/api/locations/${entry.sourceLocationId}/inventory`)
        .then(res => res.ok ? res.json() : [])
        .then(inventory => {
          const inventoryList = Array.isArray(inventory) ? inventory : [];
          const availableItem = inventoryList.find((item: any) => Number(item.stockItemId) === entryStockItemId);
          const currentInventory = availableItem ? parseFloat(availableItem.quantity || "0") : 0;
          
          // If delta <= 0, we're requesting same or less than original - ALWAYS allow
          if (delta <= 0) {
            return { success: true };
          }
          
          // If delta > 0, we need additional inventory for the increase
          // Check if we have enough for the delta
          if (currentInventory >= delta) {
            return { success: true };
          }
          
          // Not enough inventory for the increase - but allow with warning
          // Calculate what the resulting inventory would be
          const resultingInventory = currentInventory - delta;
          const item = stockItems.find(s => s.id === entryStockItemId);
          const sourceLocation = locations.find(l => l.id === entrySourceLocId);
          
          return {
            success: false,
            warning: true,
            itemName: item?.name || 'Unknown Item',
            locationName: sourceLocation?.name || 'Unknown Location',
            currentInventory,
            delta,
            resultingInventory,
            error: `${item?.name} will have ${formatNumber(resultingInventory, 0)} in ${sourceLocation?.name} after this transfer (currently ${formatNumber(currentInventory, 0)}, need ${formatNumber(delta, 0)} more)`
          };
        })
        .catch(err => ({
          success: false,
          warning: false,
          error: `Failed to validate inventory: ${err.message}`
        }));
    });

    const results = await Promise.all(inventoryValidationPromises);
    const failedValidation = results.find(r => !r.success && !(r as any).warning);
    const warningValidation = results.find(r => !r.success && (r as any).warning);
    
    // Hard failures (not warnings) - block the transfer
    if (failedValidation) {
      toast({
        title: "Validation Error",
        description: failedValidation.error,
        variant: "destructive",
      });
      return;
    }
    
    // Warnings - ask user to confirm
    let userConfirmedNegativeInventory = false;
    if (warningValidation) {
      const confirmProceed = window.confirm(
        `Warning: ${warningValidation.error}\n\nThis will result in negative inventory. Do you want to proceed anyway?`
      );
      if (!confirmProceed) {
        return;
      }
      userConfirmedNegativeInventory = true;
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

    // Pass all required data explicitly to avoid stale closure issues
    // Use validEntries which has auto-filled rates
    stockTransferMutation.mutate({ 
      ...data,
      entries: validEntries, // Use entries with auto-filled rates
      allowNegativeInventory: userConfirmedNegativeInventory,
      _companyId: selectedCompany?.id,
      _transferTotal: transferTotal,
      _voucherIdToEdit: voucherIdToEdit,
      _stockTransferToEditId: stockTransferToEdit?.id || null,
      _locations: locations,
    });
  };

  // Stock Adjustment form
  const stockAdjustmentForm = useForm<StockAdjustmentFormData>({
    resolver: zodResolver(stockAdjustmentFormSchema),
    defaultValues: {
      voucherDate: new Date(),
      locationId: 0,
      entries: [
        {
          type: "CONSUME",
          stockItemId: 0,
          stockItemCode: "",
          stockItemName: "",
          quantity: "",
          rate: "",
        }
      ],
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
  const currentHasConsumption = adjustmentEntries.some((e: any) => e.type === "CONSUME");
  const currentHasProduction = adjustmentEntries.some((e: any) => e.type === "PRODUCE");
  const currentAdjustmentType = currentHasConsumption && currentHasProduction ? "Mixed" : currentHasProduction ? "Production" : "Consumption";
  const displayAdjustmentTotal = currentAdjustmentType === "Mixed" ? productionTotal - consumptionTotal : consumptionTotal + productionTotal;

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

  // Adjustment sidebar state
  const [adjustmentSearchTerm, setAdjustmentSearchTerm] = useState("");
  const [adjustmentHighlightedIndex, setAdjustmentHighlightedIndex] = useState(0);
  const [activeAdjustmentRow, setActiveAdjustmentRow] = useState<number | null>(null);
  const [showAdjustmentSidebar, setShowAdjustmentSidebar] = useState(false);
  const adjustmentFocusIdRef = useRef(0);
  const adjustmentSidebarRef = useRef<HTMLDivElement>(null);

  // Create combined list of all stock items with their location quantities
  const adjustmentItemsWithInventory = useMemo(() => {
    if (!stockItems.length) return [];
    
    return stockItems.map(item => {
      const inventoryItem = locationInventory.find((inv: any) => inv.stockItemId === item.id);
      return {
        stockItemId: item.id,
        stockItemCode: item.code,
        stockItemName: item.name,
        quantity: inventoryItem?.quantity || "0",
        averageRate: inventoryItem?.averageRate || "0",
      };
    }).sort((a, b) => a.stockItemName.localeCompare(b.stockItemName));
  }, [stockItems, locationInventory]);

  // Filtered adjustment items based on search
  const filteredAdjustmentItems = useMemo(() => {
    if (!adjustmentSearchTerm.trim()) return adjustmentItemsWithInventory;
    const term = adjustmentSearchTerm.toLowerCase();
    return adjustmentItemsWithInventory.filter(item =>
      item.stockItemName?.toLowerCase().includes(term) ||
      item.stockItemCode?.toLowerCase().includes(term)
    );
  }, [adjustmentItemsWithInventory, adjustmentSearchTerm]);

  // Scroll highlighted adjustment item into view
  useEffect(() => {
    if (showAdjustmentSidebar && adjustmentSidebarRef.current) {
      const container = adjustmentSidebarRef.current;
      const highlightedItem = container.querySelector(`[data-adjustment-idx="${adjustmentHighlightedIndex}"]`);
      if (highlightedItem) {
        highlightedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [adjustmentHighlightedIndex, showAdjustmentSidebar]);

  // Pre-populate stock adjustment form when editing
  useEffect(() => {
    if (stockAdjustmentToEdit && stockAdjustmentToEdit.items && voucherToEdit && stockItems.length > 0) {
      if (hydratedVoucherIdRef.current === voucherIdToEdit) return;
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
          stockItemCode: stockItem?.code || "",
          stockItemName: stockItem?.name || "",
          quantity: absQuantity,
          rate: item.rate || "0",
        };
      });

      // Reset form with stock adjustment data
      stockAdjustmentForm.reset({
        voucherDate: voucherToEdit ? parseDateLocal(voucherToEdit.voucherDate) : new Date(),
        locationId: stockAdjustmentToEdit.locationId || 0,
        entries: formEntries.length > 0 ? formEntries : [{
          type: "PRODUCE",
          stockItemId: 0,
          stockItemCode: "",
          stockItemName: "",
          quantity: "",
          rate: "",
        }],
        notes: stockAdjustmentToEdit.notes || "",
        optional: voucherToEdit?.optional || false,
      });
      hydratedVoucherIdRef.current = voucherIdToEdit;
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

      const totalAmount = adjustmentType === "Mixed"
        ? productionTotal - consumptionTotal
        : consumptionTotal + productionTotal;
      
      if (isEditMode) {
        // UPDATE MODE: Use PATCH to update existing voucher and stock adjustment
        const voucherRes = await modeApiRequest("PATCH", `/api/vouchers/${voucherIdToEdit}`, {
          voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
          description: `Stock ${adjustmentType.toLowerCase()} at ${locations.find(l => l.id === data.locationId)?.name}`,
          totalAmount: totalAmount.toString(),
          optional: data.optional,
        });
        
        // Update stock adjustment (assuming stockAdjustmentToEdit has an id)
        if (stockAdjustmentToEdit?.id) {
          await modeApiRequest("PUT", `/api/stock-adjustments/${stockAdjustmentToEdit.id}`, {
            locationId: data.locationId,
            adjustmentType: adjustmentType,
            notes: data.notes || "",
            items: items,
          });
        }
        
        return await voucherRes.json();
      } else {
        // CREATE MODE: Create new voucher and stock adjustment
        const voucherRes = await modeApiRequest("POST", "/api/vouchers", {
          companyId: selectedCompany?.id,
          voucherType: adjustmentType,
          voucherNumber: `${adjustmentType.toUpperCase()}-${Date.now()}`,
          voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
          description: `Stock ${adjustmentType.toLowerCase()} at ${locations.find(l => l.id === data.locationId)?.name}`,
          totalAmount: totalAmount.toString(),
          optional: data.optional,
          currency: selectedCurrency,
          exchangeRate: exchangeRate ? exchangeRate.toString() : undefined,
        });
        const voucher = await voucherRes.json();

        // Create stock adjustment
        await modeApiRequest("POST", "/api/stock-adjustments", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-by-location"] });
      queryClient.invalidateQueries({ queryKey: ["/api/location-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-adjustments"] });
      
      // Clear edit mode and navigate back to daybook or reset form
      if (isEditMode) {
        setLocation(`${modePrefix}/daybook`);
      } else {
        stockAdjustmentForm.reset({
          voucherDate: new Date(),
          locationId: 0,
          entries: [
            {
              type: "PRODUCE",
              stockItemId: 0,
              stockItemCode: "",
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
      if (error?._handledGlobally) return;
      const isEditMode = !!voucherIdToEdit;
      toast({
        title: "Error",
        description: error.message || `Failed to ${isEditMode ? "update" : "create"} stock adjustment`,
        variant: "destructive",
      });
    },
  });

  // Export current Production/Consumption voucher to Excel
  const handleExportProductionConsumptionVoucher = async (detailed: boolean) => {
    const formData = stockAdjustmentForm.getValues();
    const voucherDate = formData.voucherDate ? format(formData.voucherDate, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
    const validEntries = formData.entries.filter((e: any) => e.stockItemId > 0 && parseFloat(e.quantity) > 0);
    
    if (validEntries.length === 0) {
      toast({
        title: "No data to export",
        description: "Add at least one entry before exporting.",
        variant: "destructive",
      });
      return;
    }
    
    const selectedLocation = locations?.find((l: any) => l.id === formData.locationId);
    const locationName = selectedLocation?.name || "";
    
    if (detailed) {
      // Detailed export - one row per entry
      const exportData = validEntries.map((entry: any) => ({
        "Entry Type": entry.type?.toUpperCase() === "CONSUME" ? "Consumption" : "Production",
        "Date": voucherDate,
        "Location": locationName,
        "Item Code": entry.stockItemCode || "",
        "Item Name": entry.stockItemName || "",
        "Quantity": parseFloat(entry.quantity).toFixed(2),
        "Rate": parseFloat(entry.rate || "0").toFixed(2),
        "Amount": (parseFloat(entry.quantity) * parseFloat(entry.rate || "0")).toFixed(2),
        "Notes": formData.notes || "",
        "Optional": formData.optional ? "Yes" : "No",
      }));
      
      const worksheet = utils.json_to_sheet(exportData);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Production-Consumption Detailed");
      const fileName = `Production_Consumption_Detailed_${voucherDate}.xlsx`;
      await writeFile(workbook, fileName);
      
      toast({
        title: "Export successful",
        description: `Downloaded ${fileName} with ${validEntries.length} items.`,
      });
    } else {
      // Summary export
      const consumeTotal = validEntries.filter((e: any) => e.type?.toUpperCase() === "CONSUME").reduce((sum: number, e: any) => sum + (parseFloat(e.quantity) * parseFloat(e.rate || "0")), 0);
      const produceTotal = validEntries.filter((e: any) => e.type?.toUpperCase() === "PRODUCE").reduce((sum: number, e: any) => sum + (parseFloat(e.quantity) * parseFloat(e.rate || "0")), 0);
      
      const exportData = [{
        "Voucher Type": "Production/Consumption",
        "Date": voucherDate,
        "Location": locationName,
        "Consumption Total": consumeTotal.toFixed(2),
        "Production Total": produceTotal.toFixed(2),
        "Number of Items": validEntries.length,
        "Notes": formData.notes || "",
        "Optional": formData.optional ? "Yes" : "No",
      }];
      
      const worksheet = utils.json_to_sheet(exportData);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Production-Consumption Summary");
      const fileName = `Production_Consumption_Summary_${voucherDate}.xlsx`;
      await writeFile(workbook, fileName);
      
      toast({
        title: "Export successful",
        description: `Downloaded ${fileName}.`,
      });
    }
  };

  // Export current Stock Transfer voucher to Excel
  const handleExportStockTransfer = async (detailed: boolean) => {
    const formData = stockTransferForm.getValues();
    const voucherDate = formData.voucherDate ? format(formData.voucherDate, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
    const validEntries = formData.entries.filter((e: any) => e.stockItemId > 0 && parseFloat(e.quantity) > 0);
    
    if (validEntries.length === 0) {
      toast({
        title: "No data to export",
        description: "Add at least one entry before exporting.",
        variant: "destructive",
      });
      return;
    }
    
    const destLocation = locations?.find((l: any) => l.id === formData.destinationLocationId);
    const destLocationName = destLocation?.name || "";
    
    if (detailed) {
      const exportData = validEntries.map((entry: any) => ({
        "Date": voucherDate,
        "Source Location": entry.sourceLocationName || "",
        "Destination Location": destLocationName,
        "Item Code": entry.stockItemCode || "",
        "Item Name": entry.stockItemName || "",
        "Quantity": parseFloat(entry.quantity).toFixed(2),
        "Rate": parseFloat(entry.rate || "0").toFixed(2),
        "Amount": (parseFloat(entry.quantity) * parseFloat(entry.rate || "0")).toFixed(2),
        "Notes": formData.notes || "",
        "Optional": formData.optional ? "Yes" : "No",
      }));
      
      const worksheet = utils.json_to_sheet(exportData);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Stock Transfer Detailed");
      const fileName = `Stock_Transfer_Detailed_${voucherDate}.xlsx`;
      await writeFile(workbook, fileName);
      
      toast({
        title: "Export successful",
        description: `Downloaded ${fileName} with ${validEntries.length} items.`,
      });
    } else {
      const totalQty = validEntries.reduce((sum: number, e: any) => sum + parseFloat(e.quantity), 0);
      const totalAmount = validEntries.reduce((sum: number, e: any) => sum + (parseFloat(e.quantity) * parseFloat(e.rate || "0")), 0);
      
      const exportData = [{
        "Voucher Type": "Stock Transfer",
        "Date": voucherDate,
        "Destination Location": destLocationName,
        "Total Items": validEntries.length,
        "Total Quantity": totalQty.toFixed(2),
        "Total Amount": totalAmount.toFixed(2),
        "Notes": formData.notes || "",
        "Optional": formData.optional ? "Yes" : "No",
      }];
      
      const worksheet = utils.json_to_sheet(exportData);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Stock Transfer Summary");
      const fileName = `Stock_Transfer_Summary_${voucherDate}.xlsx`;
      await writeFile(workbook, fileName);
      
      toast({
        title: "Export successful",
        description: `Downloaded ${fileName}.`,
      });
    }
  };

  const onStockAdjustmentSubmit = async (data: StockAdjustmentFormData) => {
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
  const handleKeyDown = async (
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
  const handleJournalKeyDown = async (
    e: React.KeyboardEvent,
    rowIndex: number,
    fieldName: "type" | "account" | "amount"
  ) => {
    const isLastRow = rowIndex === journalFields.length - 1;
    
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
            const nextTypeInput = document.querySelector(`[data-testid="input-journal-type-${rowIndex + 1}"]`) as HTMLElement;
            if (nextTypeInput) {
              nextTypeInput.focus();
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
          narration: "",
        });
      }
      setTimeout(() => {
        const nextRowInput = document.querySelector(`[data-testid="input-journal-type-${rowIndex + 1}"]`) as HTMLElement;
        if (nextRowInput) {
          nextRowInput.focus();
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
          narration: "",
        });
        setTimeout(() => {
          const newRowInput = document.querySelector(`[data-testid="input-journal-type-${rowIndex + 1}"]`) as HTMLElement;
          if (newRowInput) {
            newRowInput.focus();
          }
        }, 100);
      } else {
        // Not last row - move to DR/CR of next row
        setTimeout(() => {
          const nextRowInput = document.querySelector(`[data-testid="input-journal-type-${rowIndex + 1}"]`) as HTMLElement;
          if (nextRowInput) {
            nextRowInput.focus();
          }
        }, 50);
      }
    }
  };

  // Keyboard navigation handlers for Stock Transfer
  const handleTransferKeyDown = async (
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
            stockItemCode: "",
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
            stockItemCode: "",
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
  const handleAdjustmentKeyDown = async (
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
          stockItemCode: "",
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
    <div className="space-y-4 md:space-y-5">
      {/* Page header */}
      {isPOS ? (
        <PageHeader
          title="Stock Transfer"
          subtitle="Transfer stock between locations"
        />
      ) : (
        <div className="flex items-start justify-between gap-3 pb-4 border-b">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Vouchers</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Payments, receipts, journals and inventory transactions
            </p>
          </div>
        </div>
      )}

      {/* Hidden print template */}
      {!isPOS && (
        <div className="hidden">
          <div ref={printRef}>
            <PrintTemplate
              voucherType={activeTab === "payment" ? "Payment" : "Receipt"}
              paymentAccountName={paymentAccountName}
              date={form.watch("voucherDate")}
              entries={entries.filter((e) => e.accountId > 0 && e.amount)}
              notes={form.watch("notes") || ""}
              total={total}
              formatAmount={formatAmount}
              companyName={selectedCompany?.name || ""}
            />
          </div>
        </div>
      )}

      {/* Mobile tab selector — scrollable pills, visible on small screens only */}
      {!isPOS && (
        <div className="sm:hidden -mx-4 px-4 overflow-x-auto">
          <div className="flex gap-1.5 pb-1 w-max">
            {visibleSidebarGroups.flatMap((group) =>
              group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActiveTab(item.key as typeof activeTab)}
                    data-testid={`tab-mobile-${item.key}`}
                    className={cn(
                      "shrink-0 inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-sm font-medium border transition-colors",
                      isActive
                        ? "bg-accent text-accent-foreground border-accent/60"
                        : "bg-transparent text-muted-foreground border-border hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    {item.label}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      <div className="flex gap-5">
        {!isPOS && (
          <nav className="hidden sm:flex flex-col w-52 shrink-0 rounded-xl border bg-card p-2 gap-3 self-start sticky top-4" style={{ zIndex: 10 }}>
            {visibleSidebarGroups.map((group, groupIdx) => (
              <div key={group.label}>
                {groupIdx > 0 && <div className="border-t -mx-2 mb-1" />}
                {/* Section label with colored dot */}
                <div className="flex items-center gap-1.5 px-2 mb-1 mt-0.5">
                  <span
                    className="h-1.5 w-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: group.color }}
                  />
                  <p
                    className="text-[10px] font-semibold uppercase tracking-widest"
                    style={{ color: group.color, opacity: 0.85 }}
                  >
                    {group.label}
                  </p>
                </div>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setActiveTab(item.key as typeof activeTab)}
                        data-testid={`tab-${item.key}`}
                        className={cn(
                          "relative w-full flex items-center gap-2.5 px-2.5 h-8 rounded-lg text-sm transition-colors text-left",
                          isActive ? "font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground font-normal"
                        )}
                        style={isActive ? { backgroundColor: `${group.color}18`, color: group.color } : undefined}
                      >
                        {/* Active left rail */}
                        {isActive && (
                          <span
                            className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full"
                            style={{ backgroundColor: group.color }}
                          />
                        )}
                        {/* Icon tile when active, plain icon when not */}
                        {isActive ? (
                          <span
                            className="flex h-6 w-6 items-center justify-center rounded-md shrink-0"
                            style={{ backgroundColor: `${group.color}22` }}
                          >
                            <Icon className="h-3.5 w-3.5" style={{ color: group.color }} />
                          </span>
                        ) : (
                          <Icon className="h-4 w-4 shrink-0" />
                        )}
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        )}

        <div className="flex-1 min-w-0">
        {!isPOS && activeTab === "payment" && (
          <div className="space-y-4">
            {hasPaymentDraft && !voucherIdToEdit && paymentDraftAge && (
              <DraftRestorePrompt
                draftAge={paymentDraftAge}
                label="Unsaved payment draft found"
                onRestore={() => {
                  if (paymentDraft?.data) {
                    const d = paymentDraft.data as any;
                    form.reset({ ...d, voucherDate: d.voucherDate ? new Date(d.voucherDate) : new Date() });
                  }
                  discardPaymentDraft();
                }}
                onDiscard={discardPaymentDraft}
              />
            )}
            {/* Exchange Rate Input for multi-currency transactions */}
            {selectedCurrency === "CFA" && (
              <div className="flex flex-wrap items-center gap-2 sm:gap-4 p-3 bg-muted/30 rounded-md">
                <span className="text-sm text-muted-foreground">Transaction Rate:</span>
                <ExchangeRateInput
                  value={transactionRate}
                  onChange={setTransactionRate}
                  selectedCurrency={selectedCurrency}
                />
              </div>
            )}
            <PaymentVoucherTab
              form={form}
              fieldArray={fieldArray}
              entries={entries}
              total={total}
              paymentAccountId={paymentAccountId}
              paymentAccountType={paymentAccountType}
              paymentAccountName={paymentAccountName}
              accountBalance={accountBalance}
              accountCurrencyBalances={accountCurrencyBalances}
              allAccounts={allAccounts}
              sidebarAccounts={sidebarAccounts}
              isEditMode={!!voucherIdToEdit}
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
              handleExportVoucher={handleExportVoucher}
              onSubmit={onSubmit}
              activeTab="payment"
              activeRowIndex={activeRowIndex}
              setActiveRowIndex={setActiveRowIndex}
              onCreateAccount={() => handleOpenCreateAccountModal("payment", activeRowIndex ?? undefined)}
              isFactoryCompany={isFactoryCompany}
              onAutoCreateAccount={handleAutoCreateAccount}
              isAutoCreating={isAutoCreating}
              originalTotal={originalTotal}
              isPending={saveMutation.isPending}
              voucherNumber={voucherToEdit?.voucherNumber}
              onAccountPickerOpen={() => setAccountPickersNeeded(true)}
              onAccountSearchChange={setLiveAccountSearch}
            />
          </div>
        )}

        {!isPOS && activeTab === "receipt" && (
          <div className="space-y-4">
            {hasPaymentDraft && !voucherIdToEdit && paymentDraftAge && (
              <DraftRestorePrompt
                draftAge={paymentDraftAge}
                label="Unsaved receipt draft found"
                onRestore={() => {
                  if (paymentDraft?.data) {
                    const d = paymentDraft.data as any;
                    form.reset({ ...d, voucherDate: d.voucherDate ? new Date(d.voucherDate) : new Date() });
                  }
                  discardPaymentDraft();
                }}
                onDiscard={discardPaymentDraft}
              />
            )}
            {/* Exchange Rate Input for multi-currency transactions */}
            {selectedCurrency === "CFA" && (
              <div className="flex flex-wrap items-center gap-2 sm:gap-4 p-3 bg-muted/30 rounded-md">
                <span className="text-sm text-muted-foreground">Transaction Rate:</span>
                <ExchangeRateInput
                  value={transactionRate}
                  onChange={setTransactionRate}
                  selectedCurrency={selectedCurrency}
                />
              </div>
            )}
            <ReceiptVoucherTab
              form={form}
              fieldArray={fieldArray}
              entries={entries}
              total={total}
              paymentAccountId={paymentAccountId}
              paymentAccountType={paymentAccountType}
              paymentAccountName={paymentAccountName}
              accountBalance={accountBalance}
              accountCurrencyBalances={accountCurrencyBalances}
              allAccounts={allAccounts}
              sidebarAccounts={sidebarAccounts}
              isEditMode={!!voucherIdToEdit}
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
              handleExportVoucher={handleExportVoucher}
              onSubmit={onSubmit}
              activeTab="receipt"
              activeRowIndex={activeRowIndex}
              setActiveRowIndex={setActiveRowIndex}
              onCreateAccount={() => handleOpenCreateAccountModal("receipt", activeRowIndex ?? undefined)}
              isFactoryCompany={isFactoryCompany}
              onAutoCreateAccount={handleAutoCreateAccount}
              isAutoCreating={isAutoCreating}
              originalTotal={originalTotal}
              isPending={saveMutation.isPending}
              voucherNumber={voucherToEdit?.voucherNumber}
              onAccountPickerOpen={() => setAccountPickersNeeded(true)}
              onAccountSearchChange={setLiveAccountSearch}
            />
          </div>
        )}

        {/* Journal Voucher Tab */}
        {!isPOS && activeTab === "journal" && (
          <div className="space-y-4">
            {/* Exchange Rate Input for multi-currency transactions */}
            {selectedCurrency === "CFA" && (
              <div className="flex flex-wrap items-center gap-2 sm:gap-4 p-3 bg-muted/30 rounded-md">
                <span className="text-sm text-muted-foreground">Transaction Rate:</span>
                <ExchangeRateInput
                  value={transactionRate}
                  onChange={setTransactionRate}
                  selectedCurrency={selectedCurrency}
                />
              </div>
            )}
            <div className="flex flex-col lg:flex-row gap-4">
              {/* Left Panel - Form */}
              <Card className="flex-1 min-w-0">
                <CardContent className="pt-5">
                <div className="flex items-center gap-2 mb-5">
                  <span className="text-sm font-semibold">Journal Voucher</span>
                </div>
                {hasJournalDraft && !voucherIdToEdit && journalDraftAge && (
                  <div className="mb-4">
                    <DraftRestorePrompt
                      draftAge={journalDraftAge}
                      label="Unsaved journal draft found"
                      onRestore={() => {
                        if (journalDraft?.data) {
                          const d = journalDraft.data as any;
                          journalForm.reset({ ...d, voucherDate: d.voucherDate ? new Date(d.voucherDate) : new Date() });
                        }
                        discardJournalDraft();
                      }}
                      onDiscard={discardJournalDraft}
                    />
                  </div>
                )}
                <Form {...journalForm}>
                  <form noValidate onSubmit={journalForm.handleSubmit(onJournalSubmit)} className="space-y-5">
                    {/* Header row — title + date on one line */}
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div>
                        <p className="text-sm font-semibold">
                          {voucherToEdit?.voucherNumber ? `#${voucherToEdit.voucherNumber}` : "New Journal Entry"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">Debit and credit must balance</p>
                      </div>
                      <FormField
                        control={journalForm.control}
                        name="voucherDate"
                        render={({ field }) => (
                          <FormItem className="flex items-center gap-2 space-y-0">
                            <FormLabel className="text-sm text-muted-foreground shrink-0">Date</FormLabel>
                            <FormControl>
                              <Input
                                type="date"
                                value={field.value instanceof Date ? format(field.value, "yyyy-MM-dd") : (typeof field.value === "string" ? field.value : "")}
                                onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value + "T00:00:00") : new Date())}
                                className="w-[180px]"
                                data-testid="input-journal-date"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                  {/* ── Mobile journal cards (sm:hidden) ── */}
                  <div className="sm:hidden space-y-2">
                    {journalFields.map((field, index) => {
                      const entry = journalEntries[index];
                      const currentBalance = entry?.accountId > 0 ? getAccountBalance(entry.accountType, entry.accountId) : 0;
                      const entryAmount = parseFloat(entry?.amount || "0");
                      const isDebit = entry?.type === "DR";
                      const projectedBalance = isDebit ? currentBalance + entryAmount : currentBalance - entryAmount;
                      return (
                        <div key={field.id} className="border rounded-md p-3 space-y-2 bg-card">
                          <div className="flex items-start gap-2">
                            <FormField
                              control={journalForm.control}
                              name={`entries.${index}.type`}
                              render={({ field }) => (
                                <FormItem className="shrink-0">
                                  <Select value={field.value} onValueChange={(v: "DR" | "CR") => handleJournalTypeChange(index, v)}>
                                    <FormControl>
                                      <SelectTrigger className="w-16 text-center font-medium" data-testid={`input-journal-type-mobile-${index}`}>
                                        <SelectValue placeholder="DR" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="DR">DR</SelectItem>
                                      <SelectItem value="CR">CR</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </FormItem>
                              )}
                            />
                            <div className="flex-1 min-w-0">
                              <Input
                                value={activeJournalRow === index ? journalAccountSearchTerm : (entry?.accountName || "")}
                                onChange={(e) => {
                                  setJournalAccountSearchTerm(e.target.value);
                                  setJournalAccountHighlightedIndex(0);
                                }}
                                onFocus={() => {
                                  setAccountPickersNeeded(true);
                                  setActiveJournalRow(index);
                                  setShowAccountSidebar(true);
                                  setJournalAccountSearchTerm("");
                                }}
                                onBlur={() => {
                                  setTimeout(() => {
                                    if (activeJournalRow === index) {
                                      setJournalAccountSearchTerm("");
                                      setActiveJournalRow(null);
                                    }
                                  }, 200);
                                }}
                                placeholder="Type to search account..."
                                data-testid={`input-journal-account-mobile-${index}`}
                                className="text-sm"
                              />
                              {activeJournalRow === index && filteredJournalAccounts.length > 0 && (
                                <div className="mt-1 border rounded-md bg-popover shadow-md max-h-44 overflow-y-auto z-20 relative">
                                  {filteredJournalAccounts.slice(0, 10).map((account: any) => (
                                    <button
                                      key={`${account.type}-${account.id}`}
                                      type="button"
                                      className="w-full text-left px-3 py-2.5 text-sm hover-elevate border-b last:border-b-0"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        handleJournalAccountSelect(account);
                                        setShowAccountSidebar(false);
                                      }}
                                    >
                                      <div className="font-medium truncate">{account.name}</div>
                                    </button>
                                  ))}
                                </div>
                              )}
                              {entry?.accountId > 0 && (
                                <div className="text-xs text-muted-foreground pl-1 mt-0.5">
                                  New Bal: <span className={cn("font-mono", projectedBalance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                                    {formatAmount(Math.abs(projectedBalance))} {projectedBalance >= 0 ? "Dr" : "Cr"}
                                  </span>
                                </div>
                              )}
                            </div>
                            {journalFields.length > 1 && (
                              <Button type="button" variant="ghost" size="icon" onClick={() => removeJournal(index)} data-testid={`button-journal-remove-mobile-${index}`} className="shrink-0">
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                          <FormField
                            control={journalForm.control}
                            name={`entries.${index}.amount`}
                            render={({ field }) => (
                              <FormItem>
                                <div className="flex items-center gap-3">
                                  <span className="text-xs text-muted-foreground w-14 shrink-0">Amount</span>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      placeholder="0.00"
                                      className="font-mono text-right"
                                      data-testid={`input-journal-amount-mobile-${index}`}
                                      onBlur={(e) => {
                                        const v = Number(e.target.value);
                                        if (!isNaN(v) && v > 0 && selectedCurrency !== "USD") {
                                          journalForm.setValue(`entries.${index}.amount`, convertToUSD(v).toFixed(2));
                                        }
                                      }}
                                    />
                                  </FormControl>
                                </div>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={journalForm.control}
                            name={`entries.${index}.narration`}
                            render={({ field }) => (
                              <FormItem>
                                <div className="flex items-center gap-3">
                                  <span className="text-xs text-muted-foreground w-14 shrink-0">Narration</span>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      value={field.value ?? ""}
                                      placeholder="Optional note for this entry"
                                      className="text-sm"
                                      data-testid={`input-journal-narration-mobile-${index}`}
                                    />
                                  </FormControl>
                                </div>
                              </FormItem>
                            )}
                          />
                        </div>
                      );
                    })}
                    <div className="flex items-center justify-between pt-1 px-0.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => appendJournal({ type: "DR", accountType: "ledger", accountId: 0, accountName: "", amount: "", narration: "" })}
                        data-testid="button-journal-add-row-mobile"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Row
                      </Button>
                      <div className="text-right text-xs space-y-0.5">
                        <div className="text-muted-foreground">DR: {formatAmount(totalDebit)} | CR: {formatAmount(totalCredit)}</div>
                        <div className="font-bold font-mono">{formatAmount(Math.max(totalDebit, totalCredit))}</div>
                      </div>
                    </div>
                    {Math.abs(totalDebit - totalCredit) > 0.01 && (
                      <div className="text-center text-sm text-destructive p-2 bg-destructive/10 rounded-md">
                        DR/CR mismatch: {formatAmount(Math.abs(totalDebit - totalCredit))}
                      </div>
                    )}
                  </div>

                  {/* ── Desktop/tablet journal table (hidden on mobile) ── */}
                  <div className="hidden sm:block border rounded-xl overflow-hidden overflow-x-auto">
                    <table className="w-full min-w-[500px]">
                      <thead className="bg-muted/40">
                        <tr className="h-9">
                          <th className="text-left px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[10%]">DR/CR</th>
                          <th className="text-left px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[35%]">Account</th>
                          <th className="text-right px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[20%]">Amount</th>
                          <th className="text-left px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[28%]">Narration</th>
                          <th className="w-[7%]"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {journalFields.map((field, index) => (
                          <tr key={field.id} className="border-t hover:bg-muted/20 transition-colors">
                            <td className="p-2">
                              <FormField
                                control={journalForm.control}
                                name={`entries.${index}.type`}
                                render={({ field }) => (
                                  <FormItem>
                                    <Select
                                      value={field.value}
                                      onValueChange={(value: "DR" | "CR") => handleJournalTypeChange(index, value)}
                                    >
                                      <FormControl>
                                        <SelectTrigger 
                                          className={cn(
                                            "w-20 text-center font-semibold border",
                                            field.value === "DR"
                                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800"
                                              : "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800"
                                          )}
                                          data-testid={`input-journal-type-${index}`}
                                          onKeyDown={(e) => {
                                            if (e.key === "Tab" && !e.shiftKey) {
                                              e.preventDefault();
                                              setTimeout(() => {
                                                const accountInput = document.querySelector(`[data-testid="input-journal-account-${index}"]`) as HTMLInputElement;
                                                if (accountInput) accountInput.focus();
                                              }, 50);
                                            } else if (e.key === "ArrowRight") {
                                              e.preventDefault();
                                              setTimeout(() => {
                                                const accountInput = document.querySelector(`[data-testid="input-journal-account-${index}"]`) as HTMLInputElement;
                                                if (accountInput) accountInput.focus();
                                              }, 50);
                                            } else if (e.key === "ArrowLeft") {
                                              e.preventDefault();
                                              setTimeout(() => {
                                                const amountInput = document.querySelector(`[data-testid="input-journal-amount-${index}"]`) as HTMLInputElement;
                                                if (amountInput) {
                                                  amountInput.focus();
                                                  amountInput.select();
                                                }
                                              }, 50);
                                            } else if (e.key === "ArrowUp" && index > 0) {
                                              e.preventDefault();
                                              setTimeout(() => {
                                                const prevTypeInput = document.querySelector(`[data-testid="input-journal-type-${index - 1}"]`) as HTMLElement;
                                                if (prevTypeInput) prevTypeInput.focus();
                                              }, 50);
                                            } else if (e.key === "ArrowDown" && index < journalFields.length - 1) {
                                              e.preventDefault();
                                              setTimeout(() => {
                                                const nextTypeInput = document.querySelector(`[data-testid="input-journal-type-${index + 1}"]`) as HTMLElement;
                                                if (nextTypeInput) nextTypeInput.focus();
                                              }, 50);
                                            }
                                          }}
                                        >
                                          <SelectValue placeholder="DR" />
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
                                render={({ field }) => {
                                  const entry = journalEntries[index];
                                  const currentBalance = entry?.accountId > 0 
                                    ? getAccountBalance(entry.accountType, entry.accountId) 
                                    : 0;
                                  const entryAmount = parseFloat(entry?.amount || "0");
                                  const isDebit = entry?.type === "DR";
                                  // In the signed balance system: positive = Dr, negative = Cr
                                  // DR always adds to balance, CR always subtracts — same for all account types
                                  const projectedBalance = isDebit 
                                    ? currentBalance + entryAmount 
                                    : currentBalance - entryAmount;
                                  const displayBalance = projectedBalance;
                                    
                                  return (
                                    <FormItem>
                                      <FormControl>
                                        <div className="space-y-1">
                                          <Input
                                            value={activeJournalRow === index ? journalAccountSearchTerm : (entry?.accountName || "")}
                                            onChange={(e) => {
                                              setJournalAccountSearchTerm(e.target.value);
                                              setJournalAccountHighlightedIndex(0);
                                            }}
                                            onFocus={() => {
                                              setAccountPickersNeeded(true);
                                              setActiveJournalRow(index);
                                              setShowAccountSidebar(true);
                                              setJournalAccountSearchTerm("");
                                            }}
                                            onBlur={() => {
                                              setTimeout(() => {
                                                if (activeJournalRow === index) {
                                                  setJournalAccountSearchTerm("");
                                                  setActiveJournalRow(null);
                                                }
                                              }, 200);
                                            }}
                                            placeholder="Type to search..."
                                            data-testid={`input-journal-account-${index}`}
                                            onKeyDown={(e) => {
                                              // If sidebar is open, use arrow keys to navigate accounts
                                              if (showAccountSidebar) {
                                                if (e.key === "ArrowUp") {
                                                  e.preventDefault();
                                                  setJournalAccountHighlightedIndex(prev => 
                                                    prev > 0 ? prev - 1 : Math.max(0, filteredJournalAccounts.length - 1)
                                                  );
                                                  // Scroll highlighted item into view
                                                  setTimeout(() => {
                                                    const button = document.querySelector(`[data-testid="journal-account-option-${Math.max(0, journalAccountHighlightedIndex - 1)}"]`) as HTMLElement;
                                                    if (button) button.scrollIntoView({ block: "nearest" });
                                                  }, 0);
                                                } else if (e.key === "ArrowDown") {
                                                  e.preventDefault();
                                                  setJournalAccountHighlightedIndex(prev => 
                                                    prev < filteredJournalAccounts.length - 1 ? prev + 1 : 0
                                                  );
                                                  // Scroll highlighted item into view
                                                  setTimeout(() => {
                                                    const button = document.querySelector(`[data-testid="journal-account-option-${Math.min(journalAccountHighlightedIndex + 1, filteredJournalAccounts.length - 1)}"]`) as HTMLElement;
                                                    if (button) button.scrollIntoView({ block: "nearest" });
                                                  }, 0);
                                                } else if (e.key === "Enter") {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  const selectedAccount = filteredJournalAccounts[journalAccountHighlightedIndex];
                                                  if (selectedAccount) {
                                                    handleJournalAccountSelect(selectedAccount);
                                                    setShowAccountSidebar(false);
                                                  }
                                                }
                                                return;
                                              }

                                              // Normal row navigation when sidebar is not open
                                              if (e.key === "Tab" && !e.shiftKey) {
                                                e.preventDefault();
                                                setTimeout(() => {
                                                  const amountInput = document.querySelector(`[data-testid="input-journal-amount-${index}"]`) as HTMLInputElement;
                                                  if (amountInput) {
                                                    amountInput.focus();
                                                    amountInput.select();
                                                  }
                                                }, 50);
                                              } else if (e.key === "ArrowUp" && index > 0) {
                                                e.preventDefault();
                                                setTimeout(() => {
                                                  const prevInput = document.querySelector(`[data-testid="input-journal-account-${index - 1}"]`) as HTMLInputElement;
                                                  if (prevInput) prevInput.focus();
                                                }, 50);
                                              } else if (e.key === "ArrowDown" && index < journalFields.length - 1) {
                                                e.preventDefault();
                                                setTimeout(() => {
                                                  const nextInput = document.querySelector(`[data-testid="input-journal-account-${index + 1}"]`) as HTMLInputElement;
                                                  if (nextInput) nextInput.focus();
                                                }, 50);
                                              } else if (e.key === "ArrowRight") {
                                                e.preventDefault();
                                                setTimeout(() => {
                                                  const amountInput = document.querySelector(`[data-testid="input-journal-amount-${index}"]`) as HTMLInputElement;
                                                  if (amountInput) {
                                                    amountInput.focus();
                                                    amountInput.select();
                                                  }
                                                }, 50);
                                              } else if (e.key === "ArrowLeft") {
                                                e.preventDefault();
                                                setTimeout(() => {
                                                  const typeInput = document.querySelector(`[data-testid="input-journal-type-${index}"]`) as HTMLElement;
                                                  if (typeInput) typeInput.focus();
                                                }, 50);
                                              }
                                            }}
                                          />
                                          {entry?.accountId > 0 && (
                                            <div className="text-xs text-muted-foreground pl-1">
                                              <span>New Bal: <span className={cn("font-mono", displayBalance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                                                {formatAmount(Math.abs(displayBalance))} {displayBalance >= 0 ? "Dr" : "Cr"}
                                              </span></span>
                                            </div>
                                          )}
                                        </div>
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  );
                                }}
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
                                        onBlur={(e) => {
                                          const enteredAmount = Number(e.target.value);
                                          if (!isNaN(enteredAmount) && enteredAmount > 0 && selectedCurrency !== "USD") {
                                            const usdAmount = convertToUSD(enteredAmount);
                                            journalForm.setValue(`entries.${index}.amount`, usdAmount.toFixed(2));
                                          }
                                        }}
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
                                name={`entries.${index}.narration`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormControl>
                                      <Input
                                        {...field}
                                        value={field.value ?? ""}
                                        placeholder="Optional note…"
                                        className="text-sm h-8"
                                        data-testid={`input-journal-narration-${index}`}
                                      />
                                    </FormControl>
                                  </FormItem>
                                )}
                              />
                            </td>
                            <td className="p-2">
                              {journalFields.length > 1 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removeJournal(index)}
                                  data-testid={`button-journal-remove-${index}`}
                                >
                                  <X className="h-4 w-4 text-muted-foreground" />
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-muted/40 border-t">
                        <tr>
                          <td colSpan={5} className="px-3 py-2">
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
                                  narration: "",
                                })
                              }
                              data-testid="button-journal-add-row"
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Add Row
                            </Button>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Stats pill bar */}
                  <div className="flex flex-wrap gap-3">
                    <div className="rounded-lg border bg-muted/40 px-4 py-2 flex flex-col gap-0.5">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Total Debit</span>
                      <span className="text-sm font-semibold font-mono text-emerald-600 dark:text-emerald-400">{formatAmount(totalDebit)}</span>
                    </div>
                    <div className="rounded-lg border bg-muted/40 px-4 py-2 flex flex-col gap-0.5">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Total Credit</span>
                      <span className="text-sm font-semibold font-mono text-red-600 dark:text-red-400">{formatAmount(totalCredit)}</span>
                    </div>
                    <div className={cn(
                      "rounded-lg border px-4 py-2 flex items-center gap-2",
                      Math.abs(totalDebit - totalCredit) <= 0.01
                        ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800"
                        : "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800"
                    )}>
                      {Math.abs(totalDebit - totalCredit) <= 0.01 ? (
                        <>
                          <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Balanced</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                          <span className="text-sm font-medium text-red-700 dark:text-red-300">
                            Off by {formatAmount(Math.abs(totalDebit - totalCredit))}
                          </span>
                        </>
                      )}
                    </div>
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

                  {/* Bottom action row — Optional checkbox + Export + Save inline */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <FormField
                      control={journalForm.control}
                      name="optional"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center gap-2.5 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="checkbox-journal-optional"
                            />
                          </FormControl>
                          <FormLabel className="text-sm font-normal cursor-pointer">Mark as Optional</FormLabel>
                        </FormItem>
                      )}
                    />
                    <div className="flex items-center gap-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={journalEntries.filter((e) => e.accountId > 0 && parseFloat(e.amount) > 0).length === 0}
                            data-testid="button-export-journal-voucher"
                          >
                            <FileDown className="h-4 w-4 mr-2" />
                            Export
                            <ChevronDown className="h-4 w-4 ml-1" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleExportJournalVoucher(false)} data-testid="export-journal-summary">
                            Summary Export
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleExportJournalVoucher(true)} data-testid="export-journal-detailed">
                            Detailed Export
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        type="submit"
                        disabled={journalMutation.isPending || Math.abs(totalDebit - totalCredit) > 0.01}
                        data-testid="button-save-journal-voucher"
                      >
                        {journalMutation.isPending ? "Saving..." : "Save Journal Voucher"}
                      </Button>
                    </div>
                  </div>
                  </form>
                </Form>
                </CardContent>
              </Card>

              {/* Right Panel - Account Search Sidebar (hidden on mobile) */}
              {showAccountSidebar && (
                <Card className="hidden sm:flex flex-col w-full lg:w-80 lg:sticky lg:top-4 max-h-[60vh] lg:max-h-[calc(100vh-12rem)] self-start">
                  <div className="p-4 border-b">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <h3 className="text-sm font-semibold">Search Accounts</h3>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenCreateAccountModal("journal", activeJournalRow ?? undefined)}
                          data-testid="button-journal-create-account"
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          New
                        </Button>
                        <button 
                          onClick={() => setShowAccountSidebar(false)} 
                          className="text-xs text-muted-foreground hover:text-foreground" 
                          data-testid="button-close-account-sidebar"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <div className="relative">
                      {isAutoCreating ? (
                        <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
                      ) : (
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      )}
                      <Input
                        placeholder="Search by name or code..."
                        value={journalAccountSearchTerm}
                        onChange={(e) => {
                          setJournalAccountSearchTerm(e.target.value);
                          setJournalAccountHighlightedIndex(0);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowDown") {
                            e.preventDefault();
                            if (filteredJournalAccounts.length > 0) {
                              setJournalAccountHighlightedIndex(Math.min(journalAccountHighlightedIndex + 1, filteredJournalAccounts.length - 1));
                            }
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            if (filteredJournalAccounts.length > 0) {
                              setJournalAccountHighlightedIndex(Math.max(journalAccountHighlightedIndex - 1, 0));
                            }
                          } else if (e.key === "Enter") {
                            if (filteredJournalAccounts.length > 0 && journalAccountHighlightedIndex >= 0 && journalAccountHighlightedIndex < filteredJournalAccounts.length) {
                              e.preventDefault();
                              handleJournalAccountSelect(filteredJournalAccounts[journalAccountHighlightedIndex]);
                            }
                          }
                        }}
                        className="pl-9"
                        data-testid="input-journal-sidebar-search"
                        disabled={isAutoCreating}
                      />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2" ref={journalSidebarRef}>
                    <div className="space-y-1">
                      {filteredJournalAccounts.length === 0 ? (
                        <div className="text-center py-8 text-sm text-muted-foreground">
                          No accounts found
                        </div>
                      ) : (
                        filteredJournalAccounts.map((account, idx) => {
                          const isHighlighted = idx === journalAccountHighlightedIndex && activeJournalRow !== null;
                          const isSelected = journalEntries[activeJournalRow ?? 0]?.accountId === account.id &&
                                            journalEntries[activeJournalRow ?? 0]?.accountType === account.type;
                          const balance = getAccountBalance(account.type, account.id);
                          
                          return (
                            <button
                              key={`${account.type}-${account.id}`}
                              type="button"
                              onClick={() => handleJournalAccountSelect(account)}
                              className={cn(
                                "w-full text-left px-3 py-2 rounded-md text-sm hover-elevate active-elevate-2 flex items-center justify-between gap-2",
                                isHighlighted && "bg-accent",
                                isSelected && "bg-primary/10"
                              )}
                              data-testid={`journal-account-option-${idx}`}
                            >
                              <div className="flex-1 truncate">
                                <div className="font-medium truncate">{account.name}</div>
                              </div>
                              <div className={cn(
                                "text-xs font-mono",
                                // For liability accounts (employee/supplier), flip the color logic
                                // Positive balance = Cr (we owe them) = Red, Negative = Dr (they owe us) = Green
                                (account.type === "employee" || account.type === "supplier")
                                  ? (balance >= 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")
                                  : (balance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")
                              )}>
                                {formatAmount(Math.abs(balance))}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </Card>
              )}
            </div>
          </div>
        )}

        {(isPOS || activeTab === "transfer") && (
          <div className="space-y-4">
          <Form {...stockTransferForm}>
            <form noValidate onSubmit={stockTransferForm.handleSubmit(onStockTransferSubmit, (errors) => {
              console.error("Stock Transfer Form Validation Errors:", errors);
              toast({
                title: "Form Validation Error",
                description: Object.values(errors).map((e: any) => e?.message || JSON.stringify(e)).join(", ") || "Please check all fields",
                variant: "destructive",
              });
            })}>
              {/* Header Row */}
              <div className="flex flex-wrap items-center gap-2 sm:gap-4 mb-4">
                {isPOS && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">From:</span>
                    {myLocations.length > 1 ? (
                      <Select
                        value={posSelectedSourceId?.toString() || ""}
                        onValueChange={(v) => {
                          const newId = parseInt(v);
                          const newName = locations.find(l => l.id === newId)?.name || "";
                          setPosSelectedSourceId(newId);
                          setTransferInventorySource(newId);
                          const curEntries = stockTransferForm.getValues("entries");
                          curEntries.forEach((_, index) => {
                            stockTransferForm.setValue(`entries.${index}.sourceLocationId`, newId);
                            stockTransferForm.setValue(`entries.${index}.sourceLocationName`, newName);
                            stockTransferForm.setValue(`entries.${index}.stockItemId`, 0);
                            stockTransferForm.setValue(`entries.${index}.stockItemName`, "");
                            stockTransferForm.setValue(`entries.${index}.quantity`, "");
                          });
                        }}
                      >
                        <SelectTrigger className="w-[160px]" data-testid="select-source-location-pos">
                          <SelectValue placeholder="Select source..." />
                        </SelectTrigger>
                        <SelectContent>
                          {myLocations.map(l => (
                            <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="font-medium">{posSelectedSourceName || posLocationName}</span>
                    )}
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
                          <SelectTrigger className="w-full sm:w-[200px]" data-testid="select-destination-location">
                            <SelectValue placeholder="Select destination..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {[...locations]
                            .filter(l => l.id !== transferInventorySource)
                            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
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
                      <FormControl>
                        <Input
                          type="date"
                          value={field.value instanceof Date ? format(field.value, "yyyy-MM-dd") : (typeof field.value === "string" ? field.value : "")}
                          onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value + "T00:00:00") : new Date())}
                          className="w-full sm:w-[160px]"
                          data-testid="input-transfer-date"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="flex-1" />

                {!isPOS && voucherIdToEdit && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setLocation(`/stock-transfer-order?edit=${voucherIdToEdit}`)}
                    data-testid="button-switch-to-order-view"
                  >
                    <LayoutGrid className="h-4 w-4 mr-2" />
                    Order View
                  </Button>
                )}

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

              <div className="flex flex-col lg:flex-row gap-4">
                {/* Main Spreadsheet Area */}
                <Card className="flex-1 overflow-hidden min-w-0">

                  {/* ── Mobile: card-per-row (sm:hidden) ── */}
                  <div className="sm:hidden p-3 space-y-2">
                    {transferFields.map((field, index) => {
                      const entry = transferEntries[index];
                      const mobileFilteredItems = activeTransferRow === index && activeFieldType === 'item'
                        ? transferInventory
                            .filter((item: any) => {
                              if (!transferSearchTerm.trim()) return true;
                              const term = transferSearchTerm.toLowerCase();
                              return item.stockItemName?.toLowerCase().includes(term) || item.stockItemCode?.toLowerCase().includes(term);
                            })
                            .sort((a: any, b: any) => (a.stockItemName || '').localeCompare(b.stockItemName || ''))
                            .slice(0, 10)
                        : [];
                      const mobileFilteredLocs = activeTransferRow === index && activeFieldType === 'source'
                        ? locations
                            .filter((loc: any) => {
                              if (!transferSourceSearchTerm.trim()) return true;
                              const term = transferSourceSearchTerm.toLowerCase();
                              return (loc.name || '').toLowerCase().includes(term);
                            })
                            .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''))
                            .slice(0, 8)
                        : [];
                      return (
                        <div key={field.id} className="border rounded-md p-3 space-y-2 bg-card">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground font-medium">#{index + 1}</span>
                            {transferFields.length > 1 && (
                              <Button type="button" variant="ghost" size="icon" onClick={() => removeTransfer(index)} className="h-7 w-7" data-testid={`button-remove-transfer-mobile-${index}`}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                          {!isPOS && (
                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground">Source</label>
                              <input
                                type="text"
                                value={activeTransferRow === index && activeFieldType === 'source' ? transferSourceSearchTerm : (entry?.sourceLocationName || "")}
                                onChange={(e) => { setTransferSourceSearchTerm(e.target.value); setTransferSourceHighlightedIndex(0); }}
                                onFocus={() => {
                                  transferFocusIdRef.current += 1;
                                  setActiveTransferRow(index);
                                  setActiveFieldType('source');
                                  setTransferSourceSearchTerm(entry?.sourceLocationName || "");
                                  setTransferSourceHighlightedIndex(0);
                                  setShowSourceSidebar(true);
                                  setShowItemSidebar(false);
                                }}
                                onBlur={() => {
                                  const focusId = transferFocusIdRef.current;
                                  setTimeout(() => {
                                    if (transferFocusIdRef.current === focusId) {
                                      setActiveTransferRow(null);
                                      setActiveFieldType(null);
                                      setTransferSourceSearchTerm("");
                                      setShowSourceSidebar(false);
                                    }
                                  }, 250);
                                }}
                                placeholder="Type location..."
                                data-testid={`input-source-mobile-${index}`}
                                className="w-full px-3 py-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-ring"
                              />
                              {mobileFilteredLocs.length > 0 && (
                                <div className="border rounded-md bg-popover shadow-md max-h-36 overflow-y-auto z-20 relative">
                                  {mobileFilteredLocs.map((loc: any) => (
                                    <button key={loc.id} type="button" className="w-full text-left px-3 py-2 text-sm hover-elevate border-b last:border-b-0"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        stockTransferForm.setValue(`entries.${index}.sourceLocationId`, loc.id);
                                        stockTransferForm.setValue(`entries.${index}.sourceLocationName`, loc.name);
                                        setTransferInventorySource(loc.id);
                                        setTransferSourceSearchTerm("");
                                        setShowSourceSidebar(false);
                                      }}>
                                      {loc.name}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Item</label>
                            <input
                              type="text"
                              value={activeTransferRow === index && activeFieldType === 'item' ? transferSearchTerm : (entry?.stockItemName || "")}
                              onChange={(e) => {
                                setTransferSearchTerm(e.target.value);
                                setTransferHighlightedIndex(0);
                                if (!e.target.value) {
                                  stockTransferForm.setValue(`entries.${index}.stockItemId`, 0);
                                  stockTransferForm.setValue(`entries.${index}.stockItemCode`, "");
                                  stockTransferForm.setValue(`entries.${index}.stockItemName`, "");
                                }
                              }}
                              onFocus={() => {
                                transferFocusIdRef.current += 1;
                                setActiveTransferRow(index);
                                setActiveFieldType('item');
                                setTransferHighlightedIndex(0);
                                setTransferSearchTerm(entry?.stockItemName || "");
                                setShowItemSidebar(true);
                                setShowSourceSidebar(false);
                                if (entry?.sourceLocationId > 0) {
                                  setTransferInventorySource(entry.sourceLocationId);
                                } else if (isPOS && posSelectedSourceId) {
                                  setTransferInventorySource(posSelectedSourceId);
                                }
                              }}
                              onBlur={() => {
                                const focusId = transferFocusIdRef.current;
                                setTimeout(() => {
                                  if (transferFocusIdRef.current === focusId) {
                                    setActiveTransferRow(null);
                                    setActiveFieldType(null);
                                    setTransferSearchTerm("");
                                    setShowItemSidebar(false);
                                  }
                                }, 200);
                              }}
                              placeholder="Type to search item..."
                              data-testid={`input-item-name-mobile-${index}`}
                              className="w-full px-3 py-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-ring"
                            />
                            {mobileFilteredItems.length > 0 && (
                              <div className="border rounded-md bg-popover shadow-md max-h-40 overflow-y-auto z-20 relative">
                                {mobileFilteredItems.map((item: any) => (
                                  <button key={item.stockItemId} type="button" className="w-full text-left px-3 py-2 text-sm hover-elevate border-b last:border-b-0"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      const sourceId = Number(transferInventorySource);
                                      if (!(sourceId > 0)) return;
                                      const sourceLocation = locations.find((l: any) => l.id === sourceId);
                                      stockTransferForm.setValue(`entries.${index}.sourceLocationId`, sourceId, { shouldValidate: true });
                                      stockTransferForm.setValue(`entries.${index}.sourceLocationName`, sourceLocation?.name || "");
                                      stockTransferForm.setValue(`entries.${index}.stockItemId`, item.stockItemId, { shouldValidate: true });
                                      stockTransferForm.setValue(`entries.${index}.stockItemCode`, item.stockItemCode || "");
                                      stockTransferForm.setValue(`entries.${index}.stockItemName`, item.stockItemName);
                                      stockTransferForm.setValue(`entries.${index}.rate`, item.averageRate || "0");
                                      setTransferSearchTerm("");
                                      setShowItemSidebar(false);
                                    }}>
                                    <div className="font-medium truncate">{item.stockItemName}</div>
                                    <div className="text-xs text-muted-foreground">Qty: {formatNumber(item.quantity, 0)}</div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground">Qty</label>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={transferQtyDraft[`m${index}`] !== undefined ? transferQtyDraft[`m${index}`] : (entry?.quantity || "")}
                                onFocus={() => setTransferQtyDraft(prev => ({ ...prev, [`m${index}`]: entry?.quantity || "" }))}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  setTransferQtyDraft(prev => ({ ...prev, [`m${index}`]: raw }));
                                  if (!raw.startsWith("+") && !raw.startsWith("-")) {
                                    stockTransferForm.setValue(`entries.${index}.quantity`, raw);
                                  }
                                }}
                                onBlur={() => {
                                  const raw = (transferQtyDraft[`m${index}`] ?? "").trim();
                                  setTransferQtyDraft(prev => { const n = { ...prev }; delete n[`m${index}`]; return n; });
                                  const delta = parseFloat(raw.startsWith("+") ? raw.slice(1) : raw);
                                  if (isNaN(delta)) return;
                                  if (voucherIdToEdit && stockTransferToEdit?.items) {
                                    const origItem = (stockTransferToEdit.items as any[]).find(
                                      (item) => item.stockItemId === entry.stockItemId && item.sourceLocationId === entry.sourceLocationId
                                    );
                                    const origQty = origItem ? parseFloat(origItem.quantity) || 0 : 0;
                                    stockTransferForm.setValue(`entries.${index}.quantity`, Math.max(0, origQty + delta).toString());
                                  } else {
                                    stockTransferForm.setValue(`entries.${index}.quantity`, Math.max(0, delta).toString());
                                  }
                                }}
                                placeholder={voucherIdToEdit ? "-1 to reduce, 2 to add" : "0"}
                                data-testid={`input-transfer-quantity-mobile-${index}`}
                                className="w-full px-3 py-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-ring font-mono text-right"
                              />
                            </div>
                            {!isPOS && (
                              <div className="space-y-1">
                                <label className="text-xs text-muted-foreground">Rate</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={entry?.rate || ""}
                                  onChange={(e) => stockTransferForm.setValue(`entries.${index}.rate`, e.target.value)}
                                  placeholder="0.00"
                                  data-testid={`input-transfer-rate-mobile-${index}`}
                                  className="w-full px-3 py-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-ring font-mono text-right"
                                />
                              </div>
                            )}
                          </div>
                          {!isPOS && (
                            <div className="flex items-center justify-between px-1">
                              <span className="text-xs text-muted-foreground">Amount</span>
                              <span className="text-sm font-mono font-medium">
                                {formatAmount(parseFloat(entry?.quantity || "0") * parseFloat(entry?.rate || "0"))}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div className="flex items-center justify-between pt-1 px-0.5">
                      <Button type="button" variant="outline" size="sm"
                        onClick={() => appendTransfer({ sourceLocationId: 0, sourceLocationName: "", stockItemId: 0, stockItemCode: "", stockItemName: "", quantity: "", rate: "" })}
                        data-testid="button-add-transfer-row-mobile"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Row
                      </Button>
                      {!isPOS && (
                        <div className="font-bold font-mono text-sm">
                          Total: {formatAmount(transferTotal)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Desktop/tablet: existing spreadsheet (hidden on mobile) ── */}
                  <div className="hidden sm:block overflow-x-auto">
                    <div className="min-w-[400px]">
                      {/* Header */}
                      <div className="flex bg-muted/50 border-b sticky top-0 z-30">
                        <div className="w-10 sm:w-12 flex items-center justify-center border-r h-9 sm:h-10 font-medium text-xs">
                          #
                        </div>
                        {!isPOS && (
                          <div className="w-28 sm:w-40 flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm">
                            Source
                          </div>
                        )}
                        <div className="flex-1 min-w-[120px] flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm">
                          Item
                        </div>
                        <div className="w-16 sm:w-24 flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm">
                          Qty
                        </div>
                        {!isPOS && (
                          <>
                            <div className="w-16 sm:w-24 flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm">
                              Rate
                            </div>
                            <div className="w-20 sm:w-28 flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm bg-muted/30">
                              Amt
                            </div>
                          </>
                        )}
                        <div className="w-10 sm:w-12 flex items-center justify-center h-9 sm:h-10" />
                      </div>

                      {/* Rows */}
                      <div className="max-h-[calc(100vh-24rem)] overflow-y-auto">
                        {transferFields.map((field, index) => (
                          <div key={field.id} className="flex border-b hover-elevate">
                            <div className="w-10 sm:w-12 flex items-center justify-center border-r h-9 sm:h-10 text-xs text-muted-foreground">
                              {index + 1}
                            </div>
                            {!isPOS && (
                              <div className="w-28 sm:w-40 border-r h-9 sm:h-10">
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
                                        return (loc.name || '').toLowerCase().includes(term) || (loc.code && loc.code.toLowerCase().includes(term));
                                      })
                                      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                                    
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
                            <div className="flex-1 min-w-[120px] border-r h-9 sm:h-10">
                              <input
                                type="text"
                                value={activeTransferRow === index && activeFieldType === 'item' ? transferSearchTerm : (transferEntries[index]?.stockItemName || "")}
                                onChange={(e) => {
                                  setTransferSearchTerm(e.target.value);
                                  setTransferHighlightedIndex(0);
                                  if (!e.target.value) {
                                    stockTransferForm.setValue(`entries.${index}.stockItemId`, 0);
                                    stockTransferForm.setValue(`entries.${index}.stockItemCode`, "");
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
                                  } else if (isPOS && posSelectedSourceId) {
                                    setTransferInventorySource(posSelectedSourceId);
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
                                    .sort((a: any, b: any) => (a.stockItemName || '').localeCompare(b.stockItemName || ''));

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
                                      .sort((a: any, b: any) => (a.stockItemName || '').localeCompare(b.stockItemName || ''));
                                    
                                    if (filteredInventory.length > 0) {
                                      const item = filteredInventory[transferHighlightedIndex] || filteredInventory[0];
                                      const stockItem = stockItems.find(s => s.id === item.stockItemId);
                                      if (stockItem) {
                                        // Ensure we have a valid source location
                                        const sourceId = Number(transferInventorySource);
                                        if (!(sourceId > 0)) {
                                          toast({
                                            title: "Select a source location first",
                                            description: "Please select a source location from the inventory sidebar before adding items.",
                                            variant: "destructive",
                                          });
                                          return;
                                        }
                                        
                                        // Set source location - always set it from the current inventory source
                                        const sourceLocation = locations.find(l => l.id === sourceId);
                                        stockTransferForm.setValue(`entries.${index}.sourceLocationId`, sourceId, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
                                        stockTransferForm.setValue(`entries.${index}.sourceLocationName`, sourceLocation?.name || "");
                                        
                                        // Set item details
                                        stockTransferForm.setValue(`entries.${index}.stockItemId`, item.stockItemId, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
                                        stockTransferForm.setValue(`entries.${index}.stockItemCode`, stockItem.code || "");
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
                            <div className="w-16 sm:w-24 border-r h-9 sm:h-10">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={transferQtyDraft[index] !== undefined ? transferQtyDraft[index] : (transferEntries[index]?.quantity || "")}
                                onFocus={() => {
                                  setTransferQtyDraft(prev => ({ ...prev, [index]: transferEntries[index]?.quantity || "" }));
                                }}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  setTransferQtyDraft(prev => ({ ...prev, [index]: raw }));
                                  if (!raw.startsWith("+") && !raw.startsWith("-")) {
                                    stockTransferForm.setValue(`entries.${index}.quantity`, raw);
                                  }
                                }}
                                onBlur={(e) => {
                                  const raw = (transferQtyDraft[index] ?? e.target.value).trim();
                                  setTransferQtyDraft(prev => { const n = { ...prev }; delete n[index]; return n; });
                                  const delta = parseFloat(raw.startsWith("+") ? raw.slice(1) : raw);
                                  if (isNaN(delta)) return;
                                  if (voucherIdToEdit && stockTransferToEdit?.items) {
                                    const entry = stockTransferForm.getValues(`entries.${index}`);
                                    const origItem = (stockTransferToEdit.items as any[]).find(
                                      (item) => item.stockItemId === entry.stockItemId && item.sourceLocationId === entry.sourceLocationId
                                    );
                                    const origQty = origItem ? parseFloat(origItem.quantity) || 0 : 0;
                                    const newQty = Math.max(0, origQty + delta);
                                    stockTransferForm.setValue(`entries.${index}.quantity`, newQty.toString());
                                  } else {
                                    stockTransferForm.setValue(`entries.${index}.quantity`, Math.max(0, delta).toString());
                                  }
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
                                        stockItemCode: "",
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
                                placeholder={voucherIdToEdit ? "-1 to reduce, 2 to add" : "0"}
                                className="w-full h-full px-3 bg-transparent outline-none focus:bg-accent/20 font-mono text-right"
                                data-testid={`input-transfer-quantity-${index}`}
                              />
                            </div>
                            {!isPOS && (
                              <>
                                <div className="w-16 sm:w-24 border-r h-9 sm:h-10">
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
                                            stockItemCode: "",
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
                                <div className="w-20 sm:w-28 border-r h-9 sm:h-10 bg-muted/30 flex items-center justify-end px-2 sm:px-3 font-mono text-xs sm:text-sm">
                                  {formatAmount(parseFloat(transferEntries[index]?.quantity || "0") * parseFloat(transferEntries[index]?.rate || "0"))}
                                </div>
                              </>
                            )}
                            <div className="w-10 sm:w-12 flex items-center justify-center h-9 sm:h-10">
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
                    <div className="flex flex-wrap justify-end items-center gap-2 sm:gap-8 max-w-lg ml-auto">
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
                            {formatAmount(transferTotal)}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </Card>

                {/* Right Panel - Item Search (hidden on mobile) */}
                {showItemSidebar && (
                <Card className="hidden sm:flex flex-col w-full lg:w-80 lg:sticky lg:top-4 max-h-[60vh] lg:max-h-[calc(100vh-12rem)] self-start">
                  <div className="p-4 border-b">
                    <div className="flex items-center justify-between gap-2 mb-2">
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
                          .sort((a: any, b: any) => (a.stockItemName || '').localeCompare(b.stockItemName || ''));
                        
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
                                    // Ensure we have a valid source location
                                    const sourceId = Number(transferInventorySource);
                                    if (!(sourceId > 0)) {
                                      toast({
                                        title: "Select a source location first",
                                        description: "Please select a source location from the inventory sidebar before adding items.",
                                        variant: "destructive",
                                      });
                                      return;
                                    }
                                    
                                    // Set source location - always set it from the current inventory source
                                    const sourceLocation = locations.find(l => l.id === sourceId);
                                    stockTransferForm.setValue(`entries.${activeTransferRow}.sourceLocationId`, sourceId, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
                                    stockTransferForm.setValue(`entries.${activeTransferRow}.sourceLocationName`, sourceLocation?.name || "");
                                    
                                    // Set item details
                                    stockTransferForm.setValue(`entries.${activeTransferRow}.stockItemId`, item.stockItemId, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
                                    stockTransferForm.setValue(`entries.${activeTransferRow}.stockItemCode`, stockItem.code || "");
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

                {/* Right Panel - Source Location Search (hidden on mobile) */}
                {!isPOS && showSourceSidebar && (
                  <Card className="hidden sm:flex flex-col w-full lg:w-80 lg:sticky lg:top-4 max-h-[60vh] lg:max-h-[calc(100vh-12rem)] self-start">
                    <div className="p-4 border-b">
                      <div className="flex items-center justify-between gap-2 mb-2">
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
                              return (loc.name || '').toLowerCase().includes(term) || (loc.code && loc.code.toLowerCase().includes(term));
                            })
                            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                          
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
              <div className="mt-4 flex flex-wrap items-start gap-2 sm:gap-4">
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

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={transferEntries.filter(e => e.stockItemId > 0).length === 0}
                      data-testid="button-export-stock-transfer"
                    >
                      <FileDown className="h-4 w-4 mr-2" />
                      Export
                      <ChevronDown className="h-4 w-4 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleExportStockTransfer(false)} data-testid="export-transfer-summary">
                      Summary Export
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExportStockTransfer(true)} data-testid="export-transfer-detailed">
                      Detailed Export
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button
                  type="submit"
                  disabled={stockTransferMutation.isPending || transferEntries.filter(e => e.stockItemId > 0).length === 0}
                  data-testid="button-save-transfer-voucher"
                >
                  {stockTransferMutation.isPending ? "Saving..." : "Save Transfer"}
                </Button>
                {voucherIdToEdit && stockTransferToEdit?.id && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isTransferSavingRevision || transferEntries.filter(e => e.stockItemId > 0).length === 0}
                    onClick={handleTransferSaveAsRevision}
                    data-testid="button-save-transfer-revision"
                  >
                    <GitBranch className="h-4 w-4 mr-1" />
                    Save as Revision
                  </Button>
                )}
              </div>
            </form>
          </Form>

          {/* ── Revision Approve Dialog ── */}
          <Dialog open={!!approveRevisionTarget} onOpenChange={open => { if (!open) setApproveRevisionTarget(null); }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Approve Revision</DialogTitle>
                <DialogDescription>
                  The following quantity changes will be applied to the transfer. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              {approveRevisionTarget && (
                <div className="table-responsive rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left p-2 font-medium">Item</th>
                        <th className="text-right p-2 font-medium">Was</th>
                        <th className="text-right p-2 font-medium">Change</th>
                        <th className="text-right p-2 font-medium">Now</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(approveRevisionTarget.items ?? []).filter((item: any) => parseFloat(item.delta) !== 0).map((item: any, idx: number) => {
                        const delta = parseFloat(item.delta);
                        return (
                          <tr key={idx} className="border-t">
                            <td className="p-2 font-medium">{item.stockItemName}</td>
                            <td className="p-2 text-right font-mono text-muted-foreground">{formatNumber(parseFloat(item.originalQuantity), 0)}</td>
                            <td className={`p-2 text-right font-mono font-semibold ${delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                              {delta > 0 ? "+" : ""}{formatNumber(delta, 0)}
                            </td>
                            <td className="p-2 text-right font-mono font-semibold">{formatNumber(parseFloat(item.newQuantity), 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setApproveRevisionTarget(null)} data-testid="button-approve-revision-cancel">Cancel</Button>
                <Button
                  variant="default"
                  disabled={approveRevisionMutation.isPending}
                  onClick={() => approveRevisionTarget && approveRevisionMutation.mutate(approveRevisionTarget.id)}
                  data-testid="button-approve-revision-confirm"
                >
                  {approveRevisionMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Applying…</> : "Approve & Apply"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* ── Transfer Revision History Panel ── */}
          {voucherIdToEdit && stableTransferId && (
            <div className="mt-4 border rounded-xl overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-muted/40 hover:bg-muted/60 transition-colors text-left cursor-pointer select-none"
                onClick={() => setTransferRevisionsExpanded(v => !v)}
              >
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Revision History</span>
                  {transferRevisions.length > 0 && (
                    <Badge variant="secondary" className="ml-1 text-xs no-default-active-elevate">{transferRevisions.length}</Badge>
                  )}
                </div>
                {transferRevisionsExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </button>
              {transferRevisionsExpanded && (
                <div className="p-4 space-y-4">
                  {transferRevisions.length === 0 ? (
                    <EmptyState
                      icon={History}
                      title="No revisions yet"
                      description='Use "Save as Revision" to record tracked changes to this transfer.'
                    />
                  ) : (
                    transferRevisions.map((rev: any) => (
                      <div key={rev.id} className="border rounded-md overflow-hidden">
                        {/* Pending approval banner */}
                        {rev.optional && (
                          <div className="flex items-center justify-between gap-3 px-3 py-2 status-warning border-b">
                            <span className="text-xs font-medium">Pending POS adjustment — awaiting admin approval</span>
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => setApproveRevisionTarget(rev)}
                              data-testid={`button-approve-revision-${rev.id}`}
                            >
                              Approve
                            </Button>
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-3 p-3 bg-muted/40 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant={rev.optional ? "secondary" : "default"}>Rev {rev.revisionNumber}</Badge>
                            {rev.optional && <Badge variant="outline" className="text-xs">Reference Only</Badge>}
                            <span className="text-xs text-muted-foreground">{rev.revisionDate ? new Date(rev.revisionDate).toLocaleDateString() : ""}</span>
                            {rev.note && <span className="text-xs italic text-muted-foreground">"{rev.note}"</span>}
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground">Reference only:</span>
                            <Switch
                              checked={rev.optional}
                              onCheckedChange={async (checked) => {
                                try {
                                  await modeApiRequest("PATCH", `/api/stock-transfer-revisions/${rev.id}/optional`, { optional: checked });
                                } finally {
                                  // Always refetch after toggle (success or failure) so the UI is in sync
                                  setTransferRevisionsExpanded(true);
                                  queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers", lastKnownTransferIdRef.current, "revisions"] });
                                }
                              }}
                              data-testid={`switch-transfer-revision-optional-${rev.id}`}
                            />
                          </div>
                        </div>
                        {rev.items && rev.items.length > 0 && (
                          <div className="table-responsive">
                            <table className="w-full text-sm">
                              <thead className="bg-muted/30">
                                <tr>
                                  <th className="text-left p-2 font-medium">Item</th>
                                  <th className="text-left p-2 font-medium hidden sm:table-cell">From</th>
                                  <th className="text-right p-2 font-medium">Was</th>
                                  <th className="text-right p-2 font-medium">Change</th>
                                  <th className="text-right p-2 font-medium">Now</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rev.items.filter((item: any) => parseFloat(item.delta) !== 0).map((item: any, idx: number) => {
                                  const delta = parseFloat(item.delta);
                                  return (
                                    <tr key={idx} className="border-t">
                                      <td className="p-2 font-medium">{item.stockItemName}</td>
                                      <td className="p-2 text-muted-foreground hidden sm:table-cell">{item.sourceLocationName || "—"}</td>
                                      <td className="p-2 text-right font-mono text-muted-foreground">{formatNumber(parseFloat(item.originalQuantity), 0)}</td>
                                      <td className={`p-2 text-right font-mono font-semibold ${delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                                        {delta > 0 ? "+" : ""}{formatNumber(delta, 0)}
                                      </td>
                                      <td className="p-2 text-right font-mono font-semibold">{formatNumber(parseFloat(item.newQuantity), 0)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
          </div>
        )}

        {!isPOS && activeTab === "adjustment" && (
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-5">
              <div className="flex items-center gap-2 mb-5">
                <span className="text-sm font-semibold">Production / Consumption Voucher</span>
              </div>
              <Form {...stockAdjustmentForm}>
                <form noValidate onSubmit={stockAdjustmentForm.handleSubmit(onStockAdjustmentSubmit)} className="space-y-6">
                  {/* Header section */}
                  <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
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
                              {[...locations].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map((location) => (
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
                          <FormControl>
                            <Input
                              type="date"
                              value={field.value instanceof Date ? format(field.value, "yyyy-MM-dd") : (typeof field.value === "string" ? field.value : "")}
                              onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value + "T00:00:00") : new Date())}
                              className="w-full sm:w-[200px]"
                              data-testid="input-adjustment-date"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* UNIFIED PRODUCTION/CONSUMPTION TABLE WITH SIDEBAR */}
                  <div className="flex flex-col lg:flex-row gap-4">
                    {/* Main Spreadsheet Area */}
                    <Card className="flex-1 overflow-hidden min-w-0">

                      {/* ── Mobile: card-per-row (sm:hidden) ── */}
                      <div className="sm:hidden p-3 space-y-2">
                        {adjustmentFields.map((field, index) => {
                          const currentEntry = adjustmentEntries[index];
                          const inventoryItem = adjustmentItemsWithInventory.find(item => item.stockItemId === currentEntry?.stockItemId);
                          const availableQty = inventoryItem?.quantity || "0";
                          const rowAmount = parseFloat(currentEntry?.quantity || "0") * parseFloat(currentEntry?.rate || "0");
                          const mobileAdjItems = activeAdjustmentRow === index
                            ? filteredAdjustmentItems.slice(0, 10)
                            : [];
                          return (
                            <div key={field.id} className="border rounded-md p-3 space-y-2 bg-card">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-muted-foreground font-medium">#{index + 1}</span>
                                {adjustmentFields.length > 1 && (
                                  <Button type="button" variant="ghost" size="icon" onClick={() => removeAdjustment(index)} className="h-7 w-7" data-testid={`button-remove-adjustment-mobile-${index}`}>
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <label className="text-xs text-muted-foreground">Type (P/C)</label>
                                  <input
                                    type="text"
                                    value={currentEntry?.type === "PRODUCE" ? "Produce" : currentEntry?.type === "CONSUME" ? "Consume" : ""}
                                    onChange={(e) => {
                                      const val = e.target.value.toLowerCase();
                                      if (val.startsWith('p')) stockAdjustmentForm.setValue(`entries.${index}.type`, "PRODUCE");
                                      else if (val.startsWith('c')) stockAdjustmentForm.setValue(`entries.${index}.type`, "CONSUME");
                                    }}
                                    placeholder="p / c"
                                    data-testid={`input-adjustment-type-mobile-${index}`}
                                    className="w-full px-3 py-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-ring"
                                  />
                                </div>
                                {currentEntry?.stockItemId > 0 && (
                                  <div className="space-y-1">
                                    <label className="text-xs text-muted-foreground">Available</label>
                                    <div className="px-3 py-2 text-sm font-mono text-muted-foreground">{formatNumber(parseFloat(availableQty))}</div>
                                  </div>
                                )}
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs text-muted-foreground">Item</label>
                                <input
                                  type="text"
                                  value={activeAdjustmentRow === index ? adjustmentSearchTerm : (currentEntry?.stockItemName || "")}
                                  onChange={(e) => {
                                    setAdjustmentSearchTerm(e.target.value);
                                    setAdjustmentHighlightedIndex(0);
                                    if (!e.target.value) {
                                      stockAdjustmentForm.setValue(`entries.${index}.stockItemId`, 0);
                                      stockAdjustmentForm.setValue(`entries.${index}.stockItemCode`, "");
                                      stockAdjustmentForm.setValue(`entries.${index}.stockItemName`, "");
                                    }
                                  }}
                                  onFocus={() => {
                                    adjustmentFocusIdRef.current += 1;
                                    setActiveAdjustmentRow(index);
                                    setAdjustmentSearchTerm(currentEntry?.stockItemName || "");
                                    setAdjustmentHighlightedIndex(0);
                                    setShowAdjustmentSidebar(true);
                                  }}
                                  onBlur={() => {
                                    const focusId = adjustmentFocusIdRef.current;
                                    setTimeout(() => {
                                      if (adjustmentFocusIdRef.current === focusId) {
                                        setActiveAdjustmentRow(null);
                                        setAdjustmentSearchTerm("");
                                        setShowAdjustmentSidebar(false);
                                      }
                                    }, 200);
                                  }}
                                  placeholder="Type to search item..."
                                  data-testid={`input-adjustment-item-mobile-${index}`}
                                  className="w-full px-3 py-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-ring"
                                />
                                {mobileAdjItems.length > 0 && (
                                  <div className="border rounded-md bg-popover shadow-md max-h-40 overflow-y-auto z-20 relative">
                                    {mobileAdjItems.map((item: any) => (
                                      <button key={item.stockItemId} type="button" className="w-full text-left px-3 py-2 text-sm hover-elevate border-b last:border-b-0"
                                        onMouseDown={(e) => {
                                          e.preventDefault();
                                          stockAdjustmentForm.setValue(`entries.${index}.stockItemId`, item.stockItemId);
                                          stockAdjustmentForm.setValue(`entries.${index}.stockItemCode`, item.stockItemCode || "");
                                          stockAdjustmentForm.setValue(`entries.${index}.stockItemName`, item.stockItemName);
                                          stockAdjustmentForm.setValue(`entries.${index}.rate`, item.averageRate || "0");
                                          setAdjustmentSearchTerm("");
                                          setShowAdjustmentSidebar(false);
                                        }}>
                                        <div className="font-medium truncate">{item.stockItemName}</div>
                                        <div className="text-xs text-muted-foreground">Avail: {formatNumber(item.quantity)}</div>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <label className="text-xs text-muted-foreground">Qty</label>
                                  <input
                                    type="number"
                                    step="0.001"
                                    value={currentEntry?.quantity || ""}
                                    onChange={(e) => stockAdjustmentForm.setValue(`entries.${index}.quantity`, e.target.value)}
                                    placeholder="0"
                                    data-testid={`input-adjustment-qty-mobile-${index}`}
                                    className="w-full px-3 py-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-ring font-mono text-right"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-xs text-muted-foreground">Rate</label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={currentEntry?.rate || ""}
                                    onChange={(e) => stockAdjustmentForm.setValue(`entries.${index}.rate`, e.target.value)}
                                    placeholder="0.00"
                                    data-testid={`input-adjustment-rate-mobile-${index}`}
                                    className="w-full px-3 py-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-ring font-mono text-right"
                                  />
                                </div>
                              </div>
                              <div className="flex items-center justify-between px-1">
                                <span className="text-xs text-muted-foreground">Amount</span>
                                <span className={`text-sm font-mono font-medium ${currentEntry?.type === "CONSUME" ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
                                  {currentEntry?.type === "CONSUME" ? "-" : "+"}{formatAmount(rowAmount)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                        <div className="flex items-center justify-between pt-1 px-0.5">
                          <Button type="button" variant="outline" size="sm"
                            onClick={() => appendAdjustment({ type: "CONSUME", stockItemId: 0, stockItemCode: "", stockItemName: "", quantity: "", rate: "" })}
                            data-testid="button-add-adjustment-row-mobile"
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Add Row
                          </Button>
                          <div className="text-right text-xs space-y-0.5">
                            <div><span className="text-muted-foreground">Consume: </span><span className="text-destructive font-mono">{formatAmount(consumptionTotal)}</span></div>
                            <div><span className="text-muted-foreground">Produce: </span><span className="text-emerald-600 font-mono">{formatAmount(productionTotal)}</span></div>
                          </div>
                        </div>
                      </div>

                      {/* ── Desktop/tablet: existing spreadsheet (hidden on mobile) ── */}
                      <div className="hidden sm:block overflow-x-auto">
                        <div className="min-w-[400px]">
                          {/* Header */}
                          <div className="flex bg-muted/50 border-b sticky top-0 z-30">
                            <div className="w-10 sm:w-12 flex items-center justify-center border-r h-9 sm:h-10 font-medium text-xs">
                              #
                            </div>
                            <div className="w-16 sm:w-24 flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm">
                              Type
                            </div>
                            <div className="flex-1 min-w-[120px] flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm">
                              Item
                            </div>
                            <div className="w-16 sm:w-20 flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm text-muted-foreground">
                              Avail
                            </div>
                            <div className="w-16 sm:w-24 flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm">
                              Qty
                            </div>
                            <div className="w-16 sm:w-24 flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm">
                              Rate
                            </div>
                            <div className="w-20 sm:w-28 flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm bg-muted/30">
                              Amt
                            </div>
                            <div className="w-10 sm:w-12 flex items-center justify-center h-9 sm:h-10" />
                          </div>

                          {/* Rows */}
                          <div className="max-h-[calc(100vh-24rem)] overflow-y-auto">
                            {adjustmentFields.map((field, index) => {
                              const currentEntry = adjustmentEntries[index];
                              const inventoryItem = adjustmentItemsWithInventory.find(
                                item => item.stockItemId === currentEntry?.stockItemId
                              );
                              const availableQty = inventoryItem?.quantity || "0";
                              
                              return (
                                <div key={field.id} className="flex border-b hover-elevate">
                                  <div className="w-10 sm:w-12 flex items-center justify-center border-r h-9 sm:h-10 text-xs text-muted-foreground">
                                    {index + 1}
                                  </div>
                                  {/* Type column - accepts p/c keyboard shortcuts */}
                                  <div className="w-16 sm:w-24 border-r h-9 sm:h-10">
                                    <input
                                      type="text"
                                      value={currentEntry?.type === "PRODUCE" ? "Produce" : currentEntry?.type === "CONSUME" ? "Consume" : ""}
                                      onChange={(e) => {
                                        const val = e.target.value.toLowerCase();
                                        if (val.startsWith('p')) {
                                          stockAdjustmentForm.setValue(`entries.${index}.type`, "PRODUCE");
                                        } else if (val.startsWith('c')) {
                                          stockAdjustmentForm.setValue(`entries.${index}.type`, "CONSUME");
                                        }
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'p' || e.key === 'P') {
                                          e.preventDefault();
                                          stockAdjustmentForm.setValue(`entries.${index}.type`, "PRODUCE");
                                        } else if (e.key === 'c' || e.key === 'C') {
                                          e.preventDefault();
                                          stockAdjustmentForm.setValue(`entries.${index}.type`, "CONSUME");
                                        } else if (e.key === "Tab" && !e.shiftKey) {
                                          e.preventDefault();
                                          const itemInput = document.querySelector(`[data-testid="input-adjustment-item-${index}"]`) as HTMLInputElement;
                                          if (itemInput) { itemInput.focus(); itemInput.select(); }
                                        } else if (e.key === "ArrowDown") {
                                          e.preventDefault();
                                          const nextInput = document.querySelector(`[data-testid="input-adjustment-type-${index + 1}"]`) as HTMLInputElement;
                                          if (nextInput) nextInput.focus();
                                        } else if (e.key === "ArrowUp" && index > 0) {
                                          e.preventDefault();
                                          const prevInput = document.querySelector(`[data-testid="input-adjustment-type-${index - 1}"]`) as HTMLInputElement;
                                          if (prevInput) prevInput.focus();
                                        }
                                      }}
                                      placeholder="p/c"
                                      className="w-full h-full px-3 bg-transparent outline-none focus:bg-accent/20 text-sm"
                                      data-testid={`input-adjustment-type-${index}`}
                                    />
                                  </div>
                                  {/* Item Name column - triggers sidebar */}
                                  <div className="flex-1 min-w-[120px] border-r h-9 sm:h-10">
                                    <input
                                      type="text"
                                      value={activeAdjustmentRow === index ? adjustmentSearchTerm : (currentEntry?.stockItemName || "")}
                                      onChange={(e) => {
                                        setAdjustmentSearchTerm(e.target.value);
                                        setAdjustmentHighlightedIndex(0);
                                        if (!e.target.value) {
                                          stockAdjustmentForm.setValue(`entries.${index}.stockItemId`, 0);
                                          stockAdjustmentForm.setValue(`entries.${index}.stockItemCode`, "");
                                          stockAdjustmentForm.setValue(`entries.${index}.stockItemName`, "");
                                        }
                                      }}
                                      onFocus={() => {
                                        adjustmentFocusIdRef.current += 1;
                                        setActiveAdjustmentRow(index);
                                        setAdjustmentSearchTerm(currentEntry?.stockItemName || "");
                                        setAdjustmentHighlightedIndex(0);
                                        setShowAdjustmentSidebar(true);
                                      }}
                                      onBlur={() => {
                                        const focusIdAtBlur = adjustmentFocusIdRef.current;
                                        setTimeout(() => {
                                          if (adjustmentFocusIdRef.current === focusIdAtBlur) {
                                            setActiveAdjustmentRow(null);
                                            setAdjustmentSearchTerm("");
                                            setShowAdjustmentSidebar(false);
                                          }
                                        }, 200);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === "ArrowUp" && !e.shiftKey) {
                                          e.preventDefault();
                                          if (showAdjustmentSidebar && filteredAdjustmentItems.length > 0) {
                                            setAdjustmentHighlightedIndex(Math.max(0, adjustmentHighlightedIndex - 1));
                                          } else if (index > 0) {
                                            const prevInput = document.querySelector(`[data-testid="input-adjustment-item-${index - 1}"]`) as HTMLInputElement;
                                            if (prevInput) prevInput.focus();
                                          }
                                        } else if (e.key === "ArrowDown" && !e.shiftKey) {
                                          e.preventDefault();
                                          if (showAdjustmentSidebar && filteredAdjustmentItems.length > 0) {
                                            setAdjustmentHighlightedIndex(Math.min(filteredAdjustmentItems.length - 1, adjustmentHighlightedIndex + 1));
                                          } else if (index < adjustmentFields.length - 1) {
                                            const nextInput = document.querySelector(`[data-testid="input-adjustment-item-${index + 1}"]`) as HTMLInputElement;
                                            if (nextInput) nextInput.focus();
                                          }
                                        } else if (e.key === "Enter") {
                                          e.preventDefault();
                                          if (showAdjustmentSidebar && filteredAdjustmentItems.length > 0) {
                                            const item = filteredAdjustmentItems[adjustmentHighlightedIndex];
                                            if (item) {
                                              stockAdjustmentForm.setValue(`entries.${index}.stockItemId`, item.stockItemId);
                                              stockAdjustmentForm.setValue(`entries.${index}.stockItemCode`, item.stockItemCode || "");
                                              stockAdjustmentForm.setValue(`entries.${index}.stockItemName`, item.stockItemName);
                                              stockAdjustmentForm.setValue(`entries.${index}.rate`, item.averageRate || "0");
                                              setAdjustmentSearchTerm("");
                                              setShowAdjustmentSidebar(false);
                                              setTimeout(() => {
                                                const qtyInput = document.querySelector(`[data-testid="input-adjustment-qty-${index}"]`) as HTMLInputElement;
                                                if (qtyInput) { qtyInput.focus(); qtyInput.select(); }
                                              }, 50);
                                            }
                                          }
                                        } else if (e.key === "Tab" && !e.shiftKey) {
                                          e.preventDefault();
                                          setShowAdjustmentSidebar(false);
                                          const qtyInput = document.querySelector(`[data-testid="input-adjustment-qty-${index}"]`) as HTMLInputElement;
                                          if (qtyInput) { qtyInput.focus(); qtyInput.select(); }
                                        }
                                      }}
                                      placeholder="Type to search..."
                                      className="w-full h-full px-3 bg-transparent outline-none focus:bg-accent/20"
                                      data-testid={`input-adjustment-item-${index}`}
                                    />
                                  </div>
                                  {/* Available Qty column */}
                                  <div className="w-16 sm:w-20 border-r h-9 sm:h-10 bg-muted/20 flex items-center justify-end px-2 sm:px-3 font-mono text-xs sm:text-sm text-muted-foreground">
                                    {formatNumber(parseFloat(availableQty))}
                                  </div>
                                  {/* Quantity column - Enter goes to Rate */}
                                  <div className="w-16 sm:w-24 border-r h-9 sm:h-10">
                                    <input
                                      type="number"
                                      step="0.001"
                                      value={currentEntry?.quantity || ""}
                                      onChange={(e) => stockAdjustmentForm.setValue(`entries.${index}.quantity`, e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                                          e.preventDefault();
                                          const rateInput = document.querySelector(`[data-testid="input-adjustment-rate-${index}"]`) as HTMLInputElement;
                                          if (rateInput) { rateInput.focus(); rateInput.select(); }
                                        } else if (e.key === "ArrowDown") {
                                          e.preventDefault();
                                          const nextInput = document.querySelector(`[data-testid="input-adjustment-qty-${index + 1}"]`) as HTMLInputElement;
                                          if (nextInput) nextInput.focus();
                                        } else if (e.key === "ArrowUp" && index > 0) {
                                          e.preventDefault();
                                          const prevInput = document.querySelector(`[data-testid="input-adjustment-qty-${index - 1}"]`) as HTMLInputElement;
                                          if (prevInput) prevInput.focus();
                                        }
                                      }}
                                      placeholder="0"
                                      className="w-full h-full px-3 bg-transparent outline-none focus:bg-accent/20 font-mono text-right"
                                      data-testid={`input-adjustment-qty-${index}`}
                                    />
                                  </div>
                                  {/* Rate column - Enter creates new row or goes to next row */}
                                  <div className="w-16 sm:w-24 border-r h-9 sm:h-10">
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={currentEntry?.rate || ""}
                                      onChange={(e) => stockAdjustmentForm.setValue(`entries.${index}.rate`, e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          if (index === adjustmentFields.length - 1) {
                                            appendAdjustment({
                                              type: "CONSUME",
                                              stockItemId: 0,
                                              stockItemCode: "",
                                              stockItemName: "",
                                              quantity: "",
                                              rate: "",
                                            });
                                            setTimeout(() => {
                                              const newInput = document.querySelector(`[data-testid="input-adjustment-type-${index + 1}"]`) as HTMLInputElement;
                                              if (newInput) newInput.focus();
                                            }, 100);
                                          } else {
                                            const nextTypeInput = document.querySelector(`[data-testid="input-adjustment-type-${index + 1}"]`) as HTMLInputElement;
                                            if (nextTypeInput) nextTypeInput.focus();
                                          }
                                        } else if (e.key === "ArrowDown") {
                                          e.preventDefault();
                                          const nextInput = document.querySelector(`[data-testid="input-adjustment-rate-${index + 1}"]`) as HTMLInputElement;
                                          if (nextInput) nextInput.focus();
                                        } else if (e.key === "ArrowUp" && index > 0) {
                                          e.preventDefault();
                                          const prevInput = document.querySelector(`[data-testid="input-adjustment-rate-${index - 1}"]`) as HTMLInputElement;
                                          if (prevInput) prevInput.focus();
                                        }
                                      }}
                                      placeholder="0"
                                      className="w-full h-full px-3 bg-transparent outline-none focus:bg-accent/20 font-mono text-right"
                                      data-testid={`input-adjustment-rate-${index}`}
                                    />
                                  </div>
                                  {/* Amount column */}
                                  <div className="w-20 sm:w-28 border-r h-9 sm:h-10 bg-muted/30 flex items-center justify-end px-2 sm:px-3 font-mono text-xs sm:text-sm">
                                    {formatAmount(parseFloat(currentEntry?.quantity || "0") * parseFloat(currentEntry?.rate || "0"))}
                                  </div>
                                  {/* Delete button */}
                                  <div className="w-10 sm:w-12 flex items-center justify-center h-9 sm:h-10">
                                    {adjustmentFields.length > 1 && (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => removeAdjustment(index)}
                                        className="h-8 w-8"
                                        data-testid={`button-remove-adjustment-${index}`}
                                      >
                                        <X className="h-4 w-4 text-destructive" />
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Total Section */}
                      <div className="border-t bg-muted/20 p-4">
                        <div className="flex flex-wrap justify-between items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              appendAdjustment({
                                type: "CONSUME",
                                stockItemId: 0,
                                stockItemCode: "",
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
                          <div className="flex flex-wrap items-center gap-2 sm:gap-6">
                            <div className="text-xs text-muted-foreground">Total Qty:</div>
                            <div className="text-xs font-mono font-medium">
                              {formatNumber(adjustmentEntries.reduce((sum, e) => sum + parseFloat(e.quantity || "0"), 0))}
                            </div>
                            <div className="text-xs text-muted-foreground">Consume:</div>
                            <div className="text-xs font-mono font-medium text-destructive">
                              {formatAmount(consumptionTotal)}
                            </div>
                            <div className="text-xs text-muted-foreground">Produce:</div>
                            <div className="text-xs font-mono font-medium text-green-600">
                              {formatAmount(productionTotal)}
                            </div>
                            <div className="text-sm font-semibold">Total:</div>
                            <div className="text-sm font-bold font-mono" data-testid="text-adjustment-total">
                              {formatAmount(displayAdjustmentTotal)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </Card>

                    {/* Right Panel - Item Search Sidebar (hidden on mobile) */}
                    {showAdjustmentSidebar && (
                      <Card className="hidden sm:flex flex-col w-full lg:w-80 lg:sticky lg:top-4 max-h-[60vh] lg:max-h-[calc(100vh-12rem)] self-start">
                        <div className="p-4 border-b">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <h3 className="text-sm font-semibold">Search Items</h3>
                            <button 
                              onClick={() => setShowAdjustmentSidebar(false)} 
                              className="text-xs text-muted-foreground hover:text-foreground"
                              data-testid="button-close-adjustment-sidebar"
                            >
                              ✕
                            </button>
                          </div>
                          {adjustmentLocationId > 0 && (
                            <p className="text-xs text-muted-foreground mb-3">
                              {locations.find(l => l.id === adjustmentLocationId)?.name}
                            </p>
                          )}
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              placeholder="Search by name or code..."
                              value={adjustmentSearchTerm}
                              onChange={(e) => {
                                setAdjustmentSearchTerm(e.target.value);
                                setAdjustmentHighlightedIndex(0);
                              }}
                              className="pl-9"
                              data-testid="input-adjustment-sidebar-search"
                            />
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2" ref={adjustmentSidebarRef}>
                          <div className="space-y-1">
                            {filteredAdjustmentItems.length === 0 ? (
                              <div className="text-center py-8 text-sm text-muted-foreground">
                                {adjustmentLocationId > 0 ? "No items found" : "Select a location first"}
                              </div>
                            ) : (
                              filteredAdjustmentItems.map((item, idx) => {
                                const stock = parseFloat(item.quantity || "0");
                                const isHighlighted = idx === adjustmentHighlightedIndex && activeAdjustmentRow !== null;
                                
                                return (
                                  <button
                                    key={item.stockItemId}
                                    type="button"
                                    data-adjustment-idx={idx}
                                    className={`w-full text-left px-3 py-3 rounded-md hover-elevate active-elevate-2 ${
                                      stock === 0 ? "opacity-60" : ""
                                    } ${isHighlighted ? "bg-accent" : ""}`}
                                    data-testid={`button-adjustment-suggest-item-${item.stockItemId}`}
                                    onClick={() => {
                                      if (activeAdjustmentRow !== null) {
                                        stockAdjustmentForm.setValue(`entries.${activeAdjustmentRow}.stockItemId`, item.stockItemId);
                                        stockAdjustmentForm.setValue(`entries.${activeAdjustmentRow}.stockItemCode`, item.stockItemCode || "");
                                        stockAdjustmentForm.setValue(`entries.${activeAdjustmentRow}.stockItemName`, item.stockItemName);
                                        stockAdjustmentForm.setValue(`entries.${activeAdjustmentRow}.rate`, item.averageRate || "0");
                                        setAdjustmentSearchTerm("");
                                        setShowAdjustmentSidebar(false);
                                        
                                        setTimeout(() => {
                                          const qtyInput = document.querySelector(`[data-testid="input-adjustment-qty-${activeAdjustmentRow}"]`) as HTMLInputElement;
                                          if (qtyInput) { qtyInput.focus(); qtyInput.select(); }
                                        }, 50);
                                      }
                                    }}
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex-1 min-w-0">
                                        <div className="font-medium text-sm truncate">{item.stockItemName}</div>
                                        <div className="text-xs text-muted-foreground">{item.stockItemCode}</div>
                                      </div>
                                      <div className="text-right">
                                        <div className={`text-sm font-mono ${stock > 0 ? 'text-green-600' : 'text-muted-foreground'}`}>
                                          {formatNumber(stock)}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                          @{formatAmount(item.averageRate || "0")}
                                        </div>
                                      </div>
                                    </div>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </Card>
                    )}
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
                  <div className="flex flex-wrap justify-end gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={adjustmentEntries.filter((e: any) => e.stockItemId > 0 && parseFloat(e.quantity) > 0).length === 0}
                          data-testid="button-export-production-consumption"
                        >
                          <FileDown className="h-4 w-4 mr-2" />
                          Export
                          <ChevronDown className="h-4 w-4 ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleExportProductionConsumptionVoucher(false)} data-testid="export-prod-cons-summary">
                          Summary Export
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleExportProductionConsumptionVoucher(true)} data-testid="export-prod-cons-detailed">
                          Detailed Export
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
          </div>
        )}

        {!isPOS && activeTab === "creditnote" && (
          <div className="space-y-4">
            <CreditNoteTab allAccounts={allAccounts} editVoucherId={activeTab === "creditnote" ? editVoucherId : null} />
          </div>
        )}

        {!isPOS && activeTab === "transferorder" && (
          <StockTransferOrder />
        )}

        </div>
      </div>

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

      {/* Transfer Revision Note Dialog */}
      <Dialog open={transferRevisionDialogOpen} onOpenChange={setTransferRevisionDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              Save as Revision
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will update the transfer <strong>and</strong> record the changes as{" "}
              <strong>Rev {transferRevisions.length + 1}</strong>.
            </p>
            {(() => {
              const items = computeTransferRevisionItems();
              return items.length === 0 ? (
                <p className="text-sm status-warning rounded-md px-3 py-2">
                  No differences detected compared to the saved transfer.
                </p>
              ) : (
                <div className="border rounded-md overflow-hidden text-sm">
                  <table className="w-full">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2 font-medium">Item</th>
                        <th className="text-right p-2 font-medium">Was</th>
                        <th className="text-right p-2 font-medium">Change</th>
                        <th className="text-right p-2 font-medium">Now</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="p-2 font-medium truncate max-w-[120px]">{item.stockItemName}</td>
                          <td className="p-2 text-right font-mono text-muted-foreground">{formatNumber(item.originalQuantity, 0)}</td>
                          <td className={`p-2 text-right font-mono font-semibold ${item.delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                            {item.delta > 0 ? "+" : ""}{formatNumber(item.delta, 0)}
                          </td>
                          <td className="p-2 text-right font-mono">{formatNumber(item.newQuantity, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
            <div className="space-y-1.5">
              <Label htmlFor="transfer-revision-note">Note (optional)</Label>
              <Textarea
                id="transfer-revision-note"
                placeholder="Why was this revised? e.g. Shop sold 10 bales"
                value={transferRevisionNote}
                onChange={(e) => setTransferRevisionNote(e.target.value)}
                rows={2}
                data-testid="input-transfer-revision-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferRevisionDialogOpen(false)} disabled={isTransferSavingRevision}>
              Cancel
            </Button>
            <Button
              onClick={confirmTransferSaveAsRevision}
              disabled={isTransferSavingRevision || computeTransferRevisionItems().length === 0}
              data-testid="button-confirm-transfer-revision"
            >
              {isTransferSavingRevision ? "Saving..." : "Save Revision"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stock Transfer Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="w-[95vw] sm:max-w-4xl max-h-[90vh] overflow-y-auto">
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
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex-1 w-full sm:w-auto">
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
                    {[...locations].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map((location) => (
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
                {/* Desktop table */}
                <div className="hidden sm:block max-h-60 overflow-y-auto overflow-x-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-20 bg-background">
                      <TableRow>
                        <TableHead className="sticky left-0 bg-muted z-10">Source Location</TableHead>
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
                            <TableCell className="sticky left-0 bg-background z-10">{item.sourceLocation || "-"}</TableCell>
                            <TableCell className="font-mono">{item.barcode}</TableCell>
                            <TableCell>
                              {validation?.stockItemName || (
                                <span className="text-muted-foreground italic">Unknown</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">{item.quantity}</TableCell>
                            <TableCell className="text-right">
                              {validation?.currentStock !== undefined ? formatNumber(validation.currentStock) : "-"}
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
                {/* Mobile card list */}
                <div className="sm:hidden max-h-60 overflow-y-auto p-2 space-y-2">
                  {importPreview.items.map((item: any, index: number) => {
                    const validation = importValidationResult?.validatedItems?.[index];
                    const hasError = validation?.error;

                    return (
                      <div
                        key={index}
                        className={cn(
                          "p-3 rounded-md border text-sm space-y-1",
                          hasError ? "bg-destructive/10 border-destructive/30" : "bg-background"
                        )}
                        data-testid={`import-preview-card-${index}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate">
                            {validation?.stockItemName || (
                              <span className="text-muted-foreground italic">Unknown</span>
                            )}
                          </span>
                          {validation ? (
                            hasError ? (
                              <XCircle className="h-4 w-4 text-destructive shrink-0" />
                            ) : (
                              <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                            )
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>Source: {item.sourceLocation || "-"}</span>
                          <span className="font-mono">Code: {item.barcode}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                          <span>Qty: <span className="font-mono">{item.quantity}</span></span>
                          <span>Avail: <span className="font-mono">{validation?.currentStock !== undefined ? formatNumber(validation.currentStock) : "-"}</span></span>
                        </div>
                        {hasError && (
                          <div className="text-xs text-destructive">{validation.error}</div>
                        )}
                      </div>
                    );
                  })}
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

      {/* Create Account Modal */}
      <CreateAccountModal
        open={showCreateAccountModal}
        onClose={() => {
          setShowCreateAccountModal(false);
          setCreateAccountContext(null);
        }}
        companyId={selectedCompany?.id || 0}
        onAccountCreated={handleAccountCreated}
        apiRequestFn={modeApiRequest}
      />

      {/* WhatsApp Statement Prompt */}
      <AlertDialog open={!!waPendingPrompt} onOpenChange={(open) => { if (!open) setWaPendingPrompt(null); }}>
        <AlertDialogContent data-testid="dialog-whatsapp-prompt">
          <AlertDialogHeader>
            <AlertDialogTitle>Send Statement via WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              A WhatsApp statement is configured for this account. Would you like to send the{" "}
              <strong>{waPendingPrompt?.month}</strong> statement now, or skip and send it manually later?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              data-testid="button-whatsapp-skip"
              onClick={() => setWaPendingPrompt(null)}
            >
              Skip for Now
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-whatsapp-send"
              disabled={sendWaStatementMutation.isPending}
              onClick={() => waPendingPrompt && sendWaStatementMutation.mutate(waPendingPrompt)}
            >
              {sendWaStatementMutation.isPending ? "Sending..." : "Send Now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
