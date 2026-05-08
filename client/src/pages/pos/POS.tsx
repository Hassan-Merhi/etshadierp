import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation as useLocationContext } from "@/contexts/LocationContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useLocation, Redirect, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { MapPin, Wallet, Printer, AlertCircle, Search, Check, Trash2, User, Upload, ArrowLeft, FileDown, ChevronDown, Plus, Pencil, X, Send } from "lucide-react";
import { utils, writeFile } from "@/lib/excelHelper";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiRequest, queryClient, getAppDate, invalidateCustomerBalances } from "@/lib/queryClient";
import { useCurrencyContext, type Currency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { useReactToPrint } from "react-to-print";
import { formatNumber } from "@/lib/formatNumber";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface SaleRow {
  id: string;
  itemName: string;
  stockItemCode?: string;
  quantity: number;
  rate: number;
  rateUSD: number; // Canonical USD rate for storage (never converted)
  amount: number;
  stockItemId?: number;
  salesItemId?: number; // Original sales item ID for edit mode
  configuredPrice?: number; // Configured selling price for P/L calculation (USD)
}

interface InventoryItem {
  code: string;
  name: string;
  stock: number;
  price: number;
  configuredPrice: number; // Configured selling price (for P/L)
}

interface APIInventoryItem {
  inventoryId: number;
  locationId: number;
  stockItemId: number;
  quantity: string;
  averageRate: string;
  totalValue: string;
  lastSellingPrice?: string;
  stockItemCode: string;
  stockItemName: string;
  stockItemUom: string;
  stockGroupId: number | null;
  stockGroupName: string | null;
  stockGroupCode: string | null;
}

interface Location {
  id: number;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
}

// Retries the WhatsApp PDF upload up to `maxAttempts` times.
// - Retries on network failures and 5xx/502 (transient WhatsApp/Green API hiccups).
// - Does NOT retry on 4xx (e.g. missing config, invalid location) — those are permanent.
// - Calls onAttempt(n) before each attempt so the UI can show "Retrying… (2/3)".
async function sendWaPdfWithRetry(
  body: { pdfBase64: string; locationId?: number; filename: string; caption: string },
  opts: { maxAttempts?: number; delayMs?: number; onAttempt?: (n: number) => void } = {},
): Promise<{ ok: true } | { ok: false; message: string; attempts: number }> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const delayMs     = opts.delayMs     ?? 2000;
  let lastMessage   = "WhatsApp send failed";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    opts.onAttempt?.(attempt);
    try {
      const res = await apiRequest("POST", "/api/pos/send-whatsapp-pdf-upload", body);
      const respBody = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true };

      lastMessage = respBody.message || `WhatsApp send failed (HTTP ${res.status})`;
      // Permanent client error — no point retrying.
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        return { ok: false, message: lastMessage, attempts: attempt };
      }
    } catch (e: any) {
      lastMessage = e?.message || "Network error";
    }

    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, delayMs * attempt));
    }
  }
  return { ok: false, message: lastMessage, attempts: maxAttempts };
}

// Server-side invoice PDF send — generates PDF on the backend
async function sendInvoicePdfWithRetry(
  voucherId: number,
  locationId: number,
  opts: { maxAttempts?: number; delayMs?: number; onAttempt?: (n: number) => void } = {},
): Promise<{ ok: true } | { ok: false; message: string }> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const delayMs     = opts.delayMs     ?? 2000;
  let lastMessage   = "WhatsApp send failed";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    opts.onAttempt?.(attempt);
    try {
      const res = await apiRequest("POST", "/api/pos/send-invoice-pdf-backend", { voucherId, locationId });
      const respBody = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true };

      lastMessage = respBody.message || `WhatsApp send failed (HTTP ${res.status})`;
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        return { ok: false, message: lastMessage };
      }
    } catch (e: any) {
      lastMessage = e?.message || "Network error";
    }

    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, delayMs * attempt));
    }
  }
  return { ok: false, message: lastMessage };
}

// Server-side stock PDF send — generates PDF on the backend (multi-page safe)
async function sendStockPdfWithRetry(
  locationId: number,
  opts: { maxAttempts?: number; delayMs?: number; onAttempt?: (n: number) => void } = {},
): Promise<{ ok: true } | { ok: false; message: string }> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const delayMs     = opts.delayMs     ?? 2000;
  let lastMessage   = "WhatsApp send failed";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    opts.onAttempt?.(attempt);
    try {
      const res = await apiRequest("POST", "/api/pos/send-stock-pdf-backend", { locationId });
      const respBody = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true };

      lastMessage = respBody.message || `WhatsApp send failed (HTTP ${res.status})`;
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        return { ok: false, message: lastMessage };
      }
    } catch (e: any) {
      lastMessage = e?.message || "Network error";
    }

    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, delayMs * attempt));
    }
  }
  return { ok: false, message: lastMessage };
}

