import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Users, Container, DollarSign } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { format } from "date-fns";

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
  const { selectedCompany } = useCompany();
  
  const { data: suppliers = [], isLoading } = useQuery<SupplierWithStats[]>({
    queryKey: ["/api/suppliers/with-stats"],
  });

  // Fetch transactions for the selected supplier filtered by current company
  const { data: transactions = [], isLoading: transactionsLoading } = useQuery<any[]>({
    queryKey: [`/api/accounts/supplier/${selectedSupplier?.id}/transactions?companyId=${selectedCompany?.id}`],
    enabled: !!selectedSupplier && !!selectedCompany,
  });

  // Fetch PO imports for the selected supplier filtered by current company
  const { data: poImports = [], isLoading: poImportsLoading } = useQuery<any[]>({
    queryKey: [`/api/suppliers/${selectedSupplier?.id}/purchase-orders?companyId=${selectedCompany?.id}`],
    enabled: !!selectedSupplier && !!selectedCompany,
  });

  const activeSuppliers = suppliers.filter((s) => s.active);
  const totalContainers = suppliers.reduce((sum, s) => sum + s.containerCount, 0);
  const totalBalance = suppliers.reduce((sum, s) => sum + s.balance, 0);
  
  const handleSupplierClick = (supplier: SupplierWithStats) => {
    setSelectedSupplier(supplier);
  };
  
  const handleCloseDialog = () => {
    setSelectedSupplier(null);
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
        <CardHeader>
          <CardTitle className="text-base">Supplier List</CardTitle>
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
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead className="text-right">Containers</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map((supplier) => (
                    <TableRow
                      key={supplier.id}
                      data-testid={`row-supplier-${supplier.id}`}
                    >
                      <TableCell className="font-mono text-sm">
                        {supplier.code}
                      </TableCell>
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
                      <TableCell>
                        <div className="space-y-1">
                          <div className="text-sm">{supplier.email}</div>
                          {supplier.phone && (
                            <div className="text-xs text-muted-foreground">
                              {supplier.phone}
                            </div>
                          )}
                        </div>
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Supplier Transactions Dialog */}
      <Dialog open={!!selectedSupplier} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedSupplier?.legalName} - Transactions
              {selectedCompany && <span className="text-sm font-normal text-muted-foreground ml-2">({selectedCompany.name})</span>}
            </DialogTitle>
          </DialogHeader>
          
          {transactionsLoading || poImportsLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : transactions.length === 0 && poImports.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No transactions or purchase orders found for this supplier in {selectedCompany?.name || "this company"}.
            </div>
          ) : (
            <div className="space-y-6">
              {/* PO Imports Section */}
              {poImports.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Purchase Orders</h3>
                    <Badge variant="secondary">{poImports.length}</Badge>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>PO #</TableHead>
                        <TableHead>Container</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {poImports.map((po) => (
                        <TableRow key={po.id}>
                          <TableCell className="font-mono text-sm">
                            {format(new Date(po.createdAt), "yyyy-MM-dd")}
                          </TableCell>
                          <TableCell className="font-mono text-sm font-medium">
                            {po.poNumber}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {po.containerNumber}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {po.currency} ${parseFloat(po.itemsTotal || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell>
                            <Badge variant={po.status === "Closed" ? "secondary" : "default"}>
                              {po.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="text-right text-sm">
                    <span className="text-muted-foreground">Total PO Amount: </span>
                    <span className="font-mono font-semibold">
                      ${poImports.reduce((sum, po) => sum + parseFloat(po.itemsTotal || "0"), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              )}
              
              {/* Voucher Transactions Section */}
              {transactions.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Voucher Transactions</h3>
                    <Badge variant="secondary">{transactions.length}</Badge>
                  </div>
              <div className="text-sm text-muted-foreground">
                Showing {transactions.length} transaction{transactions.length !== 1 ? "s" : ""}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Voucher #</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((txn) => (
                    <TableRow key={txn.entryId}>
                      <TableCell className="font-mono text-sm">
                        {format(new Date(txn.voucherDate), "yyyy-MM-dd")}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {txn.voucherNumber}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{txn.voucherType}</Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate">
                        {txn.narration || txn.voucherDescription || "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {parseFloat(txn.debitAmount) > 0 
                          ? `$${parseFloat(txn.debitAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {parseFloat(txn.creditAmount) > 0 
                          ? `$${parseFloat(txn.creditAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : "-"}
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
                    ${transactions.reduce((sum, t) => sum + parseFloat(t.debitAmount || "0"), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Total Credit: </span>
                  <span className="font-mono font-semibold">
                    ${transactions.reduce((sum, t) => sum + parseFloat(t.creditAmount || "0"), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Balance: </span>
                  <span className="font-mono font-semibold">
                    ${(
                      transactions.reduce((sum, t) => sum + parseFloat(t.creditAmount || "0"), 0) -
                      transactions.reduce((sum, t) => sum + parseFloat(t.debitAmount || "0"), 0)
                    ).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
