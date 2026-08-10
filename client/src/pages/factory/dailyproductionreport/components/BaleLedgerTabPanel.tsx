import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsContent } from "@/components/ui/tabs";
import { Trash2, Package, ShoppingCart, AlertTriangle, Truck, RefreshCw } from "lucide-react";

import { fmtL, fmtML, fmtNL } from "../utils";
import { LedgerSection } from "./LedgerSection";
import type { DailyProductionReportState } from "../useDailyProductionReport";

export function BaleLedgerTabPanel({ report }: { report: DailyProductionReportState }) {
  const { ledger, ledgerLoading, ledgerRefetch, ledgerFetching, grand } = report;
  return (
    <>
      {/* ── Bale Ledger tab ── */}
      <TabsContent
        value="ledger"
        className="flex-1 overflow-y-auto p-4 gap-3 flex flex-col mt-0 data-[state=inactive]:hidden"
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm text-muted-foreground">
              Complete lifecycle view — stock in hand, wipers/garbages, sold, and waste
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => ledgerRefetch()}
            disabled={ledgerFetching}
            data-testid="button-refresh-ledger"
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${ledgerFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {ledgerLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardHeader className="py-3 px-4">
                  <Skeleton className="h-5 w-64" />
                  <Skeleton className="h-3 w-48 mt-1" />
                </CardHeader>
              </Card>
            ))}
          </div>
        ) : (
          <>
            <LedgerSection
              title="Current Stock — In Hand"
              subtitle="Bales in stock (IN_STOCK / FINALIZED), excluding wipers and garbages"
              icon={<Package className="w-4 h-4 text-green-600" />}
              badgeColor="text-green-700 border-green-200"
              rows={ledger?.currentStock || []}
              total={ledger?.totals.currentStock || { baleCount: 0, totalWeightKg: 0, totalCost: 0 }}
            />
            <LedgerSection
              title="Wipers & Garbages — In Hand"
              subtitle="Waste-category bales currently in stock (IN_STOCK / FINALIZED)"
              icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
              badgeColor="text-amber-700 border-amber-200"
              rows={ledger?.wasteStock || []}
              total={ledger?.totals.wasteStock || { baleCount: 0, totalWeightKg: 0, totalCost: 0 }}
            />
            <LedgerSection
              title="Stock Sold"
              subtitle="Bales that have been dispatched and sold to customers"
              icon={<ShoppingCart className="w-4 h-4 text-blue-600" />}
              badgeColor="text-blue-700 border-blue-200"
              rows={ledger?.sold || []}
              total={ledger?.totals.sold || { baleCount: 0, totalWeightKg: 0, totalCost: 0 }}
              showSoldPrice={true}
            />
            <LedgerSection
              title="Pending Loading / Verified"
              subtitle="Bales reserved for orders currently in Loading, Pending Verification, or Verified status"
              icon={<Truck className="w-4 h-4 text-purple-500" />}
              badgeColor="text-purple-700 border-purple-200"
              rows={ledger?.pendingLoading || []}
              total={ledger?.totals.pendingLoading || { baleCount: 0, totalWeightKg: 0, totalCost: 0 }}
            />
            <LedgerSection
              title="Waste Dispatched"
              subtitle="Bales removed from stock via waste disposal (Waste Dispatch records)"
              icon={<Trash2 className="w-4 h-4 text-destructive" />}
              badgeColor="text-destructive border-destructive/30"
              rows={ledger?.wasteDispatched || []}
              total={ledger?.totals.wasteDispatched || { baleCount: 0, totalWeightKg: 0, totalCost: 0 }}
            />

            {grand && (
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <p className="font-bold text-sm">Total Production (All Time)</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Sum of all sections — complete production output
                      </p>
                    </div>
                    <div className="flex items-center gap-6 flex-wrap">
                      <div className="text-center">
                        <p className="text-xl font-bold" data-testid="grand-total-bales">
                          {fmtNL(grand.baleCount)}
                        </p>
                        <p className="text-xs text-muted-foreground">total bales</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold" data-testid="grand-total-weight">
                          {fmtL(grand.totalWeightKg)}
                        </p>
                        <p className="text-xs text-muted-foreground">kg produced</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold" data-testid="grand-total-cost">
                          {fmtML(grand.totalCost)}
                        </p>
                        <p className="text-xs text-muted-foreground">total sell value</p>
                      </div>
                      {grand.baleCount > 0 && grand.totalCost > 0 && (
                        <div className="text-center">
                          <p className="text-xl font-bold">{fmtML(grand.totalCost / grand.baleCount)}</p>
                          <p className="text-xs text-muted-foreground">avg/bale</p>
                        </div>
                      )}
                    </div>
                  </div>
                  {ledger && (
                    <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t pt-4 sm:grid-cols-5">
                      {[
                        {
                          label: "In Hand (Regular)",
                          bales: ledger.totals.currentStock.baleCount,
                          kg: ledger.totals.currentStock.totalWeightKg,
                          cost: ledger.totals.currentStock.totalCost,
                          color: "text-green-600",
                        },
                        {
                          label: "In Hand (Waste Cat.)",
                          bales: ledger.totals.wasteStock.baleCount,
                          kg: ledger.totals.wasteStock.totalWeightKg,
                          cost: ledger.totals.wasteStock.totalCost,
                          color: "text-amber-600",
                        },
                        {
                          label: "Pending Loading / Verified",
                          bales: ledger.totals.pendingLoading.baleCount,
                          kg: ledger.totals.pendingLoading.totalWeightKg,
                          cost: ledger.totals.pendingLoading.totalCost,
                          color: "text-purple-600",
                        },
                        {
                          label: "Sold",
                          bales: ledger.totals.sold.baleCount,
                          kg: ledger.totals.sold.totalWeightKg,
                          cost: ledger.totals.sold.totalCost,
                          color: "text-blue-600",
                        },
                        {
                          label: "Waste Dispatched",
                          bales: ledger.totals.wasteDispatched.baleCount,
                          kg: ledger.totals.wasteDispatched.totalWeightKg,
                          cost: ledger.totals.wasteDispatched.totalCost,
                          color: "text-destructive",
                        },
                      ].map((s) => (
                        <div key={s.label} className="text-xs">
                          <p className={`font-semibold ${s.color}`}>{s.label}</p>
                          <p className="text-muted-foreground">
                            {fmtNL(s.bales)} bales · {fmtL(s.kg)} kg
                          </p>
                          {s.cost > 0 && <p className="font-medium">{fmtML(s.cost)}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </TabsContent>

      {/* ── Production Comparison tab ── */}
    </>
  );
}
