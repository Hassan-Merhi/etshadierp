import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { apiRequest, queryClient, getAppDate } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useReactToPrint } from "react-to-print";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { PageHeader } from "@/components/PageHeader";
import {
  ShoppingCart,
  Printer,
  Plus,
  Trash2,
  Search,
  Package,
  History,
  X,
  Check,
  MapPin,
  Wallet,
  User,
  ChevronRight,
  CreditCard,
  Banknote,
  AlertCircle,
  Pencil,
} from "lucide-react";

interface CartRow {
  id: string;
  productId: number | null;
  productName: string;
  articleCode: string;
  availableQty: number;
  quantity: number;
  unitPrice: number;
  weightPerBale: number;
}

interface InventoryItem {
  productId: number;
  productName: string;
  articleCode: string;
  category: string | null;
  quantity: number;
  totalWeight: number;
  sellingPrice: string;
  referenceNumbers?: string[];
}

interface ExpenseRow {
  id: string;
  accountId: string;
  description: string;
  amount: string;
}

function emptyRow(id?: string): CartRow {
  return {
    id: id ?? String(Date.now()),
    productId: null,
    productName: "",
    articleCode: "",
    availableQty: 0,
    quantity: 1,
    unitPrice: 0,
    weightPerBale: 0,
  };
}

