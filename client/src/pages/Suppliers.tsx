import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Users, Container, DollarSign, Download, Edit, EyeOff, Eye } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { format } from "date-fns";
import * as XLSX from "xlsx";

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
  const { selectedCompany } = useCompany();
  const [_location, navigate] = useLocation();
  
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

  const activeSuppliers = suppliers.filter((s) => s.active);
  const totalContainers = suppliers.reduce((sum, s) => sum + Number(s.containerCount || 0), 0);
  const totalBalance = suppliers.reduce((sum, s) => sum + Number(s.balance || 0), 0);
  
  // Sort suppliers alphabetically by name and filter by balance if needed
  const sortedSuppliers = [...suppliers]
    .filter(s => hideZeroBalance ? s.balance !== 0 : true)
    .sort((a, b) => 
      a.legalName.localeCompare(b.legalName)
    );
  
  const handleSupplierClick = (supplier: SupplierWithStats) => {
    setSelectedSupplier(supplier);
    setCompanyFilter("all"); // Reset filter when opening
  };
  
  const handleCloseDialog = () => {
    setSelectedSupplier(null);
    setCompanyFilter("all");
  };

  const handleExportToExcel = () => {
    if (!selectedSupplier || unifiedLedger.length === 0) return;

    const exportData = unifiedLedger.map((txn: any) => ({
      Date: txn.date ? format(new Date(txn.date), "yyyy-MM-dd") : "",
      Company: txn.companyName,
      "Doc Number": txn.docNumber,
      Type: txn.voucherType,
      Description: txn.description,
      Debit: txn.debit,
      Credit: txn.credit,
      Balance: txn.balance,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Supplier Ledger");
    
    const fileName = `${selectedSupplier.legalName}_Ledger_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">
            Suppliers
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage supplier accounts and track container shipments
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
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
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
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
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
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
                ${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
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
                      <TableCell className="font-medium">
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
                        ${supplier.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        <Badge variant={supplier.active ? "default" : "secondary"}>
                          {supplier.active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/suppliers/${supplier.id}/edit`)}
                          data-testid={`button-edit-supplier-${supplier.id}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Supplier Unified Ledger Dialog */}
      <Dialog open={!!selectedSupplier} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-6xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {selectedSupplier?.legalName} - Unified Ledger (All Companies)
            </DialogTitle>
            <div className="flex items-center gap-4 pt-2">
              <div className="flex items-center gap-2">
                <label className="text-sm text-muted-foreground">Filter by Company:</label>
                <Select value={companyFilter} onValueChange={setCompanyFilter}>
                  <SelectTrigger className="w-48" data-testid="select-company-filter">
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
          
          <div className="flex-1 overflow-y-auto">
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
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  Showing {unifiedLedger.length} transaction{unifiedLedger.length !== 1 ? "s" : ""}
                  {companyFilter !== "all" && companies.find((c: any) => c.id === parseInt(companyFilter)) 
                    ? ` from ${companies.find((c: any) => c.id === parseInt(companyFilter))?.name}`
                    : " from all companies"}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Doc #</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="max-w-xs">Description</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unifiedLedger.map((txn: any, idx: number) => (
                      <TableRow key={`${txn.type}-${txn.docNumber}-${idx}`}>
                        <TableCell className="font-mono text-sm">
                          {txn.date ? format(new Date(txn.date), "yyyy-MM-dd") : "-"}
                        </TableCell>
                        <TableCell className="text-sm">
                          <Badge variant="secondary">{txn.companyName}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm font-medium">
                          {txn.docNumber}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{txn.voucherType}</Badge>
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-sm">
                          {txn.description || "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {txn.debit > 0 
                            ? `$${txn.debit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {txn.credit > 0 
                            ? `$${txn.credit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          ${txn.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                
                {/* Summary */}
                <div className="border-t pt-4 flex justify-end gap-8">
                  <div className="text-sm">
                    <span className="text-muted-foreground">Total Debit: </span>
                    <span className="font-mono font-semibold">
                      ${unifiedLedger.reduce((sum: number, t: any) => sum + t.debit, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Total Credit: </span>
                    <span className="font-mono font-semibold">
                      ${unifiedLedger.reduce((sum: number, t: any) => sum + t.credit, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Final Balance: </span>
                    <span className="font-mono font-semibold">
                      ${(unifiedLedger[unifiedLedger.length - 1]?.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