export default function POS({ posUser, editVoucherId }: { posUser?: any; editVoucherId?: string } = {}) {
  const { selectedLocation, setSelectedLocation } = useLocationContext();
  const { selectedCompany } = useCompany();
  const [_location, navigate] = useLocation();

  // For POS users, fetch their assigned locations (multi-location support)
  const { data: posAssignedLocations = [], isLoading: posLocationsLoading } = useQuery<Location[]>({
    queryKey: posUser ? ["/api/my-locations"] : [],
    enabled: !!posUser,
    retry: false,
  });

  // POS user selected location state
  const [posSelectedLocation, setPosSelectedLocation] = useState<Location | null>(null);

  // Auto-select first assigned location for POS users when locations load
  useEffect(() => {
    if (posUser && posAssignedLocations.length > 0 && !posSelectedLocation) {
      setPosSelectedLocation(posAssignedLocations[0]);
    }
  }, [posUser, posAssignedLocations, posSelectedLocation]);

  const locationLoading = posUser ? posLocationsLoading : false;
  const locationError = posUser && !posLocationsLoading && posAssignedLocations.length === 0;

  // Fetch all locations for the dropdown (non-POS users only)
  const { data: allLocations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
    enabled: !posUser,
  });

  const { data: companySettings } = useQuery<any>({
    queryKey: ["/api/company-settings"],
    enabled: !!posUser,
  });
  const showPosImport = !posUser || companySettings?.posExcelImportEnabled;

  // Use either the selected location (for Admin/Owner/Manager) or POS user's selected location
  const activeLocation = posUser ? posSelectedLocation : selectedLocation;

  // Fetch inventory for the active location
  const { data: apiInventory = [], isLoading: inventoryLoading, error: inventoryError } = useQuery<APIInventoryItem[]>({
    queryKey: activeLocation ? [`/api/locations/${activeLocation.id}/inventory`] : [],
    enabled: !!activeLocation,
    retry: false,
  });

  // Transform API inventory to POS format with stockItemId
  // Coalesce null/undefined names and codes to prevent toLowerCase() errors
  const inventory: (InventoryItem & { stockItemId: number })[] = (Array.isArray(apiInventory) ? apiInventory : []).map((item) => ({
    code: (item.stockItemCode || "").trim(),
    name: (item.stockItemName || "Unknown Item").trim(),
    stock: parseFloat(item.quantity),
    price: parseFloat(item.lastSellingPrice || item.averageRate),
    configuredPrice: parseFloat(item.lastSellingPrice || "0"),
    stockItemId: item.stockItemId,
  }));

  // Fetch bank accounts for payment account selector
  const { data: bankAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/bank-accounts"],
    enabled: !!activeLocation, // Only fetch when location is selected
  });

  // Fetch cash ledger accounts
  const { data: allLedgerAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger-accounts"],
    enabled: !!activeLocation,
  });

  // Filter cash ledger accounts
  const cashLedgerAccounts = (Array.isArray(allLedgerAccounts) ? allLedgerAccounts : []).filter((acc: any) => acc.accountType === "Cash");

  // Cash account info now comes from posSelectedLocation (per-location mapping)
  // assignedCashAccount is no longer used — kept disabled to avoid breaking other code
  const { data: assignedCashAccount } = useQuery<any>({
    queryKey: [],
    enabled: false,
  });

  // Fetch drafts for current user and location
  const { data: drafts = [], refetch: refetchDrafts } = useQuery<any[]>({
    queryKey: activeLocation ? [`/api/pos/drafts?locationId=${activeLocation.id}`] : [],
    enabled: !!activeLocation,
  });

  // Fix 1: Fetch current open shift for POS users
  const { data: currentShift } = useQuery<any>({
    queryKey: posUser && activeLocation ? ["/api/pos/shifts/current", { locationId: activeLocation.id }] : [],
    enabled: !!posUser && !!activeLocation,
    retry: false,
    refetchInterval: 60_000,
  });
  // Non-POS users never need a shift; POS users need one open to sell
  const hasOpenShift = !posUser || (!!currentShift && currentShift.status === "open");

  // Fetch authenticated user for printing (fallback when posUser not available)
  const { data: authUser } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  // Compute the username to display on printed invoices
  // Priority: posUser fields (if POS login) -> authUser fields (if regular login)
  const printUserName = posUser?.fullName || posUser?.username || posUser?.email 
    || authUser?.fullName || authUser?.name || authUser?.username || authUser?.email 
    || 'Unknown';

  // Fetch last sold prices for stock items (from any location in the company)
  const { data: lastSoldPrices = {} } = useQuery<Record<number, string>>({
    queryKey: activeLocation ? [`/api/pos/last-sold-prices`, { locationId: activeLocation.id }] : [],
    queryFn: async () => {
      if (!activeLocation) return {};
      const response = await fetch(`/api/pos/last-sold-prices?locationId=${activeLocation.id}`, {
        credentials: "include",
      });
      if (!response.ok) return {};
      return await response.json();
    },
    enabled: !!activeLocation,
  });

  // Fetch customer accounts (Asset-type ledger accounts for receivables)
  const customerAccounts = (Array.isArray(allLedgerAccounts) ? allLedgerAccounts : []).filter((acc: any) => acc.accountType === "Asset");

  const [isCreditSale, setIsCreditSale] = useState(false);
  const [customerComboOpen, setCustomerComboOpen] = useState(false);

  // Fetch POS customers to show balance on credit sales
  const { data: posCustomers = [] } = useQuery<any[]>({
    queryKey: ["/api/pos/customers"],
    enabled: isCreditSale,
    retry: false,
  });

  // Fetch voucher details if in edit mode
  const { data: editVoucher, isLoading: editVoucherLoading } = useQuery<any>({
    queryKey: editVoucherId ? [`/api/vouchers/${editVoucherId}`] : [],
    enabled: !!editVoucherId,
  });

  const { selectedCurrency, exchangeRate: dailyExchangeRate, convertToUSD, displayCurrency, formatAmount, formatAmountRaw } = useCurrencyContext();
  // Use global currency from context (force USD if company doesn't have dual-currency enabled)
  const activeCurrency: Currency = displayCurrency ? selectedCurrency : "USD";
  // Use the daily exchange rate from context
  const exchangeRate = dailyExchangeRate;
  
  const [rows, setRows] = useState<SaleRow[]>([
    { id: "1", itemName: "", quantity: 0, rate: 0, rateUSD: 0, amount: 0 },
  ]);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number }>({
    row: 0,
    col: 0,
  });
  const [paymentAccountType, setPaymentAccountType] = useState<"bank" | "cash" | "credit">("cash");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const selectedCustomer = isCreditSale && selectedCustomerId
    ? posCustomers.find((c: any) => String(c.id) === selectedCustomerId)
    : null;
  const [notes, setNotes] = useState("");
  const [saleDate, setSaleDate] = useState(getAppDate());
  const [searchTerm, setSearchTerm] = useState("");
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [zeroStockAlert, setZeroStockAlert] = useState(false);
  const [zeroStockItem, setZeroStockItem] = useState("");
  const [savedSale, setSavedSale] = useState<any>(null);
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const [showDraftDialog, setShowDraftDialog] = useState(false);
  const [currentDraftId, setCurrentDraftId] = useState<number | null>(null);
  const [printTime, setPrintTime] = useState<string>("");
  const inputRefs = useRef<{ [key: string]: HTMLInputElement }>({});
  const itemListRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const stockPrintRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const [lastAutosaved, setLastAutosaved] = useState<Date | null>(null);
  const lastSavedFingerprintRef = useRef<string>("");
  const autoSaveInProgressRef = useRef(false);
  // Holds the timeout that clears activeRow when the inline item cell loses
  // focus — cancelled when focus moves into the search panel so activeRow stays
  // intact while the user is editing via the search panel.
  const clearActiveRowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientSaleIdRef = useRef<string>(crypto.randomUUID());

  // Refs that mirror the latest state values — used by the autosave interval so
  // it doesn't need those values in its dependency array (which would reset the
  // 30-second timer on every keystroke, preventing autosave from ever firing).
  const autoSaveStateRef = useRef({
    activeLocation: null as any,
    rows: [] as any[],
    notes: "",
    isCreditSale: false,
    paymentAccountType: "",
    paymentAccountId: null as string | null,
    selectedCustomerId: null as string | null,
    currentDraftId: null as number | null,
    saveDraftIsPending: false,
  });

  // Callback ref so react-to-print gets notified when the invoice template mounts/unmounts
  const printCallbackRef = useCallback((el: HTMLDivElement | null) => {
    printRef.current = el;
  }, []);

  // Deferred WhatsApp invoice send — fires after sale is saved
  const [pendingAutoSend, setPendingAutoSend] = useState<{
    voucherId: number; locationId: number; locationName: string;
    companyName: string; voucherNumber: string; voucherDate: string;
  } | null>(null);

  // Stock WhatsApp auto-send state
  type StockWaStatus = "idle" | "sending" | "sent" | "failed" | "not_configured";
  const [stockWaStatus, setStockWaStatus]       = useState<StockWaStatus>("idle");
  const [pendingStockSend, setPendingStockSend] = useState(false);

  // Invoice WhatsApp auto-send status (mirrors stockWaStatus for UI feedback)
  type InvoiceWaStatus = "idle" | "sending" | "sent" | "failed";
  const [invoiceWaStatus, setInvoiceWaStatus] = useState<InvoiceWaStatus>("idle");

  // Mobile-specific state
  const [mobileItemSearchOpen, setMobileItemSearchOpen] = useState(false);
  const [mobileItemSearchTerm, setMobileItemSearchTerm] = useState("");
  const [mobileItemSearchTarget, setMobileItemSearchTarget] = useState<number | null>(null);
  const [mobileRowEditOpen, setMobileRowEditOpen] = useState(false);
  const [mobileRowEditIndex, setMobileRowEditIndex] = useState<number | null>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);
  const [saleJustCompleted, setSaleJustCompleted] = useState(false);
  const [showStockPrompt, setShowStockPrompt] = useState(false);
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
  const [sendingInvoiceWhatsApp, setSendingInvoiceWhatsApp] = useState(false);

  // Keep autoSaveStateRef in sync so the interval can read latest values without
  // being in the dependency array (which would reset the 30-second timer on every keystroke).
  // NOTE: saveDraftIsPending is updated separately after saveDraftMutation is declared
  // (further down) to avoid a Temporal Dead Zone crash that would prevent this
  // entire assignment from running — which would keep currentDraftId stuck at null
  // and cause every autosave to create a brand-new draft.
  autoSaveStateRef.current.activeLocation = activeLocation;
  autoSaveStateRef.current.rows = rows;
  autoSaveStateRef.current.notes = notes;
  autoSaveStateRef.current.isCreditSale = isCreditSale;
  autoSaveStateRef.current.paymentAccountType = paymentAccountType;
  autoSaveStateRef.current.paymentAccountId = paymentAccountId;
  autoSaveStateRef.current.selectedCustomerId = selectedCustomerId;
  autoSaveStateRef.current.currentDraftId = currentDraftId;

  // Reset sale state when POS user switches location
  const prevLocationRef = useRef<number | null>(null);
  useEffect(() => {
    if (posUser && posSelectedLocation) {
      if (prevLocationRef.current !== null && prevLocationRef.current !== posSelectedLocation.id) {
        setRows([{ id: "1", itemName: "", quantity: 0, rate: 0, rateUSD: 0, amount: 0 }]);
        setSearchTerm("");
        setActiveRow(null);
        setCurrentDraftId(null);
        setNotes("");
      }
      prevLocationRef.current = posSelectedLocation.id;
    }
  }, [posUser, posSelectedLocation]);

  // Auto-set cash account for POS users from their selected location's per-location mapping
  useEffect(() => {
    const locCashId = (posSelectedLocation as any)?.cashAccountId;
    if (posUser && locCashId) {
      setPaymentAccountType("cash");
      setPaymentAccountId(String(locCashId));
    } else if (posUser && posSelectedLocation && !locCashId) {
      setPaymentAccountId(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(posSelectedLocation as any)?.id]);

  // Set location from edit voucher when in edit mode
  useEffect(() => {
    if (editVoucher && editVoucher.locationId && !selectedLocation && allLocations.length > 0) {
      const voucherLocation = allLocations.find(loc => loc.id === editVoucher.locationId);
      if (voucherLocation) {
        setSelectedLocation(voucherLocation);
      }
    }
  }, [editVoucher, allLocations, selectedLocation, setSelectedLocation]);

  // Auto-select first account when loaded based on account type (for non-POS users)
  useEffect(() => {
    // POS users get cash account from per-location mapping — skip generic auto-selection
    if (posUser) return;
    
    if (paymentAccountType === "bank" && bankAccounts.length > 0 && !paymentAccountId) {
      setPaymentAccountId(String(bankAccounts[0].id));
    } else if (paymentAccountType === "cash" && cashLedgerAccounts.length > 0 && !paymentAccountId) {
      setPaymentAccountId(String(cashLedgerAccounts[0].id));
    }
  }, [paymentAccountType, bankAccounts, cashLedgerAccounts, paymentAccountId, posUser]);

  // Reset account selection when switching account type (disabled for POS users with assigned account)
  useEffect(() => {
    if (posUser?.cashAccountId) return; // Don't reset for POS users
    setPaymentAccountId("");
  }, [paymentAccountType, posUser]);

  // Populate form when editing existing voucher
  useEffect(() => {
    if (editVoucher && Array.isArray(editVoucher.salesItems) && editVoucher.salesItems.length > 0) {
      
      // Populate rows with sales items, preserving salesItemId for edit mode
      const newRows: SaleRow[] = editVoucher.salesItems.map((item: any, index: number) => ({
        id: String(index + 1),
        itemName: item.stockItemName || "",
        stockItemCode: item.stockItemCode || "",
        stockItemId: item.stockItemId,
        salesItemId: item.id, // Preserve original sales item ID for proper cost tracking
        quantity: parseFloat(item.quantity),
        rate: parseFloat(item.sellingPrice),
        rateUSD: parseFloat(item.sellingPrice), // Stored rates are in USD
        amount: parseFloat(item.totalSales),
        configuredPrice: parseFloat(item.configuredPrice || "0") || undefined,
      }));
      
      // Add a blank row at the end for adding new items
      newRows.push({
        id: String(newRows.length + 1),
        itemName: "",
        quantity: 0,
        rate: 0,
        rateUSD: 0,
        amount: 0,
      });
      
      setRows(newRows);

      // Populate notes
      if (editVoucher.description) {
        setNotes(editVoucher.description);
      }

      // Populate date from voucher
      if (editVoucher.voucherDate) {
        setSaleDate(editVoucher.voucherDate);
      }

      // Note: currency and exchange rate come from global context

      // Populate payment account and credit sale info from voucher entries
      if (editVoucher.entries && editVoucher.entries.length > 0) {
        
        // Find the debit entry (the payment account)
        const debitEntry = editVoucher.entries.find((entry: any) => 
          parseFloat(entry.debitAmount || "0") > 0
        );
        
        if (debitEntry) {
          
          // Bank account - has bankAccountId
          if (debitEntry.bankAccountId) {
            setPaymentAccountType("bank");
            setPaymentAccountId(String(debitEntry.bankAccountId));
            setIsCreditSale(false);
          } 
          // Ledger account - need to determine if cash or credit
          else if (debitEntry.ledgerAccountId) {
            // Find the ledger account in our loaded accounts
            const ledgerAccount = allLedgerAccounts.find((acc: any) => acc.id === debitEntry.ledgerAccountId);
            
            if (ledgerAccount) {
              // Cash account
              if (ledgerAccount.accountType === "Cash") {
                setPaymentAccountType("cash");
                setPaymentAccountId(String(debitEntry.ledgerAccountId));
                setIsCreditSale(false);
              } 
              // Customer/Receivable account (Asset type for customers, or could be other types)
              else {
                setPaymentAccountType("credit");
                setPaymentAccountId(String(debitEntry.ledgerAccountId));
                setIsCreditSale(true);
              }
            } else {
              // Fallback: use narration to detect if it's credit sale
              const isCreditSaleEntry = debitEntry.narration?.includes('Credit Sale');
              if (isCreditSaleEntry) {
                setPaymentAccountType("credit");
                setIsCreditSale(true);
              } else {
                setPaymentAccountType("cash");
                setIsCreditSale(false);
              }
              setPaymentAccountId(String(debitEntry.ledgerAccountId));
            }
          }
        }
      }
    }
  }, [editVoucher, allLedgerAccounts]);

  // Scroll highlighted item into view in the sidebar list
  useEffect(() => {
    if (itemListRef.current && activeRow !== null) {
      const listContainer = itemListRef.current.children[0] as HTMLElement;
      const highlightedElement = listContainer?.children[highlightedIndex] as HTMLElement;
      if (highlightedElement) {
        highlightedElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [highlightedIndex, activeRow]);

  // Invoice WhatsApp auto-send — backend generates the PDF server-side.
  useEffect(() => {
    if (!pendingAutoSend) return;
    const data = pendingAutoSend;
    setPendingAutoSend(null);

    const doSend = async () => {
      setSendingInvoiceWhatsApp(true);
      setInvoiceWaStatus("sending");
      try {
        const result = await sendInvoicePdfWithRetry(
          data.voucherId,
          data.locationId,
          {
            onAttempt: (n) => {
              if (n > 1) {
                toast({ title: "Retrying…", description: `WhatsApp invoice send attempt ${n}/3.` });
              }
            },
          },
        );
        if (!result.ok) {
          setInvoiceWaStatus("failed");
          toast({ title: "WhatsApp", description: result.message, variant: "destructive" });
        } else {
          setInvoiceWaStatus("sent");
        }
      } catch (e: any) {
        setInvoiceWaStatus("failed");
        toast({ title: "WhatsApp", description: e.message || "Could not send invoice.", variant: "destructive" });
      } finally {
        setSendingInvoiceWhatsApp(false);
      }
    };
    doSend();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoSend]);

  // Warn user about unsaved changes when leaving the page
  useEffect(() => {
    const hasUnsavedChanges = rows.some(row => row.itemName && row.quantity > 0);

    const handleBeforeUnload = async (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = ''; // Modern browsers require this
      }
    };

    if (hasUnsavedChanges) {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [rows]);

  useEffect(() => {
    window.__escBackGuard = () => {
      return rows.some(row => row.itemName && row.quantity > 0);
    };
    window.__escBackConfirm = () => {
      setRows([{ id: "1", itemName: "", quantity: 0, rate: 0, rateUSD: 0, amount: 0 }]);
    };
    return () => {
      delete window.__escBackGuard;
      delete window.__escBackConfirm;
    };
  }, [rows]);

  // Save sale mutation (handles both create and update)
  const saveMutation = useMutation({
    mutationFn: async (saleData: any) => {
      if (editVoucherId) {
        // Update existing voucher - use the PUT sales voucher update endpoint
        // which properly handles inventory reversal and cost preservation
        const updateData = {
          description: saleData.notes,
          locationId: saleData.locationId,
          paymentAccountType: saleData.paymentAccountType,
          paymentAccountId: saleData.paymentAccountId,
          isCreditSale: saleData.isCreditSale,
          voucherDate: saleData.voucherDate,
          currency: saleData.currency,
          items: saleData.items.map((item: any) => ({
            id: item.salesItemId, // Preserve original sales item ID for cost tracking
            stockItemId: item.stockItemId,
            quantity: String(item.quantity),
            sellingPrice: String(item.rate),
          })),
        };
        const res = await apiRequest("PUT", `/api/vouchers/${editVoucherId}/sales`, updateData);
        return await res.json();
      } else {
        // Create new sale
        const res = await apiRequest("POST", "/api/pos/sales", saleData);
        return await res.json();
      }
    },
    onSuccess: async (data: any) => {
      clientSaleIdRef.current = crypto.randomUUID(); // Fresh ID for next sale (prevents duplicate on retry)
      setSavedSale(data);

      if (!editVoucherId) {
        setSaleJustCompleted(true);
      }

      // Invalidate queries regardless of print/WhatsApp path
      const locationId = activeLocation?.id || data.location?.id || editVoucher?.locationId;
      if (locationId) {
        queryClient.invalidateQueries({ queryKey: [`/api/locations/${locationId}/inventory`] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      if (editVoucherId) {
        queryClient.invalidateQueries({ queryKey: [`/api/vouchers/${editVoucherId}`] });
      }
      // A POS sale (cash or credit) impacts customer + ledger balances; invalidate
      // every related view so Customers, Accounts and ledger transactions all
      // refresh together.
      invalidateCustomerBalances(data?.voucher?.customerId ?? undefined);

      // Always open the print dialog
      toast({
        title: editVoucherId ? "Sale Updated" : "Sale Saved",
        description: `Sale ${data.voucher?.voucherNumber} has been ${editVoucherId ? "updated" : "saved"} successfully.`,
      });
      setShowPrintDialog(true);

      // Deferred auto-send: waits for print dialog to render, then captures printRef
      if (!editVoucherId) {
        const waGroupId =
          (activeLocation as any)?.whatsappGroupChatId ||
          (data.location as any)?.whatsappGroupChatId;
        if (waGroupId && data.voucher?.id) {
          setPendingAutoSend({
            voucherId:     data.voucher.id,
            locationId:    activeLocation?.id || data.location?.id,
            locationName:  activeLocation?.name || data.location?.name || "Location",
            companyName:   (selectedCompany as any)?.name || "",
            voucherNumber: data.voucher?.voucherNumber || String(data.voucher.id),
            voucherDate:   data.voucher?.voucherDate   || new Date().toISOString().slice(0, 10),
          });
          // Auto-send stock to WhatsApp — delayed 3 s so the invoice send
          // always finishes before the stock send starts, avoiding back-to-back
          // file uploads that can trip WhatsApp rate limits.
          setStockWaStatus("sending");
          setTimeout(() => setPendingStockSend(true), 3000);
        } else {
          setStockWaStatus("not_configured");
        }
      }
    },
    onError: (error: any) => {
      if (error.name === "OfflineQueued") {
        toast({ title: "Saved offline", description: "Will sync automatically when connected" });
        return;
      }
      toast({
        title: "Error",
        description: error.message || `Failed to ${editVoucherId ? 'update' : 'save'} sale`,
        variant: "destructive",
      });
    },
  });

  // Recalculate display rates when global currency changes
  useEffect(() => {
    if (!exchangeRate || !rows.some(r => r.rateUSD > 0)) return;
    
    const convertedRows = rows.map(row => {
      if (row.rateUSD === 0) return row;
      
      const newRate = activeCurrency === "CFA"
        ? Math.round(row.rateUSD * exchangeRate)
        : row.rateUSD;
      
      return {
        ...row,
        rate: newRate,
        amount: row.quantity * newRate,
      };
    });
    setRows(convertedRows);
  }, [activeCurrency, exchangeRate]);

  // Set print time when print dialog opens
  useEffect(() => {
    if (showPrintDialog) {
      const now = new Date();
      const timeString = now.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
      setPrintTime(timeString);
    }
  }, [showPrintDialog]);

  const fmtPrint = (n: number, prefix = "") => {
    const fixed = Math.abs(n).toFixed(2);
    const clean = fixed.replace(/\.00$/, "");
    const parts = clean.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const num = parts.join(".");
    return prefix ? prefix + "\u00A0" + num : num;
  };

  // Always format amounts in USD for printing.
  const fmtPrintCurrency = (usdAmount: number): string => {
    return fmtPrint(usdAmount, "$");
  };

  // Print handler
  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `${(activeLocation?.name || "POS").replace(/\s+/g, "_")}_${new Date().toLocaleDateString('en-CA')}`,
    onAfterPrint: () => {
      setShowPrintDialog(false);
      if (editVoucherId) {
        navigate("/pos-daybook");
      } else {
        // Only show stock prompt if WhatsApp didn't handle it (or failed)
        if (stockWaStatus !== "sent" && stockWaStatus !== "sending") {
          setShowStockPrompt(true);
        }
      }
    },
  });

  // Stock inventory query — prefetch when invoice dialog is open so it's ready for the stock prompt
  const printLocationId = activeLocation?.id ?? (editVoucher as any)?.locationId ?? null;
  const {
    data: stockInventory = [],
    isLoading: stockInventoryLoading,
  } = useQuery<any[]>({
    queryKey: [`/api/locations/${printLocationId}/inventory`],
    enabled: (showPrintDialog || showStockPrompt) && !!printLocationId,
  });

  // Deferred stock auto-send — backend generates the PDF server-side (multi-page safe).
  useEffect(() => {
    if (!pendingStockSend || !activeLocation?.id) return;

    setPendingStockSend(false);
    setStockWaStatus("sending");

    const doSend = async () => {
      try {
        const result = await sendStockPdfWithRetry(
          activeLocation.id,
          {
            onAttempt: (n) => {
              if (n > 1) {
                toast({ title: "Retrying…", description: `WhatsApp stock send attempt ${n}/3.` });
              }
            },
          },
        );
        if (!result.ok) throw new Error(result.message);
        setStockWaStatus("sent");
        toast({ title: "Stock sent", description: "Stock report sent to WhatsApp group." });
      } catch (e: any) {
        setStockWaStatus("failed");
        toast({ title: "Stock send failed", description: e.message || "Could not send stock report.", variant: "destructive" });
      }
    };
    doSend();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingStockSend]);

  const handleStockPrint = useReactToPrint({
    contentRef: stockPrintRef,
    documentTitle: `STK_${(activeLocation?.name || "Location").replace(/\s+/g, "_")}_${new Date().toLocaleDateString('en-CA')}`,
  });

  const handleSendWhatsAppReport = async () => {
    if (!activeLocation?.id) {
      toast({ title: "No location", description: "No active location selected.", variant: "destructive" });
      return;
    }
    setSendingWhatsApp(true);
    setStockWaStatus("sending");
    try {
      const result = await sendStockPdfWithRetry(
        activeLocation.id,
        {
          onAttempt: (n) => {
            if (n > 1) {
              toast({ title: "Retrying…", description: `WhatsApp stock send attempt ${n}/3.` });
            }
          },
        },
      );
      if (!result.ok) throw new Error(result.message);
      setStockWaStatus("sent");
      toast({ title: "Sent", description: "Stock report sent to WhatsApp group." });
    } catch (e: any) {
      setStockWaStatus("failed");
      toast({ title: "Failed to send", description: e.message || "WhatsApp send failed.", variant: "destructive" });
    } finally {
      setSendingWhatsApp(false);
    }
  };

  const handleSendInvoiceWhatsApp = async () => {
    const vId  = savedSale?.voucher?.id;
    const locId = activeLocation?.id;
    if (!vId || !locId) {
      toast({ title: "Not ready", description: "No saved invoice to send.", variant: "destructive" });
      return;
    }
    setSendingInvoiceWhatsApp(true);
    setInvoiceWaStatus("sending");
    try {
      const result = await sendInvoicePdfWithRetry(
        vId,
        locId,
        {
          onAttempt: (n) => {
            if (n > 1) {
              toast({ title: "Retrying…", description: `WhatsApp invoice send attempt ${n}/3.` });
            }
          },
        },
      );
      if (!result.ok) {
        setInvoiceWaStatus("failed");
        toast({ title: "Failed to send", description: result.message, variant: "destructive" });
      } else {
        setInvoiceWaStatus("sent");
        toast({ title: "Sent", description: "Invoice sent to WhatsApp group." });
      }
    } catch (e: any) {
      setInvoiceWaStatus("failed");
      toast({ title: "Error", description: e.message || "Could not reach the server.", variant: "destructive" });
    } finally {
      setSendingInvoiceWhatsApp(false);
    }
  };

  // Save draft mutation
  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      if (!activeLocation) throw new Error("No location selected");
      
      const invalidRow = rows.find(r => r.itemName?.trim() && !r.stockItemId);
      if (invalidRow) {
        const invalidIdx = rows.indexOf(invalidRow);
        setSelectedCell({ row: invalidIdx, col: 0 });
        focusCell(invalidIdx, 0);
        throw new Error(`"${invalidRow.itemName}" is not a valid item. Please select an item from the list.`);
      }

      const validItems = rows.filter(r => r.stockItemId && r.quantity > 0 && r.rate > 0);
      if (validItems.length === 0) throw new Error("No items to save");

      const draftData = {
        locationId: activeLocation.id,
        paymentAccountType: isCreditSale ? "credit" : paymentAccountType,
        paymentAccountId: isCreditSale ? (selectedCustomerId ? parseInt(selectedCustomerId) : null) : (paymentAccountId ? parseInt(paymentAccountId) : null),
        isCreditSale,
        notes,
        items: validItems.map(row => ({
          stockItemId: row.stockItemId,
          quantity: row.quantity.toString(),
          rate: row.rate.toString(),
          amount: row.amount.toString(),
        })),
      };

      if (currentDraftId) {
        const res = await apiRequest("PATCH", `/api/pos/drafts/${currentDraftId}`, draftData);
        return await res.json();
      } else {
        const res = await apiRequest("POST", "/api/pos/drafts", draftData);
        return await res.json();
      }
    },
    onSuccess: (data) => {
      setCurrentDraftId(data.id);
      setLastAutosaved(new Date());
      const validItems = rows.filter(r => r.stockItemId && r.quantity > 0 && r.rate > 0);
      lastSavedFingerprintRef.current = JSON.stringify({
        items: validItems.map(r => ({ id: r.stockItemId, qty: r.quantity, rate: r.rate })),
        notes, isCreditSale, paymentAccountType, paymentAccountId, selectedCustomerId,
      });
      toast({
        title: "Draft Saved",
        description: "Your transaction has been saved as a draft",
      });
      refetchDrafts();
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to save draft",
        variant: "destructive",
      });
    },
  });

  // Update the remaining ref field now that saveDraftMutation is in scope.
  autoSaveStateRef.current.saveDraftIsPending = saveDraftMutation.isPending;

  // Autosave effect — silently saves every 30 seconds when cart has items and has changed.
  // Reads all mutable state from autoSaveStateRef (updated every render) so this effect
  // never needs to restart due to state changes — the 30-second timer is stable for the
  // entire component lifetime and always fires on schedule, even during active typing.
  useEffect(() => {
    const interval = setInterval(async () => {
      const s = autoSaveStateRef.current;
      if (!s.activeLocation) return;
      if (autoSaveInProgressRef.current) return;
      if (s.saveDraftIsPending) return;

      const validItems = s.rows.filter((r: any) => r.stockItemId && r.quantity > 0 && r.rate > 0);
      if (validItems.length === 0) return;

      const fingerprint = JSON.stringify({
        items: validItems.map((r: any) => ({ id: r.stockItemId, qty: r.quantity, rate: r.rate })),
        notes: s.notes, isCreditSale: s.isCreditSale,
        paymentAccountType: s.paymentAccountType,
        paymentAccountId: s.paymentAccountId,
        selectedCustomerId: s.selectedCustomerId,
      });
      if (fingerprint === lastSavedFingerprintRef.current) return;

      autoSaveInProgressRef.current = true;
      try {
        const draftData = {
          locationId: s.activeLocation.id,
          paymentAccountType: s.isCreditSale ? "credit" : s.paymentAccountType,
          paymentAccountId: s.isCreditSale
            ? (s.selectedCustomerId ? parseInt(s.selectedCustomerId) : null)
            : (s.paymentAccountId ? parseInt(s.paymentAccountId) : null),
          isCreditSale: s.isCreditSale,
          notes: s.notes,
          items: validItems.map((row: any) => ({
            stockItemId: row.stockItemId,
            quantity: row.quantity.toString(),
            rate: row.rate.toString(),
            amount: row.amount.toString(),
          })),
        };

        let data;
        if (s.currentDraftId) {
          const res = await apiRequest("PATCH", `/api/pos/drafts/${s.currentDraftId}`, draftData);
          data = await res.json();
        } else {
          const res = await apiRequest("POST", "/api/pos/drafts", draftData);
          data = await res.json();
        }

        if (data?.id) setCurrentDraftId(data.id);
        lastSavedFingerprintRef.current = fingerprint;
        setLastAutosaved(new Date());
        refetchDrafts();
      } catch {
        // Silent — autosave failures don't show toasts
      } finally {
        autoSaveInProgressRef.current = false;
      }
    }, 30000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps — state is read from autoSaveStateRef to avoid resetting the timer

  // Load draft handler
  const handleLoadDraft = async (draftId: number) => {
    try {
      const res = await fetch(`/api/pos/drafts/${draftId}`);
      if (!res.ok) throw new Error("Failed to load draft");
      
      const draft = await res.json();
      
      // Populate form with draft data
      if (draft.paymentAccountType) setPaymentAccountType(draft.paymentAccountType);
      if (draft.paymentAccountId) setPaymentAccountId(String(draft.paymentAccountId));
      setIsCreditSale(draft.isCreditSale || false);
      if (draft.isCreditSale && draft.paymentAccountId) {
        setSelectedCustomerId(String(draft.paymentAccountId));
      }
      setNotes(draft.notes || "");

      // Populate rows with draft items
      const draftRows = (Array.isArray(draft.items) ? draft.items : []).map((item: any, index: number) => {
        const rate = parseFloat(item.rate);
        return {
          id: String(index + 1),
          itemName: item.stockItemName,
          stockItemCode: item.stockItemCode || "",
          stockItemId: item.stockItemId,
          quantity: parseFloat(item.quantity),
          rate: rate,
          rateUSD: rate,
          amount: parseFloat(item.amount),
        };
      });

      // Add blank row at end
      draftRows.push({
        id: String(draftRows.length + 1),
        itemName: "",
        quantity: 0,
        rate: 0,
        rateUSD: 0,
        amount: 0,
      });

      setRows(draftRows);
      setCurrentDraftId(draftId);
      setShowDraftDialog(false);

      toast({
        title: "Draft Loaded",
        description: "Transaction has been loaded from draft",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load draft",
        variant: "destructive",
      });
    }
  };

  // Delete draft mutation
  const deleteDraftMutation = useMutation({
    mutationFn: async (draftId: number) => {
      await apiRequest("DELETE", `/api/pos/drafts/${draftId}`);
    },
    onSuccess: () => {
      toast({
        title: "Draft Deleted",
        description: "Draft has been deleted successfully",
      });
      refetchDrafts();
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to delete draft",
        variant: "destructive",
      });
    },
  });

  // Conditional renders after all hooks are called
  // Show location selector if no location is available (only for non-POS users)
  // Skip if in edit mode, as we can load and edit without location selection
  if (!activeLocation && !posUser && !editVoucherId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 md:gap-6 p-4 md:p-8">
        <div className="text-center">
          <h1 className="text-2xl md:text-3xl font-semibold mb-2">Point of Sale</h1>
          <p className="text-sm md:text-base text-muted-foreground">Select a location to begin</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 w-full max-w-4xl">
          {(Array.isArray(allLocations) ? allLocations : []).map((location) => (
            <Card 
              key={location.id} 
              className="cursor-pointer hover-elevate"
              onClick={() => setSelectedLocation(location)}
              data-testid={`card-location-${location.id}`}
            >
              <div className="p-4 md:p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-medium text-lg">{location.name}</h3>
                    <p className="text-sm text-muted-foreground">{location.code}</p>
                  </div>
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                </div>
                {location.city && <p className="text-sm text-muted-foreground mb-2">{location.city}</p>}
                <Button 
                  className="w-full gap-2 mt-4"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedLocation(location);
                  }}
                  data-testid={`button-use-location-${location.id}`}
                >
                  Use Location
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Show loading state while fetching POS user's location
  if (posUser && locationLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading location...</p>
      </div>
    );
  }

  // Show loading state while fetching voucher for edit mode
  if (editVoucherId && editVoucherLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading transaction...</p>
      </div>
    );
  }

  // Show error if POS user's location is not accessible in current company
  if (posUser && locationError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-4 md:p-8">
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-6 w-6 md:h-8 md:w-8" />
          <h2 className="text-lg md:text-xl font-medium">Location Access Denied</h2>
        </div>
        <p className="text-center text-sm md:text-base text-muted-foreground max-w-md">
          You don't have access to a location in the currently selected company. 
          Please contact your administrator to assign you to a location in this company, 
          or switch to a different company where you have location access.
        </p>
        <Button 
          onClick={() => window.location.reload()} 
          variant="outline"
          data-testid="button-retry-location"
        >
          Retry
        </Button>
      </div>
    );
  }

  // Show error if POS user has no assigned locations
  if (posUser && !posLocationsLoading && posAssignedLocations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-8 w-8" />
          <h2 className="text-xl font-medium">No Location Assigned</h2>
        </div>
        <p className="text-center text-muted-foreground max-w-md">
          You don't have a location assigned to your account. 
          Please contact your administrator to assign you to a location.
        </p>
      </div>
    );
  }

  // Show error if inventory access is denied
  if (activeLocation && inventoryError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-8 w-8" />
          <h2 className="text-xl font-medium">Inventory Access Denied</h2>
        </div>
        <p className="text-center text-muted-foreground max-w-md">
          Unable to access inventory for this location. This may be because the location 
          belongs to a different company or you don't have the necessary permissions.
        </p>
        <Button 
          onClick={() => window.location.reload()} 
          variant="outline"
          data-testid="button-retry-inventory"
        >
          Retry
        </Button>
      </div>
    );
  }

  const handleNewSale = () => {
    setRows([{ id: "1", itemName: "", quantity: 0, rate: 0, rateUSD: 0, amount: 0 }]);
    setNotes("");
    setSaleJustCompleted(false);
    setSavedSale(null);
    setCurrentDraftId(null);
    setShowPrintDialog(false);
    setStockWaStatus("idle");
    setInvoiceWaStatus("idle");
    setPendingStockSend(false);
    lastSavedFingerprintRef.current = "";
    setLastAutosaved(null);
  };

  const getStockWarning = (row: SaleRow): string | null => {
    if (!row.stockItemId || !row.quantity) return null;
    const canSellZeroStock = posUser?.canSellNegativeStock || authUser?.canSellNegativeStock;
    if (canSellZeroStock) return null;
    const inventoryItem = inventory.find(i => i.stockItemId === row.stockItemId);
    if (!inventoryItem) return null;
    if (row.quantity > inventoryItem.stock) return `Only ${inventoryItem.stock} available`;
    return null;
  };

  // Format amount with currency prefix (no conversion - amount is already in display currency)
  const formatDisplayAmount = (amount: number): string => {
    if (activeCurrency === "CFA") {
      return `CFA ${Math.round(amount).toLocaleString()}`;
    }
    const isWhole = Math.abs(amount) % 1 === 0; return `$ ${amount.toLocaleString(undefined, { minimumFractionDigits: isWhole ? 0 : 2, maximumFractionDigits: 2 })}`;
  };

  const columns = [
    { key: "itemName", label: "Item", width: "flex-1 min-w-[80px] sm:min-w-[120px]" },
    { key: "quantity", label: "Qty", width: "w-14 sm:w-20" },
    { key: "rate", label: "Rate", width: "w-16 sm:w-24" },
    { key: "amount", label: "Amt", width: "w-18 sm:w-28" },
    { key: "plBale", label: "P/L", width: "w-16 sm:w-20" },
    { key: "totalPL", label: "T.P/L", width: "w-16 sm:w-20" },
    { key: "delete", label: "", width: "w-9 sm:w-12" },
  ];

  const normalize = (s: string) => (s || "").toLowerCase().replace(/[.\-\s]/g, "");

  const getFilteredInventory = () => {
    if (!searchTerm) return inventory;
    const searchNorm = normalize(searchTerm);
    return inventory.filter((item) =>
      normalize(item.name).includes(searchNorm) ||
      normalize(item.code).includes(searchNorm)
    );
  };

  const selectItem = async (item: InventoryItem & { stockItemId: number }, targetRowOverride?: number) => {
    const canSellZeroStock = posUser?.canSellNegativeStock || authUser?.canSellNegativeStock;
    if (item.stock === 0 && !canSellZeroStock) {
      setZeroStockItem(item.name);
      setZeroStockAlert(true);
      return;
    }

    // Fix 4: guard against stale out-of-bounds activeRow
    let resolvedActiveRow = activeRow;
    if (resolvedActiveRow !== null && resolvedActiveRow >= rows.length) {
      resolvedActiveRow = null;
    }

    // Fix 6: honour explicit override (from right-panel Enter), else fall back to activeRow
    let targetRow = targetRowOverride ?? resolvedActiveRow;
    if (targetRow === null || targetRow === undefined) {
      const emptyRowIndex = rows.findIndex(r => !r.itemName);
      targetRow = emptyRowIndex >= 0 ? emptyRowIndex : rows.length - 1;
    }

    // Guard: never write past the end of the array
    if (targetRow >= rows.length) {
      const emptyRowIndex = rows.findIndex(r => !r.itemName);
      targetRow = emptyRowIndex >= 0 ? emptyRowIndex : rows.length - 1;
    }

    // Use last sold price from any location if available, otherwise use configured price
    const lastSoldPrice = lastSoldPrices[item.stockItemId];
    const rateUSD = lastSoldPrice ? parseFloat(lastSoldPrice) : item.price;
    
    // Convert rate for display if CFA is selected
    const displayRate = activeCurrency === "CFA" && exchangeRate
      ? Math.round(rateUSD * exchangeRate)
      : rateUSD;

    const newRows = [...rows];
    const qty = newRows[targetRow].quantity || 1;
    newRows[targetRow] = {
      ...newRows[targetRow],
      itemName: item.name,
      stockItemCode: item.code,
      rate: displayRate,
      rateUSD: rateUSD,
      quantity: qty,
      stockItemId: item.stockItemId,
      amount: qty * displayRate,
      configuredPrice: item.configuredPrice,
    };

    // Fix 1: use stable unique ID for the new blank row (never array-length-based)
    if (targetRow === rows.length - 1) {
      newRows.push({
        id: `pos-row-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        itemName: "",
        quantity: 0,
        rate: 0,
        rateUSD: 0,
        amount: 0,
      });
    }

    setRows(newRows);
    setSearchTerm("");
    setHighlightedIndex(0);

    // Move to quantity field
    setTimeout(() => {
      focusCell(targetRow!, 1);
      setActiveRow(null);
    }, 0);
  };

  const updateRow = async (index: number, field: keyof SaleRow, value: string | number) => {
    const newRows = [...rows];
    
    // Convert numeric fields properly - keep as number even during typing
    if (field === "quantity" || field === "rate") {
      const numValue = value === "" || value === "-" ? 0 : parseFloat(String(value)) || 0;
      newRows[index] = { ...newRows[index], [field]: numValue };
      
      // When rate is manually changed, update rateUSD accordingly
      if (field === "rate") {
        // If in CFA mode, convert back to USD for storage
        const rateUSD = activeCurrency === "CFA" && exchangeRate
          ? numValue / exchangeRate
          : numValue;
        newRows[index].rateUSD = rateUSD;
      }
      
      // Auto-calculate amount
      const qty = field === "quantity" ? numValue : newRows[index].quantity;
      const rate = field === "rate" ? numValue : newRows[index].rate;
      newRows[index].amount = qty * rate;
    } else {
      newRows[index] = { ...newRows[index], [field]: value };
    }
    
    // Update search term when typing in item name
    if (field === "itemName") {
      setSearchTerm(String(value));
      setHighlightedIndex(0);
    }
    
    setRows(newRows);

    // Add new row if last row is being edited (only for non-empty numeric values)
    // Fix 1: use stable unique ID — never base on array length which collides after deletes
    if (index === rows.length - 1 && value !== "" && value !== 0 && field !== "itemName") {
      setRows([
        ...newRows,
        {
          id: `pos-row-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          itemName: "",
          quantity: 0,
          rate: 0,
          rateUSD: 0,
          amount: 0,
        },
      ]);
    }
  };

  const handleDeleteRow = async (index: number) => {
    // Fix 2: if this is the only row, reset it to a clean blank instead of blocking
    if (rows.length === 1) {
      setRows([{
        id: `pos-row-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        itemName: "",
        quantity: 0,
        rate: 0,
        rateUSD: 0,
        amount: 0,
      }]);
      // Fix 3: clear all selection/search state
      setActiveRow(null);
      setSearchTerm("");
      setHighlightedIndex(0);
      setSelectedCell({ row: 0, col: 0 });
      return;
    }

    // Remove the row
    const newRows = rows.filter((_, i) => i !== index);
    
    // Ensure there's always at least one blank row for adding new items
    const hasBlankRow = newRows.some(row => !row.itemName && row.quantity === 0 && row.rate === 0);
    if (!hasBlankRow) {
      newRows.push({
        id: `pos-row-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        itemName: "",
        quantity: 0,
        rate: 0,
        rateUSD: 0,
        amount: 0,
      });
    }
    
    setRows(newRows);

    // Fix 3: always reset active/search state after deletion so the right-panel
    // cannot target a row that no longer exists at the same index
    setActiveRow(null);
    setSearchTerm("");
    setHighlightedIndex(0);
    if (selectedCell.row >= newRows.length) {
      setSelectedCell({ row: 0, col: 0 });
    }
  };

  const handleKeyDown = async (e: React.KeyboardEvent, rowIndex: number, colIndex: number) => {
    const maxCol = columns.length - 4; // Exclude plBale, totalPL, delete from navigation
    const maxRow = rows.length - 1;
    const isItemNameField = columns[colIndex].key === "itemName";
    const filteredItems = getFilteredInventory();

    // Special handling for item name field with filtered items
    if (isItemNameField && activeRow === rowIndex && filteredItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.min(prev + 1, filteredItems.length - 1));
        return;
      }
      if (e.key === "ArrowUp" && highlightedIndex > 0) {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (filteredItems[highlightedIndex]) {
          selectItem(filteredItems[highlightedIndex]);
        }
        return;
      }
    }

    // Block navigation away from item field if text is typed but no item selected
    const currentRow = rows[rowIndex];
    const hasUnselectedItem = isItemNameField && currentRow?.itemName?.trim() && !currentRow?.stockItemId;

    switch (e.key) {
      case "ArrowUp":
        if (!isItemNameField || filteredItems.length === 0) {
          if (hasUnselectedItem) {
            e.preventDefault();
            toast({ title: "Invalid item", description: "Please select an item from the list.", variant: "destructive" });
            return;
          }
          e.preventDefault();
          if (rowIndex > 0) {
            setSelectedCell({ row: rowIndex - 1, col: colIndex });
            focusCell(rowIndex - 1, colIndex);
          }
        }
        break;
      case "ArrowDown":
        if (!isItemNameField || filteredItems.length === 0) {
          if (hasUnselectedItem) {
            e.preventDefault();
            toast({ title: "Invalid item", description: "Please select an item from the list.", variant: "destructive" });
            return;
          }
          e.preventDefault();
          if (rowIndex < maxRow) {
            setSelectedCell({ row: rowIndex + 1, col: colIndex });
            focusCell(rowIndex + 1, colIndex);
          }
        }
        break;
      case "Enter":
        if (!isItemNameField || filteredItems.length === 0) {
          if (hasUnselectedItem) {
            e.preventDefault();
            toast({ title: "Invalid item", description: "Please select an item from the list.", variant: "destructive" });
            return;
          }
          e.preventDefault();
          
          // If on qty field, move to rate field (same row)
          const isQtyField = columns[colIndex].key === "quantity";
          if (isQtyField) {
            setSelectedCell({ row: rowIndex, col: colIndex + 1 });
            focusCell(rowIndex, colIndex + 1);
            return;
          }
          
          // If on rate field, immediately create a new row
          const isRateField = columns[colIndex].key === "rate";
          if (isRateField) {
            // Check if next row exists
            const nextRow = rows[rowIndex + 1];
            
            if (!nextRow) {
              // Add a new row
              setRows(prev => [...prev, {
                id: String(Date.now()),
                itemName: "",
                quantity: 0,
                rate: 0,
                rateUSD: 0,
                amount: 0,
              }]);
              // Focus on item name field of new row after state updates
              setTimeout(() => {
                focusCell(rows.length, 0);
              }, 50);
            } else {
              // Move to next row's first field
              setSelectedCell({ row: rowIndex + 1, col: 0 });
              focusCell(rowIndex + 1, 0);
            }
          } else if (rowIndex < maxRow) {
            setSelectedCell({ row: rowIndex + 1, col: colIndex });
            focusCell(rowIndex + 1, colIndex);
          }
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (colIndex > 0) {
          setSelectedCell({ row: rowIndex, col: colIndex - 1 });
          focusCell(rowIndex, colIndex - 1);
        }
        break;
      case "ArrowRight":
        if (hasUnselectedItem) {
          e.preventDefault();
          toast({ title: "Invalid item", description: "Please select an item from the list.", variant: "destructive" });
          return;
        }
        e.preventDefault();
        if (colIndex < maxCol) {
          setSelectedCell({ row: rowIndex, col: colIndex + 1 });
          focusCell(rowIndex, colIndex + 1);
        }
        break;
      case "Tab":
        // If on item name field with filtered items, Tab selects the highlighted item
        if (isItemNameField && activeRow === rowIndex && filteredItems.length > 0 && !e.shiftKey) {
          e.preventDefault();
          if (filteredItems[highlightedIndex]) {
            selectItem(filteredItems[highlightedIndex]);
          }
          return;
        }
        if (hasUnselectedItem) {
          e.preventDefault();
          toast({ title: "Invalid item", description: "Please select an item from the list.", variant: "destructive" });
          return;
        }
        if (!e.shiftKey && colIndex < maxCol) {
          e.preventDefault();
          setSelectedCell({ row: rowIndex, col: colIndex + 1 });
          focusCell(rowIndex, colIndex + 1);
        }
        break;
      case "Backspace": {
        const inputVal = (e.target as HTMLInputElement).value;
        const isQtyField = columns[colIndex].key === "quantity";
        const isRateField = columns[colIndex].key === "rate";
        if (inputVal === "" && (isQtyField || isRateField)) {
          e.preventDefault();
          setSelectedCell({ row: rowIndex, col: colIndex - 1 });
          focusCell(rowIndex, colIndex - 1);
        }
        break;
      }
    }
  };

  const focusCell = async (rowIndex: number, colIndex: number) => {
    const key = `${rowIndex}-${colIndex}`;
    setTimeout(() => {
      inputRefs.current[key]?.focus();
      inputRefs.current[key]?.select();
    }, 0);
  };

  // Mobile helpers
  const openMobileItemSearch = async (rowIndex: number) => {
    setMobileItemSearchTarget(rowIndex);
    setMobileItemSearchTerm("");
    setMobileItemSearchOpen(true);
    setTimeout(() => mobileSearchInputRef.current?.focus(), 150);
  };

  const selectMobileItem = async (item: InventoryItem & { stockItemId: number }) => {
    const canSellZeroStock = posUser?.canSellNegativeStock || authUser?.canSellNegativeStock;
    if (item.stock === 0 && !canSellZeroStock) {
      setZeroStockItem(item.name);
      setZeroStockAlert(true);
      return;
    }
    const targetRow = mobileItemSearchTarget ?? rows.length - 1;
    const lastSoldPrice = lastSoldPrices[item.stockItemId];
    const rateUSD = lastSoldPrice ? parseFloat(lastSoldPrice) : item.price;
    const displayRate = activeCurrency === "CFA" && exchangeRate ? Math.round(rateUSD * exchangeRate) : rateUSD;
    const newRows = [...rows];
    const qty = newRows[targetRow].quantity || 1;
    newRows[targetRow] = {
      ...newRows[targetRow],
      itemName: item.name,
      stockItemCode: item.code,
      rate: displayRate,
      rateUSD,
      quantity: qty,
      stockItemId: item.stockItemId,
      amount: qty * displayRate,
      configuredPrice: item.configuredPrice,
    };
    if (targetRow === rows.length - 1) {
      newRows.push({ id: String(rows.length + 1), itemName: "", quantity: 0, rate: 0, rateUSD: 0, amount: 0 });
    }
    setRows(newRows);
    setMobileItemSearchOpen(false);
    setMobileItemSearchTerm("");
    // Open row editor so user can adjust qty/rate
    setMobileRowEditIndex(targetRow);
    setMobileRowEditOpen(true);
  };

  const getMobileFilteredInventory = () => {
    if (!mobileItemSearchTerm) return inventory;
    const searchNorm = (mobileItemSearchTerm || "").toLowerCase().replace(/[.\-\s]/g, "");
    return inventory.filter((item) =>
      (item.name || "").toLowerCase().replace(/[.\-\s]/g, "").includes(searchNorm) ||
      (item.code || "").toLowerCase().replace(/[.\-\s]/g, "").includes(searchNorm)
    );
  };

  const addMobileRow = async () => {
    const newRowIndex = rows.length - 1;
    // If the last row already has an item, push a fresh empty row first
    if (rows[newRowIndex].stockItemId) {
      const newRow = { id: String(rows.length + 1), itemName: "", quantity: 0, rate: 0, rateUSD: 0, amount: 0 };
      setRows(prev => [...prev, newRow]);
      openMobileItemSearch(rows.length);
    } else {
      openMobileItemSearch(newRowIndex);
    }
  };

  // Export current Sale to Excel
  const handleExportSale = async (detailed: boolean) => {
    const validItems = rows.filter(r => r.stockItemId && r.quantity > 0 && r.rate > 0);
    
    if (validItems.length === 0) {
      toast({
        title: "No data to export",
        description: "Add at least one item before exporting.",
        variant: "destructive",
      });
      return;
    }
    
    const exportDate = saleDate || new Date().toLocaleDateString('en-CA');
    const locationName = activeLocation?.name || "";
    
    if (detailed) {
      // Detailed export - one row per item
      const exportData = validItems.map((item: any) => ({
        "Voucher Type": "Sales",
        "Voucher Number": editVoucher?.voucherNumber || "New Sale",
        "Date": exportDate,
        "Location": locationName,
        "Item Code": item.stockItemCode || "",
        "Item Name": item.itemName || "",
        "Quantity": item.quantity,
        "Rate": item.rate.toFixed(2),
        "Amount": item.amount.toFixed(2),
        "Credit Sale": isCreditSale ? "Yes" : "No",
        "Notes": notes || "",
      }));
      
      const worksheet = utils.json_to_sheet(exportData);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Sales Detailed");
      const fileName = `Sales_Voucher_Detailed_${exportDate}.xlsx`;
      await writeFile(workbook, fileName);
      
      toast({
        title: "Export successful",
        description: `Downloaded ${fileName} with ${validItems.length} items.`,
      });
    } else {
      // Summary export
      const exportData = [{
        "Voucher Type": "Sales",
        "Voucher Number": editVoucher?.voucherNumber || "New Sale",
        "Date": exportDate,
        "Location": locationName,
        "Total Items": validItems.length,
        "Total Quantity": totalQty,
        "Total Amount": total.toFixed(2),
        "Credit Sale": isCreditSale ? "Yes" : "No",
        "Notes": notes || "",
      }];
      
      const worksheet = utils.json_to_sheet(exportData);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Sales Summary");
      const fileName = `Sales_Voucher_Summary_${exportDate}.xlsx`;
      await writeFile(workbook, fileName);
      
      toast({
        title: "Export successful",
        description: `Downloaded ${fileName}.`,
      });
    }
  };

  const handleSaveSale = async () => {
    // Validate
    if (!activeLocation && !editVoucherId) {
      toast({
        title: "Error",
        description: "Please select a location",
        variant: "destructive",
      });
      return;
    }

    // Validate payment account for cash sales
    if (!isCreditSale && !paymentAccountId) {
      toast({
        title: "Error",
        description: "Please select a payment account",
        variant: "destructive",
      });
      return;
    }

    // Validate customer for credit sales
    if (isCreditSale && !selectedCustomerId) {
      toast({
        title: "Error",
        description: "Please select a customer for credit sale",
        variant: "destructive",
      });
      return;
    }

    // Validate exchange rate is available when selling in CFA
    if (activeCurrency === "CFA" && !exchangeRate) {
      toast({
        title: "Error",
        description: "Please enter an exchange rate for this transaction.",
        variant: "destructive",
      });
      return;
    }

    const invalidRow = rows.find(r => r.itemName?.trim() && !r.stockItemId);
    if (invalidRow) {
      const invalidIdx = rows.indexOf(invalidRow);
      toast({
        title: "Invalid item",
        description: `"${invalidRow.itemName}" is not a valid item. Please select an item from the list.`,
        variant: "destructive",
      });
      setSelectedCell({ row: invalidIdx, col: 0 });
      focusCell(invalidIdx, 0);
      return;
    }

    const validItems = rows.filter(r => r.stockItemId && r.quantity > 0 && r.rate > 0);
    if (validItems.length === 0) {
      toast({
        title: "Error",
        description: "Please add at least one item to the sale",
        variant: "destructive",
      });
      return;
    }

    // Prepare sale data - convert CFA amounts to USD if entering in CFA
    const saleData = {
      locationId: activeLocation?.id || editVoucher?.locationId,
      shiftId: posUser && currentShift ? currentShift.id : undefined,
      clientSaleId: !editVoucherId ? clientSaleIdRef.current : undefined,
      paymentAccountType: isCreditSale ? "credit" : paymentAccountType,
      paymentAccountId: isCreditSale ? parseInt(selectedCustomerId) : parseInt(paymentAccountId),
      isCreditSale,
      notes,
      voucherDate: saleDate,
      currency: activeCurrency === "CFA" ? "CFA" : "USD",
      exchangeRate: exchangeRate ? exchangeRate.toString() : undefined, // Rate-lock: store the rate used for this transaction
      items: validItems.map(row => {
        // Always send rate in USD.
        // When in CFA mode, derive USD from the display rate (row.rate ÷ exchangeRate)
        // so even if rateUSD was set before the exchange rate loaded, the math is correct.
        const rateInUSD = activeCurrency === "CFA" && dailyExchangeRate
          ? parseFloat(row.rate.toString()) / dailyExchangeRate
          : row.rateUSD;
        return {
          stockItemId: row.stockItemId,
          salesItemId: row.salesItemId, // Preserve for edit mode
          quantity: row.quantity.toString(),
          rate: rateInUSD.toFixed(6),
        };
      }),
    };

    saveMutation.mutate(saleData);
  };

  const total = rows.reduce((sum, row) => sum + (row.amount || 0), 0);
  const totalQty = rows.reduce((sum, row) => sum + (parseFloat(String(row.quantity)) || 0), 0);
  const hasValidItems = rows.some(r => r.stockItemId && r.quantity > 0 && r.rate > 0);
  const filteredItems = getFilteredInventory();

  return (
    <div className="space-y-4">
      <PageHeader 
        title={editVoucherId ? "Edit Sale" : "Point of Sale"}
        subtitle={editVoucherId && editVoucher ? `Voucher #${editVoucher.voucherNumber}` : undefined}
      >
        <div className="flex flex-wrap gap-1 sm:gap-2">
          {!editVoucherId && showPosImport && (
            <Link href="/pos-import">
              <Button variant="outline" size="sm" className="gap-1 sm:gap-2" data-testid="button-import-sales">
                <Upload className="h-4 w-4" />
                <span className="hidden sm:inline">Import</span>
              </Button>
            </Link>
          )}
          {!editVoucherId && (
            <>
              <Button 
                variant="outline"
                size="sm"
                onClick={() => setShowDraftDialog(true)}
                disabled={drafts.length === 0}
                data-testid="button-load-draft"
              >
                <span className="hidden sm:inline">Load Draft</span>
                <span className="sm:hidden">Load</span>
                {drafts.length > 0 && ` (${drafts.length})`}
              </Button>
              <Button 
                variant="outline"
                size="sm"
                onClick={() => saveDraftMutation.mutate()}
                disabled={saveDraftMutation.isPending || rows.filter(r => r.stockItemId && r.quantity > 0).length === 0}
                data-testid="button-save-draft"
              >
                {saveDraftMutation.isPending ? "..." : currentDraftId ? <span className="hidden sm:inline">Update Draft</span> : <span className="hidden sm:inline">Save Draft</span>}
                {!saveDraftMutation.isPending && <span className="sm:hidden">Draft</span>}
              </Button>
              {lastAutosaved && (
                <span className="text-xs text-muted-foreground hidden sm:inline whitespace-nowrap" data-testid="text-autosaved">
                  Autosaved {Math.floor((Date.now() - lastAutosaved.getTime()) / 60000) < 1
                    ? "just now"
                    : `${Math.floor((Date.now() - lastAutosaved.getTime()) / 60000)}m ago`}
                </span>
              )}
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={rows.filter(r => r.stockItemId && r.quantity > 0 && r.rate > 0).length === 0}
                className="gap-1"
                data-testid="button-export-sale"
              >
                <FileDown className="h-4 w-4" />
                <span className="hidden sm:inline">Export</span>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExportSale(false)} data-testid="export-sale-summary">
                Summary Export
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportSale(true)} data-testid="export-sale-detailed">
                Detailed Export
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {saleJustCompleted && !editVoucherId ? (
            <Button
              size="sm"
              onClick={handleNewSale}
              className="gap-1 sm:gap-2"
              data-testid="button-new-sale"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New Sale</span>
              <span className="sm:hidden">New</span>
            </Button>
          ) : (
            <Button
              onClick={handleSaveSale}
              size="sm"
              disabled={saveMutation.isPending || !hasValidItems}
              className="gap-1 sm:gap-2"
              data-testid="button-complete-sale"
            >
              {saveMutation.isPending ? "..." : <><span className="hidden sm:inline">{editVoucherId ? "Update" : "Save"}</span><span className="sm:hidden">Save</span></>}
              {!saveMutation.isPending && <Check className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </PageHeader>


      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-4">
        <div className="flex items-center gap-2 col-span-2 sm:col-span-1">
          <MapPin className="h-4 w-4 text-muted-foreground shrink-0 hidden sm:block" />
          {posUser ? (
            posAssignedLocations.length > 1 ? (
              <Select
                value={posSelectedLocation?.id.toString() || ""}
                onValueChange={(value) => {
                  const cartHasItems = rows.some(r => (r.stockItemId || r.itemName.trim()) && r.quantity > 0);
                  if (cartHasItems) {
                    toast({ title: "Cart not empty", description: "Clear the cart before switching location.", variant: "destructive" });
                    return;
                  }
                  const location = posAssignedLocations.find(loc => loc.id.toString() === value);
                  if (location) {
                    setPosSelectedLocation(location as any);
                    setPaymentAccountId(null);
                  }
                }}
              >
                <SelectTrigger className="w-full sm:w-48" data-testid="select-pos-location">
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {(Array.isArray(posAssignedLocations) ? posAssignedLocations : []).map((loc) => (
                    <SelectItem key={loc.id} value={loc.id.toString()}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="px-2 sm:px-3 py-1.5">
                <span className="text-sm sm:text-base">{activeLocation?.name}</span>
              </div>
            )
          ) : (
            <Select 
              value={activeLocation?.id.toString() || ""} 
              onValueChange={(value) => {
                const location = allLocations.find(loc => loc.id.toString() === value);
                if (location) {
                  setSelectedLocation(location);
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-48" data-testid="select-location">
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {(Array.isArray(allLocations) ? allLocations : []).map((loc) => (
                  <SelectItem key={loc.id} value={loc.id.toString()}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Date Picker — frozen to GMT today for POS users */}
        <div className="flex items-center gap-2">
          {posUser ? (
            <div
              className="w-full sm:w-36 px-3 py-1.5 rounded-md border bg-muted/50 text-sm text-muted-foreground cursor-not-allowed select-none"
              title="Date is fixed to today (GMT) for POS users"
              data-testid="input-sale-date"
            >
              {saleDate}
            </div>
          ) : (
            <DatePickerInput
              value={saleDate}
              onChange={setSaleDate}
              placeholder="Date"
              className="w-full sm:w-36"
              data-testid="input-sale-date"
            />
          )}
        </div>

        {/* Hide cash account selector when credit sale is ON */}
        {!isCreditSale && (
          <div className="flex items-center gap-2 col-span-2 sm:col-span-1 flex-wrap">
            <Wallet className="h-4 w-4 text-muted-foreground shrink-0 hidden sm:block" />
            {posUser ? (
              posSelectedLocation ? (
                (posSelectedLocation as any).cashAccountId ? (
                  <div className="px-2 sm:px-3 py-1.5 bg-muted/50 rounded-md border">
                    <span className="text-xs sm:text-sm">{(posSelectedLocation as any).cashAccountName || `Account #${(posSelectedLocation as any).cashAccountId}`}</span>
                    {(posSelectedLocation as any).cashAccountCode && <span className="text-xs text-muted-foreground ml-1 sm:ml-2 hidden sm:inline">({(posSelectedLocation as any).cashAccountCode})</span>}
                  </div>
                ) : (
                  <div className="px-2 sm:px-3 py-1.5 bg-destructive/10 rounded-md border border-destructive/30">
                    <span className="text-xs sm:text-sm text-destructive">No cash account — contact admin</span>
                  </div>
                )
              ) : (
                <div className="px-2 sm:px-3 py-1.5 text-xs sm:text-sm text-muted-foreground">Select a location</div>
              )
            ) : (
              <>
                <Select value={paymentAccountType} onValueChange={(value: "bank" | "cash") => setPaymentAccountType(value)}>
                  <SelectTrigger className="w-20 sm:w-28" data-testid="select-account-type">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank">Bank</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
                  <SelectTrigger className="flex-1 min-w-0 sm:w-44 sm:flex-none" data-testid="select-payment-account">
                    <SelectValue placeholder={paymentAccountType === "bank" ? "Bank" : "Cash"} />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentAccountType === "bank" ? (
                      (Array.isArray(bankAccounts) ? bankAccounts : []).map((acc: any) => (
                        <SelectItem key={acc.id} value={String(acc.id)}>
                          {acc.name} ({acc.code})
                        </SelectItem>
                      ))
                    ) : (
                      cashLedgerAccounts.map((acc: any) => (
                        <SelectItem key={acc.id} value={String(acc.id)}>
                          {acc.name} ({acc.code})
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>
        )}

        {/* Credit Sale Toggle */}
        <div className="flex items-center gap-2">
          <Switch 
            id="credit-sale" 
            checked={isCreditSale}
            onCheckedChange={setIsCreditSale}
            data-testid="toggle-credit-sale"
          />
          <Label htmlFor="credit-sale" className="text-xs sm:text-sm cursor-pointer">
            Credit
          </Label>
        </div>

        {/* Customer Selector (shown when credit sale is enabled) */}
        {isCreditSale && (
          <div className="flex flex-col gap-1 col-span-2 sm:col-span-1">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground shrink-0 hidden sm:block" />
              <Popover open={customerComboOpen} onOpenChange={setCustomerComboOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full sm:w-44 justify-between font-normal"
                    data-testid="select-customer"
                  >
                    <span className="truncate">
                      {selectedCustomerId
                        ? (customerAccounts.find((a: any) => String(a.id) === selectedCustomerId)?.name || "Customer")
                        : "Select customer…"}
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50 shrink-0 ml-1" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search customer…" data-testid="input-customer-search" />
                    <CommandList>
                      <CommandEmpty>No customer found.</CommandEmpty>
                      <CommandGroup>
                        {customerAccounts.map((acc: any) => (
                          <CommandItem
                            key={acc.id}
                            value={acc.name}
                            onSelect={() => {
                              setSelectedCustomerId(String(acc.id));
                              setCustomerComboOpen(false);
                            }}
                          >
                            <Check className={`mr-2 h-4 w-4 shrink-0 ${selectedCustomerId === String(acc.id) ? "opacity-100" : "opacity-0"}`} />
                            {acc.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            {selectedCustomer && (
              <p className="text-xs text-muted-foreground pl-0 sm:pl-6" data-testid="text-customer-balance">
                Balance:{" "}
                <span className={selectedCustomer.balanceSide === "Dr" ? "text-destructive font-medium" : "text-green-600 dark:text-green-400 font-medium"}>
                  {formatAmountRaw(selectedCustomer.balance)} {selectedCustomer.balanceSide === "Dr" ? "owed" : "credit"}
                </span>
              </p>
            )}
          </div>
        )}

        <div className="col-span-2 sm:col-span-1 sm:flex-1 flex items-center gap-2 order-last sm:order-none">
          <Textarea
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="resize-none h-9"
            data-testid="input-notes"
          />
        </div>
      </div>

      {/* ── MOBILE card list (hidden on md+) ── */}
      <div className="md:hidden space-y-1 pb-36">
        {rows.map((row, realIndex) => {
          if (!row.stockItemId) return null;
          return (
            <div
              key={row.id}
              className="rounded-md border bg-card px-3 py-2.5 flex items-center gap-2 hover-elevate active-elevate-2 cursor-pointer"
              onClick={() => { setMobileRowEditIndex(realIndex); setMobileRowEditOpen(true); }}
              data-testid={`mobile-row-card-${realIndex}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground shrink-0">{realIndex + 1}.</span>
                  <span className="text-sm font-medium truncate">{row.itemName}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 font-mono flex items-center gap-2 flex-wrap">
                  <span>Qty: {row.quantity} · Rate: {formatDisplayAmount(row.rate)}</span>
                  {row.stockItemId && (row.configuredPrice ?? 0) > 0 && (() => {
                    const cfgUSD = row.configuredPrice ?? 0;
                    const plBaleUSD = row.rateUSD - cfgUSD;
                    const totalPLDisplay = (activeCurrency === "CFA" && exchangeRate ? plBaleUSD * exchangeRate : plBaleUSD) * row.quantity;
                    return (
                      <span className={totalPLDisplay > 0 ? "text-green-600 dark:text-green-400" : totalPLDisplay < 0 ? "text-red-500 dark:text-red-400" : ""}>
                        P/L: {totalPLDisplay >= 0 ? "" : "-"}{formatDisplayAmount(Math.abs(totalPLDisplay))}
                      </span>
                    );
                  })()}
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-1.5">
                <span className="text-sm font-semibold font-mono">{formatDisplayAmount(row.amount)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={(e) => { e.stopPropagation(); handleDeleteRow(realIndex); }}
                  data-testid={`mobile-delete-row-${realIndex}`}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          );
        })}
        {/* "Add item" card */}
        <div
          className="rounded-md border border-dashed border-muted-foreground/30 px-3 py-3 flex items-center gap-2 text-muted-foreground cursor-pointer hover-elevate active-elevate-2"
          onClick={addMobileRow}
          data-testid="mobile-add-item-card"
        >
          <Plus className="h-4 w-4" />
          <span className="text-sm">Tap to add item</span>
        </div>

        {/* Mobile summary */}
        <div className="rounded-md border bg-muted/30 px-3 py-2 flex items-center justify-between gap-2 mt-2">
          <span className="text-xs text-muted-foreground">
            {rows.filter(r => r.amount > 0).length} items · Qty {totalQty > 0 ? totalQty.toFixed(2) : "0"}
          </span>
          <span className="text-base font-semibold font-mono" data-testid="text-grand-total-mobile">
            {formatDisplayAmount(total)}
          </span>
        </div>
      </div>

      {/* ── DESKTOP table + right search panel (hidden on mobile) ── */}
      <div className="hidden md:flex flex-col lg:flex-row gap-4">
        {/* Main Spreadsheet Area */}
        <Card className="flex-1 overflow-hidden min-w-0">
          <div className="table-responsive">
            <div className="min-w-[340px] sm:min-w-[500px]">
              {/* Header */}
              <div className="flex bg-muted/30 border-b border-muted sticky top-0 z-30">
                <div className="w-8 sm:w-12 flex items-center justify-center border-r border-muted h-9 sm:h-10 text-xs text-muted-foreground">
                  #
                </div>
                {columns.map((col) => (
                  <div
                    key={col.key}
                    className={`${col.width} flex items-center px-1.5 sm:px-3 border-r border-muted h-9 sm:h-10 text-xs sm:text-sm text-muted-foreground`}
                  >
                    {col.label}
                  </div>
                ))}
              </div>

              {/* Rows */}
              <div className="max-h-[calc(100vh-24rem)] overflow-y-auto">
                {rows.map((row, rowIndex) => (
                  <div key={row.id}>
                    <div className="flex border-b border-muted/50 hover-elevate">
                      <div className="w-8 sm:w-12 flex items-center justify-center border-r border-muted/50 h-10 sm:h-10 text-xs text-muted-foreground">
                        {rowIndex + 1}
                      </div>
                      {columns.map((col, colIndex) => (
                        <div
                          key={col.key}
                          className={`${col.width} border-r h-10 sm:h-10 ${
                            col.key === "amount" ? "bg-muted/30" : ""
                          }`}
                          onMouseDown={(e) => {
                            const invalidIdx = rows.findIndex(r => r.itemName?.trim() && !r.stockItemId);
                            if (invalidIdx !== -1 && !(rowIndex === invalidIdx && col.key === "itemName")) {
                              e.preventDefault();
                              toast({ title: "Select an item first", description: `Row ${invalidIdx + 1} has an incomplete item. Please choose an item from the list.`, variant: "destructive" });
                              focusCell(invalidIdx, 0);
                            }
                          }}
                        >
                          {col.key === "delete" ? (
                            <div className="flex items-center justify-center h-full">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteRow(rowIndex)}
                                className="h-8 w-8"
                                data-testid={`button-delete-row-${rowIndex}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          ) : col.key === "plBale" || col.key === "totalPL" ? (() => {
                            const cfgUSD = row.configuredPrice ?? 0;
                            const plBaleUSD = row.rateUSD - cfgUSD;
                            const plBaleDisplay = activeCurrency === "CFA" && exchangeRate ? plBaleUSD * exchangeRate : plBaleUSD;
                            const val = col.key === "plBale" ? plBaleDisplay : plBaleDisplay * row.quantity;
                            const hasConfig = (row.stockItemId && cfgUSD > 0);
                            const color = !hasConfig ? undefined : val > 0 ? "text-green-700 dark:text-green-400" : val < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground";
                            return (
                              <div className={`flex items-center justify-end h-full px-1.5 sm:px-2 font-mono text-xs sm:text-sm ${color ?? "text-muted-foreground"}`}>
                                {hasConfig ? formatDisplayAmount(Math.abs(val)) : "—"}
                              </div>
                            );
                          })() : (
                            <input
                              ref={(el) => {
                                if (el) inputRefs.current[`${rowIndex}-${colIndex}`] = el;
                              }}
                              type={col.key === "quantity" || col.key === "rate" ? "number" : "text"}
                              inputMode={col.key === "quantity" || col.key === "rate" ? "decimal" : undefined}
                              value={
                                col.key === "amount"
                                  ? formatDisplayAmount(row.amount)
                                  : col.key === "quantity" || col.key === "rate"
                                    ? (row[col.key as keyof SaleRow] === 0 ? "" : row[col.key as keyof SaleRow])
                                    : row[col.key as keyof SaleRow]
                              }
                              onChange={(e) => {
                                if (col.key !== "amount") {
                                  updateRow(rowIndex, col.key as keyof SaleRow, e.target.value);
                                }
                              }}
                              onKeyDown={(e) => handleKeyDown(e, rowIndex, colIndex)}
                              onFocus={() => {
                                setSelectedCell({ row: rowIndex, col: colIndex });
                                if (col.key === "itemName") {
                                  setActiveRow(rowIndex);
                                  setSearchTerm(row.itemName);
                                  setHighlightedIndex(0);
                                } else if ((col.key === "quantity" || col.key === "rate") && row.itemName?.trim() && !row.stockItemId) {
                                  toast({ title: "Invalid item", description: "Please select an item from the list.", variant: "destructive" });
                                  setTimeout(() => {
                                    setSelectedCell({ row: rowIndex, col: 0 });
                                    focusCell(rowIndex, 0);
                                    setActiveRow(rowIndex);
                                    setSearchTerm(row.itemName);
                                    setHighlightedIndex(0);
                                  }, 0);
                                  return;
                                }
                              }}
                              onBlur={() => {
                                if (col.key === "itemName") {
                                  clearActiveRowTimerRef.current = setTimeout(() => {
                                    setActiveRow(null);
                                  }, 200);
                                }
                              }}
                              readOnly={col.key === "amount"}
                              className={`w-full h-full px-1.5 sm:px-3 bg-transparent outline-none focus:bg-accent/20 text-xs sm:text-sm ${
                                col.key === "quantity" || col.key === "rate" || col.key === "amount"
                                  ? "font-mono text-right"
                                  : ""
                              } ${col.key === "amount" ? "cursor-not-allowed" : ""} ${
                                col.key === "quantity" && getStockWarning(row) ? "text-destructive font-bold" : ""
                              }`}
                              placeholder={
                                col.key === "itemName"
                                  ? "Type to search..."
                                  : ""
                              }
                              style={col.key === "quantity" || col.key === "rate" ? { fontSize: "16px" } : undefined}
                              data-testid={`input-${col.key}-${rowIndex}`}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Total Section */}
          <div className="border-t border-muted bg-muted/20 p-2 sm:p-4">
            <div className="flex flex-col sm:flex-row sm:justify-end items-stretch sm:items-center gap-2 sm:gap-6 sm:max-w-lg ml-auto">
              <div className="flex items-center justify-between sm:justify-start gap-2 text-xs sm:text-sm">
                <span className="text-muted-foreground">Items:</span>
                <span className="font-mono">{rows.filter((r) => r.amount > 0).length}</span>
                <span className="text-muted-foreground ml-2">Qty:</span>
                <span className="font-mono" data-testid="text-total-qty">{totalQty > 0 ? totalQty.toFixed(3) : "0"}</span>
              </div>
              {(() => {
                const totalPLUSD = rows.reduce((sum, row) => {
                  if (!row.stockItemId || !(row.configuredPrice ?? 0)) return sum;
                  return sum + (row.rateUSD - (row.configuredPrice ?? 0)) * row.quantity;
                }, 0);
                const totalPLDisplay = activeCurrency === "CFA" && exchangeRate ? totalPLUSD * exchangeRate : totalPLUSD;
                const anyConfig = rows.some(r => r.stockItemId && (r.configuredPrice ?? 0) > 0);
                if (!anyConfig) return null;
                return (
                  <div className="flex items-center justify-between sm:justify-start gap-2">
                    <span className="text-sm font-medium text-muted-foreground">P/L:</span>
                    <span className={`text-base sm:text-lg font-semibold font-mono ${totalPLDisplay > 0 ? "text-green-700 dark:text-green-400" : totalPLDisplay < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`} data-testid="text-total-pl">
                      {totalPLDisplay >= 0 ? "" : "-"}{formatDisplayAmount(Math.abs(totalPLDisplay))}
                    </span>
                  </div>
                );
              })()}
              <div className="flex items-center justify-between sm:justify-start gap-2">
                <span className="text-sm sm:text-lg font-medium">Total:</span>
                <span className="text-lg sm:text-2xl font-semibold font-mono" data-testid="text-grand-total">
                  {formatDisplayAmount(total)}
                </span>
              </div>
            </div>
          </div>
        </Card>

        {/* Right Panel - Item Search */}
        <Card className="hidden lg:flex w-96 flex-col sticky top-4 max-h-[calc(100vh-8rem)] self-start">
          <div className="p-4 border-b">
            <h3 className="text-sm font-medium mb-3">Search Items</h3>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Scan barcode or search..."
                value={searchTerm}
                onFocus={() => {
                  // onFocus fires AFTER the inline cell's onBlur, so this is
                  // the correct place to cancel the "clear activeRow" timer.
                  if (clearActiveRowTimerRef.current !== null) {
                    clearTimeout(clearActiveRowTimerRef.current);
                    clearActiveRowTimerRef.current = null;
                  }
                  // Clear the search text so the cashier can immediately type a
                  // new search. Fix 5: do NOT clear stockItemId here — a confirmed
                  // item should only be invalidated when the cashier actually changes
                  // the search text (handled in onChange below).
                  setSearchTerm("");
                  setHighlightedIndex(0);
                }}
                onChange={(e) => {
                  const val = e.target.value;
                  setSearchTerm(val);
                  setHighlightedIndex(0);
                  // Mirror the change into the active row so the inline cell
                  // stays in sync (same behaviour as typing in the cell directly).
                  if (activeRow !== null) {
                    setRows(prev => prev.map((r, i) => {
                      if (i !== activeRow) return r;
                      return { ...r, itemName: val, ...(val === "" ? { stockItemId: undefined } : {}) };
                    }));
                  }
                }}
                onBlur={() => {
                  // After a short delay (so item-click onMouseDown fires first),
                  // clear the row completely if no valid item was confirmed.
                  setTimeout(() => {
                    setActiveRow(prev => {
                      if (prev !== null) {
                        setRows(rs => rs.map((r, i) => {
                          if (i !== prev) return r;
                          if (!r.stockItemId) return { ...r, itemName: "", stockItemId: undefined };
                          return r;
                        }));
                        setSearchTerm("");
                      }
                      return null;
                    });
                  }, 150);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (!searchTerm.trim()) return;
                    const items = getFilteredInventory();
                    if (items.length > 0) {
                      const item = items[highlightedIndex] || items[0];
                      // Fix 6: compute the exact target row now and pass it directly
                      // to selectItem so it never relies on async state update timing.
                      // Guard against out-of-bounds activeRow before using it.
                      const safeActiveRow = (activeRow !== null && activeRow < rows.length) ? activeRow : null;
                      const targetRow = safeActiveRow ?? selectedCell.row;
                      selectItem(item, targetRow);
                    }
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    const items = getFilteredInventory();
                    setHighlightedIndex((prev) => Math.min(prev + 1, items.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlightedIndex((prev) => Math.max(prev - 1, 0));
                  }
                }}
                className="pl-9"
                autoFocus
                data-testid="input-search"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2" ref={itemListRef}>
            <div className="space-y-1">
              {filteredItems.map((item, idx) => (
                <button
                  key={item.code}
                  onMouseDown={(e) => { e.preventDefault(); selectItem(item); }}
                  className={`w-full text-left px-3 py-3 rounded-md hover-elevate active-elevate-2 ${
                    item.stock === 0 ? "opacity-60" : ""
                  } ${idx === highlightedIndex && activeRow !== null ? "bg-primary/20 ring-1 ring-primary/40" : ""}`}
                  data-testid={`item-${idx}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm mb-1">{item.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {item.code}
                      </div>
                    </div>
                    <div className="flex items-center">
                      <div className={`text-xs font-medium px-2 py-0.5 rounded ${
                        item.stock === 0 
                          ? "bg-destructive/10 text-destructive" 
                          : item.stock < 10
                          ? "bg-chart-3/10 text-chart-3"
                          : "bg-chart-2/10 text-chart-2"
                      }`}>
                        {item.stock === 0 ? "Out" : `${item.stock}`}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* ── MOBILE: Full-screen item search Sheet ── */}
      <Sheet open={mobileItemSearchOpen} onOpenChange={(open) => { setMobileItemSearchOpen(open); if (!open) setMobileItemSearchTerm(""); }}>
        <SheetContent side="bottom" className="h-[90vh] flex flex-col p-0">
          <SheetHeader className="px-4 pt-4 pb-2 border-b shrink-0">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-base">Select Item</SheetTitle>
              {total > 0 && (
                <span className="text-sm font-semibold font-mono" data-testid="text-mobile-sheet-total">
                  {formatDisplayAmount(total)}
                </span>
              )}
            </div>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={mobileSearchInputRef}
                placeholder="Search by name or code..."
                value={mobileItemSearchTerm}
                onChange={(e) => setMobileItemSearchTerm(e.target.value)}
                className="pl-9"
                data-testid="input-mobile-item-search"
              />
            </div>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            {(() => {
              const mobileFiltered = getMobileFilteredInventory();
              const inStock = mobileFiltered.filter(i => i.stock > 0);
              const outOfStock = mobileFiltered.filter(i => i.stock === 0);
              const sorted = [...inStock, ...outOfStock];
              return sorted.map((item) => (
                <button
                  key={item.code}
                  className={`w-full text-left px-4 py-3 border-b border-muted/40 flex items-center justify-between gap-3 active-elevate-2 ${item.stock === 0 ? "opacity-50" : ""}`}
                  onClick={() => selectMobileItem(item)}
                  data-testid={`mobile-search-item-${item.code}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{item.name}</div>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">{item.code}</div>
                  </div>
                  <div className={`text-xs font-semibold px-2 py-0.5 rounded shrink-0 ${
                    item.stock === 0 ? "bg-destructive/10 text-destructive"
                    : item.stock < 10 ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    : "bg-green-500/10 text-green-700 dark:text-green-400"
                  }`}>
                    {item.stock === 0 ? "Out" : `${item.stock}`}
                  </div>
                </button>
              ));
            })()}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── MOBILE: Row editor Sheet ── */}
      <Sheet open={mobileRowEditOpen} onOpenChange={setMobileRowEditOpen}>
        <SheetContent side="bottom" className="flex flex-col p-0" style={{ height: "auto", maxHeight: "85vh" }}>
          {mobileRowEditIndex !== null && rows[mobileRowEditIndex] && (() => {
            const row = rows[mobileRowEditIndex];
            return (
              <>
                <SheetHeader className="px-4 pt-4 pb-3 border-b shrink-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <SheetTitle className="text-base truncate">{row.itemName || "New Item"}</SheetTitle>
                      {row.stockItemCode && <p className="text-xs text-muted-foreground font-mono mt-0.5">{row.stockItemCode}</p>}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-xs"
                      onClick={() => { setMobileRowEditOpen(false); openMobileItemSearch(mobileRowEditIndex); }}
                      data-testid="button-mobile-change-item"
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Change
                    </Button>
                  </div>
                </SheetHeader>
                <div className="px-4 py-4 space-y-5 overflow-y-auto">
                  {/* Quantity */}
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Quantity</Label>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0 h-12 w-12"
                        onClick={() => {
                          const newQty = Math.max(0, (row.quantity || 0) - 1);
                          updateRow(mobileRowEditIndex, "quantity", newQty);
                        }}
                        data-testid="button-mobile-qty-minus"
                      >
                        <span className="text-xl font-bold">−</span>
                      </Button>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={row.quantity === 0 ? "" : row.quantity}
                        onChange={(e) => updateRow(mobileRowEditIndex, "quantity", e.target.value)}
                        className="flex-1 text-center text-lg font-mono h-12"
                        placeholder="0"
                        style={{ fontSize: "18px" }}
                        data-testid="input-mobile-qty"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0 h-12 w-12"
                        onClick={() => {
                          updateRow(mobileRowEditIndex, "quantity", (row.quantity || 0) + 1);
                        }}
                        data-testid="button-mobile-qty-plus"
                      >
                        <span className="text-xl font-bold">+</span>
                      </Button>
                    </div>
                  </div>
                  {/* Rate */}
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Rate ({activeCurrency})</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={row.rate === 0 ? "" : row.rate}
                      onChange={(e) => updateRow(mobileRowEditIndex, "rate", e.target.value)}
                      className="text-right font-mono h-12 text-lg"
                      placeholder="0"
                      style={{ fontSize: "18px" }}
                      data-testid="input-mobile-rate"
                    />
                  </div>
                  {/* Amount */}
                  <div className="rounded-md bg-muted/30 border px-3 py-2.5 flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Amount</span>
                    <span className="text-lg font-semibold font-mono">{formatDisplayAmount(row.amount)}</span>
                  </div>
                  {/* Actions */}
                  <div className="flex gap-2 pt-1 pb-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="flex-1"
                      onClick={() => { handleDeleteRow(mobileRowEditIndex); setMobileRowEditOpen(false); }}
                      data-testid="button-mobile-remove-row"
                    >
                      <Trash2 className="h-4 w-4 mr-1.5" />
                      Remove
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => setMobileRowEditOpen(false)}
                      data-testid="button-mobile-row-done"
                    >
                      <Check className="h-4 w-4 mr-1.5" />
                      Done
                    </Button>
                  </div>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* ── MOBILE: FAB (floating add button) ── */}
      <button
        className="md:hidden fixed bottom-20 right-4 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center active:scale-95 transition-transform"
        onClick={addMobileRow}
        data-testid="button-mobile-fab-add"
        aria-label="Add item"
      >
        <Plus className="h-7 w-7" />
      </button>

      {/* ── MOBILE: Sticky save bar ── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-background border-t px-3 py-2 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground truncate">
            {rows.filter(r => r.amount > 0).length} items · Qty {totalQty > 0 ? totalQty.toFixed(2) : "0"}
          </div>
          <div className="text-base font-semibold font-mono leading-tight" data-testid="text-sticky-total">
            {formatDisplayAmount(total)}
          </div>
        </div>
        {saleJustCompleted && !editVoucherId ? (
          <Button
            onClick={handleNewSale}
            className="shrink-0 h-10 px-5"
            data-testid="button-mobile-sticky-new-sale"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            New Sale
          </Button>
        ) : (
          <Button
            onClick={handleSaveSale}
            disabled={saveMutation.isPending || !hasValidItems}
            className="shrink-0 h-10 px-5"
            data-testid="button-mobile-sticky-save"
          >
            {saveMutation.isPending ? "..." : <><Check className="h-4 w-4 mr-1.5" />{editVoucherId ? "Update" : "Save"}</>}
          </Button>
        )}
      </div>

      {/* Zero Stock Alert Dialog */}
      <AlertDialog open={zeroStockAlert} onOpenChange={setZeroStockAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Out of Stock
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium">{zeroStockItem}</span> cannot be added because it has 0 stock available.
              Please check inventory or select a different item.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button onClick={() => setZeroStockAlert(false)} data-testid="button-close-alert">
              OK
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Print Dialog */}
      <AlertDialog open={showPrintDialog} onOpenChange={setShowPrintDialog}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Print Invoice</AlertDialogTitle>
            <AlertDialogDescription>
              Sale has been saved successfully. Would you like to print the invoice?
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          {/* Invoice print template — off-screen so html2canvas can capture it */}
          <div style={{ position: 'fixed', top: '-99999px', left: '-99999px', width: '680px', pointerEvents: 'none', zIndex: -1 }}>
            <div ref={printCallbackRef} style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8pt', padding: '8px', backgroundColor: 'white', color: 'black', width: '100%', fontWeight: 'normal', fontVariantNumeric: 'tabular-nums' }}>
              <style dangerouslySetInnerHTML={{ __html: `
                @media print {
                  body { font-family: Arial, Helvetica, sans-serif !important; }
                  * { font-family: Arial, Helvetica, sans-serif !important; font-variant-numeric: tabular-nums !important; }
                }
              `}} />
              {/* Title */}
              <div style={{ textAlign: 'center', fontWeight: '900', fontSize: '13pt', letterSpacing: '1px', marginBottom: '4px' }}>
                POS INVOICE
              </div>

              {/* Invoice Info - Date/Time left, User right */}
              <div style={{ fontSize: '8pt', fontWeight: '700', display: 'flex', justifyContent: 'space-between', borderTop: '1.5px solid black', borderBottom: '1.5px solid black', padding: '3px 0', marginBottom: '4px' }}>
                <span>Date: {savedSale?.saleDate}</span>
                <span>User: {printUserName}</span>
              </div>

              {/* Daily Exchange Rate - Only for Mali company, uses transaction's locked rate */}
              {selectedCompany?.name?.toLowerCase().includes('mali') && (savedSale?.voucher?.exchangeRate || exchangeRate) && (
                <div style={{ fontSize: '8pt', fontWeight: '700', marginBottom: '4px', padding: '3px', border: '1.5px solid black', textAlign: 'center' }}>
                  <span style={{ fontWeight: '900' }}>Daily Rate:</span> $1 = {formatNumber(parseFloat(savedSale?.voucher?.exchangeRate) || exchangeRate || 0)} CFA
                </div>
              )}

              {/* Credit Sale Customer Info */}
              {savedSale?.isCreditSale && savedSale?.customer && (
                <div style={{ fontSize: '8pt', fontWeight: '700', marginBottom: '4px', padding: '3px', border: '1.5px solid black' }}>
                  <div style={{ fontWeight: '900' }}>CREDIT SALE</div>
                  <div>Customer: {savedSale.customer.name}</div>
                </div>
              )}

              {/* Items Table — NO Tailwind classes; only inline styles so html2canvas renders correctly */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8pt', lineHeight: '1.5', fontVariantNumeric: 'tabular-nums', border: '1px solid #999', fontFamily: 'Arial, Helvetica, sans-serif' }}>
                <thead>
                  <tr style={{ backgroundColor: '#e0e0e0' }}>
                    <th style={{ textAlign: 'left',   padding: '4px 6px', width: '34%', fontWeight: '900', border: '1px solid #999', verticalAlign: 'middle' }}>Description</th>
                    <th style={{ textAlign: 'center', padding: '4px 6px', width: '7%',  fontWeight: '900', border: '1px solid #999', verticalAlign: 'middle' }}>Qty</th>
                    <th style={{ textAlign: 'center', padding: '4px 6px', width: '10%', fontWeight: '900', border: '1px solid #999', verticalAlign: 'middle' }}>Rate</th>
                    <th style={{ textAlign: 'center', padding: '4px 6px', width: '11%', fontWeight: '900', border: '1px solid #999', verticalAlign: 'middle' }}>Amt</th>
                    <th style={{ textAlign: 'center', padding: '4px 6px', width: '11%', fontWeight: '900', border: '1px solid #999', verticalAlign: 'middle' }}>Config</th>
                    <th style={{ textAlign: 'center', padding: '4px 6px', width: '13%', fontWeight: '900', border: '1px solid #999', verticalAlign: 'middle' }}>P/L Bale</th>
                    <th style={{ textAlign: 'center', padding: '4px 6px', width: '14%', fontWeight: '900', border: '1px solid #999', verticalAlign: 'middle' }}>Total P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {(savedSale?.items ?? []).map((item: any, idx: number) => {
                    const itemRateUSD = parseFloat(item.rateUSD || item.rate);
                    const itemAmountUSD = parseFloat(item.quantity) * itemRateUSD;
                    const configuredPrice = parseFloat(item.configuredPrice || "0");
                    const plPerBale = itemRateUSD - configuredPrice;
                    const totalPL = plPerBale * parseFloat(item.quantity);
                    const plBaleColor = plPerBale > 0 ? '#0a7e1f' : plPerBale < 0 ? '#c2272d' : undefined;
                    const totalPLColor = totalPL > 0 ? '#0a7e1f' : totalPL < 0 ? '#c2272d' : undefined;
                    return (
                      <tr key={idx} style={{ backgroundColor: '#ffffff' }}>
                        <td style={{ padding: '4px 6px', verticalAlign: 'middle', wordBreak: 'break-word', fontWeight: '600', border: '1px solid #bbb' }}>{item.stockItemName}</td>
                        <td style={{ textAlign: 'center', padding: '4px 6px', verticalAlign: 'middle', fontWeight: '600', border: '1px solid #bbb' }}>{fmtPrint(parseFloat(item.quantity))}</td>
                        <td style={{ textAlign: 'center', padding: '4px 6px', verticalAlign: 'middle', fontWeight: '600', border: '1px solid #bbb' }}>{fmtPrintCurrency(itemRateUSD)}</td>
                        <td style={{ textAlign: 'center', padding: '4px 6px', verticalAlign: 'middle', fontWeight: '600', border: '1px solid #bbb' }}>{fmtPrintCurrency(itemAmountUSD)}</td>
                        <td style={{ textAlign: 'center', padding: '4px 6px', verticalAlign: 'middle', fontWeight: '600', border: '1px solid #bbb' }}>{fmtPrintCurrency(configuredPrice)}</td>
                        <td style={{ textAlign: 'center', padding: '4px 6px', verticalAlign: 'middle', fontWeight: '600', border: '1px solid #bbb', color: plBaleColor }}>{fmtPrint(plPerBale, "$")}</td>
                        <td style={{ textAlign: 'center', padding: '4px 6px', verticalAlign: 'middle', fontWeight: '600', border: '1px solid #bbb', color: totalPLColor }}>{fmtPrint(totalPL, "$")}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ backgroundColor: '#e0e0e0' }}>
                    <td style={{ padding: '4px 6px', fontWeight: '900', border: '1px solid #999', verticalAlign: 'middle' }}>TOTAL</td>
                    <td style={{ textAlign: 'center', padding: '4px 6px', fontWeight: '900', border: '1px solid #999', verticalAlign: 'middle' }}>
                      {fmtPrint((savedSale?.items ?? []).reduce((sum: number, item: any) => sum + parseFloat(item.quantity || 0), 0))}
                    </td>
                    <td style={{ border: '1px solid #999' }}></td>
                    <td style={{ textAlign: 'center', padding: '4px 6px', fontWeight: '900', border: '1px solid #999', verticalAlign: 'middle' }}>
                      {fmtPrintCurrency((savedSale?.items ?? []).reduce((sum: number, item: any) => sum + parseFloat(item.quantity) * parseFloat(item.rateUSD || item.rate), 0))}
                    </td>
                    <td style={{ border: '1px solid #999' }}></td>
                    <td style={{ border: '1px solid #999' }}></td>
                    <td style={{ textAlign: 'center', padding: '4px 6px', fontWeight: '900', border: '1px solid #999', verticalAlign: 'middle', color: (() => { const t = (savedSale?.items ?? []).reduce((s: number, i: any) => s + (parseFloat(i.rateUSD || i.rate) - parseFloat(i.configuredPrice || "0")) * parseFloat(i.quantity), 0); return t > 0 ? '#0a7e1f' : t < 0 ? '#c2272d' : undefined; })() }}>
                      {(() => { const t = (savedSale?.items ?? []).reduce((s: number, i: any) => s + (parseFloat(i.rateUSD || i.rate) - parseFloat(i.configuredPrice || "0")) * parseFloat(i.quantity), 0); return fmtPrint(t, "$"); })()}
                    </td>
                  </tr>
                </tfoot>
              </table>

              {/* Total Paid */}
              <div style={{ fontSize: '11pt', fontWeight: '900', marginTop: '5px', paddingTop: '5px', borderTop: '1.5px solid #333', display: 'flex', justifyContent: 'space-between' }}>
                <span>TOTAL PAID:</span>
                <span>
                  {fmtPrintCurrency((savedSale?.items ?? []).reduce((sum: number, item: any) => {
                    const rateUSD = parseFloat(item.rateUSD || item.rate);
                    return sum + (parseFloat(item.quantity) * rateUSD);
                  }, 0))}
                </span>
              </div>

              {/* Notes - dir=auto handles Arabic RTL automatically */}
              {savedSale?.voucher?.description && (
                <div dir="auto" style={{ fontSize: '8pt', fontWeight: '600', marginTop: '5px', padding: '3px', border: '1.5px solid black' }}>
                  <span style={{ fontWeight: '900' }}>Note:</span> {savedSale.voucher.description}
                </div>
              )}

              {/* Footer */}
              <div style={{ textAlign: 'center', fontSize: '7.5pt', fontWeight: '700', marginTop: '6px', paddingTop: '4px', borderTop: '1.5px solid black' }}>
                <div>Thank you for your business!</div>
              </div>
            </div>
          </div>

          <AlertDialogFooter>
            <Button variant="outline" onClick={() => { setShowPrintDialog(false); if (editVoucherId) navigate("/pos-daybook"); }} data-testid="button-cancel-print">
              Close
            </Button>
            {!editVoucherId && (
              <Button variant="outline" onClick={handleNewSale} className="gap-2" data-testid="button-new-sale-print">
                <Plus className="h-4 w-4" />
                New Sale
              </Button>
            )}
            {(activeLocation as any)?.whatsappGroupChatId && (() => {
              if (invoiceWaStatus === "sending") {
                return (
                  <Button variant="outline" disabled className="gap-2" data-testid="button-invoice-wa-sending">
                    <span className="animate-spin inline-block"><Send className="h-4 w-4" /></span>
                    Sending Invoice…
                  </Button>
                );
              }
              if (invoiceWaStatus === "sent") {
                return (
                  <Button variant="outline" disabled className="gap-2 opacity-60" data-testid="button-invoice-wa-sent">
                    <Send className="h-4 w-4" />
                    Invoice Sent
                  </Button>
                );
              }
              return (
                <Button
                  variant="outline"
                  onClick={handleSendInvoiceWhatsApp}
                  disabled={sendingInvoiceWhatsApp}
                  className="gap-2"
                  data-testid="button-send-whatsapp-invoice"
                >
                  <Send className="h-4 w-4" />
                  {invoiceWaStatus === "failed" ? "Retry Invoice" : "Resend Invoice"}
                </Button>
              );
            })()}
            {!editVoucherId && (() => {
              const hasWa = !!(activeLocation as any)?.whatsappGroupChatId;
              if (stockWaStatus === "sending") {
                return (
                  <Button variant="outline" disabled className="gap-2" data-testid="button-stock-wa-sending">
                    <span className="animate-spin inline-block"><Send className="h-4 w-4" /></span>
                    Sending Stock…
                  </Button>
                );
              }
              if (stockWaStatus === "sent") {
                return (
                  <Button variant="outline" disabled className="gap-2 opacity-60" data-testid="button-stock-wa-sent">
                    <Send className="h-4 w-4" />
                    Stock Sent
                  </Button>
                );
              }
              if (stockWaStatus === "failed" || !hasWa || stockWaStatus === "not_configured") {
                return (
                  <Button
                    variant="outline"
                    onClick={handleStockPrint}
                    disabled={stockInventoryLoading}
                    className="gap-2"
                    data-testid="button-print-stock-fallback"
                  >
                    <Printer className="h-4 w-4" />
                    {stockInventoryLoading ? "Loading…" : stockWaStatus === "failed" ? "Print Stock" : "Print Stock"}
                  </Button>
                );
              }
              return null;
            })()}
            <Button onClick={handlePrint} className="gap-2" data-testid="button-print-invoice">
              <Printer className="h-4 w-4" />
              Print Invoice
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Stock print template — off-screen, inline styles for html2canvas + react-to-print */}
      <div style={{ position: 'fixed', top: '-99999px', left: '-99999px', width: '794px', pointerEvents: 'none', zIndex: -1 }}>
        <div ref={stockPrintRef} style={{ fontFamily: 'Arial, Helvetica, sans-serif', backgroundColor: 'white', color: 'black', padding: '12mm 14mm', boxSizing: 'border-box', width: '794px' }}>
          {/* Header — matches LocationInventory print template */}
          <div style={{ textAlign: 'center', marginBottom: '10px' }}>
            <h1 style={{ fontSize: '16pt', fontWeight: 'bold', margin: '0 0 4px 0', textDecoration: 'underline', fontFamily: 'Arial, Helvetica, sans-serif' }}>
              {activeLocation?.name ?? "Stock Report"}
            </h1>
            <h2 style={{ fontSize: '12pt', fontWeight: 'bold', margin: '0 0 2px 0', fontFamily: 'Arial, Helvetica, sans-serif' }}>
              Godown Summary
            </h2>
            <p style={{ fontSize: '9pt', margin: '0', color: '#333', fontFamily: 'Arial, Helvetica, sans-serif' }}>
              {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8pt', color: '#666', marginTop: '8px', paddingTop: '4px', borderTop: '1px solid #ccc' }}>
              <span>Printed: {new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              <span>Page 1</span>
            </div>
          </div>

          {stockInventory.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#666', marginTop: '20px', fontFamily: 'Arial' }}>No inventory found at this location.</p>
          ) : (() => {
            const sorted = [...stockInventory]
              .filter(item => parseFloat(item.quantity || '0') !== 0)
              .sort((a, b) => (a.stockGroupName || '').localeCompare(b.stockGroupName || '') || a.stockItemName.localeCompare(b.stockItemName));
            const grouped = sorted.reduce((acc: Record<string, { name: string; items: any[] }>, item) => {
              const key = item.stockGroupCode || 'UNCAT';
              if (!acc[key]) acc[key] = { name: item.stockGroupName || 'Unassigned', items: [] };
              acc[key].items.push(item);
              return acc;
            }, {});
            const grandTotal = sorted.reduce((s, i) => s + Math.floor(parseFloat(i.quantity || '0')), 0);
            const uom = sorted[0]?.stockItemUom || sorted[0]?.uom || 'BL';
            return (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt', lineHeight: '1.6', fontFamily: 'Arial, Helvetica, sans-serif', marginTop: '6px' }}>
                <thead>
                  <tr>
                    <th style={{ fontWeight: 'bold', fontSize: '9pt', padding: '6px 8px 6px 4px', borderTop: '2.5px solid #111', borderBottom: '2.5px solid #111', textAlign: 'left', verticalAlign: 'bottom', backgroundColor: 'white' }}>
                      Particulars
                    </th>
                    <th style={{ fontWeight: 'bold', fontSize: '9pt', padding: '6px 4px 6px 8px', borderTop: '2.5px solid #111', borderBottom: '2.5px solid #111', textAlign: 'right', width: '140px', verticalAlign: 'bottom', backgroundColor: 'white' }}>
                      Closing<br />Balance<br /><span style={{ fontWeight: 'normal', fontSize: '7.5pt' }}>Quantity</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(grouped).map(([groupCode, { name, items }]) => {
                    const groupTotal = (items as any[]).reduce((s, i) => s + parseFloat(i.quantity || '0'), 0);
                    const firstUom = (items as any[])[0]?.stockItemUom || (items as any[])[0]?.uom || 'BL';
                    const isGroupNeg = groupTotal < 0;
                    return [
                      /* Group header row — light gray background like the reference */
                      <tr key={`g-${groupCode}`} style={{ backgroundColor: '#e8e8e8' }}>
                        <td style={{ fontWeight: 'bold', fontSize: '9.5pt', padding: '5px 8px 5px 4px', borderTop: '1px solid #aaa', borderBottom: '1px solid #aaa', color: isGroupNeg ? '#c2272d' : '#000', verticalAlign: 'middle', backgroundColor: '#e8e8e8' }}>
                          {name}
                        </td>
                        <td style={{ fontWeight: 'bold', fontSize: '9.5pt', padding: '5px 4px 5px 8px', borderTop: '1px solid #aaa', borderBottom: '1px solid #aaa', textAlign: 'right', color: isGroupNeg ? '#c2272d' : '#000', verticalAlign: 'middle', backgroundColor: '#e8e8e8', whiteSpace: 'nowrap' }}>
                          {Math.floor(groupTotal).toLocaleString()}&nbsp;&nbsp;<span style={{ fontWeight: 'normal', fontSize: '8pt' }}>{firstUom}</span>
                        </td>
                      </tr>,
                      ...(items as any[]).map((item) => {
                        const qty = Math.floor(parseFloat(item.quantity || '0'));
                        const isNeg = qty < 0;
                        const itemUom = item.stockItemUom || item.uom || 'BL';
                        return (
                          <tr key={`i-${item.inventoryId || item.stockItemId}`} style={{ backgroundColor: isNeg ? '#fff0f0' : 'white' }}>
                            <td style={{ padding: '3.5px 8px 3.5px 16px', borderBottom: '0.75px solid #ccc', fontSize: '9pt', color: isNeg ? '#c2272d' : '#222', fontWeight: isNeg ? 600 : 'normal', verticalAlign: 'middle' }}>
                              {item.stockItemName}
                            </td>
                            <td style={{ padding: '3.5px 4px 3.5px 8px', borderBottom: '0.75px solid #ccc', textAlign: 'right', fontSize: '9pt', fontWeight: isNeg ? 600 : 'normal', whiteSpace: 'nowrap', color: isNeg ? '#c2272d' : '#222', verticalAlign: 'middle' }}>
                              {qty.toLocaleString()}&nbsp;&nbsp;<span style={{ fontWeight: 'normal', fontSize: '8pt' }}>{itemUom}</span>
                            </td>
                          </tr>
                        );
                      }),
                    ];
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ backgroundColor: '#e8e8e8' }}>
                    <td style={{ fontWeight: 'bold', fontSize: '10pt', borderTop: '2.5px solid #111', borderBottom: '2.5px solid #111', padding: '6px 8px 6px 4px', backgroundColor: '#e8e8e8', verticalAlign: 'middle' }}>Grand Total</td>
                    <td style={{ fontWeight: 'bold', fontSize: '10pt', borderTop: '2.5px solid #111', borderBottom: '2.5px solid #111', padding: '6px 4px 6px 8px', backgroundColor: '#e8e8e8', textAlign: 'right', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                      {grandTotal.toLocaleString()}&nbsp;&nbsp;<span style={{ fontWeight: 'normal', fontSize: '8pt' }}>{uom}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            );
          })()}
        </div>
      </div>

      {/* Stock Print Prompt — appears after invoice is printed */}
      <AlertDialog open={showStockPrompt} onOpenChange={setShowStockPrompt}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Stock Report</AlertDialogTitle>
            <AlertDialogDescription>
              {(activeLocation as any)?.whatsappGroupChatId
                ? <>Print the stock report for <strong>{activeLocation?.name}</strong>. It will also be sent to the WhatsApp group automatically.</>
                : <>What would you like to do with the stock report for <strong>{activeLocation?.name}</strong>?</>
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:gap-2">
            <Button variant="outline" onClick={() => setShowStockPrompt(false)} data-testid="button-skip-stock-print">
              Skip
            </Button>
            <Button
              onClick={() => {
                setShowStockPrompt(false);
                handleStockPrint();
                if ((activeLocation as any)?.whatsappGroupChatId) {
                  handleSendWhatsAppReport();
                }
              }}
              disabled={stockInventoryLoading || sendingWhatsApp}
              className="gap-2"
              data-testid="button-confirm-stock-print"
            >
              {sendingWhatsApp ? (
                <span className="animate-spin">↻</span>
              ) : (
                <Printer className="h-4 w-4" />
              )}
              {stockInventoryLoading
                ? "Loading…"
                : sendingWhatsApp
                  ? "Sending…"
                  : (activeLocation as any)?.whatsappGroupChatId
                    ? "Print + Send to WhatsApp"
                    : "Print Stock"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Draft Dialog */}
      <AlertDialog open={showDraftDialog} onOpenChange={setShowDraftDialog}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Load Draft</AlertDialogTitle>
            <AlertDialogDescription>
              Select a draft to continue working on it. Loading a draft will replace your current work.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <div className="max-h-96 overflow-y-auto">
            {!Array.isArray(drafts) || drafts.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No drafts available</p>
            ) : (
              <div className="space-y-2">
                {(Array.isArray(drafts) ? drafts : []).map((draft: any) => (
                  <div key={draft.id} className="flex items-center justify-between p-4 border rounded-md hover-elevate">
                    <div className="flex-1">
                      <p className="font-medium">
                        Draft #{draft.id} - {new Date(draft.updatedAt).toLocaleString()}
                      </p>
                      {draft.notes && (
                        <p className="text-sm text-muted-foreground mt-1">{draft.notes}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleLoadDraft(draft.id)}
                        data-testid={`button-load-draft-${draft.id}`}
                      >
                        Load
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => deleteDraftMutation.mutate(draft.id)}
                        disabled={deleteDraftMutation.isPending}
                        data-testid={`button-delete-draft-${draft.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setShowDraftDialog(false)} data-testid="button-cancel-draft">
              Cancel
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
