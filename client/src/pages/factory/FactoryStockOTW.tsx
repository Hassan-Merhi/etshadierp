import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Ship, Package, Boxes, Building2 } from "lucide-react";
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
  ratePerKg: string | null;
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
  totalsByCurrency: Record<string, number>;
}

function num(v: string | null | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

const CCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  AUD: "A$",
  CAD: "C$",
  CHF: "CHF",
  JPY: "¥",
  CNY: "¥",
  AED: "AED",
  SAR: "SAR",
  LBP: "LL",
};

function ccySymbol(code: string | null | undefined): string {
  if (!code) return "$";
  return CCY_SYMBOLS[code] || code;
}

function fmtCcy(symbol: string, amount: number): string {
  return `${symbol} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function addToCurrency(map: Record<string, number>, ccy: string, amount: number) {
  if (amount > 0 && ccy) {
    map[ccy] = (map[ccy] || 0) + amount;
  }
}

function computeContainerByCurrency(c: FactoryContainer): Record<string, number> {
  const amounts: Record<string, number> = {};
  const containerCcy = c.currencyCode || "USD";

  // Goods value: use confirmed finalPayableAmount, or fall back to ratePerKg × totalKg estimate
  const goodsValue = num(c.finalPayableAmount) > 0
    ? num(c.finalPayableAmount)
    : num(c.ratePerKg) * num(c.totalKg);
  addToCurrency(amounts, containerCcy, goodsValue);

  // Freight
  const freightCcy = c.freightCurrencyCode || containerCcy;
  addToCurrency(amounts, freightCcy, num(c.freight));

  // Commission
  const commCcy = c.commissionCurrencyCode || "USD";
  addToCurrency(amounts, commCcy, num(c.commissionAmount));

  // Other charges (in container's currency)
  addToCurrency(amounts, containerCcy, num(c.otherCharges));

  // Additional & pre-registered charges (in container's currency)
  addToCurrency(amounts, containerCcy, num(c.additionalChargesSum));
  addToCurrency(amounts, containerCcy, num(c.preRegisteredChargesSum));

  return amounts;
}

function mergeCurrencyMaps(
  target: Record<string, number>,
  source: Record<string, number>
) {
  for (const [ccy, amt] of Object.entries(source)) {
    target[ccy] = (target[ccy] || 0) + amt;
  }
}

function renderCurrencyBreakdown(
  amounts: Record<string, number>,
  className = ""
): React.ReactNode {
  const entries = Object.entries(amounts).filter(([, v]) => v > 0);
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className={`flex flex-col items-end gap-0.5 ${className}`}>
      {entries.map(([ccy, amt]) => (
        <span key={ccy} className="font-mono text-sm font-semibold whitespace-nowrap">
          {fmtCcy(ccySymbol(ccy), amt)}
        </span>
      ))}
    </div>
  );
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
  const [, navigate] = useLocation();

  const { data: containers = [], isLoading } = useQuery<FactoryContainer[]>({
    queryKey: ["/api/factory/containers"],
  });

  const otwContainers = useMemo(
    () => containers.filter((c) => STATUS_ACTIVE.has(c.status)),
    [containers]
  );

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
          totalsByCurrency: {},
        });
      }
      const group = map.get(key)!;
      group.containers.push(c);
      group.totalKg += num(c.totalKg);
      mergeCurrencyMaps(group.totalsByCurrency, computeContainerByCurrency(c));
    }

    return Array.from(map.values()).sort((a, b) =>
      a.supplierName.localeCompare(b.supplierName)
    );
  }, [otwContainers]);

  const grandTotals = useMemo(() => {
    const totalsByCurrency: Record<string, number> = {};
    let containers = 0;
    let kg = 0;
    for (const g of supplierGroups) {
      containers += g.containers.length;
      kg += g.totalKg;
      mergeCurrencyMaps(totalsByCurrency, g.totalsByCurrency);
    }
    return { containers, kg, totalsByCurrency };
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
                <div className="table-responsive">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Container</TableHead>
                        <TableHead className="text-right">KG</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.containers.map((c) => {
                        const byCurrency = computeContainerByCurrency(c);
                        const isEstimated = num(c.finalPayableAmount) === 0 && num(c.ratePerKg) > 0;
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
                            <TableCell className="text-right font-mono text-sm">
                              {fmtKg(num(c.totalKg))}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex flex-col items-end gap-0.5">
                                {renderCurrencyBreakdown(byCurrency)}
                                {isEstimated && (
                                  <span className="text-xs text-muted-foreground italic">est.</span>
                                )}
                              </div>
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
                    <tfoot>
                      <TableRow className="bg-muted/40 font-medium">
                        <TableCell className="text-sm">Supplier Total</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {fmtKg(group.totalKg)} kg
                        </TableCell>
                        <TableCell className="text-right">
                          {renderCurrencyBreakdown(group.totalsByCurrency)}
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
            <div className="flex flex-wrap items-center gap-6 p-4">
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
              <div className="flex items-start gap-2 flex-1">
                <div className="w-full">
                  <p className="text-xs text-muted-foreground mb-1">Total Value by Currency</p>
                  <div className="flex flex-wrap gap-x-6 gap-y-1" data-testid="text-grand-totals">
                    {Object.entries(grandTotals.totalsByCurrency)
                      .filter(([, v]) => v > 0)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([ccy, amt]) => (
                        <div key={ccy} className="flex flex-col">
                          <span className="text-xs text-muted-foreground">{ccy}</span>
                          <span className="text-lg font-bold font-mono whitespace-nowrap">
                            {fmtCcy(ccySymbol(ccy), amt)}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
