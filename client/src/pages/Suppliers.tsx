import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Users, Container, DollarSign, Download, Edit, EyeOff, Eye, ExternalLink, FileText, Trash2 } from "lucide-react";
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
import { utils, writeFile, readFile, ExcelJS } from "@/lib/excelHelper";
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
  const [dialogTab, setDialogTab] = useState<"transactions" | "purchase-orders">("transactions");
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

  // Handle clicking on a transaction to navigate to it
  const handleTransactionClick = async (txn: any) => {
    // First switch to the correct company if different
    const targetCompany = companies.find((c: any) => c.id === txn.companyId);
    if (targetCompany && (!selectedCompany || selectedCompany.id !== txn.companyId)) {
      // Switch company via API first
      await apiRequest("POST", "/api/auth/set-company", { companyId: txn.companyId });
      selectCompany(targetCompany);
    }

    // Close the dialog
    setSelectedSupplier(null);

    // Navigate to the voucher page with the correct tab for editing
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
  
  // Fetch global supplier statistics (no company filter)
  const { data: suppliers = [], isLoading } = useQuery<SupplierWithStats[]>({
    queryKey: ["/api/suppliers/stats"],
  });

  // Fetch all companies for the filter dropdown
  const { data: companies = [] } = useQuery<any[]>({
    queryKey: ["/api/companies"],
  });

  // Fetch unified ledger for the selected supplier (with optional company filter)
  const unifiedLedgerUrl = companyFilter !== "all" 
    ? `/api/suppliers/${selectedSupplier?.id}/unified-ledger?companyId=${companyFilter}`
    : `/api/suppliers/${selectedSupplier?.id}/unified-ledger`;
  
  const { data: unifiedLedger = [], isLoading: ledgerLoading } = useQuery<any[]>({
    queryKey: [unifiedLedgerUrl],
    enabled: !!selectedSupplier,
  });

  // Fetch purchase orders for the selected supplier (with optional company filter)
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
  
  // Sort suppliers alphabetically by name and filter by balance if needed
  const sortedSuppliers = [...suppliers]
    .filter(s => hideZeroBalance ? s.balance !== 0 : true)
    .sort((a, b) => 
      a.legalName.localeCompare(b.legalName)
    );
  
  const handleSupplierClick = async (supplier: SupplierWithStats) => {
    setSelectedSupplier(supplier);
    setCompanyFilter("all"); // Reset filter when opening
    setDialogTab("transactions"); // Reset to transactions tab
  };
  
  const handleCloseDialog = async () => {
    setSelectedSupplier(null);
    setCompanyFilter("all");
    setDialogTab("transactions");
  };

  // Handle clicking on a PO to navigate to its details
  const handlePOClick = async (po: any) => {
    // First switch to the correct company if different
    const targetCompany = companies.find((c: any) => c.id === po.companyId);
    if (targetCompany && (!selectedCompany || selectedCompany.id !== po.companyId)) {
      await apiRequest("POST", "/api/auth/set-company", { companyId: po.companyId });
      selectCompany(targetCompany);
    }

    // Close the dialog
    setSelectedSupplier(null);

    // Navigate to PO edit page
    navigate(`/purchase-orders/${po.id}/edit`);
  };

  // Handle clicking on a container number to navigate to it
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
  const txCount = ledgerRows.length;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <PageHeader title="Suppliers" subtitle="Manage supplier accounts and track container shipments" />
        </div>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Active Suppliers
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-active-suppliers">
                {activeSuppliers.length}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Containers
            </CardTitle>
            <Container className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-total-containers">
                {totalContainers}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Outstanding
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-total-balance">
                {formatAmount(totalBalance)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Supplier List</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setHideZeroBalance(!hideZeroBalance)}
            data-testid="button-toggle-zero-balance"
            title={hideZeroBalance ? "Show all suppliers" : "Hide zero balance suppliers"}
          >
            {hideZeroBalance ? (
              <><EyeOff className="h-4 w-4 mr-1" /> Hide Zero</>
            ) : (
              <><Eye className="h-4 w-4 mr-1" /> Show All</>
            )}
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : suppliers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No suppliers found. Create suppliers in the Master Data page.
            </div>
          ) : (
            <>
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-muted z-10">Name</TableHead>
                    <TableHead className="text-right">Containers</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedSuppliers.map((supplier) => (
                    <TableRow
                      key={supplier.id}
                      data-testid={`row-supplier-${supplier.id}`}
                    >
                      <TableCell className="font-medium sticky left-0 bg-background z-10">
                        <Button
                          variant="ghost"
                          className="p-0 h-auto font-medium hover:underline text-left"
                          onClick={() => handleSupplierClick(supplier)}
                          data-testid={`button-supplier-name-${supplier.id}`}
                        >
                          {supplier.legalName}
                        </Button>
                      </TableCell>
                      <TableCell className="text-right" data-testid={`text-containers-${supplier.id}`}>
                        <Badge variant="outline">
                          {supplier.containerCount}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono" data-testid={`text-balance-${supplier.id}`}>
                        <span className={supplier.balance > 0 ? "text-red-600" : supplier.balance < 0 ? "text-green-600" : ""}>
                          {formatAmount(Math.abs(supplier.balance))}
                          {supplier.balance !== 0 && (supplier.balance > 0 ? " Cr" : " Dr")}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={supplier.active ? "default" : "secondary"}>
                          {supplier.active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(`/suppliers/${supplier.id}/proformas`)}
                            data-testid={`button-proformas-supplier-${supplier.id}`}
                          >
                            <FileText className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(`/suppliers/${supplier.id}/edit`)}
                            data-testid={`button-edit-supplier-${supplier.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSupplierToDelete({ id: supplier.id, name: supplier.legalName })}
                            data-testid={`button-delete-supplier-${supplier.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="md:hidden space-y-3">
              {sortedSuppliers.map((supplier) => (
                <Card key={supplier.id} data-testid={`row-supplier-${supplier.id}`}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Button
                        variant="ghost"
                        className="p-0 h-auto font-medium hover:underline text-left"
                        onClick={() => handleSupplierClick(supplier)}
                        data-testid={`button-supplier-name-${supplier.id}`}
                      >
                        {supplier.legalName}
                      </Button>
                      <Badge variant={supplier.active ? "default" : "secondary"}>
                        {supplier.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Container className="h-3 w-3" />
                        <span>{supplier.containerCount} containers</span>
                      </div>
                      <span className={`font-mono font-semibold ${supplier.balance > 0 ? "text-red-600" : supplier.balance < 0 ? "text-green-600" : ""}`} data-testid={`text-balance-${supplier.id}`}>
                        {formatAmount(Math.abs(supplier.balance))}
                        {supplier.balance !== 0 && (supplier.balance > 0 ? " Cr" : " Dr")}
                      </span>
                    </div>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/suppliers/${supplier.id}/edit`)}
                        data-testid={`button-edit-supplier-${supplier.id}`}
                      >
                        <Edit className="h-4 w-4 mr-1" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSupplierToDelete({ id: supplier.id, name: supplier.legalName })}
                        data-testid={`button-delete-supplier-mobile-${supplier.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Supplier Details Dialog */}
      <Dialog open={!!selectedSupplier} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-6xl w-[95vw] md:w-auto max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {selectedSupplier?.legalName}
            </DialogTitle>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 pt-2">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <label className="text-sm text-muted-foreground whitespace-nowrap">Filter by Company:</label>
                <Select value={companyFilter} onValueChange={setCompanyFilter}>
                  <SelectTrigger className="w-full sm:w-48" data-testid="select-company-filter">
                    <SelectValue placeholder="All Companies" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Companies</SelectItem>
                    {companies.map((company: any) => (
                      <SelectItem key={company.id} value={company.id.toString()}>
                        {company.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportToExcel}
                disabled={unifiedLedger.length === 0}
                data-testid="button-export-excel"
              >
                <Download className="h-4 w-4 mr-2" />
                Export to Excel
              </Button>
            </div>
          </DialogHeader>
          
          <Tabs value={dialogTab} onValueChange={(v) => setDialogTab(v as "transactions" | "purchase-orders")} className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="w-fit">
              <TabsTrigger value="transactions" data-testid="tab-transactions">
                <DollarSign className="h-4 w-4 mr-2" />
                Transactions
              </TabsTrigger>
              <TabsTrigger value="purchase-orders" data-testid="tab-purchase-orders">
                <FileText className="h-4 w-4 mr-2" />
                Purchase Orders ({purchaseOrders.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="transactions" className="flex-1 overflow-y-auto mt-4">
              {ledgerLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : unifiedLedger.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No transactions found for this supplier
                  {companyFilter !== "all" && companies.find((c: any) => c.id === parseInt(companyFilter)) 
                    ? ` in ${companies.find((c: any) => c.id === parseInt(companyFilter))?.name}`
                    : ""}.
                </div>
              ) : (
                <div className="space-y-3">
                      <div className="text-sm text-muted-foreground">
                        Showing {txCount} transaction{txCount !== 1 ? "s" : ""}
                        {companyFilter !== "all" && companies.find((c: any) => c.id === parseInt(companyFilter))
                          ? ` from ${companies.find((c: any) => c.id === parseInt(companyFilter))?.name}`
                          : " from all companies"}
                      </div>

                      {openingEntry && (
                        <div className="flex items-center justify-between rounded-md bg-muted/50 border px-4 py-2 text-sm">
                          <span className="text-muted-foreground font-medium">Opening Balance</span>
                          <span className="font-mono font-semibold">{formatAmount(openingEntry.balance)}</span>
                        </div>
                      )}

                      <div className="hidden md:block">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Company</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead>Container</TableHead>
                              <TableHead className="text-right">Debit</TableHead>
                              <TableHead className="text-right">Credit</TableHead>
                              <TableHead className="text-right">Balance</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {ledgerRows.map((txn: any, idx: number) => {
                              const isPayment = txn.voucherType === "Payment" || txn.debit > 0;
                              return (
                                <TableRow key={`${txn.type}-${txn.docNumber}-${idx}`}>
                                  <TableCell className="font-mono text-sm">
                                    {txn.date ? format(new Date(txn.date), "yyyy-MM-dd") : "-"}
                                  </TableCell>
                                  <TableCell className="text-sm">
                                    <Badge variant="secondary">{txn.companyName}</Badge>
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant={isPayment ? "default" : "outline"}>
                                      {isPayment ? "Payment" : txn.voucherType}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    {txn.containerNumber ? (
                                      <button
                                        onClick={() => handleContainerClick(txn)}
                                        className="font-mono text-sm text-primary hover:underline cursor-pointer flex items-center gap-1"
                                        data-testid={`link-container-${idx}`}
                                      >
                                        {txn.containerNumber}
                                        <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => handleTransactionClick(txn)}
                                        className="text-sm text-muted-foreground hover:text-primary hover:underline cursor-pointer flex items-center gap-1"
                                        data-testid={`link-transaction-${idx}`}
                                      >
                                        {txn.docNumber || "-"}
                                        <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                      </button>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm">
                                    {txn.debit > 0 ? formatAmount(txn.debit) : "—"}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm">
                                    {txn.credit > 0 ? formatAmount(txn.credit) : "—"}
                                  </TableCell>
                                  <TableCell className="text-right font-mono font-semibold">
                                    {formatAmount(txn.balance)}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>

                      <div className="md:hidden space-y-3">
                        {ledgerRows.map((txn: any, idx: number) => {
                          const isPayment = txn.voucherType === "Payment" || txn.debit > 0;
                          return (
                            <Card key={`${txn.type}-${txn.docNumber}-${idx}`}>
                              <CardContent className="p-3 space-y-2">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <span className="font-mono text-xs text-muted-foreground">
                                    {txn.date ? format(new Date(txn.date), "yyyy-MM-dd") : "-"}
                                  </span>
                                  <Badge variant={isPayment ? "default" : "outline"}>
                                    {isPayment ? "Payment" : txn.voucherType}
                                  </Badge>
                                </div>
                                {txn.containerNumber ? (
                                  <button
                                    onClick={() => handleContainerClick(txn)}
                                    className="font-mono text-sm text-primary hover:underline cursor-pointer flex items-center gap-1"
                                    data-testid={`link-container-mobile-${idx}`}
                                  >
                                    {txn.containerNumber}
                                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleTransactionClick(txn)}
                                    className="text-sm text-muted-foreground hover:text-primary hover:underline cursor-pointer flex items-center gap-1"
                                    data-testid={`link-transaction-mobile-${idx}`}
                                  >
                                    {txn.docNumber || "-"}
                                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                  </button>
                                )}
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <Badge variant="secondary" className="text-xs">{txn.companyName}</Badge>
                                  <div className="flex items-center gap-3 font-mono text-xs">
                                    {txn.debit > 0 && <span className="text-muted-foreground">Dr: {formatAmount(txn.debit)}</span>}
                                    {txn.credit > 0 && <span className="text-muted-foreground">Cr: {formatAmount(txn.credit)}</span>}
                                    <span className="font-semibold">{formatAmount(txn.balance)}</span>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>

                      <div className="border-t pt-4 flex justify-end">
                        <div className="text-sm">
                          <span className="text-muted-foreground">Total Balance: </span>
                          <span className="font-mono font-semibold text-lg">
                            {formatAmount(unifiedLedger[unifiedLedger.length - 1]?.balance ?? 0)}
                          </span>
                        </div>
                      </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="purchase-orders" className="flex-1 overflow-y-auto mt-4">
              {posLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : purchaseOrders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No purchase orders found for this supplier
                  {companyFilter !== "all" && companies.find((c: any) => c.id === parseInt(companyFilter)) 
                    ? ` in ${companies.find((c: any) => c.id === parseInt(companyFilter))?.name}`
                    : ""}.
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
                    <div className="space-y-3">
                      <div className="text-sm text-muted-foreground">
                        Showing {sortedPOs.length} purchase order{sortedPOs.length !== 1 ? "s" : ""}
                        {companyFilter !== "all" && companies.find((c: any) => c.id === parseInt(companyFilter))
                          ? ` from ${companies.find((c: any) => c.id === parseInt(companyFilter))?.name}`
                          : " from all companies"}
                      </div>

                      <div className="hidden md:block">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-base">Container</TableHead>
                              <TableHead className="text-base">Import Date</TableHead>
                              <TableHead className="text-base">Company</TableHead>
                              <TableHead className="text-right text-base">Total Amount</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sortedPOs.map((po: any, idx: number) => (
                              <TableRow key={po.id} className="h-14">
                                <TableCell>
                                  {po.containerId ? (
                                    <button
                                      onClick={() => handleContainerClick(po)}
                                      className="flex items-center gap-2 text-primary hover:underline cursor-pointer font-mono font-bold text-base"
                                      data-testid={`link-po-container-${idx}`}
                                    >
                                      {po.containerNumber || "-"}
                                      <ExternalLink className="h-4 w-4 flex-shrink-0" />
                                    </button>
                                  ) : (
                                    <span className="font-mono font-bold text-base">{po.containerNumber || "-"}</span>
                                  )}
                                </TableCell>
                                <TableCell className="font-mono text-base">
                                  {po.importDate ? format(new Date(po.importDate), "dd MMM yyyy") : "-"}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="secondary">{po.companyName}</Badge>
                                </TableCell>
                                <TableCell className="text-right font-mono font-bold text-base">
                                  {formatAmount(po.totalAmount)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>

                      <div className="md:hidden space-y-2">
                        {sortedPOs.map((po: any, idx: number) => (
                          <Card key={po.id}>
                            <CardContent className="p-3 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                {po.containerId ? (
                                  <button
                                    onClick={() => handleContainerClick(po)}
                                    className="flex items-center gap-1 text-primary hover:underline cursor-pointer font-mono font-bold"
                                    data-testid={`link-po-container-mobile-${idx}`}
                                  >
                                    {po.containerNumber || "-"}
                                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                  </button>
                                ) : (
                                  <span className="font-mono font-bold">{po.containerNumber || "-"}</span>
                                )}
                                <span className="font-mono text-sm text-muted-foreground">
                                  {po.importDate ? format(new Date(po.importDate), "dd MMM yyyy") : "-"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <Badge variant="secondary" className="text-xs">{po.companyName}</Badge>
                                <span className="font-mono font-bold">{formatAmount(po.totalAmount)}</span>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>

                      <div className="border-t pt-3 flex items-center justify-between bg-muted/50 rounded-md px-4 py-3">
                        <span className="text-sm font-medium text-muted-foreground">
                          {sortedPOs.length} container{sortedPOs.length !== 1 ? "s" : ""}
                        </span>
                        <div className="text-right">
                          <span className="text-xs text-muted-foreground block">Total</span>
                          <span className="font-mono font-bold text-lg">{formatAmount(grandTotal)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()
              }
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!supplierToDelete} onOpenChange={(o) => !o && setSupplierToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Supplier</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{supplierToDelete?.name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => supplierToDelete && deleteMutation.mutate(supplierToDelete.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
