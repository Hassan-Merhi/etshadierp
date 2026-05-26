import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { queryClient } from "@/lib/queryClient";
import { SpOffloadDialog } from "@/components/SpOffloadDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ArrowLeft, Truck } from "lucide-react";
import ContainerDetailERP from "./ContainerDetail";

function fmt2(v: any) {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? "$0.00" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmt4(v: any) {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? "$0.0000" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

export default function ContainerDetailPage() {
  const { selectedCompany } = useCompany();
  const isSupplierPartner = selectedCompany?.companyType === "supplier_partner";

  if (!isSupplierPartner) {
    return <ContainerDetailERP />;
  }

  return <SpContainerDetailView />;
}

function SpContainerDetailView() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [showOffloadDialog, setShowOffloadDialog] = useState(false);

  const { data: spc, isLoading } = useQuery<any>({
    queryKey: [`/api/sp/containers/${id}`],
    queryFn: () =>
      fetch(`/api/sp/containers/${id}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4" data-testid="sp-container-detail">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-40" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      </div>
    );
  }

  if (!spc || spc.message) {
    return (
      <div className="p-6" data-testid="sp-container-detail">
        <p className="text-muted-foreground text-sm">Container not found.</p>
      </div>
    );
  }

  const discountFactor = 1 - parseFloat(spc.discountPct ?? "0") / 100;
  const baseCostAfterDiscount = (spc.lines ?? []).reduce((sum: number, l: any) => {
    return sum + parseFloat(l.qty ?? "0") * parseFloat(l.unitRateUsd ?? "0") * discountFactor;
  }, 0);

  const title = spc.invoiceNumber || spc.containerNumber || `Container #${spc.id}`;

  return (
    <div className="flex flex-col h-full" data-testid="sp-container-detail">
      {/* Header */}
      <div className="border-b px-4 md:px-6 py-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/containers")}
              data-testid="button-sp-back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold leading-tight">{title}</h1>
              <p className="text-sm text-muted-foreground">{spc.supplierName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className={
                spc.status === "offloaded"
                  ? "text-green-600 border-green-600/40"
                  : "text-blue-600 border-blue-600/40"
              }
              data-testid={`badge-sp-status-${spc.id}`}
            >
              {spc.status === "offloaded" ? "Offloaded" : "Open / OTW"}
            </Badge>
            {spc.status !== "offloaded" && (
              <Button
                onClick={() => setShowOffloadDialog(true)}
                data-testid="button-sp-offload"
              >
                <Truck className="h-4 w-4 mr-2" />
                Offload
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-5">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Invoice Total
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-xl font-semibold tabular-nums">
                {fmt2(spc.invoiceTotalUsd)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Discount
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-xl font-semibold tabular-nums">
                {parseFloat(spc.discountPct ?? "0").toFixed(2)}%
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Base Cost (after disc.)
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-xl font-semibold tabular-nums">
                {fmt2(baseCostAfterDiscount)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Invoice Date
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-xl font-semibold">{spc.invoiceDate ?? "—"}</p>
            </CardContent>
          </Card>
        </div>

        {/* Line Items */}
        <Card>
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm">Line Items</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Article Code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit Rate (USD)</TableHead>
                  <TableHead className="text-right">Disc. Rate</TableHead>
                  <TableHead className="text-right">Line Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(spc.lines ?? []).map((line: any) => {
                  const qty = parseFloat(line.qty ?? "0");
                  const unitRate = parseFloat(line.unitRateUsd ?? "0");
                  const discRate = unitRate * discountFactor;
                  const lineCost = qty * discRate;
                  return (
                    <TableRow key={line.id} data-testid={`row-sp-line-${line.id}`}>
                      <TableCell className="font-mono text-sm">{line.articleCode}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {line.description || "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{qty.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{fmt4(unitRate)}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{fmt4(discRate)}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums font-medium">{fmt2(lineCost)}</TableCell>
                    </TableRow>
                  );
                })}
                {(spc.lines ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-6">
                      No line items
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Prepaid Charges */}
        {(spc.prepaid ?? []).length > 0 && (
          <Card>
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-sm">Prepaid Charges</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount (USD)</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(spc.prepaid ?? []).map((charge: any) => (
                    <TableRow key={charge.id}>
                      <TableCell className="text-sm capitalize">
                        {charge.chargeType?.replace(/_/g, " ") ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {charge.notes || charge.agentName || "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums font-medium">
                        {fmt2(charge.amountPaidUsd)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {charge.prepaidDate ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Offload Summary */}
        {spc.status === "offloaded" && spc.offload && (
          <Card>
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-sm">
                Offload Summary
                <span className="ml-2 font-normal text-muted-foreground text-xs">
                  {spc.offload.offloadDate}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(spc.offloadCharges ?? []).length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount (USD)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(spc.offloadCharges ?? []).map((charge: any) => (
                      <TableRow key={charge.id}>
                        <TableCell className="text-sm capitalize">
                          {charge.chargeType?.replace(/_/g, " ") ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {charge.description || "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums font-medium">
                          {fmt2(charge.amountUsd)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="px-4 pb-4 text-sm text-muted-foreground">No charges recorded.</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Notes */}
        {spc.notes && (
          <Card>
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-sm">Notes</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{spc.notes}</p>
            </CardContent>
          </Card>
        )}
      </div>

      <SpOffloadDialog
        open={showOffloadDialog}
        onOpenChange={setShowOffloadDialog}
        container={spc}
        onSuccess={() =>
          queryClient.invalidateQueries({ queryKey: [`/api/sp/containers/${id}`] })
        }
      />
    </div>
  );
}
