import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/use-debounce";
import { queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Users,
  Container,
  DollarSign,
  Download,
  Edit,
  EyeOff,
  Eye,
  ExternalLink,
  FileText,
  Truck,
  Search,
} from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import { utils, writeFile } from "@/lib/excelHelper";
import { useEscapeBack } from "@/hooks/use-escape-back";

interface SupplierWithStats {
  id: number;
  code: string;
  legalName: string;
  email: string;
  phone: string | null;
  address: string | null;
  taxId: string | null;
  paymentTerms: string | null;
  active: boolean;
  containerCount: number;
  balance: number;
}

export default function Suppliers() {
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierWithStats | null>(null);
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [hideZeroBalance, setHideZeroBalance] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebounce(searchTerm, 300);
  const [dialogTab, setDialogTab] = useState<"transactions" | "purchase-orders">("transactions");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "yesterday" | "this_month" | "this_year">("all");
  const [hidePayments, setHidePayments] = useState(true);
  const [supplierToDelete, setSupplierToDelete] = useState<{ id: number; name: string } | null>(null);

  useEscapeBack(selectedSupplier ? () => setSelectedSupplier(null) : null);

  const { selectedCompany, selectCompany } = useCompany();
  const { formatAmount } = useCurrencyContext();
  const { toast } = useToast();
  const [_location, navigate] = useLocation();

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/suppliers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers/stats"] });
      toast({ title: "Supplier deleted" });
      setSupplierToDelete(null);
    },
    onError: (err: any) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setSupplierToDelete(null);
    },
  });

  const handleTransactionClick = async (txn: any) => {
    const targetCompany = companies.find((c: any) => c.id === txn.companyId);
    if (targetCompany && (!selectedCompany || selectedCompany.id !== txn.companyId)) {
      await apiRequest("POST", "/api/auth/set-company", { companyId: txn.companyId });
      selectCompany(targetCompany);
    }
    setSelectedSupplier(null);
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
    const tabName = voucherTypeMap[txn.voucherType];
    if (tabName) {
      navigate(`/vouchers?edit=${txn.voucherId}&tab=${tabName}`);
    } else {
      navigate(`/voucher-detail/${txn.voucherId}`);
    }
  };

  const { data: suppliers = [], isLoading } = useQuery<SupplierWithStats[]>({
    queryKey: ["/api/suppliers/stats"],
  });

  const { data: companies = [] } = useQuery<any[]>({
    queryKey: ["/api/companies"],
  });

  const unifiedLedgerUrl = companyFilter !== "all"
    ? `/api/suppliers/${selectedSupplier?.id}/unified-ledger?companyId=${companyFilter}`
    : `/api/suppliers/${selectedSupplier?.id}/unified-ledger`;

  const { data: unifiedLedger = [], isLoading: ledgerLoading } = useQuery<any[]>({
    queryKey: [unifiedLedgerUrl],
    enabled: !!selectedSupplier,
  });

  const purchaseOrdersUrl = companyFilter !== "all"
    ? `/api/suppliers/${selectedSupplier?.id}/purchase-orders?companyId=${companyFilter}`
    : `/api/suppliers/${selectedSupplier?.id}/purchase-orders`;

  const { data: purchaseOrders = [], isLoading: posLoading } = useQuery<any[]>({
    queryKey: [purchaseOrdersUrl],
    enabled: !!selectedSupplier,
  });

  const activeSuppliers = suppliers.filter((s) => s.active);
  const totalContainers = suppliers.reduce((sum, s) => sum + Number(s.containerCount || 0), 0);
  const totalBalance = suppliers.reduce((sum, s) => sum + Number(s.balance || 0), 0);

  const sortedSuppliers = [...suppliers]
    .filter(s => hideZeroBalance ? s.balance !== 0 : true)
    .filter(s => debouncedSearch.trim() === "" || s.legalName.toLowerCase().includes(debouncedSearch.toLowerCase()))
    .sort((a, b) => a.legalName.localeCompare(b.legalName));

  const handleSupplierClick = (supplier: SupplierWithStats) => {
    setSelectedSupplier(supplier);
    setCompanyFilter("all");
    setDialogTab("transactions");
    setDateFilter("all");
  };

  const handleCloseDialog = () => {
    setSelectedSupplier(null);
    setCompanyFilter("all");
    setDialogTab("transactions");
    setDateFilter("all");
  };

  const handlePOClick = async (po: any) => {
    const targetCompany = companies.find((c: any) => c.id === po.companyId);
    if (targetCompany && (!selectedCompany || selectedCompany.id !== po.companyId)) {
      await apiRequest("POST", "/api/auth/set-company", { companyId: po.companyId });
      selectCompany(targetCompany);
    }
    setSelectedSupplier(null);
    navigate(`/purchase-orders/${po.id}/edit`);
  };

  const handleContainerClick = async (po: any) => {
    if (!po.containerId) return;
    const targetCompany = companies.find((c: any) => c.id === po.companyId);
    if (targetCompany && (!selectedCompany || selectedCompany.id !== po.companyId)) {
      await apiRequest("POST", "/api/auth/set-company", { companyId: po.companyId });
      selectCompany(targetCompany);
    }
    setSelectedSupplier(null);
    navigate(`/containers/${po.containerId}`);
  };

  const handleExportToExcel = async () => {
    if (!selectedSupplier || unifiedLedger.length === 0) return;
    const exportData = unifiedLedger.map((txn: any) => ({
      Date: txn.date ? format(new Date(txn.date), "yyyy-MM-dd") : "",
      Company: txn.companyName,
      "Doc Number": txn.docNumber,
      Type: txn.voucherType,
      Description: txn.description,
      Balance: txn.balance,
    }));
    const worksheet = utils.json_to_sheet(exportData);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, "Supplier Ledger");
    const fileName = `${selectedSupplier.legalName}_Ledger_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
    await writeFile(workbook, fileName);
  };

  const openingEntry = unifiedLedger.find((t: any) => t.type === "opening");
  const ledgerRows = unifiedLedger.filter((t: any) => t.type !== "opening");

  // Date filter helpers
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const yesterdayStr = format(new Date(Date.now() - 86400000), "yyyy-MM-dd");
  const nowDate = new Date();
  const filteredLedgerRows = dateFilter === "all" ? ledgerRows
    : dateFilter === "today" ? ledgerRows.filter((t: any) => t.date && format(new Date(t.date), "yyyy-MM-dd") === todayStr)
    : dateFilter === "yesterday" ? ledgerRows.filter((t: any) => t.date && format(new Date(t.date), "yyyy-MM-dd") === yesterdayStr)
    : dateFilter === "this_month" ? ledgerRows.filter((t: any) => {
        if (!t.date) return false;
        const d = new Date(t.date);
        return d.getFullYear() === nowDate.getFullYear() && d.getMonth() === nowDate.getMonth();
      })
    : ledgerRows.filter((t: any) => {
        if (!t.date) return false;
        return new Date(t.date).getFullYear() === nowDate.getFullYear();
      });

  const txCount = filteredLedgerRows.length;
  const totalPurchases = filteredLedgerRows.reduce((s: number, t: any) => s + (parseFloat(t.credit) || 0), 0);
  const totalPayments = filteredLedgerRows.reduce((s: number, t: any) => s + (parseFloat(t.debit) || 0), 0);
  const totalPurchasesQty = filteredLedgerRows.filter((t: any) =>
    t.voucherType === "Purchase" || (t.voucherType === "Journal" && (parseFloat(t.credit) || 0) > 0)
  ).length;
  const currentBalance = unifiedLedger.length > 0 ? (unifiedLedger[unifiedLedger.length - 1]?.balance ?? 0) : 0;

  // Display rows — optionally hide payment/debit rows from the table (KPIs are always full)
  const isPaymentRow = (t: any) => t.debit > 0 || t.voucherType === "Payment" || t.voucherType === "Receipt";
  const displayedLedgerRows = hidePayments ? filteredLedgerRows.filter((t: any) => !isPaymentRow(t)) : filteredLedgerRows;
  const hiddenPaymentsCount = hidePayments ? filteredLedgerRows.filter((t: any) => isPaymentRow(t)).length : 0;

  const typeBadgeClass: Record<string, string> = {
    Payment: "bg-green-500/10 text-green-600 dark:text-green-400",
    Receipt: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    Journal: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
    "Credit Note": "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    "Debit Note": "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  };

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Suppliers" subtitle="Manage supplier accounts and track container shipments" showBackButton={false} />

      {/* Stats pills */}
      <div className="flex flex-wrap gap-3">
        {isLoading ? (
          [1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-40 rounded-lg" />)
        ) : (
          <>
            <div className="flex items-center gap-2.5 rounded-lg border bg-muted/40 px-4 py-2">
              <Users className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground">Active Suppliers</span>
              <span className="font-semibold text-sm" data-testid="text-active-suppliers">{activeSuppliers.length}</span>
            </div>
            <div className="flex items-center gap-2.5 rounded-lg border bg-muted/40 px-4 py-2">
              <Container className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground">Total Containers</span>
              <span className="font-semibold text-sm" data-testid="text-total-containers">{totalContainers}</span>
            </div>
            <div className="flex items-center gap-2.5 rounded-lg border bg-muted/40 px-4 py-2">
              <DollarSign className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground">Total Outstanding</span>
              <span className="font-semibold text-sm font-mono" data-testid="text-total-balance">{formatAmount(totalBalance)}</span>
            </div>
          </>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search suppliers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
            data-testid="input-supplier-search"
          />
        </div>
        <Button
          variant="outline"
          size="default"
          onClick={() => setHideZeroBalance(!hideZeroBalance)}
          data-testid="button-toggle-zero-balance"
        >
          {hideZeroBalance ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
          {hideZeroBalance ? "Hide Zero" : "Show All"}
        </Button>
      </div>

      {/* Supplier table */}
      {isLoading ? (
        <div className="border rounded-xl overflow-hidden">
          <div className="bg-muted/40 px-4 py-2.5 border-b flex gap-6">
            {[180, 80, 100, 80].map((w, i) => <Skeleton key={i} className="h-3.5 rounded" style={{ width: w }} />)}
          </div>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="px-4 py-3.5 border-b last:border-b-0 flex gap-6 items-center">
              {[180, 80, 100, 80].map((w, j) => <Skeleton key={j} className="h-3 rounded" style={{ width: w }} />)}
            </div>
          ))}
        </div>
      ) : suppliers.length === 0 ? (
        <div className="border rounded-xl bg-muted/20 flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
            <Truck className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">No suppliers found</p>
            <p className="text-xs text-muted-foreground mt-0.5">Create suppliers in the Master Data page</p>
          </div>
        </div>
      ) : sortedSuppliers.length === 0 ? (
        <div className="border rounded-xl bg-muted/20 flex flex-col items-center justify-center py-12 gap-3 text-center">
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
            <Search className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">No results</p>
            <p className="text-xs text-muted-foreground mt-0.5">Try adjusting your search or filter</p>
          </div>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block border rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="h-9 font-semibold text-xs">Supplier</TableHead>
                  <TableHead className="h-9 font-semibold text-xs">Containers</TableHead>
                  <TableHead className="h-9 font-semibold text-xs text-right">Balance</TableHead>
                  <TableHead className="h-9 font-semibold text-xs text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedSuppliers.map((supplier) => (
                  <TableRow
                    key={supplier.id}
                    className="cursor-pointer hover:bg-muted/40 group"
                    onClick={() => handleSupplierClick(supplier)}
                    data-testid={`row-supplier-${supplier.id}`}
                  >
                    <TableCell className="py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm" data-testid={`button-supplier-name-${supplier.id}`}>
                          {supplier.legalName}
                        </span>
                        {!supplier.active && (
                          <Badge variant="secondary" className="text-xs">Inactive</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      {supplier.containerCount > 0 ? (
                        <Badge variant="secondary" className="text-xs" data-testid={`text-containers-${supplier.id}`}>
                          {supplier.containerCount}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground" data-testid={`text-containers-${supplier.id}`}>—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3 text-right">
                      <span
                        className={`font-mono text-sm font-medium ${
                          supplier.balance > 0 ? "text-red-500" : supplier.balance < 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                        }`}
                        data-testid={`text-balance-${supplier.id}`}
                      >
                        {supplier.balance === 0 ? "—" : `${formatAmount(Math.abs(supplier.balance))} ${supplier.balance > 0 ? "Cr" : "Dr"}`}
                      </span>
                    </TableCell>
                    <TableCell className="py-3 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => { e.stopPropagation(); navigate(`/suppliers/${supplier.id}/proformas`); }}
                          data-testid={`button-proformas-supplier-${supplier.id}`}
                          title="Proformas"
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => { e.stopPropagation(); navigate(`/suppliers/${supplier.id}/edit`); }}
                          data-testid={`button-edit-supplier-${supplier.id}`}
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {sortedSuppliers.map((supplier) => (
              <div
                key={supplier.id}
                className="border rounded-xl p-3 cursor-pointer"
                onClick={() => handleSupplierClick(supplier)}
                data-testid={`card-supplier-${supplier.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm leading-tight" data-testid={`button-supplier-name-mobile-${supplier.id}`}>
                      {supplier.legalName}
                    </div>
                    {supplier.phone && (
                      <div className="text-xs text-muted-foreground mt-0.5" data-testid={`text-phone-mobile-${supplier.id}`}>
                        {supplier.phone}
                      </div>
                    )}
                    {!supplier.active && (
                      <Badge variant="secondary" className="text-xs mt-1">Inactive</Badge>
                    )}
                  </div>
                  <span
                    className={`font-mono text-sm font-medium shrink-0 ${
                      supplier.balance > 0 ? "text-red-500" : supplier.balance < 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                    }`}
                    data-testid={`text-balance-mobile-${supplier.id}`}
                  >
                    {supplier.balance === 0 ? "—" : `${formatAmount(Math.abs(supplier.balance))} ${supplier.balance > 0 ? "Cr" : "Dr"}`}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div>
                    {supplier.containerCount > 0 && (
                      <Badge variant="secondary" className="text-xs" data-testid={`text-containers-mobile-${supplier.id}`}>
                        {supplier.containerCount} containers
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => navigate(`/suppliers/${supplier.id}/proformas`)}
                      data-testid={`button-proformas-supplier-mobile-${supplier.id}`}
                      title="Proformas"
                    >
                      <FileText className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => navigate(`/suppliers/${supplier.id}/edit`)}
                      data-testid={`button-edit-supplier-mobile-${supplier.id}`}
                      title="Edit"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Supplier Details Dialog */}
      <Dialog open={!!selectedSupplier} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-hidden flex flex-col gap-0 p-0">

          {/* ── Header ── */}
          <DialogHeader className="px-6 pt-5 pb-4 border-b shrink-0 gap-0">
            {/* Row 1: name + controls */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <DialogTitle className="text-lg font-bold mr-auto">{selectedSupplier?.legalName}</DialogTitle>
              <Select value={companyFilter} onValueChange={setCompanyFilter}>
                <SelectTrigger className="w-40" data-testid="select-company-filter">
                  <SelectValue placeholder="All Companies" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Companies</SelectItem>
                  {companies.map((company: any) => (
                    <SelectItem key={company.id} value={company.id.toString()}>{company.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="default" onClick={handleExportToExcel} disabled={unifiedLedger.length === 0} data-testid="button-export-excel">
                <Download className="h-4 w-4 mr-1.5" />
                Export
              </Button>
            </div>

            {/* Row 2: KPI cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
              <div className="rounded-lg border bg-muted/30 px-4 py-2.5">
                <p className="text-xs text-muted-foreground mb-1">Total Purchases</p>
                {ledgerLoading
                  ? <Skeleton className="h-5 w-24" />
                  : <p className="font-mono font-semibold text-sm">{formatAmount(totalPurchases)}</p>}
              </div>
              <div className="rounded-lg border bg-muted/30 px-4 py-2.5">
                <p className="text-xs text-muted-foreground mb-1">Total Payments</p>
                {ledgerLoading
                  ? <Skeleton className="h-5 w-24" />
                  : <p className="font-mono font-semibold text-sm text-green-600 dark:text-green-400">{formatAmount(totalPayments)}</p>}
              </div>
              <div className="rounded-lg border bg-muted/30 px-4 py-2.5">
                <p className="text-xs text-muted-foreground mb-1">Purchases Qty</p>
                {ledgerLoading
                  ? <Skeleton className="h-5 w-10" />
                  : <p className="font-semibold text-sm">{totalPurchasesQty}</p>}
              </div>
              <div className="rounded-lg border bg-muted/30 px-4 py-2.5">
                <p className="text-xs text-muted-foreground mb-1">Transactions</p>
                {ledgerLoading
                  ? <Skeleton className="h-5 w-10" />
                  : <p className="font-semibold text-sm">{txCount}</p>}
              </div>
              <div className="rounded-lg border bg-muted/30 px-4 py-2.5">
                <p className="text-xs text-muted-foreground mb-1">Balance</p>
                {ledgerLoading
                  ? <Skeleton className="h-5 w-24" />
                  : <p className="font-mono font-semibold text-sm">{formatAmount(currentBalance)}</p>}
              </div>
            </div>

            {/* Row 3: date filter */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {(["all", "today", "yesterday", "this_month", "this_year"] as const).map((f) => (
                <Button
                  key={f}
                  variant={dateFilter === f ? "default" : "outline"}
                  size="sm"
                  className="text-xs"
                  onClick={() => setDateFilter(f)}
                  data-testid={`button-date-filter-${f}`}
                >
                  {f === "all" ? "All" : f === "today" ? "Today" : f === "yesterday" ? "Yesterday" : f === "this_month" ? "This Month" : "This Year"}
                </Button>
              ))}
              {dateFilter !== "all" && (
                <span className="ml-1 text-xs text-muted-foreground">{txCount} result{txCount !== 1 ? "s" : ""}</span>
              )}
            </div>
          </DialogHeader>

          {/* ── Tabs ── */}
          <Tabs value={dialogTab} onValueChange={(v) => setDialogTab(v as "transactions" | "purchase-orders")} className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="px-6 pt-3 pb-0 shrink-0 flex items-center gap-3 flex-wrap">
              <TabsList className="w-fit">
                <TabsTrigger value="transactions" className="text-xs" data-testid="tab-transactions">
                  <DollarSign className="h-3.5 w-3.5 mr-1.5" />
                  Transactions
                </TabsTrigger>
                <TabsTrigger value="purchase-orders" className="text-xs" data-testid="tab-purchase-orders">
                  <FileText className="h-3.5 w-3.5 mr-1.5" />
                  Purchase Orders {purchaseOrders.length > 0 && `(${purchaseOrders.length})`}
                </TabsTrigger>
              </TabsList>
              {dialogTab === "transactions" && (
                <Button
                  variant={hidePayments ? "default" : "outline"}
                  size="sm"
                  className="text-xs gap-1.5 ml-auto"
                  onClick={() => setHidePayments(v => !v)}
                  data-testid="button-hide-payments"
                >
                  <EyeOff className="h-3.5 w-3.5" />
                  {hidePayments ? `Payments hidden (${hiddenPaymentsCount})` : "Hide Payments"}
                </Button>
              )}
            </div>

            {/* Transactions tab */}
            <TabsContent value="transactions" className="mt-0 px-6 pb-5 pt-3 flex-1 overflow-hidden">
              {ledgerLoading ? (
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-muted/40 px-4 py-2.5 border-b flex gap-6">
                    {[80, 100, 80, 150, 80, 80, 80].map((w, i) => <Skeleton key={i} className="h-3.5 rounded" style={{ width: w }} />)}
                  </div>
                  {[1, 2, 3, 4, 5, 6].map(i => (
                    <div key={i} className="px-4 py-3 border-b last:border-b-0 flex gap-6 items-center">
                      {[80, 100, 80, 150, 80, 80, 80].map((w, j) => <Skeleton key={j} className="h-3 rounded" style={{ width: w }} />)}
                    </div>
                  ))}
                </div>
              ) : unifiedLedger.length === 0 ? (
                <div className="border rounded-lg bg-muted/20 flex flex-col items-center justify-center py-16 gap-3 text-center">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                    <DollarSign className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">No transactions</p>
                    <p className="text-xs text-muted-foreground mt-0.5">No transactions found{companyFilter !== "all" ? " for this company" : ""}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {openingEntry && (
                    <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-2.5">
                      <span className="text-xs font-medium text-muted-foreground">Opening Balance</span>
                      <span className="font-mono font-semibold text-sm">{formatAmount(openingEntry.balance)}</span>
                    </div>
                  )}
                  <Table wrapperClassName="max-h-[calc(90vh-390px)]">
                    <TableHeader>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableHead className="h-9 text-xs font-semibold">Date</TableHead>
                        <TableHead className="h-9 text-xs font-semibold">Company</TableHead>
                        <TableHead className="h-9 text-xs font-semibold">Type</TableHead>
                        <TableHead className="h-9 text-xs font-semibold">Ref</TableHead>
                        <TableHead className="h-9 text-xs font-semibold text-right">Debit</TableHead>
                        <TableHead className="h-9 text-xs font-semibold text-right">Credit</TableHead>
                        <TableHead className="h-9 text-xs font-semibold text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayedLedgerRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">
                            {hidePayments && filteredLedgerRows.length > 0 ? "All transactions are payments — toggle off to show them." : "No transactions in this period"}
                          </TableCell>
                        </TableRow>
                      ) : displayedLedgerRows.map((txn: any, idx: number) => {
                        const isPayment = txn.voucherType === "Payment" || txn.debit > 0;
                        return (
                          <TableRow key={`${txn.type}-${txn.docNumber}-${idx}`} className="text-xs">
                            <TableCell className="py-2.5 font-mono text-muted-foreground whitespace-nowrap">
                              {txn.date ? format(new Date(txn.date), "dd MMM yyyy") : "-"}
                            </TableCell>
                            <TableCell className="py-2.5">
                              <Badge variant="secondary" className="text-xs">{txn.companyName}</Badge>
                            </TableCell>
                            <TableCell className="py-2.5">
                              <Badge variant="secondary" className={`text-xs ${typeBadgeClass[isPayment ? "Payment" : txn.voucherType] || ""}`}>
                                {isPayment ? "Payment" : txn.voucherType}
                              </Badge>
                            </TableCell>
                            <TableCell className="py-2.5">
                              {txn.containerNumber ? (
                                <button
                                  onClick={() => handleContainerClick(txn)}
                                  className="font-mono text-xs text-primary hover:underline cursor-pointer flex items-center gap-1"
                                  data-testid={`link-container-${idx}`}
                                >
                                  {txn.containerNumber}
                                  <ExternalLink className="h-3 w-3 shrink-0" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleTransactionClick(txn)}
                                  className="text-xs text-muted-foreground hover:text-primary hover:underline cursor-pointer flex items-center gap-1"
                                  data-testid={`link-transaction-${idx}`}
                                >
                                  {txn.docNumber || "-"}
                                  <ExternalLink className="h-3 w-3 shrink-0" />
                                </button>
                              )}
                            </TableCell>
                            <TableCell className="py-2.5 text-right font-mono">
                              {txn.debit > 0 ? formatAmount(txn.debit) : "—"}
                            </TableCell>
                            <TableCell className="py-2.5 text-right font-mono">
                              {txn.credit > 0 ? formatAmount(txn.credit) : "—"}
                            </TableCell>
                            <TableCell className="py-2.5 text-right font-mono font-semibold">
                              {formatAmount(txn.balance)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            {/* Purchase Orders tab */}
            <TabsContent value="purchase-orders" className="mt-0 px-6 pb-5 pt-3 flex-1 overflow-hidden">
              {posLoading ? (
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-muted/40 px-4 py-2.5 border-b flex gap-6">
                    {[160, 120, 100, 100].map((w, i) => <Skeleton key={i} className="h-3.5 rounded" style={{ width: w }} />)}
                  </div>
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="px-4 py-3.5 border-b last:border-b-0 flex gap-6 items-center">
                      {[160, 120, 100, 100].map((w, j) => <Skeleton key={j} className="h-3 rounded" style={{ width: w }} />)}
                    </div>
                  ))}
                </div>
              ) : purchaseOrders.length === 0 ? (
                <div className="border rounded-lg bg-muted/20 flex flex-col items-center justify-center py-16 gap-3 text-center">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                    <FileText className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">No purchase orders</p>
                    <p className="text-xs text-muted-foreground mt-0.5">No purchase orders found{companyFilter !== "all" ? " for this company" : ""}</p>
                  </div>
                </div>
              ) : (() => {
                const sortedPOs = [...purchaseOrders]
                  .sort((a: any, b: any) => new Date(b.importDate || b.createdAt).getTime() - new Date(a.importDate || a.createdAt).getTime())
                  .map((po: any) => {
                    const itemsTotal = parseFloat(po.itemsTotal || "0");
                    const freight = parseFloat(po.freight || "0");
                    const surcharge = parseFloat(po.surcharge || "0");
                    const fumigation = parseFloat(po.fumigation || "0");
                    const documentCharges = parseFloat(po.documentCharges || "0");
                    const discount = parseFloat(po.discount || "0");
                    const otherCharges = parseFloat(po.otherCharges || "0");
                    const totalAmount = itemsTotal + freight + surcharge + fumigation + documentCharges - discount + otherCharges;
                    return { ...po, totalAmount };
                  });
                const grandTotal = sortedPOs.reduce((sum: number, po: any) => sum + po.totalAmount, 0);

                return (
                  <div className="space-y-2">
                    <Table wrapperClassName="max-h-[calc(90vh-340px)]">
                      <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableHead className="h-9 text-xs font-semibold">Container</TableHead>
                          <TableHead className="h-9 text-xs font-semibold">Import Date</TableHead>
                          <TableHead className="h-9 text-xs font-semibold">Company</TableHead>
                          <TableHead className="h-9 text-xs font-semibold text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedPOs.map((po: any, idx: number) => (
                          <TableRow key={po.id} className="text-sm cursor-pointer" onClick={() => handlePOClick(po)}>
                            <TableCell className="py-3">
                              {po.containerId ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleContainerClick(po); }}
                                  className="flex items-center gap-1.5 font-mono font-semibold text-primary hover:underline"
                                  data-testid={`link-po-container-${idx}`}
                                >
                                  {po.containerNumber || "-"}
                                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                                </button>
                              ) : (
                                <span className="font-mono font-semibold">{po.containerNumber || "-"}</span>
                              )}
                            </TableCell>
                            <TableCell className="py-3 font-mono text-sm text-muted-foreground">
                              {po.importDate ? format(new Date(po.importDate), "dd MMM yyyy") : "-"}
                            </TableCell>
                            <TableCell className="py-3">
                              <Badge variant="secondary" className="text-xs">{po.companyName}</Badge>
                            </TableCell>
                            <TableCell className="py-3 text-right font-mono font-semibold">
                              {formatAmount(po.totalAmount)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <div className="flex justify-end">
                      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-4 py-2 text-sm">
                        <span className="text-muted-foreground">Grand Total</span>
                        <span className="font-mono font-semibold">{formatAmount(grandTotal)}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!supplierToDelete} onOpenChange={(open) => !open && setSupplierToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Supplier</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{supplierToDelete?.name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => supplierToDelete && deleteMutation.mutate(supplierToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-supplier"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
