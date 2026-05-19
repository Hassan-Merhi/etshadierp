import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, BarChart3, Package2, CreditCard, CheckCircle2 } from "lucide-react";

function fmt(v: any) {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? "$0.00" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function SpReports() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [splitPeriod, setSplitPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [customSplitPct, setCustomSplitPct] = useState("50");

  const payableUrl = "/api/sp/report/payable";
  const profitUrl = `/api/sp/report/profit${startDate || endDate ? `?${new URLSearchParams({ ...(startDate && { startDate }), ...(endDate && { endDate }) })}` : ""}`;
  const stockUrl = "/api/sp/report/stock";
  const splitsUrl = "/api/sp/profit-splits";

  const { data: payable, isLoading: payableLoading } = useQuery<any>({ queryKey: [payableUrl] });
  const { data: profit, isLoading: profitLoading } = useQuery<any>({ queryKey: [profitUrl] });
  const { data: stock, isLoading: stockLoading } = useQuery<any[]>({ queryKey: [stockUrl] });
  const { data: splits = [], isLoading: splitsLoading } = useQuery<any[]>({ queryKey: [splitsUrl] });

  const finalizeMutation = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/sp/profit-splits", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [splitsUrl] });
      toast({ title: "Profit split finalized" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleFinalize = () => {
    if (!profit) return;
    finalizeMutation.mutate({
      periodMonth: splitPeriod,
      totalRevenue: profit.totalRevenue,
      totalCogs: profit.totalCogs,
      totalSharedCharges: profit.totalSharedCharges,
      splitPct: customSplitPct,
    });
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Payable statement, P&L, and stock inventory</p>
      </div>

      <Tabs defaultValue="payable">
        <TabsList data-testid="tabs-sp-reports">
          <TabsTrigger value="payable" data-testid="tab-sp-payable">
            <CreditCard className="h-3.5 w-3.5 mr-1.5" /> Supplier Payable
          </TabsTrigger>
          <TabsTrigger value="profit" data-testid="tab-sp-profit">
            <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Profit & Loss
          </TabsTrigger>
          <TabsTrigger value="stock" data-testid="tab-sp-stock">
            <Package2 className="h-3.5 w-3.5 mr-1.5" /> Stock Inventory
          </TabsTrigger>
        </TabsList>

        {/* Payable */}
        <TabsContent value="payable" className="mt-4">
          {payableLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <CardTitle className="text-sm">Supplier Cash Payable</CardTitle>
                    <CardDescription className="text-xs">Base supplier item cost only — from sale postings</CardDescription>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Closing Balance</p>
                    <p className="text-lg font-bold text-orange-600">{fmt(payable?.closingBalance)}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {(payable?.movements || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No payable entries yet.</p>
                ) : (
                  <div className="space-y-0.5">
                    <div className="grid grid-cols-5 text-xs font-medium text-muted-foreground pb-1 border-b border-border/40">
                      <span>Date</span><span className="col-span-2">Description</span>
                      <span className="text-right">Credit</span><span className="text-right">Balance</span>
                    </div>
                    {(payable?.movements || []).map((m: any, idx: number) => (
                      <div key={idx} className="grid grid-cols-5 text-xs py-1 border-b border-border/30 last:border-0" data-testid={`row-sp-payable-${idx}`}>
                        <span className="text-muted-foreground">{m.date?.slice(0, 10)}</span>
                        <span className="col-span-2 truncate">{m.description}</span>
                        <span className="text-right tabular-nums text-orange-600">{m.credit > 0 ? fmt(m.credit) : ""}</span>
                        <span className="text-right tabular-nums font-medium">{fmt(m.balance)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Profit */}
        <TabsContent value="profit" className="mt-4 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <label className="text-xs text-muted-foreground">From</label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="mt-1 w-36" data-testid="input-sp-profit-start" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">To</label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="mt-1 w-36" data-testid="input-sp-profit-end" />
            </div>
          </div>

          {profitLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : profit ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Profit & Loss Summary</CardTitle>
                  <CardDescription className="text-xs">{profit.saleCount} sales in period</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {[
                      { label: "Total Revenue", value: profit.totalRevenue, className: "text-green-600" },
                      { label: "COGS (base + landed)", value: -profit.totalCogs, className: "text-destructive" },
                      { label: "Gross Profit", value: profit.grossProfit, className: "font-semibold border-t border-border/40 pt-1 mt-1" },
                      { label: "Shared Charges", value: -profit.totalSharedCharges, className: "text-destructive" },
                      { label: "Net Profit", value: profit.netProfit, className: "font-bold border-t border-border/40 pt-1 mt-1 text-base" },
                    ].map((row, i) => (
                      <div key={i} className={`flex items-center justify-between text-sm py-0.5 ${row.className || ""}`} data-testid={`row-sp-pl-${i}`}>
                        <span>{row.label}</span>
                        <span className="tabular-nums">{fmt(Math.abs(row.value))}{row.value < 0 ? " (cost)" : ""}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Profit Split (Report Only)</CardTitle>
                  <CardDescription className="text-xs">
                    50/50 split — supplier share is informational only, not posted to Supplier Cash Payable
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><p className="text-xs text-muted-foreground">Our Share (50%)</p><p className="font-semibold text-green-600">{fmt(profit.ourShare)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Supplier Share (50%)</p><p className="font-semibold text-orange-600">{fmt(profit.supplierShare)}</p></div>
                  </div>
                  <div className="flex items-end gap-3 pt-1">
                    <div>
                      <label className="text-xs text-muted-foreground">Period (YYYY-MM)</label>
                      <Input value={splitPeriod} onChange={e => setSplitPeriod(e.target.value)} className="mt-1 w-28 text-xs" data-testid="input-sp-split-period" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Split %</label>
                      <Input type="number" value={customSplitPct} onChange={e => setCustomSplitPct(e.target.value)} className="mt-1 w-20 text-xs" data-testid="input-sp-split-pct" />
                    </div>
                    <Button variant="outline" size="sm" onClick={handleFinalize} disabled={finalizeMutation.isPending} data-testid="button-sp-finalize-split">
                      {finalizeMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                      Finalize
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}

          {/* Finalized splits */}
          {!splitsLoading && splits.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Finalized Splits</h3>
              {splits.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border/30" data-testid={`row-sp-split-${s.id}`}>
                  <span className="font-mono">{s.periodMonth}</span>
                  <span className="text-muted-foreground">Net {fmt(s.grossProfit)}</span>
                  <span className="text-green-600">Our: {fmt(s.ourShare)}</span>
                  <span className="text-orange-600">Sup: {fmt(s.supplierShare)}</span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Stock */}
        <TabsContent value="stock" className="mt-4">
          {stockLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : !stock || stock.length === 0 ? (
            <Card>
              <CardContent className="py-12 flex flex-col items-center gap-3 text-muted-foreground">
                <Package2 className="h-10 w-10 opacity-30" />
                <p className="text-sm">No stock on hand.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Stock Inventory by Article</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-0.5">
                  <div className="grid grid-cols-5 text-xs font-medium text-muted-foreground pb-1 border-b border-border/40">
                    <span className="col-span-2">Article</span>
                    <span className="text-right">Qty In</span>
                    <span className="text-right">Remaining</span>
                    <span className="text-right">Avg Final/u</span>
                  </div>
                  {stock.map((g: any, idx: number) => (
                    <div key={idx} className="grid grid-cols-5 text-sm py-1.5 border-b border-border/30 last:border-0" data-testid={`row-sp-stock-${idx}`}>
                      <div className="col-span-2">
                        <p className="font-mono text-xs">{g.articleCode}</p>
                        {g.description && <p className="text-xs text-muted-foreground">{g.description}</p>}
                      </div>
                      <span className="text-right tabular-nums text-muted-foreground">{parseFloat(g.totalQtyIn || "0").toFixed(2)}</span>
                      <span className="text-right tabular-nums font-semibold text-green-600">{parseFloat(g.totalQtyRemaining || "0").toFixed(2)}</span>
                      <span className="text-right tabular-nums">{fmt(g.avgFinalCost)}</span>
                    </div>
                  ))}
                  <div className="grid grid-cols-5 text-sm pt-2 font-semibold">
                    <span className="col-span-2">Total</span>
                    <span className="text-right tabular-nums text-muted-foreground">{stock.reduce((s, g) => s + parseFloat(g.totalQtyIn || "0"), 0).toFixed(2)}</span>
                    <span className="text-right tabular-nums text-green-600">{stock.reduce((s, g) => s + parseFloat(g.totalQtyRemaining || "0"), 0).toFixed(2)}</span>
                    <span className="text-right tabular-nums">{fmt(stock.reduce((s, g) => s + parseFloat(g.totalValueRemaining || "0"), 0))}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
