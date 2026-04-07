import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Ship, Package, TrendingUp, Boxes, Building2 } from "lucide-react";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useLocation } from "wouter";

interface FactoryContainer {
  id: number;
  containerNumber: string;
  supplierId: number | null;
  supplierName: string | null;
  origin: string | null;
  totalKg: string | null;
  status: string;
  arrivalDate: string | null;
  currencyCode: string;
  fxRateToUsd: string;
  finalPayableAmount: string | null;
  finalPayableAmountUsd: string | null;
  freight: string | null;
  freightCurrencyCode: string | null;
  otherCharges: string | null;
  otherChargesCurrencyCode: string | null;
  commissionAmount: string | null;
  commissionCurrencyCode: string | null;
  additionalChargesSum: string | null;
  preRegisteredChargesSum: string | null;
}

interface SupplierGroup {
  supplierId: number | null;
  supplierName: string;
  containers: FactoryContainer[];
  totalKg: number;
  totalGoodsUsd: number;
  totalChargesUsd: number;
  totalValueUsd: number;
}

function num(v: string | null | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function computeContainerTotals(c: FactoryContainer) {
  const fxRate = num(c.fxRateToUsd) || 1;

  const goodsUsd = num(c.finalPayableAmountUsd);

  // Freight: convert to USD
  const freightLocal = num(c.freight);
  const freightCcy = c.freightCurrencyCode || c.currencyCode || "USD";
  const freightUsd = freightCcy === "USD"
    ? freightLocal
    : freightLocal / fxRate;

  // Commission: default USD
  const commissionLocal = num(c.commissionAmount);
  const commissionCcy = c.commissionCurrencyCode || "USD";
  const commissionUsd = commissionCcy === "USD"
    ? commissionLocal
    : commissionLocal / fxRate;

  // Other charges (in container's local currency → USD)
  const otherLocal = num(c.otherCharges);
  const otherUsd = otherLocal / fxRate;

  // Additional offload charges & pre-registered charges (already in container's currency)
  const additionalUsd = num(c.additionalChargesSum) / fxRate;
  const preRegUsd = num(c.preRegisteredChargesSum) / fxRate;

  const chargesUsd = freightUsd + commissionUsd + otherUsd + additionalUsd + preRegUsd;
  const totalUsd = goodsUsd + chargesUsd;

  return { goodsUsd, chargesUsd, totalUsd };
}

const STATUS_ACTIVE = new Set(["PENDING", "IN_TRANSIT", "ARRIVED"]);

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  IN_TRANSIT: "In Transit",
  ARRIVED: "Arrived",
  OFFLOADED: "Offloaded",
  PARTIALLY_RECEIVED: "Partially Received",
  RECEIVED: "Received",
};

