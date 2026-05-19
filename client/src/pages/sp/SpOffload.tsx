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
import { Loader2, ArrowLeft, Plus, Trash2, AlertCircle, CheckCircle2, AlertTriangle } from "lucide-react";

function formatUsd(v: any) {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? "$0.00" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}
function fmt2(v: any) {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? "$0.00" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const CHARGE_TYPES = [
  { value: "prepaid_used",    label: "Prepaid Used" },
  { value: "paid_now",        label: "Paid Now (Cash/Bank)" },
  { value: "unpaid_payable",  label: "Unpaid Payable" },
  { value: "invoice_freight", label: "Invoice Freight" },
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

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/sp/containers/${containerId}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Offload Container</h1>
          <p className="text-sm text-muted-foreground">{container.supplierName} · {container.invoiceNumber}</p>
        </div>
      </div>

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Container Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><p className="text-xs text-muted-foreground">Total Qty</p><p className="font-semibold">{totalQty.toFixed(2)}</p></div>
          <div><p className="text-xs text-muted-foreground">Base Cost</p><p className="font-semibold">{fmt2(totalBaseCost)}</p></div>
          <div><p className="text-xs text-muted-foreground">Landed Total</p><p className="font-semibold">{fmt2(totalLandedCost)}</p></div>
          <div><p className="text-xs text-muted-foreground">Landed/Unit</p><p className="font-semibold">{fmt2(landedPerUnit)}</p></div>
        </CardContent>
      </Card>

      {/* Per-line preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Final Cost Preview (per line)</CardTitle>
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
                  <span className="text-right tabular-nums">{formatUsd(baseU)}</span>
                  <span className="text-right tabular-nums text-orange-600">{formatUsd(landedPerUnit)}</span>
                  <span className="text-right tabular-nums font-semibold">{formatUsd(finalU)}</span>
                </div>
              );
            })}
          </div>
          {(container.lines || []).some((l: any) => !aliasMap.has(l.articleCode)) && (
            <p className="text-xs text-amber-600 flex items-center gap-1.5 pt-1">
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
              <CardDescription className="text-xs">Define each charge and its credit source</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={addCharge} data-testid="button-sp-add-charge">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Charge
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {chargeLines.map((charge, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-end p-2 border border-border rounded-md" data-testid={`row-sp-charge-${idx}`}>
              {/* Type */}
              <div className="col-span-3">
                <label className="text-xs text-muted-foreground">Type</label>
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
                <label className="text-xs text-muted-foreground">Description</label>
                <Input className="h-8 text-xs" value={charge.description} onChange={e => updateCharge(idx, "description", e.target.value)} data-testid={`input-sp-charge-desc-${idx}`} />
              </div>
              {/* Amount */}
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">Amount $</label>
                <Input type="number" step="0.01" className="h-8 text-xs" value={charge.amountUsd} onChange={e => updateCharge(idx, "amountUsd", e.target.value)} data-testid={`input-sp-charge-amount-${idx}`} />
              </div>
              {/* Source */}
              <div className="col-span-3">
                <label className="text-xs text-muted-foreground">
                  {charge.chargeType === "prepaid_used" ? "Prepaid Charge" :
                    charge.chargeType === "paid_now" ? "Bank Account" :
                    charge.chargeType === "unpaid_payable" ? "Payable Account" : "Auto (OTW Clearing)"}
                </label>
                {charge.chargeType === "prepaid_used" ? (
                  <Select value={charge.prepaidChargeId} onValueChange={v => updateCharge(idx, "prepaidChargeId", v)}>
                    <SelectTrigger className="h-8 text-xs" data-testid={`select-sp-prepaid-charge-${idx}`}>
                      <SelectValue placeholder="Select prepaid" />
                    </SelectTrigger>
                    <SelectContent>
                      {(container.prepaid || []).map((p: any) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.chargeType} — {formatUsd(p.amountPaidUsd)}
                        </SelectItem>
                      ))}
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
                      <SelectValue placeholder="Select account" />
                    </SelectTrigger>
                    <SelectContent>
                      {(ledgerAccounts as any[]).filter((a: any) => a.accountType === "Liability" || a.accountType === "Accounts Payable").map((a: any) => (
                        <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="h-8 flex items-center">
                    <Badge variant="secondary" className="text-xs">Auto → SP-COSTCLR</Badge>
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
            <p className="text-sm text-muted-foreground">No charges added. All landed cost will be zero.</p>
          )}
        </CardContent>
      </Card>

      {/* Summary before confirm */}
      <Card>
        <CardContent className="pt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><p className="text-xs text-muted-foreground">Total Base Cost</p><p className="font-semibold">{fmt2(totalBaseCost)}</p></div>
          <div><p className="text-xs text-muted-foreground">Total Landed</p><p className="font-semibold">{fmt2(totalLandedCost)}</p></div>
          <div><p className="text-xs text-muted-foreground">Total Final Cost</p><p className="font-semibold">{fmt2(totalFinalCost)}</p></div>
          <div><p className="text-xs text-muted-foreground">OTW Reversal</p><p className="font-semibold">{fmt2(container.invoiceTotalUsd)}</p></div>
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