function formatNum(v: string | number) {
  const n = parseFloat(String(v));
  if (isNaN(n)) return "0.00";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const COLUMNS = [
  { key: "productName", label: "Description", width: "flex-1" },
  { key: "quantity", label: "Qty", width: "w-20" },
  { key: "unitPrice", label: "Price", width: "w-28" },
  { key: "amount", label: "Amount", width: "w-28" },
  { key: "delete", label: "", width: "w-10" },
];

export default function FactoryPOS() {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const printRef = useRef<HTMLDivElement>(null);
  const inputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  // Edit mode — populated from ?edit=<id> query param
  const editSaleId = (() => {
    const p = new URLSearchParams(window.location.search).get("edit");
    return p ? parseInt(p) : null;
  })();

  const [locationId, setLocationId] = useState<string>("");
  const [customerName, setCustomerName] = useState("");
  const [paymentType, setPaymentType] = useState<"CASH" | "CREDIT">("CASH");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [txDate, setTxDate] = useState(getAppDate());
  const [currencyCode, setCurrencyCode] = useState("USD");
  const [cashAccountId, setCashAccountId] = useState<string>("");
  const [rows, setRows] = useState<CartRow[]>([emptyRow("1")]);
  const [expenseRows, setExpenseRows] = useState<ExpenseRow[]>([]);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const itemListRef = useRef<HTMLDivElement>(null);
  const [savedSale, setSavedSale] = useState<any>(null);
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const [voidId, setVoidId] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [editLoaded, setEditLoaded] = useState(false);

  // Mobile state
  const [mobileRowEditOpen, setMobileRowEditOpen] = useState(false);
  const [mobileRowEditIdx, setMobileRowEditIdx] = useState<number | null>(null);
  const [mobileBrowseOpen, setMobileBrowseOpen] = useState(false);
  const [mobileBrowseSearch, setMobileBrowseSearch] = useState("");
  const [mobileRowTarget, setMobileRowTarget] = useState<number | null>(null);

  // Queries
  const { data: locations } = useQuery<any[]>({ queryKey: ["/api/locations"] });
  const { data: allCustomers } = useQuery<any[]>({ queryKey: ["/api/factory/customers"] });
  const { data: inventory, isLoading: invLoading } = useQuery<InventoryItem[]>({
    queryKey: ["/api/factory/location-inventory", locationId],
    queryFn: async () => {
      if (!locationId) return [];
      const res = await fetch(`/api/factory/location-inventory/${locationId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!locationId,
  });
  const { data: ledgerAccounts } = useQuery<any[]>({ queryKey: ["/api/ledger-accounts"] });
  const cashAccounts = (ledgerAccounts || []).filter((a: any) => a.accountType === "Cash");
  const { data: sales, isLoading: salesLoading } = useQuery<any[]>({
    queryKey: ["/api/factory/pos/sales"],
    enabled: showHistory,
  });
  const { data: authUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const printUserName = authUser?.fullName || authUser?.name || authUser?.username || authUser?.email || "User";

  // Fetch existing sale when in edit mode
  const { data: editSaleData } = useQuery<any>({
    queryKey: ["/api/factory/pos/sales", editSaleId],
    queryFn: async () => {
      if (!editSaleId) return null;
      const res = await fetch(`/api/factory/pos/sales/${editSaleId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Sale not found");
      return res.json();
    },
    enabled: !!editSaleId,
  });

  // Populate form when edit data loads
  useEffect(() => {
    if (!editSaleData || editLoaded) return;
    setLocationId(editSaleData.locationId ? String(editSaleData.locationId) : "");
    setCustomerName(editSaleData.customerName || "");
    setPaymentType((editSaleData.paymentType as "CASH" | "CREDIT") || "CASH");
    setSelectedCustomerId(editSaleData.customerId ? String(editSaleData.customerId) : "");
    setNotes(editSaleData.notes || "");
    setTxDate(editSaleData.txDate || getAppDate());
    setCurrencyCode(editSaleData.currencyCode || "USD");
    setCashAccountId(editSaleData.cashAccountId ? String(editSaleData.cashAccountId) : "");
    if (editSaleData.items && editSaleData.items.length > 0) {
      setRows(
        editSaleData.items.map((it: any) => ({
          id: String(it.id),
          productId: it.productId || null,
          productName: it.productName,
          articleCode: it.articleCode || "",
          availableQty: 9999,
          quantity: parseInt(it.quantity) || 1,
          unitPrice: parseFloat(it.unitPrice) || 0,
          weightPerBale: 0,
        }))
      );
    }
    if (editSaleData.expensesJson) {
      try {
        const expArr = JSON.parse(editSaleData.expensesJson);
        setExpenseRows(
          expArr.map((e: any) => ({
            id: String(Date.now() + Math.random()),
            accountId: String(e.accountId),
            description: e.description || "",
            amount: String(e.amount),
          }))
        );
      } catch {
        /* ignore */
      }
    }
    setEditLoaded(true);
  }, [editSaleData, editLoaded]);

  const normSearch = (s: string) => (s || "").toLowerCase().replace(/[\s.\-_]/g, "");

  const filteredInventory = (inventory || []).filter((item) => {
    if (!search) return true;
    const s = normSearch(search);
    return (
      normSearch(item.productName).includes(s) ||
      normSearch(item.articleCode).includes(s) ||
      (item.referenceNumbers || []).some((r) => normSearch(r).includes(s))
    );
  });

  const mobileFilteredInventory = (inventory || []).filter((item) => {
    if (!mobileBrowseSearch) return true;
    const s = normSearch(mobileBrowseSearch);
    return (
      normSearch(item.productName).includes(s) ||
      normSearch(item.articleCode).includes(s) ||
      (item.referenceNumbers || []).some((r) => normSearch(r).includes(s))
    );
  });

  // Scroll the highlighted item into view when navigating with arrow keys
  useEffect(() => {
    const list = itemListRef.current;
    if (!list) return;
    const child = list.children[highlightedIndex] as HTMLElement | undefined;
    if (child) child.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlightedIndex]);

  // Keyboard handler for the search input
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, filteredInventory.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const searchNorm = normSearch(search);
      // Prefer an exact articleCode or reference-number match (barcode scanner sends full code + Enter)
      const exactMatch = filteredInventory.find(
        (item) =>
          normSearch(item.articleCode) === searchNorm ||
          (item.referenceNumbers || []).some((r) => normSearch(r) === searchNorm)
      );
      const item = exactMatch ?? filteredInventory[highlightedIndex] ?? filteredInventory[0];
      if (item) {
        addOrIncrementProduct(item);
        setSearch("");
        setHighlightedIndex(0);
        // Keep focus on the search box for rapid scanning
        searchRef.current?.focus();
      }
    } else if (e.key === "Escape") {
      setSearch("");
      setHighlightedIndex(0);
    }
  };

  // ---- Row helpers ----
  const addOrIncrementProduct = (item: InventoryItem) => {
    setRows((prev) => {
      const existingIdx = prev.findIndex((r) => r.productId === item.productId);
      if (existingIdx !== -1) {
        const existing = prev[existingIdx];
        if (existing.quantity >= item.quantity) {
          toast({ title: "Not enough stock", description: `Only ${item.quantity} available`, variant: "destructive" });
          return prev;
        }
        return prev.map((r, i) => (i === existingIdx ? { ...r, quantity: r.quantity + 1 } : r));
      }
      // Add new row before trailing empty row if one exists
      const newRow: CartRow = {
        id: String(Date.now()),
        productId: item.productId,
        productName: item.productName,
        articleCode: item.articleCode,
        availableQty: item.quantity,
        quantity: 1,
        unitPrice: parseFloat(item.sellingPrice || "0"),
        weightPerBale: item.quantity > 0 ? (item.totalWeight || 0) / item.quantity : 0,
      };
      const lastRow = prev[prev.length - 1];
      if (lastRow && !lastRow.productId) {
        return [...prev.slice(0, -1), newRow, lastRow];
      }
      return [...prev, newRow];
    });
  };

  const addProductFromMobile = (item: InventoryItem) => {
    const targetIdx = mobileRowTarget ?? (rows.length > 0 ? rows.length - 1 : 0);
    setRows((prev) => {
      const existingIdx = prev.findIndex((r) => r.productId === item.productId);
      if (existingIdx !== -1) {
        return prev.map((r, i) => (i === existingIdx ? { ...r, quantity: r.quantity + 1 } : r));
      }
      const newRow: CartRow = {
        id: String(Date.now()),
        productId: item.productId,
        productName: item.productName,
        articleCode: item.articleCode,
        availableQty: item.quantity,
        quantity: 1,
        unitPrice: parseFloat(item.sellingPrice || "0"),
        weightPerBale: item.quantity > 0 ? (item.totalWeight || 0) / item.quantity : 0,
      };
      const arr = [...prev];
      arr.splice(targetIdx, 0, newRow);
      return arr;
    });
    setMobileBrowseOpen(false);
    setMobileBrowseSearch("");
    setMobileRowEditIdx(
      rows.findIndex((r) => r.productId === item.productId) !== -1
        ? rows.findIndex((r) => r.productId === item.productId)
        : targetIdx
    );
    setMobileRowEditOpen(true);
  };

  const updateRow = (idx: number, field: "quantity" | "unitPrice", value: string) => {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        if (field === "quantity") {
          const qty = parseInt(value) || 1;
          if (r.availableQty > 0 && qty > r.availableQty) {
            toast({
              title: "Not enough stock",
              description: `Only ${r.availableQty} available`,
              variant: "destructive",
            });
            return r;
          }
          return { ...r, quantity: Math.max(1, qty) };
        }
        return { ...r, unitPrice: parseFloat(value) || 0 };
      })
    );
  };

  const deleteRow = (idx: number) => {
    setRows((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length === 0) return [emptyRow()];
      return next;
    });
  };

  const validRows = rows.filter((r) => r.productId && r.quantity > 0);
  const total = validRows.reduce((s, r) => s + r.quantity * r.unitPrice, 0);
  const totalQty = validRows.reduce((s, r) => s + r.quantity, 0);
  const totalWeight = validRows.reduce((s, r) => s + r.quantity * r.weightPerBale, 0);
  const totalExpenseAmount = expenseRows.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const netTotal = total - totalExpenseAmount;
  const ccPrefix = currencyCode !== "USD" ? `${currencyCode} ` : "$";

  // Expense row helpers
  const addExpenseRow = () =>
    setExpenseRows((prev) => [...prev, { id: String(Date.now()), accountId: "", description: "", amount: "" }]);
  const removeExpenseRow = (idx: number) => setExpenseRows((prev) => prev.filter((_, i) => i !== idx));
  const updateExpenseRow = (idx: number, field: keyof ExpenseRow, value: string) =>
    setExpenseRows((prev) => prev.map((e, i) => (i === idx ? { ...e, [field]: value } : e)));

  // ---- Print ----
  const fmtPrint = (n: number, prefix = "") => {
    const fixed = Math.abs(n).toFixed(2);
    const clean = fixed.replace(/\.00$/, "");
    const parts = clean.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const num = parts.join(".");
    return prefix ? prefix + "\u00A0" + num : num;
  };
  const fmtPrintAmt = (n: number) => fmtPrint(n, ccPrefix);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `FactoryPOS_${txDate}`,
    onAfterPrint: () => setShowPrintDialog(false),
  });

  // ---- Mutations ----
  const saleMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/factory/pos/sale", data),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/factory/pos/sales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/location-inventory", locationId] });
      const snapshotExpenses = expenseRows
        .map((e) => ({
          ...e,
          accountName: (ledgerAccounts || []).find((a: any) => String(a.id) === e.accountId)?.name || e.accountId,
        }))
        .filter((e) => parseFloat(e.amount) > 0 && e.accountId);
      setSavedSale({
        ...data,
        cartRows: validRows,
        customerName,
        notes,
        currencyCode,
        total,
        totalWeight,
        expenses: snapshotExpenses,
        netTotal: total - snapshotExpenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0),
        txDate,
        companyName: selectedCompany?.name || "",
        paymentType: data.paymentType || "CASH",
        depositAmount: data.depositAmount || "0",
      });
      setRows([emptyRow()]);
      setExpenseRows([]);
      setCustomerName("");
      setPaymentType("CASH");
      setSelectedCustomerId("");
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customers"] });
      toast({ title: "Sale recorded", description: `${data.saleNumber} – ${ccPrefix}${formatNum(total)}` });
      setShowPrintDialog(true);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to create sale", variant: "destructive" });
    },
  });

  const editMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", `/api/factory/pos/sales/${editSaleId}`, data),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/factory/pos/sales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/pos/sales", editSaleId] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/location-inventory", locationId] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      toast({ title: "Sale updated", description: `${data.saleNumber || editSaleData?.saleNumber} saved` });
      navigate("/factory/daybook");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to update sale", variant: "destructive" });
    },
  });

  const voidMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/factory/pos/sales/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/pos/sales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/location-inventory", locationId] });
      setVoidId(null);
      toast({ title: "Sale voided" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!locationId) return toast({ title: "Select a location", variant: "destructive" });
    if (validRows.length === 0) return toast({ title: "No items in sale", variant: "destructive" });
    const validExpenses = expenseRows.filter((e) => parseFloat(e.amount) > 0 && e.accountId);
    if (totalExpenseAmount > total) return toast({ title: "Deductions exceed sales total", variant: "destructive" });
    if (paymentType === "CREDIT" && !selectedCustomerId) {
      return toast({ title: "Select a customer for credit sale", variant: "destructive" });
    }
    const payload = {
      locationId: parseInt(locationId),
      customerName: customerName || null,
      customerId: paymentType === "CREDIT" && selectedCustomerId ? parseInt(selectedCustomerId) : null,
      paymentType,
      depositAmount: "0",
      notes: notes || null,
      txDate,
      currencyCode,
      cashAccountId: cashAccountId ? parseInt(cashAccountId) : null,
      items: validRows.map((r) => ({
        productId: r.productId,
        productName: r.productName,
        articleCode: r.articleCode,
        quantity: r.quantity,
        unitPrice: String(r.unitPrice),
      })),
      expenses: validExpenses.map((e) => ({
        accountId: e.accountId,
        description: e.description,
        amount: e.amount,
      })),
    };
    if (editSaleId) {
      editMutation.mutate(payload);
    } else {
      saleMutation.mutate(payload);
    }
  };

  // Mobile row being edited
  const mobileRow = mobileRowEditIdx !== null ? rows[mobileRowEditIdx] : null;

  return (
    <div className="space-y-4">
      <PageHeader title={editSaleId ? `Editing ${editSaleData?.saleNumber || "Sale"}` : "Factory POS"}>
        <div className="flex flex-wrap gap-1 sm:gap-2">
          {editSaleId ? (
            <Button variant="outline" size="sm" onClick={() => navigate("/factory/pos")} data-testid="button-new-sale">
              <Plus className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">New Sale</span>
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowHistory((h) => !h)}
              data-testid="button-toggle-history"
            >
              <History className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">History</span>
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={validRows.length === 0 || saleMutation.isPending || editMutation.isPending}
            className="gap-1 sm:gap-2"
            data-testid="button-complete-sale"
          >
            {saleMutation.isPending || editMutation.isPending ? (
              "..."
            ) : editSaleId ? (
              <>
                <span className="hidden sm:inline">Update</span>
                <Pencil className="h-4 w-4" />
              </>
            ) : (
              <>
                <span className="hidden sm:inline">Save</span>
                <Check className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </PageHeader>

      {/* ── Toolbar ── */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-4">
        {/* Location */}
        <div className="flex items-center gap-2 col-span-2 sm:col-span-1">
          <MapPin className="h-4 w-4 text-muted-foreground shrink-0 hidden sm:block" />
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger className="w-full sm:w-48" data-testid="select-location">
              <SelectValue placeholder="Select location" />
            </SelectTrigger>
            <SelectContent>
              {(locations || []).map((l: any) => (
                <SelectItem key={l.id} value={String(l.id)}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Date */}
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={txDate}
            onChange={(e) => setTxDate(e.target.value)}
            className="w-full sm:w-36"
            data-testid="input-sale-date"
          />
        </div>

        {/* Currency */}
        <div className="flex items-center gap-2">
          <Select value={currencyCode} onValueChange={setCurrencyCode}>
            <SelectTrigger className="w-24 sm:w-28" data-testid="select-currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="USD">USD</SelectItem>
              <SelectItem value="EUR">EUR</SelectItem>
              <SelectItem value="GBP">GBP</SelectItem>
              <SelectItem value="LBP">LBP</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Cash Account */}
        <div className="flex items-center gap-2 col-span-2 sm:col-span-1">
          <Wallet className="h-4 w-4 text-muted-foreground shrink-0 hidden sm:block" />
          <Select value={cashAccountId} onValueChange={setCashAccountId}>
            <SelectTrigger className="w-full sm:w-48" data-testid="select-cash-account">
              <SelectValue placeholder="Cash account" />
            </SelectTrigger>
            <SelectContent>
              {cashAccounts.map((a: any) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Payment Type Toggle */}
        <div className="flex items-center gap-1 col-span-2 sm:col-span-1">
          <Button
            variant={paymentType === "CASH" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setPaymentType("CASH");
              setSelectedCustomerId("");
            }}
            data-testid="button-payment-type-cash"
            className="gap-1"
          >
            <Banknote className="h-3.5 w-3.5" />
            Cash
          </Button>
          <Button
            variant={paymentType === "CREDIT" ? "default" : "outline"}
            size="sm"
            onClick={() => setPaymentType("CREDIT")}
            data-testid="button-payment-type-credit"
            className="gap-1"
          >
            <CreditCard className="h-3.5 w-3.5" />
            Credit
          </Button>
        </div>

        {/* Customer — always visible for cash, required for credit */}
        {paymentType === "CASH" ? (
          <div className="flex items-center gap-2 col-span-2 sm:col-span-1">
            <User className="h-4 w-4 text-muted-foreground shrink-0 hidden sm:block" />
            <Input
              placeholder="Customer name (optional)"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="w-full sm:w-44"
              data-testid="input-customer-name"
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 col-span-2 sm:col-span-1">
            <User className="h-4 w-4 text-muted-foreground shrink-0 hidden sm:block" />
            <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
              <SelectTrigger className="w-full sm:w-48" data-testid="select-credit-customer">
                <SelectValue placeholder="Select customer *" />
              </SelectTrigger>
              <SelectContent>
                {(allCustomers || []).map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.legalName || c.name || `Customer #${c.id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Notes */}
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
        {rows.map((row, idx) => {
          if (!row.productId) return null;
          return (
            <div
              key={row.id}
              className="rounded-md border bg-card px-3 py-2.5 flex items-center gap-2 hover-elevate active-elevate-2 cursor-pointer"
              onClick={() => {
                setMobileRowEditIdx(idx);
                setMobileRowEditOpen(true);
              }}
              data-testid={`mobile-row-card-${idx}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground shrink-0">{idx + 1}.</span>
                  <span className="text-sm font-medium truncate">{row.productName}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                  Qty: {row.quantity} · Price: {ccPrefix}
                  {formatNum(row.unitPrice)}
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-1.5">
                <span className="text-sm font-semibold font-mono">
                  {ccPrefix}
                  {formatNum(row.quantity * row.unitPrice)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteRow(idx);
                  }}
                  data-testid={`mobile-delete-row-${idx}`}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          );
        })}

        {/* Tap to add item */}
        <div
          className="rounded-md border border-dashed border-muted-foreground/30 px-3 py-3 flex items-center gap-2 text-muted-foreground cursor-pointer hover-elevate active-elevate-2"
          onClick={() => {
            setMobileRowTarget(rows.length);
            setMobileBrowseOpen(true);
          }}
          data-testid="mobile-add-item-card"
        >
          <Plus className="h-4 w-4" />
          <span className="text-sm">Tap to add item</span>
        </div>

        {/* Mobile summary */}
        <div className="rounded-md border bg-muted/30 px-3 py-2 flex items-center justify-between gap-2 mt-2">
          <span className="text-xs text-muted-foreground">
            {validRows.length} items · Qty {totalQty}
            {totalWeight > 0 && ` · ${formatNum(totalWeight)} kg`}
          </span>
          <div className="text-right">
            {totalExpenseAmount > 0 ? (
              <>
                <div className="text-xs text-muted-foreground line-through font-mono">
                  {ccPrefix}
                  {formatNum(total)}
                </div>
                <div className="text-base font-semibold font-mono" data-testid="text-grand-total-mobile">
                  {ccPrefix}
                  {formatNum(netTotal)}
                </div>
              </>
            ) : (
              <span className="text-base font-semibold font-mono" data-testid="text-grand-total-mobile">
                {ccPrefix}
                {formatNum(total)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── DESKTOP: table + right product panel (hidden on mobile) ── */}
      <div className="hidden md:flex flex-col lg:flex-row gap-4">
        {/* Main Table */}
        <Card className="flex-1 overflow-hidden min-w-0">
          <div className="table-responsive">
            <div className="min-w-[400px]">
              {/* Header */}
              <div className="flex bg-muted/30 border-b border-muted sticky top-0 z-30">
                <div className="w-10 flex items-center justify-center border-r border-muted h-10 text-xs text-muted-foreground">
                  #
                </div>
                {COLUMNS.map((col) => (
                  <div
                    key={col.key}
                    className={`${col.width} flex items-center px-3 border-r border-muted h-10 text-xs text-muted-foreground`}
                  >
                    {col.label}
                  </div>
                ))}
              </div>

              {/* Rows */}
              <div className="max-h-[calc(100vh-24rem)] overflow-y-auto">
                {rows.map((row, idx) => (
                  <div key={row.id} className="flex border-b border-muted/50 hover-elevate">
                    <div className="w-10 flex items-center justify-center border-r border-muted/50 h-10 text-xs text-muted-foreground">
                      {row.productId ? idx + 1 : ""}
                    </div>
                    {COLUMNS.map((col) => (
                      <div
                        key={col.key}
                        className={`${col.width} border-r h-10 ${col.key === "amount" ? "bg-muted/30" : ""}`}
                      >
                        {col.key === "delete" ? (
                          row.productId ? (
                            <div className="flex items-center justify-center h-full">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteRow(idx)}
                                data-testid={`button-delete-row-${idx}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          ) : null
                        ) : col.key === "amount" ? (
                          <div className="flex items-center justify-end h-full px-3 font-mono text-sm text-muted-foreground">
                            {row.productId ? `${ccPrefix}${formatNum(row.quantity * row.unitPrice)}` : ""}
                          </div>
                        ) : col.key === "productName" ? (
                          <div className="flex items-center h-full px-3 text-sm font-medium">
                            {row.productId ? (
                              <div className="min-w-0">
                                <div className="truncate">{row.productName}</div>
                                {row.articleCode && (
                                  <div className="text-xs text-muted-foreground truncate">{row.articleCode}</div>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground/50 text-xs">Click a product →</span>
                            )}
                          </div>
                        ) : (
                          <input
                            ref={(el) => {
                              inputRefs.current[`${idx}-${col.key}`] = el;
                            }}
                            type="number"
                            inputMode="decimal"
                            value={!row.productId ? "" : col.key === "quantity" ? row.quantity : row.unitPrice}
                            onChange={(e) =>
                              row.productId && updateRow(idx, col.key as "quantity" | "unitPrice", e.target.value)
                            }
                            readOnly={!row.productId}
                            className={`w-full h-full px-3 bg-transparent outline-none focus:bg-accent/20 text-sm font-mono text-right ${!row.productId ? "cursor-default" : ""}`}
                            data-testid={`input-${col.key}-${idx}`}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Total Section */}
          <div className="border-t border-muted bg-muted/20 p-4 space-y-3">
            {/* Summary row */}
            <div className="flex flex-col sm:flex-row sm:justify-end items-stretch sm:items-center gap-2 sm:gap-6 sm:max-w-lg ml-auto">
              <div className="flex items-center justify-between sm:justify-start gap-2 text-sm flex-wrap">
                <span className="text-muted-foreground">Items:</span>
                <span className="font-mono">{validRows.length}</span>
                <span className="text-muted-foreground ml-2">Qty:</span>
                <span className="font-mono" data-testid="text-total-qty">
                  {totalQty}
                </span>
                {totalWeight > 0 && (
                  <>
                    <span className="text-muted-foreground ml-2">Wt:</span>
                    <span className="font-mono" data-testid="text-total-weight">
                      {formatNum(totalWeight)} kg
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center justify-between sm:justify-start gap-2">
                <span className="text-lg font-medium">Total:</span>
                <span className="text-2xl font-semibold font-mono" data-testid="text-grand-total">
                  {ccPrefix}
                  {formatNum(total)}
                </span>
              </div>
            </div>

            {/* Expense deductions */}
            <div className="sm:max-w-lg ml-auto space-y-2">
              {expenseRows.map((exp, idx) => (
                <div key={exp.id} className="flex gap-2 items-center">
                  <Select value={exp.accountId} onValueChange={(v) => updateExpenseRow(idx, "accountId", v)}>
                    <SelectTrigger className="flex-1 min-w-0" data-testid={`select-expense-account-${idx}`}>
                      <SelectValue placeholder="Expense account" />
                    </SelectTrigger>
                    <SelectContent>
                      {(ledgerAccounts || []).map((a: any) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Description"
                    value={exp.description}
                    onChange={(e) => updateExpenseRow(idx, "description", e.target.value)}
                    className="w-28 shrink-0"
                    data-testid={`input-expense-description-${idx}`}
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="Amount"
                    value={exp.amount}
                    onChange={(e) => updateExpenseRow(idx, "amount", e.target.value)}
                    className="w-24 shrink-0 text-right font-mono"
                    data-testid={`input-expense-amount-${idx}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeExpenseRow(idx)}
                    data-testid={`button-remove-expense-${idx}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={addExpenseRow}
                  className="text-muted-foreground"
                  data-testid="button-add-deduction"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Deduction
                </Button>
                {totalExpenseAmount > 0 && (
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>Deductions:</span>
                      <span className="font-mono text-destructive">
                        -{ccPrefix}
                        {formatNum(totalExpenseAmount)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-medium">Net Cash:</span>
                      <span className="text-xl font-semibold font-mono" data-testid="text-net-total">
                        {ccPrefix}
                        {formatNum(netTotal)}
                      </span>
                    </div>
                  </div>
                )}
                {paymentType === "CREDIT" &&
                  (() => {
                    const custObj = (allCustomers || []).find((c: any) => String(c.id) === selectedCustomerId);
                    const prevBal = custObj ? parseFloat(custObj.balance || "0") : 0;
                    const prevBalSide = custObj?.balanceSide || "Dr";
                    const prevNet = prevBalSide === "Dr" ? prevBal : -prevBal;
                    const afterSale = prevNet + total;
                    return (
                      <div
                        className="mt-2 rounded-md border bg-muted/30 p-3 space-y-1.5 text-sm"
                        data-testid="credit-sale-summary"
                      >
                        <div className="flex items-center gap-1.5 font-medium text-xs text-muted-foreground uppercase tracking-wide mb-1">
                          <CreditCard className="h-3.5 w-3.5" />
                          Credit Sale Summary
                        </div>
                        {custObj && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Previous balance</span>
                            <span className="font-mono">
                              {prevNet >= 0 ? "Dr " : "Cr "}
                              {ccPrefix}
                              {formatNum(Math.abs(prevNet))}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">This sale (Dr)</span>
                          <span className="font-mono">
                            +{ccPrefix}
                            {formatNum(total)}
                          </span>
                        </div>
                        <div className="flex justify-between font-semibold border-t border-border pt-1.5">
                          <span>Balance after sale</span>
                          <span className="font-mono" data-testid="text-balance-after-sale">
                            {afterSale >= 0 ? "Dr " : "Cr "}
                            {ccPrefix}
                            {formatNum(Math.abs(afterSale))}
                          </span>
                        </div>
                      </div>
                    );
                  })()}
              </div>
            </div>
          </div>
        </Card>

        {/* Right: Product Browser */}
        <Card className="hidden lg:flex w-96 flex-col sticky top-4 max-h-[calc(100vh-8rem)] self-start">
          <div className="p-4 border-b">
            <h3 className="text-sm font-medium mb-2">Products</h3>
            <p className="text-xs text-muted-foreground mb-3">Type or scan a barcode — ↑↓ to navigate, Enter to add</p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchRef}
                placeholder="Scan barcode or search..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setHighlightedIndex(0);
                }}
                onKeyDown={handleSearchKeyDown}
                className="pl-9"
                autoFocus
                data-testid="input-product-search"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {!locationId ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                <Package className="h-8 w-8 opacity-40" />
                <span className="text-sm">Select a location first</span>
              </div>
            ) : invLoading ? (
              <div className="text-center text-muted-foreground text-sm py-8">Loading inventory...</div>
            ) : filteredInventory.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-8">No products in stock</div>
            ) : (
              <div className="space-y-1" ref={itemListRef}>
                {filteredInventory.map((item, idx) => {
                  const inCart = rows.find((r) => r.productId === item.productId);
                  const price = parseFloat(item.sellingPrice || "0");
                  const isHighlighted = idx === highlightedIndex;
                  return (
                    <button
                      key={item.productId}
                      onMouseDown={(e) => {
                        // Use mouseDown so focus stays on the search input while clicking
                        e.preventDefault();
                        addOrIncrementProduct(item);
                        setSearch("");
                        setHighlightedIndex(0);
                        searchRef.current?.focus();
                      }}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      className={`w-full text-left rounded-md px-3 py-2.5 border flex items-center justify-between gap-2 transition-colors ${
                        isHighlighted ? "bg-accent border-accent-foreground/20" : "hover-elevate active-elevate-2"
                      }`}
                      data-testid={`card-product-${item.productId}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{item.productName}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                          {item.articleCode && <span className="font-mono">{item.articleCode}</span>}
                          <span>Stock: {item.quantity}</span>
                          {price > 0 && (
                            <span className="font-semibold">
                              {ccPrefix}
                              {formatNum(price)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-1.5">
                        {inCart && (
                          <Badge variant="outline" className="text-xs">
                            ×{inCart.quantity}
                          </Badge>
                        )}
                        {isHighlighted ? (
                          <Check className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Plus className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* ── History ── */}
      {showHistory && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4" />
              Sales History
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {salesLoading ? (
              <div className="p-6 text-center text-muted-foreground">Loading...</div>
            ) : !sales || sales.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground">No sales yet</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sale #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sales.map((sale: any) => {
                    const pfx = sale.currencyCode !== "USD" ? `${sale.currencyCode} ` : "$";
                    return (
                      <TableRow key={sale.id} data-testid={`row-sale-${sale.id}`}>
                        <TableCell className="font-mono text-sm">{sale.saleNumber}</TableCell>
                        <TableCell className="text-sm">{sale.txDate}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{sale.customerName || "—"}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {pfx}
                          {formatNum(sale.totalAmount)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={sale.status === "VOIDED" ? "secondary" : "outline"}>{sale.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {sale.status !== "VOIDED" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-destructive"
                              onClick={() => setVoidId(sale.id)}
                              data-testid={`button-void-${sale.id}`}
                            >
                              Void
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── MOBILE: product browse sheet ── */}
      <Sheet open={mobileBrowseOpen} onOpenChange={setMobileBrowseOpen}>
        <SheetContent side="bottom" className="h-[80vh] flex flex-col">
          <div className="pb-3 border-b">
            <div className="text-base font-semibold mb-3">Add Product</div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Scan barcode or search..."
                value={mobileBrowseSearch}
                onChange={(e) => setMobileBrowseSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && mobileFilteredInventory.length > 0) {
                    e.preventDefault();
                    const searchNorm = normSearch(mobileBrowseSearch);
                    const exactMatch = mobileFilteredInventory.find(
                      (item) =>
                        normSearch(item.articleCode) === searchNorm ||
                        (item.referenceNumbers || []).some((r) => normSearch(r) === searchNorm)
                    );
                    addProductFromMobile(exactMatch ?? mobileFilteredInventory[0]);
                  }
                }}
                className="pl-9"
                autoFocus
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1 pt-3">
            {!locationId ? (
              <div className="text-center text-muted-foreground text-sm py-8">Select a location first</div>
            ) : mobileFilteredInventory.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-8">No products in stock</div>
            ) : (
              mobileFilteredInventory.map((item) => {
                const price = parseFloat(item.sellingPrice || "0");
                return (
                  <button
                    key={item.productId}
                    onClick={() => addProductFromMobile(item)}
                    className="w-full text-left rounded-md px-3 py-2.5 border hover-elevate active-elevate-2 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{item.productName}</div>
                      <div className="text-xs text-muted-foreground">
                        Stock: {item.quantity}
                        {price > 0 ? ` · ${ccPrefix}${formatNum(price)}` : ""}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                );
              })
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── MOBILE: row edit sheet ── */}
      <Sheet open={mobileRowEditOpen} onOpenChange={setMobileRowEditOpen}>
        <SheetContent side="bottom" className="h-auto">
          {mobileRow && mobileRowEditIdx !== null && (
            <>
              <div className="pb-3 border-b">
                <div className="text-base font-semibold truncate">{mobileRow.productName}</div>
                {mobileRow.articleCode && <div className="text-xs text-muted-foreground">{mobileRow.articleCode}</div>}
              </div>
              <div className="space-y-4 pt-4">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Quantity (max {mobileRow.availableQty || "∞"})</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={mobileRow.quantity}
                    onChange={(e) => updateRow(mobileRowEditIdx, "quantity", e.target.value)}
                    className="text-right font-mono h-12 text-lg"
                    style={{ fontSize: "18px" }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Unit Price ({currencyCode})</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={mobileRow.unitPrice}
                    onChange={(e) => updateRow(mobileRowEditIdx, "unitPrice", e.target.value)}
                    className="text-right font-mono h-12 text-lg"
                    placeholder="0"
                    style={{ fontSize: "18px" }}
                  />
                </div>
                <div className="rounded-md bg-muted/30 border px-3 py-2.5 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Amount</span>
                  <span className="text-lg font-semibold font-mono">
                    {ccPrefix}
                    {formatNum(mobileRow.quantity * mobileRow.unitPrice)}
                  </span>
                </div>
                <div className="flex gap-2 pt-1 pb-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      deleteRow(mobileRowEditIdx);
                      setMobileRowEditOpen(false);
                    }}
                  >
                    <Trash2 className="h-4 w-4 mr-1.5" />
                    Remove
                  </Button>
                  <Button size="sm" className="flex-1" onClick={() => setMobileRowEditOpen(false)}>
                    <Check className="h-4 w-4 mr-1.5" />
                    Done
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ── MOBILE: FAB ── */}
      <button
        className="md:hidden fixed bottom-20 right-4 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center active:scale-95 transition-transform"
        onClick={() => {
          setMobileRowTarget(rows.length);
          setMobileBrowseOpen(true);
        }}
        data-testid="button-mobile-fab-add"
        aria-label="Add product"
      >
        <Plus className="h-7 w-7" />
      </button>

      {/* ── MOBILE: Sticky save bar ── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-background border-t px-3 py-2 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground">
            {validRows.length} items · Qty {totalQty}
            {totalWeight > 0 ? ` · ${formatNum(totalWeight)} kg` : ""}
          </div>
          <div className="text-base font-semibold font-mono leading-tight" data-testid="text-sticky-total">
            {totalExpenseAmount > 0 ? `${ccPrefix}${formatNum(netTotal)} (net)` : `${ccPrefix}${formatNum(total)}`}
          </div>
        </div>
        <Button
          onClick={handleSubmit}
          disabled={saleMutation.isPending || validRows.length === 0}
          className="shrink-0 h-10 px-5"
          data-testid="button-mobile-sticky-save"
        >
          {saleMutation.isPending ? (
            "..."
          ) : (
            <>
              <Check className="h-4 w-4 mr-1.5" />
              Save
            </>
          )}
        </Button>
      </div>

      {/* ── Print Dialog ── */}
      <AlertDialog open={showPrintDialog} onOpenChange={setShowPrintDialog}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Print Invoice</AlertDialogTitle>
            <AlertDialogDescription>Sale recorded successfully. Print the invoice?</AlertDialogDescription>
          </AlertDialogHeader>

          {/* Hidden Print Template */}
          <div className="hidden">
            <div
              ref={printRef}
              style={{
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: "8pt",
                padding: "8px",
                backgroundColor: "white",
                color: "black",
                width: "100%",
                fontWeight: "normal",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <style
                dangerouslySetInnerHTML={{
                  __html: `
                @media print {
                  body { font-family: Arial, Helvetica, sans-serif !important; }
                  * { font-family: Arial, Helvetica, sans-serif !important; font-variant-numeric: tabular-nums !important; }
                }
              `,
                }}
              />

              {/* Title */}
              <div
                style={{
                  textAlign: "center",
                  fontWeight: "900",
                  fontSize: "13pt",
                  letterSpacing: "1px",
                  marginBottom: "4px",
                }}
              >
                FACTORY POS INVOICE
              </div>

              {/* Sale # centered */}
              {savedSale?.saleNumber && (
                <div style={{ textAlign: "center", fontSize: "8pt", fontWeight: "700", marginBottom: "3px" }}>
                  #{savedSale.saleNumber}
                </div>
              )}

              {/* Date / User row */}
              <div
                style={{
                  fontSize: "8pt",
                  fontWeight: "700",
                  display: "flex",
                  justifyContent: "space-between",
                  borderTop: "1.5px solid black",
                  borderBottom: "1.5px solid black",
                  padding: "3px 0",
                  marginBottom: "4px",
                }}
              >
                <span>Date: {savedSale?.txDate}</span>
                <span>User: {printUserName}</span>
              </div>

              {/* Customer info */}
              {savedSale?.customerName && (
                <div
                  style={{
                    fontSize: "8pt",
                    fontWeight: "700",
                    marginBottom: "4px",
                    padding: "3px",
                    border: "1.5px solid black",
                  }}
                >
                  <div style={{ fontWeight: "900" }}>Customer</div>
                  <div>{savedSale.customerName}</div>
                </div>
              )}

              {/* Items table */}
              {(() => {
                const printRows: CartRow[] = savedSale?.cartRows ?? [];
                const hasPrintWeight = printRows.some((r: CartRow) => r.weightPerBale > 0);
                const printTotalQty = printRows.reduce((s: number, r: CartRow) => s + r.quantity, 0);
                const printTotalWeight = printRows.reduce(
                  (s: number, r: CartRow) => s + r.quantity * r.weightPerBale,
                  0
                );
                const printExpenses: any[] = savedSale?.expenses ?? [];
                const printNetTotal: number = savedSale?.netTotal ?? savedSale?.total ?? 0;
                return (
                  <>
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: "7.5pt",
                        marginBottom: "0",
                        fontVariantNumeric: "tabular-nums",
                        border: "1px solid #999",
                      }}
                    >
                      <thead>
                        <tr>
                          <th
                            style={{
                              textAlign: "left",
                              padding: "2px 5px",
                              fontWeight: "900",
                              fontSize: "7pt",
                              border: "1px solid #999",
                              backgroundColor: "#eeeeee",
                            }}
                          >
                            Description
                          </th>
                          <th
                            style={{
                              textAlign: "center",
                              padding: "2px 5px",
                              fontWeight: "900",
                              fontSize: "7pt",
                              border: "1px solid #999",
                              backgroundColor: "#eeeeee",
                              width: "8%",
                            }}
                          >
                            Qty
                          </th>
                          {hasPrintWeight && (
                            <th
                              style={{
                                textAlign: "center",
                                padding: "2px 5px",
                                fontWeight: "900",
                                fontSize: "7pt",
                                border: "1px solid #999",
                                backgroundColor: "#eeeeee",
                                width: "12%",
                              }}
                            >
                              Wt (kg)
                            </th>
                          )}
                          <th
                            style={{
                              textAlign: "center",
                              padding: "2px 5px",
                              fontWeight: "900",
                              fontSize: "7pt",
                              border: "1px solid #999",
                              backgroundColor: "#eeeeee",
                              width: "14%",
                            }}
                          >
                            Rate
                          </th>
                          <th
                            style={{
                              textAlign: "center",
                              padding: "2px 5px",
                              fontWeight: "900",
                              fontSize: "7pt",
                              border: "1px solid #999",
                              backgroundColor: "#eeeeee",
                              width: "16%",
                            }}
                          >
                            Amt
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {printRows.map((row: CartRow, idx: number) => {
                          const rowBg = idx % 2 === 0 ? "#ffffff" : "#f5f5f5";
                          const rowWeight = row.quantity * row.weightPerBale;
                          return (
                            <tr key={idx} style={{ backgroundColor: rowBg }}>
                              <td
                                style={{
                                  padding: "2px 5px",
                                  verticalAlign: "top",
                                  fontWeight: "600",
                                  lineHeight: "1.2",
                                  fontSize: "7pt",
                                  border: "1px solid #c8c8c8",
                                }}
                              >
                                {row.productName}
                                {row.articleCode ? (
                                  <span style={{ color: "#666", fontSize: "6.5pt" }}> ({row.articleCode})</span>
                                ) : null}
                              </td>
                              <td
                                style={{
                                  textAlign: "center",
                                  padding: "2px 5px",
                                  verticalAlign: "top",
                                  fontWeight: "600",
                                  fontSize: "7pt",
                                  border: "1px solid #c8c8c8",
                                }}
                              >
                                {fmtPrint(row.quantity)}
                              </td>
                              {hasPrintWeight && (
                                <td
                                  style={{
                                    textAlign: "center",
                                    padding: "2px 5px",
                                    verticalAlign: "top",
                                    fontWeight: "600",
                                    fontSize: "7pt",
                                    border: "1px solid #c8c8c8",
                                  }}
                                >
                                  {rowWeight > 0 ? fmtPrint(rowWeight) : "—"}
                                </td>
                              )}
                              <td
                                style={{
                                  textAlign: "center",
                                  padding: "2px 5px",
                                  verticalAlign: "top",
                                  fontWeight: "600",
                                  fontSize: "7pt",
                                  border: "1px solid #c8c8c8",
                                }}
                              >
                                {fmtPrintAmt(row.unitPrice)}
                              </td>
                              <td
                                style={{
                                  textAlign: "center",
                                  padding: "2px 5px",
                                  verticalAlign: "top",
                                  fontWeight: "600",
                                  fontSize: "7pt",
                                  border: "1px solid #c8c8c8",
                                }}
                              >
                                {fmtPrintAmt(row.quantity * row.unitPrice)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td
                            style={{
                              padding: "2px 5px",
                              fontWeight: "900",
                              fontSize: "7pt",
                              border: "1px solid #999",
                              backgroundColor: "#eeeeee",
                            }}
                          >
                            TOTAL
                          </td>
                          <td
                            style={{
                              textAlign: "center",
                              padding: "2px 5px",
                              fontWeight: "900",
                              fontSize: "7pt",
                              border: "1px solid #999",
                              backgroundColor: "#eeeeee",
                            }}
                          >
                            {fmtPrint(printTotalQty)}
                          </td>
                          {hasPrintWeight && (
                            <td
                              style={{
                                textAlign: "center",
                                padding: "2px 5px",
                                fontWeight: "900",
                                fontSize: "7pt",
                                border: "1px solid #999",
                                backgroundColor: "#eeeeee",
                              }}
                            >
                              {fmtPrint(printTotalWeight)}
                            </td>
                          )}
                          <td style={{ padding: "2px 5px", border: "1px solid #999", backgroundColor: "#eeeeee" }}></td>
                          <td
                            style={{
                              textAlign: "center",
                              padding: "2px 5px",
                              fontWeight: "900",
                              fontSize: "7pt",
                              border: "1px solid #999",
                              backgroundColor: "#eeeeee",
                            }}
                          >
                            {fmtPrintAmt(savedSale?.total ?? 0)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>

                    {/* Expense deductions on receipt */}
                    {printExpenses.length > 0 && (
                      <table
                        style={{
                          width: "100%",
                          borderCollapse: "collapse",
                          fontSize: "7.5pt",
                          marginTop: "3px",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        <tbody>
                          {printExpenses.map((exp: any, idx: number) => (
                            <tr key={idx}>
                              <td style={{ padding: "2px 5px", fontSize: "7pt", fontWeight: "600", color: "#333" }}>
                                {exp.description || exp.accountName || "Deduction"}
                              </td>
                              <td
                                style={{
                                  textAlign: "right",
                                  padding: "2px 5px",
                                  fontSize: "7pt",
                                  fontWeight: "700",
                                  color: "#c00",
                                }}
                              >
                                -{fmtPrintAmt(parseFloat(exp.amount))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {/* Total Paid / Net Cash */}
                    {savedSale?.paymentType === "CREDIT" ? (
                      <>
                        <div
                          style={{
                            fontSize: "11pt",
                            fontWeight: "900",
                            marginTop: "4px",
                            paddingTop: "4px",
                            borderTop: "1.5px solid #333",
                            display: "flex",
                            justifyContent: "space-between",
                            color: "#a00",
                          }}
                        >
                          <span>BALANCE DUE:</span>
                          <span>{fmtPrintAmt(savedSale?.total ?? 0)}</span>
                        </div>
                        <div
                          style={{
                            textAlign: "center",
                            fontSize: "7.5pt",
                            fontWeight: "700",
                            marginTop: "3px",
                            color: "#a00",
                          }}
                        >
                          *** CREDIT SALE ***
                        </div>
                      </>
                    ) : printExpenses.length > 0 ? (
                      <>
                        <div
                          style={{
                            fontSize: "9pt",
                            fontWeight: "700",
                            marginTop: "4px",
                            paddingTop: "4px",
                            borderTop: "1px solid #ccc",
                            display: "flex",
                            justifyContent: "space-between",
                            color: "#555",
                          }}
                        >
                          <span>SALES TOTAL:</span>
                          <span>{fmtPrintAmt(savedSale?.total ?? 0)}</span>
                        </div>
                        <div
                          style={{
                            fontSize: "11pt",
                            fontWeight: "900",
                            marginTop: "3px",
                            paddingTop: "3px",
                            borderTop: "1.5px solid #333",
                            display: "flex",
                            justifyContent: "space-between",
                          }}
                        >
                          <span>NET CASH RECEIVED:</span>
                          <span>{fmtPrintAmt(printNetTotal)}</span>
                        </div>
                      </>
                    ) : (
                      <div
                        style={{
                          fontSize: "11pt",
                          fontWeight: "900",
                          marginTop: "5px",
                          paddingTop: "5px",
                          borderTop: "1.5px solid #333",
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span>TOTAL PAID:</span>
                        <span>{fmtPrintAmt(savedSale?.total ?? 0)}</span>
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Notes */}
              {savedSale?.notes && (
                <div
                  dir="auto"
                  style={{
                    fontSize: "8pt",
                    fontWeight: "600",
                    marginTop: "5px",
                    padding: "3px",
                    border: "1.5px solid black",
                  }}
                >
                  <span style={{ fontWeight: "900" }}>Note:</span> {savedSale.notes}
                </div>
              )}

              {/* Footer */}
              <div
                style={{
                  textAlign: "center",
                  fontSize: "7.5pt",
                  fontWeight: "700",
                  marginTop: "6px",
                  paddingTop: "4px",
                  borderTop: "1.5px solid black",
                }}
              >
                <div>Thank you for your business!</div>
              </div>
            </div>
          </div>

          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setShowPrintDialog(false)} data-testid="button-cancel-print">
              Close
            </Button>
            <Button onClick={handlePrint} className="gap-2" data-testid="button-print-invoice">
              <Printer className="h-4 w-4" />
              Print Invoice
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Void confirmation ── */}
      <AlertDialog open={voidId !== null} onOpenChange={() => setVoidId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this sale?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark the sale as voided and restore the bale inventory. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setVoidId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => voidId !== null && voidMutation.mutate(voidId)}
              disabled={voidMutation.isPending}
            >
              {voidMutation.isPending ? "Voiding..." : "Void Sale"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
