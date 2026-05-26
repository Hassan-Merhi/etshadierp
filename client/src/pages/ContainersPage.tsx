import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { PageHeader } from "@/components/PageHeader";
import { AddContainerDialog } from "@/components/AddContainerDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Package, Plus } from "lucide-react";
import ContainersERP from "./Containers";
import { queryClient } from "@/lib/queryClient";

export default function ContainersPage() {
  const { selectedCompany } = useCompany();
  const isSupplierPartner = selectedCompany?.companyType === "supplier_partner";

  if (!isSupplierPartner) {
    return <ContainersERP />;
  }

  return <SpContainerList />;
}

function SpContainerList() {
  const [, navigate] = useLocation();
  const { formatAmount } = useCurrencyContext();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: containers = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/sp/containers"],
  });

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Container Tracking"
        actions={
          <Button
            onClick={() => setDialogOpen(true)}
            data-testid="button-add-container"
          >
            <Plus className="h-4 w-4 mr-2" />
            Import Container
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-4 md:p-6">
        {isLoading ? (
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-20 ml-auto" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : containers.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <Package className="h-10 w-10 opacity-30" />
              <p className="text-sm">No containers yet. Import one to start tracking a supplier shipment.</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Container #</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Total (USD)</TableHead>
                    <TableHead className="text-center">Lines</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {containers.map((c: any) => (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/containers/${c.id}`)}
                      data-testid={`row-sp-container-${c.id}`}
                    >
                      <TableCell className="font-mono text-sm">{c.invoiceNumber}</TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {c.containerNumber || "—"}
                      </TableCell>
                      <TableCell className="text-sm">{c.supplierName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {c.invoiceDate}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {formatAmount(parseFloat(c.invoiceTotalUsd ?? "0"))}
                      </TableCell>
                      <TableCell className="text-center text-sm text-muted-foreground">
                        {(c.lines || []).length}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            c.status === "offloaded"
                              ? "text-green-600 border-green-600/40"
                              : "text-blue-600 border-blue-600/40"
                          }
                          data-testid={`badge-sp-status-${c.id}`}
                        >
                          {c.status === "offloaded" ? "Offloaded" : "Open"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      <AddContainerDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) queryClient.invalidateQueries({ queryKey: ["/api/sp/containers"] });
        }}
        isSP={true}
      />
    </div>
  );
}
