import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2, Info, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { factoryApiRequest } from "@/lib/factoryApi";
import { formatNumber } from "@/lib/formatNumber";
import type { FactorySupplier } from "@shared/schema";

type OtherChargeLine = { description: string; amount: string; currencyCode: string; ledgerAccountId: string };

export default function FactoryContainerCreate() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    containerNumber: "",
    supplierId: "",
    notes: "",
    commissionAmount: "",
    commissionCurrencyCode: "USD",
    commissionSupplierId: "",
    commissionNotes: "",
    freight: "",
    freightAccountId: "",
    freightCurrencyCode: "USD",
  });

  const [currency, setCurrency] = useState("USD");
  const [totalKg, setTotalKg] = useState("");
  const [ratePerKg, setRatePerKg] = useState("");
  const [otherChargeLines, setOtherChargeLines] = useState<OtherChargeLine[]>([]);

  const updateOtherChargeLine = (idx: number, field: keyof OtherChargeLine, value: string) => {
    setOtherChargeLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };
  const removeOtherChargeLine = (idx: number) => {
    setOtherChargeLines(prev => prev.filter((_, i) => i !== idx));
  };

  useEffect(() => {
    setFormData(f => ({ ...f, commissionCurrencyCode: currency, freightCurrencyCode: currency }));
  }, [currency]);

  const { data: suppliers } = useQuery<FactorySupplier[]>({
    queryKey: ["/api/factory/suppliers"],
  });

  const { data: ledgerAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger-accounts"],
  });

  const activeSuppliers = suppliers?.filter(s => s.isActive) ?? [];

  const selectedSupplier = formData.supplierId
    ? activeSuppliers.find(s => s.id === parseInt(formData.supplierId)) ?? null
    : null;

  // Auto-derive broker from supplier's parentId (true broker balance model)
  const linkedBroker = selectedSupplier?.parentId
    ? activeSuppliers.find(s => s.id === selectedSupplier.parentId) ?? null
    : null;

  // When supplier changes: if it has a linked broker, auto-set commissionSupplierId
  useEffect(() => {
    if (selectedSupplier?.parentId) {
      setFormData(f => ({ ...f, commissionSupplierId: String(selectedSupplier.parentId) }));
    }
    // If supplier has no parent, clear any previously auto-set broker only if it was auto-derived
    // (we leave manually-chosen broker intact when supplier has no parent)
  }, [selectedSupplier?.id, selectedSupplier?.parentId]);

  // For the standalone broker selector (when supplier has no parent), show all top-level suppliers
  const brokerIdNum = formData.commissionSupplierId ? parseInt(formData.commissionSupplierId) : null;
  const selectedBroker = brokerIdNum
    ? activeSuppliers.find(s => s.id === brokerIdNum) ?? null
    : null;

  // Suppliers to show: when a broker is manually chosen, show their linked suppliers + standalones
  const filteredSupplierList = brokerIdNum && !selectedSupplier?.parentId
    ? activeSuppliers.filter(s => s.parentId === brokerIdNum || !s.parentId)
    : activeSuppliers;

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        containerNumber: formData.containerNumber,
        supplierId: formData.supplierId ? parseInt(formData.supplierId) : null,
        notes: formData.notes || null,
        status: "PENDING",
        currencyCode: currency,
        fxRateToUsd: "1",
        fxRateSource: "manual",
        totalKg: totalKg || null,
        ratePerKg: ratePerKg || null,
        commissionAmount: formData.commissionAmount || "0",
        commissionCurrencyCode: formData.commissionCurrencyCode || currency,
        commissionSupplierId: formData.commissionSupplierId ? parseInt(formData.commissionSupplierId) : null,
        commissionNotes: formData.commissionNotes || null,
        freight: formData.freight || "0",
        freightCurrencyCode: formData.freightCurrencyCode || currency,
        freightAccountId: formData.freightAccountId ? parseInt(formData.freightAccountId) : null,
        otherCharges: "0",
        otherChargesAccountId: null,
      };
      const res = await factoryApiRequest("POST", "/api/factory/containers", payload);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create container");
      }
      const container = await res.json();
      const validLines = otherChargeLines.filter(l => l.description && parseFloat(l.amount || "0") > 0);
      if (validLines.length > 0) {
        await factoryApiRequest("POST", `/api/factory/containers/${container.id}/other-charges/sync`, {
          charges: validLines.map(l => ({
            description: l.description,
            amount: l.amount,
            currencyCode: l.currencyCode || currency,
            ledgerAccountId: l.ledgerAccountId ? parseInt(l.ledgerAccountId) : null,
          })),
        });
      }
      return container;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
      const hasCommission = parseFloat(formData.commissionAmount || "0") > 0;
      toast({
        title: "Container created",
        description: hasCommission
          ? "Container created and commission account set up automatically."
          : "Container created successfully.",
      });
      navigate("/factory/containers");
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const canSubmit = !!formData.containerNumber && !createMutation.isPending;

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/factory/containers")}
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Add Factory Container</h1>
          <p className="text-sm text-muted-foreground">Track a new incoming factory container</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Basic</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Container Number <span className="text-destructive">*</span></Label>
            <Input
              value={formData.containerNumber}
              onChange={e => setFormData({ ...formData, containerNumber: e.target.value })}
              placeholder="e.g., CNTR-2024-001"
              data-testid="input-container-number"
            />
          </div>
          <div>
            <Label>Notes <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
            <Input
              value={formData.notes}
              onChange={e => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Additional notes"
              data-testid="input-container-notes"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Supplier &amp; Broker</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Purchase Supplier — always shown first */}
          <div>
            <Label>Purchase Supplier</Label>
            <Select
              value={formData.supplierId || "__none__"}
              onValueChange={val => setFormData({ ...formData, supplierId: val === "__none__" ? "" : val })}
            >
              <SelectTrigger data-testid="select-container-supplier">
                <SelectValue placeholder="Select supplier..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {filteredSupplierList.map(s => (
                  <SelectItem key={s.id} value={s.id.toString()}>
                    {s.name}{s.parentId ? " (linked)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Broker section: auto-derived when supplier has a linked broker */}
          {linkedBroker ? (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-muted-foreground">
                Linked Broker:{" "}
                <span className="font-medium text-foreground">{linkedBroker.name}</span>
              </span>
            </div>
          ) : formData.supplierId ? (
            /* Supplier selected but no linked broker — show optional broker selector */
            <div>
              <Label>Broker / Commission To <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
              <Select
                value={formData.commissionSupplierId || "__none__"}
                onValueChange={val => {
                  const newBroker = val === "__none__" ? "" : val;
                  setFormData(f => ({ ...f, commissionSupplierId: newBroker }));
                }}
              >
                <SelectTrigger data-testid="select-container-broker">
                  <SelectValue placeholder="Select broker..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {activeSuppliers.filter(s => !s.parentId && s.id !== parseInt(formData.supplierId || "0")).map(s => (
                    <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Money &amp; Commission</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Total Kg</Label>
              <Input
                type="number"
                value={totalKg}
                onChange={e => setTotalKg(e.target.value)}
                placeholder="0.000"
                data-testid="input-container-total-kg"
              />
            </div>
            <div>
              <Label>Rate per Kg</Label>
              <Input
                type="number"
                value={ratePerKg}
                onChange={e => setRatePerKg(e.target.value)}
                placeholder="0.00"
                data-testid="input-container-rate"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Currency</Label>
              <Select value={currency} onValueChange={val => setCurrency(val)}>
                <SelectTrigger data-testid="select-container-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="AUD">AUD</SelectItem>
                  <SelectItem value="LBP">LBP</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Commission Amount</Label>
              <Input
                type="number"
                value={formData.commissionAmount}
                onChange={e => setFormData({ ...formData, commissionAmount: e.target.value })}
                placeholder="0.00"
                data-testid="input-container-commission"
              />
            </div>
            <div>
              <Label>Commission Currency</Label>
              <Select
                value={formData.commissionCurrencyCode}
                onValueChange={val => setFormData({ ...formData, commissionCurrencyCode: val })}
              >
                <SelectTrigger data-testid="select-commission-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="AUD">AUD</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="LBP">LBP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Commission Notes <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
            <Input
              value={formData.commissionNotes}
              onChange={e => setFormData({ ...formData, commissionNotes: e.target.value })}
              placeholder="e.g. Commission for container facilitation"
              data-testid="input-commission-notes"
            />
          </div>

          {selectedBroker && parseFloat(formData.commissionAmount || "0") > 0 && (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm flex items-start gap-2 text-muted-foreground">
              <Info className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
              <span>
                A commission account for <strong className="text-foreground">{selectedBroker.name}</strong> will be automatically created or reused in your accounts.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Freight &amp; Other Charges</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Freight Amount <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
              <Input
                type="number"
                value={formData.freight}
                onChange={e => setFormData({ ...formData, freight: e.target.value })}
                placeholder="0.00"
                data-testid="input-container-freight"
              />
            </div>
            <div>
              <Label>Freight Currency</Label>
              <Select
                value={formData.freightCurrencyCode}
                onValueChange={val => setFormData({ ...formData, freightCurrencyCode: val })}
              >
                <SelectTrigger data-testid="select-freight-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="AUD">AUD</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="LBP">LBP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Freight Account <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
            <Select
              value={formData.freightAccountId || "__none__"}
              onValueChange={val => setFormData({ ...formData, freightAccountId: val === "__none__" ? "" : val })}
            >
              <SelectTrigger data-testid="select-freight-account">
                <SelectValue placeholder="Auto (Freight)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Auto (Freight)</SelectItem>
                {ledgerAccounts.map((acc: any) => (
                  <SelectItem key={acc.id} value={String(acc.id)}>
                    {acc.name}{acc.code ? ` (${acc.code})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>Other Charges <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => setOtherChargeLines(prev => [...prev, { description: "", amount: "", currencyCode: currency, ledgerAccountId: "" }])}
                data-testid="button-add-other-charge"
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Line
              </Button>
            </div>
            {otherChargeLines.length === 0 && (
              <p className="text-xs text-muted-foreground py-1">No other charges. Click "Add Line" to add one.</p>
            )}
            {otherChargeLines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-[2fr_1fr_auto_2fr_auto] gap-2 items-end">
                <div>
                  {idx === 0 && <Label className="text-xs text-muted-foreground">Description</Label>}
                  <Input
                    value={line.description}
                    onChange={e => updateOtherChargeLine(idx, "description", e.target.value)}
                    placeholder="e.g. Port handling"
                    data-testid={`input-other-charge-description-${idx}`}
                  />
                </div>
                <div>
                  {idx === 0 && <Label className="text-xs text-muted-foreground">Amount</Label>}
                  <Input
                    type="number"
                    value={line.amount}
                    onChange={e => updateOtherChargeLine(idx, "amount", e.target.value)}
                    placeholder="0.00"
                    data-testid={`input-other-charge-amount-${idx}`}
                  />
                </div>
                <div>
                  {idx === 0 && <Label className="text-xs text-muted-foreground">CCY</Label>}
                  <Select
                    value={line.currencyCode || currency}
                    onValueChange={val => updateOtherChargeLine(idx, "currencyCode", val)}
                  >
                    <SelectTrigger className="w-20" data-testid={`select-other-charge-currency-${idx}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="AUD">AUD</SelectItem>
                      <SelectItem value="LBP">LBP</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  {idx === 0 && <Label className="text-xs text-muted-foreground">Account (optional)</Label>}
                  <Select
                    value={line.ledgerAccountId || "__none__"}
                    onValueChange={val => updateOtherChargeLine(idx, "ledgerAccountId", val === "__none__" ? "" : val)}
                  >
                    <SelectTrigger data-testid={`select-other-charge-account-${idx}`}>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {ledgerAccounts.map((acc: any) => (
                        <SelectItem key={acc.id} value={String(acc.id)}>
                          {acc.name}{acc.code ? ` (${acc.code})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  {idx === 0 && <div className="h-4" />}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => removeOtherChargeLine(idx)}
                    data-testid={`button-remove-other-charge-${idx}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            {otherChargeLines.length > 0 && (
              <div className="text-xs text-muted-foreground text-right pt-1 space-y-0.5">
                {(() => {
                  const totals: Record<string, number> = {};
                  for (const l of otherChargeLines) {
                    const cc = l.currencyCode || currency;
                    totals[cc] = (totals[cc] || 0) + parseFloat(l.amount || "0");
                  }
                  return Object.entries(totals).map(([cc, amt]) => (
                    <div key={cc}>Total: {cc} {formatNumber(amt)}</div>
                  ));
                })()}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3 pb-6">
        <Button
          variant="outline"
          onClick={() => navigate("/factory/containers")}
          data-testid="button-cancel"
        >
          Cancel
        </Button>
        <Button
          onClick={() => createMutation.mutate()}
          disabled={!canSubmit}
          data-testid="button-create-container"
        >
          {createMutation.isPending ? "Creating..." : "Create Container"}
        </Button>
      </div>
    </div>
  );
}
