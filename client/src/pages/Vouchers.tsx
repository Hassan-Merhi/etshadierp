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
import { StockTransferForm } from "@/pages/vouchers/StockTransferForm";
import { StockAdjustmentForm } from "@/pages/vouchers/StockAdjustmentForm";

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

const voucherFormSchema = z.object({
  paymentAccountType: z.enum(["ledger", "bank", "supplier", "employee", "fixedAsset", "customer", "factorySupplier"]),
  paymentAccountId: z.number().min(1, "Please select an account"),
  paymentAccountName: z.string(),
  voucherDate: z.date(),
  entries: z.array(voucherEntrySchema).min(1, "Add at least one entry"),
  notes: z.string().optional(),
  optional: z.boolean().default(false),
});

type VoucherFormData = z.infer<typeof voucherFormSchema>;

// Account Combobox Component
export default function Vouchers({ posUser }: VouchersProps = {}) {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const isFactoryCompany = selectedCompany?.companyType === "factory";
  const isPropertiesCompany = selectedCompany?.companyType === "properties";
  const { data: myErpPages } = useQuery<{ hiddenErpCostFields?: string[] }>({ queryKey: ["/api/my-erp-pages"] });
  const hideVoucherAmounts = (myErpPages?.hiddenErpCostFields ?? []).includes("voucher_amounts");
  const [isAutoCreating, setIsAutoCreating] = useState(false);
  const { formatDisplayDate } = useDateFormat();
  const { formatAmount, selectedCurrency, convertToUSD, exchangeRate: dailyExchangeRate } = useCurrencyContext();
  // Transaction-specific exchange rate (allows override of daily rate for rate-locking)
  const [transactionRate, setTransactionRate] = useState<number | null>(null);
  // Use transaction rate if set, otherwise fall back to daily rate
  const exchangeRate = transactionRate || dailyExchangeRate;
  const [voucherEffectiveDate, setVoucherEffectiveDate] = useState<string>("");
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
    enabled: accountPickersNeeded && !!selectedCompany && !isPropertiesCompany,
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
    enabled: debouncedAccountSearch.length >= 2 && !!selectedCompany && !isPropertiesCompany,
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
      // Initialize effective date from voucher
      setVoucherEffectiveDate(voucherToEdit.effectiveDate || "");
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
        effectiveDate: voucherEffectiveDate || null,
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
              effectiveDate={voucherEffectiveDate}
              onEffectiveDateChange={setVoucherEffectiveDate}
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
              effectiveDate={voucherEffectiveDate}
              onEffectiveDateChange={setVoucherEffectiveDate}
            />
          </div>
        )}

        {/* Journal Voucher Tab */}
        {!isPOS && activeTab === "journal" && (
          <JournalForm voucherIdToEdit={voucherIdToEdit} isPOS={isPOS} />
        )}


        {(isPOS || activeTab === "transfer") && (
          <StockTransferForm voucherIdToEdit={voucherIdToEdit} isPOS={isPOS} posUser={posUser} />
        )}

        {!isPOS && activeTab === "adjustment" && (
          <StockAdjustmentForm voucherIdToEdit={voucherIdToEdit} isPOS={isPOS} />
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
