import { useState, useRef, useEffect } from "react";
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
import { MapPin, Wallet, Printer, AlertCircle, Search, Check, Trash2, User, Upload, ArrowLeft, FileDown, ChevronDown } from "lucide-react";
import { utils, writeFile } from "@/lib/excelHelper";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
}

interface InventoryItem {
  code: string;
  name: string;
  stock: number;
  price: number;
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

export default function POS({ posUser, editVoucherId }: { posUser?: any; editVoucherId?: string } = {}) {
  const { selectedLocation, setSelectedLocation } = useLocationContext();
  const { selectedCompany } = useCompany();
  const [_location, navigate] = useLocation();

  // For POS users, fetch their assigned location
  const { data: posLocation, error: locationError, isLoading: locationLoading } = useQuery<Location>({
    queryKey: posUser?.assignedLocationId ? [`/api/locations/${posUser.assignedLocationId}`] : [],
    enabled: !!posUser?.assignedLocationId,
    retry: false,
  });

  // Fetch all locations for the dropdown (non-POS users only)
  const { data: allLocations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
    enabled: !posUser, // Only fetch for non-POS users
  });

  // Use either the selected location (for Admin/Owner/Manager) or POS user's assigned location
  const activeLocation = posUser ? posLocation : selectedLocation;

  // Fetch inventory for the active location
  const { data: apiInventory = [], isLoading: inventoryLoading, error: inventoryError } = useQuery<APIInventoryItem[]>({
    queryKey: activeLocation ? [`/api/locations/${activeLocation.id}/inventory`] : [],
    enabled: !!activeLocation,
    retry: false,
  });

