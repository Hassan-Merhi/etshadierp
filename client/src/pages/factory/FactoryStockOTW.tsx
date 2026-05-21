import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { Ship, Package, Boxes, Building2, ChevronDown, StickyNote } from "lucide-react";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/PageHeader";

const NOTES_KEY = "factory-otw-notes";

function OTWNotes() {
  const [value, setValue] = useState(() => localStorage.getItem(NOTES_KEY) ?? "");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      localStorage.setItem(NOTES_KEY, e.target.value);
    }, 600);
  }

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  return (
    <Card>
      <CardContent className="pt-3 pb-3">
        <div className="flex items-center gap-2 mb-2">
          <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Notes</span>
        </div>
        <Textarea
          value={value}
          onChange={handleChange}
          placeholder="Write anything here…"
          className="min-h-[80px] resize-y text-sm border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 p-0"
          data-testid="textarea-otw-notes"
        />
      </CardContent>
    </Card>
  );
}

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
  USD: "$", EUR: "€", GBP: "£", AUD: "A$", CAD: "C$",
  CHF: "CHF", JPY: "¥", CNY: "¥", AED: "AED", SAR: "SAR", LBP: "LL",
};

function ccySymbol(code: string | null | undefined): string {
  if (!code) return "$";
  return CCY_SYMBOLS[code] || code;
}

function fmtCcy(symbol: string, amount: number | null | undefined): string {
  if (amount == null || isNaN(amount)) return `${symbol} 0.00`;
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
  const goodsValue = num(c.finalPayableAmount) > 0
    ? num(c.finalPayableAmount)
    : num(c.ratePerKg) * num(c.totalKg);
  addToCurrency(amounts, containerCcy, goodsValue);
  addToCurrency(amounts, c.freightCurrencyCode || containerCcy, num(c.freight));
  addToCurrency(amounts, c.commissionCurrencyCode || "USD", num(c.commissionAmount));
  addToCurrency(amounts, containerCcy, num(c.otherCharges));
  addToCurrency(amounts, containerCcy, num(c.additionalChargesSum));
  addToCurrency(amounts, containerCcy, num(c.preRegisteredChargesSum));
  return amounts;
}

function mergeCurrencyMaps(target: Record<string, number>, source: Record<string, number>) {
  for (const [ccy, amt] of Object.entries(source)) {
    target[ccy] = (target[ccy] || 0) + amt;
  }
}

function CurrencyInline({ amounts }: { amounts: Record<string, number> }) {
  const entries = Object.entries(amounts).filter(([, v]) => v > 0);
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col items-end gap-0.5">
      {entries.map(([ccy, amt]) => (
        <span key={ccy} className="font-mono text-sm font-semibold whitespace-nowrap">
          {fmtCcy(ccySymbol(ccy), amt)}
        </span>
      ))}
    </div>
  );
}

const STATUS_ACTIVE = new Set(["PENDING", "IN_TRANSIT", "ARRIVED", "RECEIVED", "PARTIALLY_RECEIVED"]);

const STATUS_LABEL: Record<string, string> = {
  PENDING:            "Pending",
  IN_TRANSIT:         "Pending",
  ARRIVED:            "Pending",
  OFFLOADED:          "Offloaded",
  PARTIALLY_RECEIVED: "Pending",
  RECEIVED:           "Pending",
};

export default function FactoryStockOTW() {
  const [, navigate] = useLocation();
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const { data: containers = [], isLoading } = useQuery<FactoryContainer[]>({
    queryKey: ["/api/factory/containers"],
  });

  const otwContainers = useMemo(
    () => containers.filter((c) => STATUS_ACTIVE.has(c.status)),
    [containers],
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
    return Array.from(map.values()).sort((a, b) => a.supplierName.localeCompare(b.supplierName));
  }, [otwContainers]);

  const grandTotals = useMemo(() => {
    const totalsByCurrency: Record<string, number> = {};
    let count = 0;
    let kg = 0;
    for (const g of supplierGroups) {
      count += g.containers.length;
      kg += g.totalKg;
      mergeCurrencyMaps(totalsByCurrency, g.totalsByCurrency);
    }
    return { containers: count, kg, totalsByCurrency };
  }, [supplierGroups]);

  const fmtKg = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-8 w-64" />
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Ship className="h-6 w-6 text-muted-foreground" />
        <div>
          <PageHeader title="Stock On The Way" subtitle="Containers currently in transit — grouped by supplier" />
        </div>
        <Badge variant="outline" className="ml-auto" data-testid="badge-total-containers">
          {otwContainers.length} container{otwContainers.length !== 1 ? "s" : ""} OTW
        </Badge>
      </div>

      <OTWNotes />

      {otwContainers.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Ship className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-40" />
            <p className="text-muted-foreground">No containers currently on the way.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            {supplierGroups.map((group, idx) => {
              const key = String(group.supplierId ?? "none");
              const isOpen = openGroups.has(key);
              const isLast = idx === supplierGroups.length - 1;

              return (
                <Collapsible key={key} open={isOpen} onOpenChange={() => toggleGroup(key)}>
                  <CollapsibleTrigger asChild>
                    <div
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover-elevate transition-colors
                        ${!isLast ? "border-b" : ""}
                        ${isOpen ? "bg-muted/30" : ""}`}
                      data-testid={`row-supplier-${key}`}
                    >
                      {/* Supplier name */}
                      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-medium text-sm flex-1 min-w-0 truncate">
                        {group.supplierName}
                      </span>

                      {/* Container count */}
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {group.containers.length} ctr{group.containers.length !== 1 ? "s" : ""}
                      </Badge>

                      {/* Total KG */}
                      <span className="text-sm font-mono text-muted-foreground shrink-0 hidden sm:block w-28 text-right">
                        {fmtKg(group.totalKg)} kg
                      </span>

                      {/* Total value */}
                      <div className="shrink-0 min-w-[100px] text-right">
                        <CurrencyInline amounts={group.totalsByCurrency} />
                      </div>

                      {/* Chevron */}
                      <ChevronDown
                        className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                      />
                    </div>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className={`border-t bg-muted/10 ${!isLast ? "border-b" : ""}`}>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Container</TableHead>
                            <TableHead>Origin</TableHead>
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
                                <TableCell className="text-sm text-muted-foreground">
                                  {c.origin || "—"}
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">
                                  {fmtKg(num(c.totalKg))}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex flex-col items-end gap-0.5">
                                    <CurrencyInline amounts={byCurrency} />
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
                          <TableRow className="bg-muted/30 font-medium">
                            <TableCell colSpan={2} className="text-sm text-muted-foreground">
                              Supplier total
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {fmtKg(group.totalKg)} kg
                            </TableCell>
                            <TableCell className="text-right">
                              <CurrencyInline amounts={group.totalsByCurrency} />
                            </TableCell>
                            <TableCell />
                          </TableRow>
                        </tfoot>
                      </Table>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </Card>

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
