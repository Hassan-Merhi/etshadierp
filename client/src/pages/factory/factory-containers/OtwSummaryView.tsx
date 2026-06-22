import { Ship, Building2, Package, Boxes, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { OtwNotes, OtwCurrencyInline } from "./ContainerBadges";
import { otwContainerByCurrency, otwNum, otwFmtCcy, otwCcySymbol, OTW_STATUS_LABEL } from "./otwHelpers";
import type { ContainerWithSupplier } from "./otwHelpers";

interface OtwSupplierGroup {
  supplierId: number | null;
  supplierName: string;
  containers: ContainerWithSupplier[];
  totalKg: number;
  totalsByCurrency: Record<string, number>;
}

interface OtwGrandTotals {
  containers: number;
  kg: number;
  totalsByCurrency: Record<string, number>;
}

interface OtwSummaryViewProps {
  otwContainers: ContainerWithSupplier[];
  otwSupplierGroups: OtwSupplierGroup[];
  otwGrandTotals: OtwGrandTotals;
  openOtwGroups: Set<string>;
  toggleOtwGroup: (key: string) => void;
  fmtOtwKg: (n: number) => string;
  onViewContainer: (c: ContainerWithSupplier) => void;
}

export function OtwSummaryView({
  otwContainers,
  otwSupplierGroups,
  otwGrandTotals,
  openOtwGroups,
  toggleOtwGroup,
  fmtOtwKg,
  onViewContainer,
}: OtwSummaryViewProps) {
  return (
    <div className="space-y-4">
      <OtwNotes />

      {otwContainers.length === 0 ? (
        <div className="rounded-xl border overflow-hidden">
          <div className="py-16 text-center">
            <Ship className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-40" />
            <p className="text-muted-foreground">No containers currently on the way.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-xl border overflow-hidden">
            {otwSupplierGroups.map((group, idx) => {
              const key = String(group.supplierId ?? "none");
              const isOpen = openOtwGroups.has(key);
              const isLast = idx === otwSupplierGroups.length - 1;
              return (
                <Collapsible key={key} open={isOpen} onOpenChange={() => toggleOtwGroup(key)}>
                  <CollapsibleTrigger asChild>
                    <div
                      className={`flex items-center gap-3 px-4 py-3.5 cursor-pointer hover-elevate transition-colors ${!isLast || isOpen ? "border-b" : ""} ${isOpen ? "bg-muted/30" : ""}`}
                      data-testid={`row-otw-supplier-${key}`}
                    >
                      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-semibold text-sm flex-1 min-w-0 truncate">
                        {group.supplierName}
                      </span>
                      <Badge variant="secondary" className="shrink-0 text-xs">
                        {group.containers.length} ctr{group.containers.length !== 1 ? "s" : ""}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground shrink-0 hidden sm:block w-28 text-right">
                        {fmtOtwKg(group.totalKg)} kg
                      </span>
                      <div className="shrink-0 min-w-[110px] text-right">
                        <OtwCurrencyInline amounts={group.totalsByCurrency} />
                      </div>
                      <ChevronDown
                        className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                      />
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className={`bg-muted/5 ${!isLast ? "border-b" : ""}`}>
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/40 border-b border-border/60 hover:bg-muted/40">
                            <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground py-2 pl-4">Container</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground py-2">Origin</TableHead>
                            <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground py-2">KG</TableHead>
                            <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground py-2">Value</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground py-2">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.containers.map((c) => {
                            const byCurrency = otwContainerByCurrency(c);
                            return (
                              <TableRow
                                key={c.id}
                                className="cursor-pointer hover-elevate"
                                onClick={() => onViewContainer(c)}
                                data-testid={`row-otw-container-${c.id}`}
                              >
                                <TableCell className="font-mono font-semibold">{c.containerNumber}</TableCell>
                                <TableCell className="text-muted-foreground">{c.origin || "—"}</TableCell>
                                <TableCell className="text-right font-mono">{fmtOtwKg(otwNum(c.totalKg))}</TableCell>
                                <TableCell className="text-right">
                                  <OtwCurrencyInline amounts={byCurrency} />
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline">{OTW_STATUS_LABEL[c.status] || c.status}</Badge>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                        <tfoot>
                          <TableRow className="bg-muted/30 font-medium">
                            <TableCell colSpan={2} className="text-muted-foreground">Supplier total</TableCell>
                            <TableCell className="text-right font-mono font-semibold">{fmtOtwKg(group.totalKg)} kg</TableCell>
                            <TableCell className="text-right">
                              <OtwCurrencyInline amounts={group.totalsByCurrency} />
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
          </div>

          <div className="sticky bottom-0 z-50 rounded-xl border bg-card shadow-md" data-testid="div-otw-grand-total">
            <div className="flex flex-wrap items-center gap-6 p-4">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Containers</p>
                  <p className="text-lg font-bold font-mono" data-testid="text-otw-grand-containers">
                    {otwGrandTotals.containers}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Boxes className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                <div>
                  <p className="text-xs text-muted-foreground">Total KG</p>
                  <p className="text-lg font-bold font-mono" data-testid="text-otw-grand-kg">
                    {fmtOtwKg(otwGrandTotals.kg)}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2 flex-1">
                <div className="w-full">
                  <p className="text-xs text-muted-foreground mb-1">Total Value by Currency</p>
                  <div className="flex flex-wrap gap-x-6 gap-y-1" data-testid="text-otw-grand-totals">
                    {Object.entries(otwGrandTotals.totalsByCurrency)
                      .filter(([, v]) => v > 0)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([ccy, amt]) => (
                        <div key={ccy} className="flex flex-col">
                          <span className="text-xs text-muted-foreground">{ccy}</span>
                          <span className="text-lg font-bold font-mono whitespace-nowrap">
                            {otwFmtCcy(otwCcySymbol(ccy), amt)}
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