export default function FactoryStockOTW() {
  const { formatAmount } = useCurrencyContext();
  const [, navigate] = useLocation();

  const { data: containers = [], isLoading } = useQuery<FactoryContainer[]>({
    queryKey: ["/api/factory/containers"],
  });

  const otwContainers = useMemo(
    () => containers.filter((c) => STATUS_ACTIVE.has(c.status)),
    [containers]
  );

  // Group by supplier
  const supplierGroups = useMemo<SupplierGroup[]>(() => {
    const map = new Map<string, SupplierGroup>();

    for (const c of otwContainers) {
      const key = String(c.supplierId ?? "none");
      if (!map.has(key)) {
        map.set(key, {
          supplierId: c.supplierId,
          supplierName: c.supplierName || "No Supplier",
          containers: [],
          totalKg: 0,
          totalGoodsUsd: 0,
          totalChargesUsd: 0,
          totalValueUsd: 0,
        });
      }
      const group = map.get(key)!;
      group.containers.push(c);

      const { goodsUsd, chargesUsd, totalUsd } = computeContainerTotals(c);
      group.totalKg += num(c.totalKg);
      group.totalGoodsUsd += goodsUsd;
      group.totalChargesUsd += chargesUsd;
      group.totalValueUsd += totalUsd;
    }

    return Array.from(map.values()).sort((a, b) =>
      a.supplierName.localeCompare(b.supplierName)
    );
  }, [otwContainers]);

  // Grand totals
  const grandTotals = useMemo(() => {
    return supplierGroups.reduce(
      (acc, g) => ({
        containers: acc.containers + g.containers.length,
        kg: acc.kg + g.totalKg,
        goodsUsd: acc.goodsUsd + g.totalGoodsUsd,
        chargesUsd: acc.chargesUsd + g.totalChargesUsd,
        totalUsd: acc.totalUsd + g.totalValueUsd,
      }),
      { containers: 0, kg: 0, goodsUsd: 0, chargesUsd: 0, totalUsd: 0 }
    );
  }, [supplierGroups]);

  const fmtKg = (n: number) =>
    n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Ship className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-xl font-bold">Stock On The Way</h1>
          <p className="text-sm text-muted-foreground">
            Containers currently in transit — grouped by supplier
          </p>
        </div>
        <Badge variant="outline" className="ml-auto" data-testid="badge-total-containers">
          {otwContainers.length} container{otwContainers.length !== 1 ? "s" : ""} OTW
        </Badge>
      </div>

      {otwContainers.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Ship className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-40" />
            <p className="text-muted-foreground">No containers currently on the way.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Supplier groups */}
          {supplierGroups.map((group) => (
            <Card key={group.supplierId ?? "none"} data-testid={`card-supplier-${group.supplierId ?? "none"}`}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  {group.supplierName}
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {group.containers.length} container{group.containers.length !== 1 ? "s" : ""}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Container</TableHead>
                        <TableHead>Origin</TableHead>
                        <TableHead>Arrival</TableHead>
                        <TableHead className="text-right">KG</TableHead>
                        <TableHead className="text-right">Goods Value</TableHead>
                        <TableHead className="text-right">Charges</TableHead>
                        <TableHead className="text-right">Total Value</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.containers.map((c) => {
                        const { goodsUsd, chargesUsd, totalUsd } = computeContainerTotals(c);
                        return (
                          <TableRow
                            key={c.id}
                            className="cursor-pointer hover-elevate"
                            onClick={() => navigate(`/containers/${c.id}`)}
                            data-testid={`row-container-${c.id}`}
                          >
                            <TableCell className="font-mono text-sm font-medium">
                              {c.containerNumber}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {c.origin || "—"}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {c.arrivalDate || "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {fmtKg(num(c.totalKg))}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {goodsUsd > 0 ? formatAmount(goodsUsd) : "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm text-muted-foreground">
                              {chargesUsd > 0 ? formatAmount(chargesUsd) : "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm font-semibold">
                              {totalUsd > 0 ? formatAmount(totalUsd) : "—"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {STATUS_LABEL[c.status] || c.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                    {/* Supplier subtotal row */}
                    <tfoot>
                      <TableRow className="bg-muted/40 font-medium">
                        <TableCell colSpan={3} className="text-sm">
                          Supplier Total
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {fmtKg(group.totalKg)} kg
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatAmount(group.totalGoodsUsd)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">
                          {formatAmount(group.totalChargesUsd)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-semibold">
                          {formatAmount(group.totalValueUsd)}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </tfoot>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ))}

          {/* Grand total bar */}
          <div
            className="sticky bottom-0 z-50 rounded-md border bg-background shadow-md"
            data-testid="div-grand-total"
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Containers</p>
                  <p className="text-lg font-bold font-mono" data-testid="text-grand-containers">
                    {grandTotals.containers}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Boxes className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Total KG</p>
                  <p className="text-lg font-bold font-mono" data-testid="text-grand-kg">
                    {fmtKg(grandTotals.kg)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Ship className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Goods Value</p>
                  <p className="text-lg font-bold font-mono" data-testid="text-grand-goods">
                    {formatAmount(grandTotals.goodsUsd)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Total Value (incl. charges)</p>
                  <p className="text-lg font-bold font-mono" data-testid="text-grand-total">
                    {formatAmount(grandTotals.totalUsd)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
