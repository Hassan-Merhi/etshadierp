import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, TrendingUp, ShoppingBag, Info } from "lucide-react";

function fmt(v: any, dec = 2) {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? `$0.${"0".repeat(dec)}` : `$${n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

interface SaleLine {
  articleCode: string;
  qtySold: string;
  salePricePerUnit: string;
}

export default function SpSales() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [saleDate, setSaleDate] = useState(new Date().toISOString().slice(0, 10));
  const [customerName, setCustomerName] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [saleLines, setSaleLines] = useState<SaleLine[]>([
    { articleCode: "", qtySold: "", salePricePerUnit: "" },
  ]);

  const { data: stockGroups = [], isLoading: stockLoading } = useQuery<any[]>({
    queryKey: ["/api/sp/report/stock"],
  });

  const { data: statusData } = useQuery<any>({
    queryKey: ["/api/sp/setup/status"],
  });

  const { data: pastSales = [], isLoading: salesLoading } = useQuery<any[]>({
    queryKey: ["/api/sp/sales"],
  });

  const saleMutation = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/sp/sales", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sp/sales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sp/report/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sp/report/profit"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sp/report/sales-detail"] });
      toast({ title: "Sale posted", description: "FIFO lots consumed automatically. COGS and payable entries created." });
      setSaleLines([{ articleCode: "", qtySold: "", salePricePerUnit: "" }]);
      setCustomerName("");
      setNotes("");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addLine = () => setSaleLines(prev => [...prev, { articleCode: "", qtySold: "", salePricePerUnit: "" }]);
  const removeLine = (idx: number) => setSaleLines(prev => prev.filter((_, i) => i !== idx));
  const updateLine = (idx: number, key: keyof SaleLine, value: string) =>
    setSaleLines(prev => prev.map((l, i) => i === idx ? { ...l, [key]: value } : l));

  const getStockGroup = (code: string) => stockGroups.find((g: any) => g.articleCode === code);

  const previewLines = saleLines.map(sl => {
    const g = getStockGroup(sl.articleCode);
    const qty = parseFloat(sl.qtySold || "0");
    const price = parseFloat(sl.salePricePerUnit || "0");
    const avgFinal = g ? parseFloat(g.avgFinalCost || "0") : 0;
    return {
      saleTotal: qty * price,
      estCogs: qty * avgFinal,
      estProfit: qty * (price - avgFinal),
      available: g ? parseFloat(g.totalQtyRemaining || "0") : 0,
    };
  });

  const totalSale = previewLines.reduce((s, l) => s + l.saleTotal, 0);
  const totalCogs = previewLines.reduce((s, l) => s + l.estCogs, 0);
  const grossProfit = totalSale - totalCogs;

  const handleSubmit = () => {
    if (!customerName.trim()) { toast({ title: "Customer name required", variant: "destructive" }); return; }
    const validLines = saleLines.filter(sl => sl.articleCode && parseFloat(sl.qtySold || "0") > 0 && parseFloat(sl.salePricePerUnit || "0") > 0);
    if (validLines.length === 0) { toast({ title: "Add at least one valid sale line", variant: "destructive" }); return; }
    saleMutation.mutate({ saleDate, customerName, bankAccountId: bankAccountId || undefined, notes, saleLines: validLines });
  };

  const availableArticles = stockGroups.filter((g: any) => parseFloat(g.totalQtyRemaining || "0") > 0);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold">Sales</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Record sales — lots consumed FIFO automatically</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">New Sale</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Sale Date</label>
              <Input type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)} className="mt-1" data-testid="input-sp-sale-date" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Customer</label>
              <Input value={customerName} onChange={e => setCustomerName(e.target.value)} className="mt-1" placeholder="Customer name" data-testid="input-sp-customer" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Bank Account (for receipt)</label>
              <Select value={bankAccountId} onValueChange={setBankAccountId}>
                <SelectTrigger className="mt-1" data-testid="select-sp-sale-bank">
                  <SelectValue placeholder="Select bank (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {(statusData?.bankAccounts || []).map((b: any) => (
                    <SelectItem key={b.id} value={String(b.id)}>{b.bankName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} className="mt-1" placeholder="Optional" data-testid="input-sp-sale-notes" />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-sm font-medium">Items to Sell</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Info className="h-3 w-3" /> Server applies FIFO automatically
                </span>
                <Button type="button" variant="outline" size="sm" onClick={addLine} data-testid="button-sp-add-sale-line">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Item
                </Button>
              </div>
            </div>

            {stockLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading available stock...
              </div>
            ) : availableArticles.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <ShoppingBag className="h-4 w-4 opacity-40" /> No stock available. Add opening stock or offload a container first.
              </div>
            ) : (
              saleLines.map((sl, idx) => {
                const g = getStockGroup(sl.articleCode);
                const qty = parseFloat(sl.qtySold || "0");
                const price = parseFloat(sl.salePricePerUnit || "0");
                const avgFinal = g ? parseFloat(g.avgFinalCost || "0") : 0;
                const avail = g ? parseFloat(g.totalQtyRemaining || "0") : 0;
                const estProfit = price - avgFinal;
                const insufficientQty = qty > 0 && avail > 0 && qty > avail;
                return (
                  <div key={idx} className="border border-border rounded-md p-2 space-y-2" data-testid={`row-sp-sale-line-${idx}`}>
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-5">
                        <label className="text-xs text-muted-foreground">Article</label>
                        <Select value={sl.articleCode} onValueChange={v => updateLine(idx, "articleCode", v)}>
                          <SelectTrigger className="h-8 text-xs mt-1" data-testid={`select-sp-sale-article-${idx}`}>
                            <SelectValue placeholder="Select article" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableArticles.map((g: any) => (
                              <SelectItem key={g.articleCode} value={g.articleCode}>
                                {g.articleCode} — {parseFloat(g.totalQtyRemaining || "0").toFixed(2)} avail
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-3">
                        <label className="text-xs text-muted-foreground">Qty to Sell</label>
                        <Input
                          type="number" step="0.01" className="h-8 text-xs mt-1"
                          value={sl.qtySold} onChange={e => updateLine(idx, "qtySold", e.target.value)}
                          data-testid={`input-sp-sale-qty-${idx}`}
                        />
                        {insufficientQty && (
                          <p className="text-xs text-destructive mt-0.5">Exceeds available {avail.toFixed(2)}</p>
                        )}
                      </div>
                      <div className="col-span-3">
                        <label className="text-xs text-muted-foreground">Sale Price/u $</label>
                        <Input
                          type="number" step="0.0001" className="h-8 text-xs mt-1"
                          value={sl.salePricePerUnit} onChange={e => updateLine(idx, "salePricePerUnit", e.target.value)}
                          data-testid={`input-sp-sale-price-${idx}`}
                        />
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(idx)} data-testid={`button-sp-remove-sale-line-${idx}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    {g && qty > 0 && price > 0 && (
                      <div className="flex items-center gap-4 text-xs text-muted-foreground px-1">
                        <span>Avg final cost: {fmt(avgFinal, 4)}/u (est.)</span>
                        <span className={estProfit >= 0 ? "text-green-600" : "text-destructive"}>
                          Est. profit: {fmt(estProfit, 4)}/u ({estProfit >= 0 ? "+" : ""}{fmt(qty * estProfit)})
                        </span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {totalSale > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 bg-muted/30 rounded-md text-sm">
              <div><p className="text-xs text-muted-foreground">Sale Total</p><p className="font-semibold">{fmt(totalSale)}</p></div>
              <div><p className="text-xs text-muted-foreground">Est. COGS (avg)</p><p className="font-semibold">{fmt(totalCogs)}</p></div>
              <div><p className="text-xs text-muted-foreground">Est. Gross Profit</p><p className={`font-semibold ${grossProfit >= 0 ? "text-green-600" : "text-destructive"}`}>{fmt(grossProfit)}</p></div>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={handleSubmit} disabled={saleMutation.isPending} data-testid="button-sp-post-sale">
              {saleMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Post Sale
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Past Sales</h2>
        {salesLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
        ) : pastSales.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sales posted yet.</p>
        ) : (
          <div className="grid gap-2">
            {(pastSales as any[]).map((s: any) => (
              <Card key={s.id} data-testid={`card-sp-sale-${s.id}`}>
                <CardContent className="py-3 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{s.customerName}</span>
                      <span className="text-xs text-muted-foreground">{s.saleDate}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      COGS {fmt(s.totalFinalCostUsd)} · Sup. Payable {fmt(s.totalBaseCostUsd)}
                      {s.lines && s.lines.length > 1 && (
                        <span className="ml-2 text-purple-600">{s.lines.length} lots (FIFO)</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-sm">{fmt(s.totalSalePriceUsd)}</div>
                    <div className={`text-xs font-medium ${parseFloat(s.grossProfitUsd || "0") >= 0 ? "text-green-600" : "text-destructive"}`}>
                      <TrendingUp className="h-3 w-3 inline mr-0.5" />
                      {fmt(s.grossProfitUsd)} profit
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
