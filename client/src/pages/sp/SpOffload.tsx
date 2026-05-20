import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, ArrowLeft, Plus, Trash2, AlertCircle, CheckCircle2, AlertTriangle, FileText, TrendingDown, TrendingUp } from "lucide-react";

function fmt2(v: any) {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? "$0.00" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmt4(v: any) {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? "$0.0000" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

const CHARGE_TYPES = [
  { value: "prepaid_used",    label: "Prepaid Used" },
  { value: "paid_now",        label: "Paid Now (Cash/Bank)" },
  { value: "unpaid_payable",  label: "Unpaid Payable (Accrual)" },
  { value: "invoice_freight", label: "Invoice Freight (Cost Clearing)" },
  { value: "other",           label: "Other (Any Ledger Account)" },
];

interface ChargeLine {
  chargeType: string;
  description: string;
  amountUsd: string;
  prepaidChargeId: string;
  creditBankAccountId: string;
  creditLedgerAccountId: string;
}

export default function SpOffload() {
  const { containerId } = useParams<{ containerId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [offloadDate, setOffloadDate] = useState(new Date().toISOString().slice(0, 10));
  const [chargeLines, setChargeLines] = useState<ChargeLine[]>([
    { chargeType: "prepaid_used", description: "", amountUsd: "", prepaidChargeId: "", creditBankAccountId: "", creditLedgerAccountId: "" },
  ]);

  const { data: container, isLoading } = useQuery<any>({
    queryKey: ["/api/sp/containers", containerId],
    queryFn: () => fetch(`/api/sp/containers/${containerId}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: statusData } = useQuery<any>({
    queryKey: ["/api/sp/setup/status"],
  });

  const { data: ledgerAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/accounts"],
  });

  const { data: aliases = [] } = useQuery<any[]>({ queryKey: ["/api/sp/aliases"] });
  const aliasMap = new Map((aliases as any[]).map((a: any) => [a.alias_code, a]));

  const offloadMutation = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/sp/offload", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sp/containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sp/containers", containerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/sp/stock"] });
      toast({ title: "Offload recorded", description: "Goods OTW reversed and stock created." });
      navigate(`/sp/containers/${containerId}`);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
  if (!container) return <div className="text-muted-foreground text-sm">Container not found.</div>;
  if (container.status !== "open") return (
    <div className="max-w-xl space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/sp/containers/${containerId}`)}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back
      </Button>
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <AlertCircle className="h-4 w-4" /> This container has already been offloaded.
      </div>
    </div>
  );

  const discountFactor = 1 - parseFloat(container.discountPct || "0") / 100;
  const totalQty = (container.lines || []).reduce((s: number, l: any) => s + parseFloat(l.qty || "0"), 0);
  const totalBaseCost = (container.lines || []).reduce(
    (s: number, l: any) => s + parseFloat(l.qty || "0") * parseFloat(l.unitRateUsd || "0") * discountFactor, 0
  );
  const totalLandedCost = chargeLines.reduce((s, c) => s + parseFloat(c.amountUsd || "0"), 0);
  const landedPerUnit = totalQty > 0 ? totalLandedCost / totalQty : 0;
  const totalFinalCost = totalBaseCost + totalLandedCost;
  const invoiceTotal = parseFloat(container.invoiceTotalUsd || "0");

  const addCharge = () => setChargeLines(prev => [
    ...prev,
    { chargeType: "paid_now", description: "", amountUsd: "", prepaidChargeId: "", creditBankAccountId: "", creditLedgerAccountId: "" },
  ]);

  const removeCharge = (idx: number) => setChargeLines(prev => prev.filter((_, i) => i !== idx));

  const updateCharge = (idx: number, key: keyof ChargeLine, value: string) => {
    setChargeLines(prev => prev.map((c, i) => i === idx ? { ...c, [key]: value } : c));
  };

  const handleSubmit = () => {
    offloadMutation.mutate({
      containerId,
      offloadDate,
      chargeLines: chargeLines.filter(c => parseFloat(c.amountUsd || "0") > 0),
    });
  };

  // SP account names for accounting preview
  const otwAcct = (statusData?.spAccounts || []).find((a: any) => a.subType === "sp_goods_otw");
  const otwClrAcct = (statusData?.spAccounts || []).find((a: any) => a.subType === "sp_otw_clearing");
  const stockAcct = (statusData?.spAccounts || []).find((a: any) => a.subType === "sp_stock");
  const costClrAcct = (statusData?.spAccounts || []).find((a: any) => a.subType === "sp_cost_clearing");
  const prepaidAcct = (statusData?.spAccounts || []).find((a: any) => a.subType === "sp_prepaid");

  const activeCharges = chargeLines.filter(c => parseFloat(c.amountUsd || "0") > 0);

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/sp/containers/${containerId}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Offload Container</h1>
          <p className="text-sm text-muted-foreground">
            {container.supplierName}
            {container.containerNumber && <span className="ml-2 font-mono">{container.containerNumber}</span>}
            {" · "}{container.invoiceNumber}
          </p>
        </div>
      </div>

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Container Summary</CardTitle>
          <CardDescription className="text-xs">Figures before landed charges</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><p className="text-xs text-muted-foreground">Total Qty</p><p className="font-semibold">{totalQty.toFixed(2)}</p></div>
          <div><p className="text-xs text-muted-foreground">Invoice Total</p><p className="font-semibold">{fmt2(invoiceTotal)}</p></div>
          <div><p className="text-xs text-muted-foreground">Base Cost</p><p className="font-semibold">{fmt2(totalBaseCost)}</p></div>
          <div><p className="text-xs text-muted-foreground">Prepaid Charges</p><p className="font-semibold">{fmt2((container.prepaid || []).reduce((s: number, p: any) => s + parseFloat(p.amountPaidUsd || "0"), 0))}</p></div>
        </CardContent>
      </Card>

      {/* Per-line preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Final Cost Preview — Per Line</CardTitle>
          <CardDescription className="text-xs">Discounted base + shared landed cost per unit</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-0.5">
            <div className="grid grid-cols-6 text-xs font-medium text-muted-foreground pb-1 border-b border-border/40">
              <span className="col-span-2">Article</span><span className="text-right">Qty</span>
              <span className="text-right">Base/u</span><span className="text-right">Landed/u</span><span className="text-right">Final/u</span>
            </div>
            {(container.lines || []).map((l: any) => {
              const baseU = parseFloat(l.unitRateUsd || "0") * discountFactor;
              const finalU = baseU + landedPerUnit;
              const mapped = aliasMap.has(l.articleCode);
              return (
                <div key={l.id} className="grid grid-cols-6 text-xs py-1 border-b border-border/30 last:border-0">
                  <div className="col-span-2 flex items-center gap-1.5 min-w-0">
                    <span className="font-mono truncate">{l.articleCode}</span>
                    {mapped
                      ? <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />
                      : <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />}
                  </div>
                  <span className="text-right tabular-nums">{parseFloat(l.qty || "0").toFixed(2)}</span>
                  <span className="text-right tabular-nums">{fmt4(baseU)}</span>
                  <span className="text-right tabular-nums text-orange-600">{fmt4(landedPerUnit)}</span>
                  <span className="text-right tabular-nums font-semibold">{fmt4(finalU)}</span>
                </div>
              );
            })}
          </div>
          {(container.lines || []).some((l: any) => !aliasMap.has(l.articleCode)) && (
            <p className="text-xs text-amber-600 flex items-center gap-1.5 pt-2">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              Lines without alias mapping will have FIFO tracked by article code only.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Offload date */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium whitespace-nowrap">Offload Date</label>
        <Input
          type="date"
          value={offloadDate}
          onChange={e => setOffloadDate(e.target.value)}
          className="w-44"
          data-testid="input-sp-offload-date"
        />
      </div>

      {/* Charge Lines */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-sm">Landed Charges</CardTitle>
              <CardDescription className="text-xs">Each charge credits a specific account on the stock voucher</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={addCharge} data-testid="button-sp-add-charge">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Charge
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {chargeLines.length > 0 && (
            <div className="grid grid-cols-12 gap-1.5 px-2 pb-0.5">
              <span className="col-span-3 text-xs text-muted-foreground">Type</span>
              <span className="col-span-3 text-xs text-muted-foreground">Description</span>
              <span className="col-span-2 text-xs text-muted-foreground">Amount $</span>
              <span className="col-span-3 text-xs text-muted-foreground">Credit Source</span>
              <span className="col-span-1" />
            </div>
          )}
          {chargeLines.map((charge, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-center p-2 border border-border rounded-md" data-testid={`row-sp-charge-${idx}`}>
              {/* Type */}
              <div className="col-span-3">
                <Select value={charge.chargeType} onValueChange={v => updateCharge(idx, "chargeType", v)}>
                  <SelectTrigger className="h-8 text-xs" data-testid={`select-sp-charge-type-${idx}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHARGE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {/* Description */}
              <div className="col-span-3">
                <Input className="h-8 text-xs" placeholder="Description" value={charge.description} onChange={e => updateCharge(idx, "description", e.target.value)} data-testid={`input-sp-charge-desc-${idx}`} />
              </div>
              {/* Amount */}
              <div className="col-span-2">
                <Input type="number" step="0.01" className="h-8 text-xs" placeholder="0.00" value={charge.amountUsd} onChange={e => updateCharge(idx, "amountUsd", e.target.value)} data-testid={`input-sp-charge-amount-${idx}`} />
              </div>
              {/* Source */}
              <div className="col-span-3">
                {charge.chargeType === "prepaid_used" ? (
                  <Select value={charge.prepaidChargeId} onValueChange={v => updateCharge(idx, "prepaidChargeId", v)}>
                    <SelectTrigger className="h-8 text-xs" data-testid={`select-sp-prepaid-charge-${idx}`}>
                      <SelectValue placeholder="Select prepaid" />
                    </SelectTrigger>
                    <SelectContent>
                      {(container.prepaid || []).map((p: any) => {
                        const remaining = parseFloat(p.amountPaidUsd || "0") - parseFloat(p.amountUsedUsd || "0");
                        return (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {p.chargeType} — {fmt2(remaining)} left
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                ) : charge.chargeType === "paid_now" ? (
                  <Select value={charge.creditBankAccountId} onValueChange={v => updateCharge(idx, "creditBankAccountId", v)}>
                    <SelectTrigger className="h-8 text-xs" data-testid={`select-sp-charge-bank-${idx}`}>
                      <SelectValue placeholder="Select bank" />
                    </SelectTrigger>
                    <SelectContent>
                      {(statusData?.bankAccounts || []).map((b: any) => (
                        <SelectItem key={b.id} value={String(b.id)}>{b.bankName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : charge.chargeType === "unpaid_payable" ? (
                  <Select value={charge.creditLedgerAccountId} onValueChange={v => updateCharge(idx, "creditLedgerAccountId", v)}>
                    <SelectTrigger className="h-8 text-xs" data-testid={`select-sp-charge-ledger-${idx}`}>
                      <SelectValue placeholder="Select payable account" />
                    </SelectTrigger>
                    <SelectContent>
                      {(ledgerAccounts as any[]).filter((a: any) => a.accountType === "Liability" || a.accountType === "Accounts Payable").map((a: any) => (
                        <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : charge.chargeType === "other" ? (
                  <Select value={charge.creditLedgerAccountId} onValueChange={v => updateCharge(idx, "creditLedgerAccountId", v)}>
                    <SelectTrigger className="h-8 text-xs" data-testid={`select-sp-charge-other-ledger-${idx}`}>
                      <SelectValue placeholder="Select any account" />
                    </SelectTrigger>
                    <SelectContent>
                      {(ledgerAccounts as any[]).map((a: any) => (
                        <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="h-8 flex items-center px-1">
                    <Badge variant="secondary" className="text-xs">Auto → Cost Clearing</Badge>
                  </div>
                )}
              </div>
              {/* Remove */}
              <div className="col-span-1 flex justify-end">
                <Button type="button" variant="ghost" size="icon" onClick={() => removeCharge(idx)} data-testid={`button-sp-remove-charge-${idx}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}

          {chargeLines.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">No charges added. All landed cost will be zero.</p>
          )}
        </CardContent>
      </Card>

      {/* Cost Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Cost Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><p className="text-xs text-muted-foreground">Base Cost</p><p className="font-semibold">{fmt2(totalBaseCost)}</p></div>
          <div><p className="text-xs text-muted-foreground">Landed Charges</p><p className="font-semibold">{fmt2(totalLandedCost)}</p></div>
          <div><p className="text-xs text-muted-foreground">Total Final Cost</p><p className="font-semibold">{fmt2(totalFinalCost)}</p></div>
          <div><p className="text-xs text-muted-foreground">OTW Reversal</p><p className="font-semibold">{fmt2(invoiceTotal)}</p></div>
        </CardContent>
      </Card>

      {/* Accounting Preview — both vouchers */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <div>
              <CardTitle className="text-sm">Accounting Preview</CardTitle>
              <CardDescription className="text-xs">Two journal vouchers will be created on confirm</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Voucher A: OTW Reversal */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 mb-1.5">
              <TrendingDown className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Voucher A — Goods OTW Reversal</p>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3 space-y-1">
              <div className="grid grid-cols-3 text-xs text-muted-foreground font-medium pb-1 border-b border-border/40">
                <span className="col-span-2">Account</span>
                <span className="text-right">Dr / Cr</span>
              </div>
              <div className="grid grid-cols-3 text-xs py-0.5">
                <span className="col-span-2 font-medium">{otwClrAcct?.name ?? "Goods OTW Clearing"} <Badge variant="secondary" className="text-xs ml-1">Dr</Badge></span>
                <span className="text-right tabular-nums font-semibold">{fmt2(invoiceTotal)}</span>
              </div>
              <div className="grid grid-cols-3 text-xs py-0.5 text-muted-foreground">
                <span className="col-span-2 pl-4">{otwAcct?.name ?? "Goods OTW"} (Cr)</span>
                <span className="text-right tabular-nums">{fmt2(invoiceTotal)}</span>
              </div>
            </div>
          </div>

          <Separator />

          {/* Voucher B: Stock Creation */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 mb-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Voucher B — Stock Creation</p>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3 space-y-1">
              <div className="grid grid-cols-3 text-xs text-muted-foreground font-medium pb-1 border-b border-border/40">
                <span className="col-span-2">Account</span>
                <span className="text-right">Dr / Cr</span>
              </div>
              {/* Dr Stock */}
              <div className="grid grid-cols-3 text-xs py-0.5">
                <span className="col-span-2 font-medium">{stockAcct?.name ?? "SP Stock on Floor"} <Badge variant="secondary" className="text-xs ml-1">Dr</Badge></span>
                <span className="text-right tabular-nums font-semibold">{fmt2(totalFinalCost)}</span>
              </div>
              {/* Cr Base cost → Cost Clearing */}
              <div className="grid grid-cols-3 text-xs py-0.5 text-muted-foreground">
                <span className="col-span-2 pl-4">{costClrAcct?.name ?? "SP Cost Clearing"} — base supplier cost (Cr)</span>
                <span className="text-right tabular-nums">{fmt2(totalBaseCost)}</span>
              </div>
              {/* Cr each active charge */}
              {activeCharges.map((c, idx) => {
                const amt = parseFloat(c.amountUsd || "0");
                let creditLabel = "";
                if (c.chargeType === "prepaid_used") {
                  const p = (container.prepaid || []).find((x: any) => String(x.id) === c.prepaidChargeId);
                  creditLabel = prepaidAcct?.name ?? "SP Prepaid Charges";
                  if (p) creditLabel += ` — ${p.chargeType}`;
                } else if (c.chargeType === "paid_now") {
                  const b = (statusData?.bankAccounts || []).find((x: any) => String(x.id) === c.creditBankAccountId);
                  creditLabel = b ? b.bankName : "Bank Account";
                } else if (c.chargeType === "unpaid_payable") {
                  const a = (ledgerAccounts as any[]).find((x: any) => String(x.id) === c.creditLedgerAccountId);
                  creditLabel = a ? `${a.name} — payable` : "Payable Account";
                } else if (c.chargeType === "other") {
                  const a = (ledgerAccounts as any[]).find((x: any) => String(x.id) === c.creditLedgerAccountId);
                  creditLabel = a ? a.name : "Ledger Account (other)";
                } else {
                  creditLabel = `${costClrAcct?.name ?? "Cost Clearing"} — freight`;
                }
                return (
                  <div key={idx} className="grid grid-cols-3 text-xs py-0.5 text-muted-foreground">
                    <span className="col-span-2 pl-4">{creditLabel} (Cr){c.description ? ` — ${c.description}` : ""}</span>
                    <span className="text-right tabular-nums">{fmt2(amt)}</span>
                  </div>
                );
              })}
              {activeCharges.length === 0 && (
                <div className="grid grid-cols-3 text-xs py-0.5 text-muted-foreground">
                  <span className="col-span-2 pl-4">No landed charges (Cr will equal base cost)</span>
                  <span className="text-right tabular-nums">—</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate(`/sp/containers/${containerId}`)}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={offloadMutation.isPending} data-testid="button-sp-confirm-offload">
          {offloadMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Confirm Offload
        </Button>
      </div>
    </div>
  );
}