  // Transform API inventory to POS format with stockItemId
  // Coalesce null/undefined names and codes to prevent toLowerCase() errors
  const inventory: (InventoryItem & { stockItemId: number })[] = apiInventory.map((item) => ({
    code: (item.stockItemCode || "").trim(),
    name: (item.stockItemName || "Unknown Item").trim(),
    stock: parseFloat(item.quantity),
    price: parseFloat(item.lastSellingPrice || item.averageRate),
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
  const cashLedgerAccounts = allLedgerAccounts.filter((acc: any) => acc.accountType === "Cash");

  // Fetch assigned cash account for POS users
  const { data: assignedCashAccount } = useQuery<any>({
    queryKey: posUser?.cashAccountId ? [`/api/ledger-accounts/${posUser.cashAccountId}`] : [],
    enabled: !!posUser?.cashAccountId,
  });

  // Fetch drafts for current user and location
  const { data: drafts = [], refetch: refetchDrafts } = useQuery<any[]>({
    queryKey: activeLocation ? [`/api/pos/drafts`, { locationId: activeLocation.id }] : [],
    enabled: !!activeLocation,
  });

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
  const customerAccounts = allLedgerAccounts.filter((acc: any) => acc.accountType === "Asset");

  // Fetch voucher details if in edit mode
  const { data: editVoucher, isLoading: editVoucherLoading } = useQuery<any>({
    queryKey: editVoucherId ? [`/api/vouchers/${editVoucherId}`] : [],
    enabled: !!editVoucherId,
  });

  const { selectedCurrency, exchangeRate: dailyExchangeRate, convertToUSD, displayCurrency, formatAmount } = useCurrencyContext();
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
  const [isCreditSale, setIsCreditSale] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [notes, setNotes] = useState("");
  const [saleDate, setSaleDate] = useState(new Date().toISOString().split('T')[0]);
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
  const { toast } = useToast();

  // Auto-set cash account for POS users with assigned cash account
  useEffect(() => {
    if (posUser?.cashAccountId && assignedCashAccount && !paymentAccountId) {
      setPaymentAccountType("cash");
      setPaymentAccountId(String(posUser.cashAccountId));
    }
  }, [posUser, assignedCashAccount, paymentAccountId]);

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
    // Skip auto-selection if POS user has assigned cash account
    if (posUser?.cashAccountId) return;
    
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
    if (editVoucher && editVoucher.salesItems && editVoucher.salesItems.length > 0) {
      console.log('[POS Edit] Loading voucher for edit:', editVoucher);
      console.log('[POS Edit] Sales items:', editVoucher.salesItems);
      
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
      console.log('[POS Edit] Set rows to:', newRows);

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
        console.log('[POS Edit] Voucher entries:', editVoucher.entries);
        
        // Find the debit entry (the payment account)
        const debitEntry = editVoucher.entries.find((entry: any) => 
          parseFloat(entry.debitAmount || "0") > 0
        );
        
        if (debitEntry) {
          console.log('[POS Edit] Debit entry found:', debitEntry);
          
          // Bank account - has bankAccountId
          if (debitEntry.bankAccountId) {
            setPaymentAccountType("bank");
            setPaymentAccountId(String(debitEntry.bankAccountId));
            setIsCreditSale(false);
            console.log('[POS Edit] Set bank account:', debitEntry.bankAccountId);
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
                console.log('[POS Edit] Set cash account:', debitEntry.ledgerAccountId);
              } 
              // Customer/Receivable account (Asset type for customers, or could be other types)
              else {
                setPaymentAccountType("credit");
                setPaymentAccountId(String(debitEntry.ledgerAccountId));
                setIsCreditSale(true);
                console.log('[POS Edit] Set credit sale with customer account:', debitEntry.ledgerAccountId, 'accountType:', ledgerAccount.accountType);
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
              console.log('[POS Edit] Ledger account not found in list, using narration fallback');
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

  // Warn user about unsaved changes when leaving the page
  useEffect(() => {
    const hasUnsavedChanges = rows.some(row => row.itemName && row.quantity > 0);

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
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
    onSuccess: (data: any) => {
      setSavedSale(data);
      toast({
        title: editVoucherId ? "Sale Updated" : "Sale Saved",
        description: `Sale ${data.voucher?.voucherNumber} has been ${editVoucherId ? 'updated' : 'saved'} successfully.`,
      });
      
      if (!editVoucherId) {
        // Clear the form for new sales
        setRows([{ id: "1", itemName: "", quantity: 0, rate: 0, rateUSD: 0, amount: 0 }]);
        setNotes("");
      }
      
      // Auto-show print dialog for both new and edit
      setShowPrintDialog(true);
      
      // Invalidate inventory query to refresh stock levels
      queryClient.invalidateQueries({ queryKey: [`/api/locations/${activeLocation?.id}/inventory`] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
    },
    onError: (error: any) => {
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

  // Print handler
  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: savedSale?.voucher?.voucherNumber ? `Invoice-${savedSale.voucher.voucherNumber}` : "Invoice",
    onAfterPrint: () => {
      setShowPrintDialog(false);
      if (editVoucherId) {
        navigate("/pos-daybook");
      }
    },
  });

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
      toast({
        title: "Draft Saved",
        description: "Your transaction has been saved as a draft",
      });
      refetchDrafts();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save draft",
        variant: "destructive",
      });
    },
  });

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
      const draftRows = draft.items.map((item: any, index: number) => ({
        id: String(index + 1),
        itemName: item.stockItemName,
        stockItemCode: item.stockItemCode || "",
        stockItemId: item.stockItemId,
        quantity: parseFloat(item.quantity),
        rate: parseFloat(item.rate),
        amount: parseFloat(item.amount),
      }));

      // Add blank row at end
      draftRows.push({
        id: String(draftRows.length + 1),
        itemName: "",
        quantity: 0,
        rate: 0,
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
          {allLocations.map((location) => (
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

  // Show error if POS user has no assigned location
  if (posUser && !posUser.assignedLocationId) {
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

  // Format amount with currency prefix (no conversion - amount is already in display currency)
  const formatDisplayAmount = (amount: number): string => {
    if (activeCurrency === "CFA") {
      return `CFA ${Math.round(amount).toLocaleString()}`;
    }
    return `$ ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const columns = [
    { key: "itemName", label: "Item", width: "flex-1 min-w-[80px] sm:min-w-[120px]" },
    { key: "quantity", label: "Qty", width: "w-14 sm:w-20" },
    { key: "rate", label: "Rate", width: "w-16 sm:w-24" },
    { key: "amount", label: "Amt", width: "w-18 sm:w-28" },
    { key: "delete", label: "", width: "w-9 sm:w-12" },
  ];

  const normalize = (s: string) => (s || "").toLowerCase().replace(/[.\-]/g, "");

  const getFilteredInventory = () => {
    if (!searchTerm) return inventory;
    const searchNorm = normalize(searchTerm);
    return inventory.filter((item) =>
      normalize(item.name).includes(searchNorm) ||
      normalize(item.code).includes(searchNorm)
    );
  };

  const selectItem = (item: InventoryItem & { stockItemId: number }) => {
    if (item.stock === 0) {
      setZeroStockItem(item.name);
      setZeroStockAlert(true);
      return;
    }

    if (activeRow === null) return;

    // Use last sold price from any location if available, otherwise use configured price
    const lastSoldPrice = lastSoldPrices[item.stockItemId];
    const rateUSD = lastSoldPrice ? parseFloat(lastSoldPrice) : item.price;
    
    // Convert rate for display if CFA is selected
    const displayRate = activeCurrency === "CFA" && exchangeRate
      ? Math.round(rateUSD * exchangeRate)
      : rateUSD;

    const newRows = [...rows];
    const qty = newRows[activeRow].quantity || 1;
    newRows[activeRow] = {
      ...newRows[activeRow],
      itemName: item.name,
      stockItemCode: item.code,
      rate: displayRate,
      rateUSD: rateUSD,
      quantity: qty,
      stockItemId: item.stockItemId,
      amount: qty * displayRate,
    };
    
    setRows(newRows);
    setSearchTerm("");
    setHighlightedIndex(0);

    // Add new row if last row is being edited
    if (activeRow === rows.length - 1) {
      setRows([
        ...newRows,
        {
          id: String(rows.length + 1),
          itemName: "",
          quantity: 0,
          rate: 0,
          rateUSD: 0,
          amount: 0,
        },
      ]);
    }

    // Move to quantity field
    setTimeout(() => {
      focusCell(activeRow, 1);
      setActiveRow(null);
    }, 0);
  };

  const updateRow = (index: number, field: keyof SaleRow, value: string | number) => {
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
    if (index === rows.length - 1 && value !== "" && value !== 0 && field !== "itemName") {
      setRows([
        ...newRows,
        {
          id: String(rows.length + 1),
          itemName: "",
          quantity: 0,
          rate: 0,
          rateUSD: 0,
          amount: 0,
        },
      ]);
    }
  };

  const handleDeleteRow = (index: number) => {
    // Don't allow deleting if it's the only row
    if (rows.length === 1) {
      toast({
        title: "Cannot Delete",
        description: "At least one row must remain",
        variant: "destructive",
      });
      return;
    }

    // Remove the row
    const newRows = rows.filter((_, i) => i !== index);
    
    // Ensure there's always at least one blank row for adding new items
    const hasBlankRow = newRows.some(row => !row.itemName && row.quantity === 0 && row.rate === 0);
    if (!hasBlankRow) {
      newRows.push({
        id: String(Date.now()),
        itemName: "",
        quantity: 0,
        rate: 0,
        rateUSD: 0,
        amount: 0,
      });
    }
    
    setRows(newRows);
  };

  const handleKeyDown = (e: React.KeyboardEvent, rowIndex: number, colIndex: number) => {
    const maxCol = columns.length - 2; // Exclude delete column from navigation
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
    }
  };

  const focusCell = (rowIndex: number, colIndex: number) => {
    const key = `${rowIndex}-${colIndex}`;
    setTimeout(() => {
      inputRefs.current[key]?.focus();
      inputRefs.current[key]?.select();
    }, 0);
  };

  // Export current Sale to Excel
  const handleExportSale = (detailed: boolean) => {
    const validItems = rows.filter(r => r.stockItemId && r.quantity > 0 && r.rate > 0);
    
    if (validItems.length === 0) {
      toast({
        title: "No data to export",
        description: "Add at least one item before exporting.",
        variant: "destructive",
      });
      return;
    }
    
    const exportDate = saleDate || new Date().toISOString().split('T')[0];
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
      writeFile(workbook, fileName);
      
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
      writeFile(workbook, fileName);
      
      toast({
        title: "Export successful",
        description: `Downloaded ${fileName}.`,
      });
    }
  };

  const handleSaveSale = () => {
    // Validate
    if (!activeLocation) {
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
      locationId: activeLocation.id,
      paymentAccountType: isCreditSale ? "credit" : paymentAccountType,
      paymentAccountId: isCreditSale ? parseInt(selectedCustomerId) : parseInt(paymentAccountId),
      isCreditSale,
      notes,
      voucherDate: saleDate,
      currency: "USD", // Always store in USD
      exchangeRate: exchangeRate ? exchangeRate.toString() : undefined, // Rate-lock: store the rate used for this transaction
      items: validItems.map(row => {
        // Use canonical USD rate directly (no conversion needed)
        return {
          stockItemId: row.stockItemId,
          salesItemId: row.salesItemId, // Preserve for edit mode
          quantity: row.quantity.toString(),
          rate: row.rateUSD.toFixed(2),
        };
      }),
    };

    saveMutation.mutate(saleData);
  };

  const total = rows.reduce((sum, row) => sum + (row.amount || 0), 0);
  const totalQty = rows.reduce((sum, row) => sum + (parseFloat(String(row.quantity)) || 0), 0);
  const filteredItems = getFilteredInventory();

  return (
    <div className="space-y-4">
      <PageHeader 
        title={editVoucherId ? "Edit Sale" : "Point of Sale"}
        subtitle={editVoucherId && editVoucher ? `Voucher #${editVoucher.voucherNumber}` : undefined}
      >
        <div className="flex flex-wrap gap-1 sm:gap-2">
          {!posUser && !editVoucherId && (
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
          <Button 
            onClick={handleSaveSale}
            size="sm"
            disabled={saveMutation.isPending}
            className="gap-1 sm:gap-2"
            data-testid="button-complete-sale"
          >
            {saveMutation.isPending ? "..." : <><span className="hidden sm:inline">{editVoucherId ? "Update" : "Save"}</span><span className="sm:hidden">Save</span></>}
            {!saveMutation.isPending && <Check className="h-4 w-4" />}
          </Button>
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-4">
        <div className="flex items-center gap-2 col-span-2 sm:col-span-1">
          <MapPin className="h-4 w-4 text-muted-foreground shrink-0 hidden sm:block" />
          {posUser ? (
            <div className="px-2 sm:px-3 py-1.5">
              <span className="text-sm sm:text-base">{activeLocation?.name}</span>
            </div>
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
                {allLocations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id.toString()}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Date Picker */}
        <div className="flex items-center gap-2">
          <DatePickerInput
            value={saleDate}
            onChange={setSaleDate}
            placeholder="Date"
            className="w-full sm:w-36"
            data-testid="input-sale-date"
          />
        </div>

        {/* Hide cash account selector when credit sale is ON */}
        {!isCreditSale && (
          <div className="flex items-center gap-2 col-span-2 sm:col-span-1 flex-wrap">
            <Wallet className="h-4 w-4 text-muted-foreground shrink-0 hidden sm:block" />
            {posUser?.cashAccountId && assignedCashAccount ? (
              <div className="px-2 sm:px-3 py-1.5 bg-muted/50 rounded-md border">
                <span className="text-xs sm:text-sm">{assignedCashAccount.name}</span>
                <span className="text-xs text-muted-foreground ml-1 sm:ml-2 hidden sm:inline">({assignedCashAccount.code})</span>
              </div>
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
                      bankAccounts.map((acc: any) => (
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
          <div className="flex items-center gap-2 col-span-2 sm:col-span-1">
            <User className="h-4 w-4 text-muted-foreground shrink-0 hidden sm:block" />
            <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
              <SelectTrigger className="w-full sm:w-44" data-testid="select-customer">
                <SelectValue placeholder="Customer" />
              </SelectTrigger>
              <SelectContent>
                {customerAccounts.map((acc: any) => (
                  <SelectItem key={acc.id} value={String(acc.id)}>
                    {acc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

      <div className="flex flex-col lg:flex-row gap-4">
        {/* Main Spreadsheet Area */}
        <Card className="flex-1 overflow-hidden min-w-0">
          <div className="overflow-x-auto">
            <div className="min-w-[340px] sm:min-w-[500px]">
              {/* Header */}
              <div className="flex bg-muted/30 border-b border-muted sticky top-0 z-10">
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
                          ) : (
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
                                  setTimeout(() => {
                                    setActiveRow(null);
                                  }, 200);
                                }
                              }}
                              readOnly={col.key === "amount"}
                              className={`w-full h-full px-1.5 sm:px-3 bg-transparent outline-none focus:bg-accent/20 text-xs sm:text-sm ${
                                col.key === "quantity" || col.key === "rate" || col.key === "amount"
                                  ? "font-mono text-right"
                                  : ""
                              } ${col.key === "amount" ? "cursor-not-allowed" : ""}`}
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
                    {/* Mobile inline autocomplete dropdown */}
                    {activeRow === rowIndex && filteredItems.length > 0 && (
                      <div className="lg:hidden border-b border-muted bg-background shadow-md max-h-48 overflow-y-auto z-20 relative">
                        {filteredItems.slice(0, 8).map((item, idx) => (
                          <button
                            key={item.code}
                            onMouseDown={(e) => { e.preventDefault(); selectItem(item); }}
                            className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 border-b border-muted/30 active-elevate-2 ${
                              item.stock === 0 ? "opacity-60" : ""
                            } ${idx === highlightedIndex ? "bg-accent" : ""}`}
                            data-testid={`mobile-item-${idx}`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-sm">{item.name}</div>
                              <div className="text-xs text-muted-foreground font-mono">{item.code}</div>
                            </div>
                            <div className={`text-xs font-medium px-2 py-0.5 rounded shrink-0 ${
                              item.stock === 0 
                                ? "bg-destructive/10 text-destructive" 
                                : item.stock < 10
                                ? "bg-chart-3/10 text-chart-3"
                                : "bg-chart-2/10 text-chart-2"
                            }`}>
                              {item.stock === 0 ? "Out" : `${item.stock}`}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Total Section */}
          <div className="border-t border-muted bg-muted/20 p-2 sm:p-4">
            <div className="flex flex-col sm:flex-row sm:justify-end items-stretch sm:items-center gap-2 sm:gap-6 sm:max-w-md ml-auto">
              <div className="flex items-center justify-between sm:justify-start gap-2 text-xs sm:text-sm">
                <span className="text-muted-foreground">Items:</span>
                <span className="font-mono">{rows.filter((r) => r.amount > 0).length}</span>
                <span className="text-muted-foreground ml-2">Qty:</span>
                <span className="font-mono" data-testid="text-total-qty">{totalQty > 0 ? totalQty.toFixed(3) : "0"}</span>
              </div>
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
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setHighlightedIndex(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (!searchTerm.trim()) return;
                    const items = getFilteredInventory();
                    if (items.length > 0) {
                      const item = items[highlightedIndex] || items[0];
                      const targetRow = activeRow ?? selectedCell.row;
                      if (activeRow === null) {
                        setActiveRow(targetRow);
                        setTimeout(() => selectItem(item), 0);
                      } else {
                        selectItem(item);
                      }
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
                  onClick={() => selectItem(item)}
                  className={`w-full text-left px-3 py-3 rounded-md hover-elevate active-elevate-2 ${
                    item.stock === 0 ? "opacity-60" : ""
                  } ${idx === highlightedIndex && activeRow !== null ? "bg-accent" : ""}`}
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
          
          {/* Hidden Print Template - POS/Thermal Style */}
          <div className="hidden">
            <div ref={printRef} style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '11pt', padding: '12px', backgroundColor: 'white', color: 'black', width: '100%', fontWeight: 'normal', fontVariantNumeric: 'tabular-nums' }}>
              {/* Injected print styles to match LocationInventory print */}
              <style dangerouslySetInnerHTML={{ __html: `
                @media print {
                  body { font-family: Arial, Helvetica, sans-serif !important; }
                  * { font-family: Arial, Helvetica, sans-serif !important; font-variant-numeric: tabular-nums !important; }
                }
              `}} />
              {/* Title */}
              <div style={{ textAlign: 'center', fontWeight: '900', fontSize: '18pt', letterSpacing: '2px', marginBottom: '6px' }}>
                POS INVOICE
              </div>

              {/* Invoice Info - Date/Time left, User right */}
              <div style={{ fontSize: '11pt', fontWeight: '700', display: 'flex', justifyContent: 'space-between', borderTop: '2px solid black', borderBottom: '2px solid black', padding: '5px 0', marginBottom: '6px' }}>
                <span>Date: {savedSale?.saleDate}</span>
                <span>User: {printUserName}</span>
              </div>

              {/* Daily Exchange Rate - Only for Mali company, uses transaction's locked rate */}
              {selectedCompany?.name?.toLowerCase().includes('mali') && (savedSale?.voucher?.exchangeRate || exchangeRate) && (
                <div style={{ fontSize: '11pt', fontWeight: '700', marginBottom: '6px', padding: '4px', border: '2px solid black', textAlign: 'center' }}>
                  <span style={{ fontWeight: '900' }}>Daily Rate:</span> $1 = {formatNumber(parseFloat(savedSale?.voucher?.exchangeRate) || exchangeRate || 0)} CFA
                </div>
              )}

              {/* Credit Sale Customer Info */}
              {savedSale?.isCreditSale && savedSale?.customer && (
                <div style={{ fontSize: '10pt', fontWeight: '700', marginBottom: '6px', padding: '4px', border: '2px solid black' }}>
                  <div style={{ fontWeight: '900' }}>CREDIT SALE</div>
                  <div>Customer: {savedSale.customer.name}</div>
                </div>
              )}

              {/* Items Table - Always print in USD */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11pt', marginBottom: '0', fontVariantNumeric: 'tabular-nums' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid black' }}>
                    <th style={{ textAlign: 'left', padding: '4px 3px', width: '48%', fontWeight: '900' }}>Description</th>
                    <th style={{ textAlign: 'right', padding: '4px 3px', width: '12%', fontWeight: '900' }}>Qty</th>
                    <th style={{ textAlign: 'right', padding: '4px 3px', width: '20%', fontWeight: '900' }}>Rate</th>
                    <th style={{ textAlign: 'right', padding: '4px 3px', width: '20%', fontWeight: '900' }}>Amt</th>
                  </tr>
                </thead>
                <tbody>
                  {(savedSale?.items ?? []).map((item: any, idx: number) => {
                    const lockedRate = parseFloat(savedSale?.voucher?.exchangeRate) || exchangeRate || 1;
                    const wasCFA = savedSale?.voucher?.currency === "CFA";
                    const rawRate = parseFloat(item.rateUSD || item.rate);
                    const itemRateUSD = wasCFA && !item.rateUSD && lockedRate > 1 
                      ? rawRate / lockedRate 
                      : rawRate;
                    const itemAmountUSD = parseFloat(item.quantity) * itemRateUSD;
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #ccc' }}>
                        <td style={{ padding: '4px 3px', verticalAlign: 'top', wordBreak: 'break-word', fontWeight: '600', lineHeight: '1.3' }}>{item.stockItemName}</td>
                        <td style={{ textAlign: 'right', padding: '4px 3px', verticalAlign: 'top', fontWeight: '600' }}>{item.quantity}</td>
                        <td style={{ textAlign: 'right', padding: '4px 3px', verticalAlign: 'top', fontWeight: '600' }}>${itemRateUSD.toFixed(2)}</td>
                        <td style={{ textAlign: 'right', padding: '4px 3px', verticalAlign: 'top', fontWeight: '600' }}>${itemAmountUSD.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                {/* Totals Row */}
                <tfoot>
                  <tr style={{ borderTop: '2px solid black', fontWeight: '900' }}>
                    <td style={{ padding: '5px 3px', fontWeight: '900' }}>TOTAL</td>
                    <td style={{ textAlign: 'right', padding: '5px 3px' }}>{(savedSale?.items ?? []).reduce((sum: number, item: any) => sum + parseFloat(item.quantity || 0), 0)}</td>
                    <td style={{ padding: '5px 3px' }}></td>
                    <td style={{ textAlign: 'right', padding: '5px 3px', fontWeight: '900' }}>
                      ${(() => {
                        const lockedRate = parseFloat(savedSale?.voucher?.exchangeRate) || exchangeRate || 1;
                        const wasCFA = savedSale?.voucher?.currency === "CFA";
                        const total = (savedSale?.items ?? []).reduce((sum: number, item: any) => {
                          const rawRate = parseFloat(item.rateUSD || item.rate);
                          const rateUSD = wasCFA && !item.rateUSD && lockedRate > 1 ? rawRate / lockedRate : rawRate;
                          return sum + (parseFloat(item.quantity) * rateUSD);
                        }, 0);
                        return total.toFixed(2);
                      })()}
                    </td>
                  </tr>
                </tfoot>
              </table>

              {/* Total Paid - Simple clean display */}
              <div style={{ fontSize: '14pt', fontWeight: '900', marginTop: '8px', paddingTop: '8px', borderTop: '2px solid black', display: 'flex', justifyContent: 'space-between' }}>
                <span>TOTAL PAID:</span>
                <span>
                  ${(() => {
                    const lockedRate = parseFloat(savedSale?.voucher?.exchangeRate) || exchangeRate || 1;
                    const wasCFA = savedSale?.voucher?.currency === "CFA";
                    const total = (savedSale?.items ?? []).reduce((sum: number, item: any) => {
                      const rawRate = parseFloat(item.rateUSD || item.rate);
                      const rateUSD = wasCFA && !item.rateUSD && lockedRate > 1 ? rawRate / lockedRate : rawRate;
                      return sum + (parseFloat(item.quantity) * rateUSD);
                    }, 0);
                    return total.toFixed(2);
                  })()}
                </span>
              </div>

              {/* Notes */}
              {savedSale?.voucher?.description && (
                <div style={{ fontSize: '9pt', fontWeight: '600', marginTop: '8px', padding: '4px', border: '2px solid black' }}>
                  <span style={{ fontWeight: '900' }}>Note:</span> {savedSale.voucher.description}
                </div>
              )}

              {/* Footer */}
              <div style={{ textAlign: 'center', fontSize: '9pt', fontWeight: '700', marginTop: '10px', paddingTop: '5px', borderTop: '2px solid black' }}>
                <div>Thank you for your business!</div>
              </div>
            </div>
          </div>

          <AlertDialogFooter>
            <Button variant="outline" onClick={() => { setShowPrintDialog(false); if (editVoucherId) navigate("/pos-daybook"); }} data-testid="button-cancel-print">
              Close
            </Button>
            <Button onClick={handlePrint} className="gap-2" data-testid="button-print-invoice">
              <Printer className="h-4 w-4" />
              Print Invoice
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
            {drafts.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No drafts available</p>
            ) : (
              <div className="space-y-2">
                {drafts.map((draft: any) => (
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
