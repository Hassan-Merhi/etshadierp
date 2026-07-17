import { useState, useMemo, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { factoryApiRequest } from "@/lib/factoryApi";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Plus, X, Gavel, Info, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { formatNumber } from "@/lib/formatNumber";
import { AccountCombobox } from "./ProductionRawStockHelpers";

interface OffloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableContainers: any[];
  factorySuppliers: any[];
  ledgerAccounts: any[];
  offloadMutation: any;
  wrapAdminAction: (action: () => void, title: string) => void;
  mixBatches: any[];
}

export function OffloadDialog({
  open,
  onOpenChange,
  availableContainers,
  factorySuppliers,
  ledgerAccounts,
  offloadMutation,
  wrapAdminAction,
  mixBatches,
}: OffloadDialogProps) {
  const { toast } = useToast();
  // Idempotency key is generated lazily on first submit and reused on retries.
  // Reset when the dialog closes or when the user selects a different container.
  const idempotencyKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) idempotencyKeyRef.current = null;
  }, [open]);
  const [offloadDate, setOffloadDate] = useState<string>(new Date().toLocaleDateString("en-CA"));
  const [offloadDestination, setOffloadDestination] = useState("");
  const [selectedContainerId, setSelectedContainerId] = useState("");
  const [actualReceivedKg, setActualReceivedKg] = useState("");
  const [costPerKg, setCostPerKg] = useState("");
  const [currencyCode, setCurrencyCode] = useState("USD");
  const [fxRateToUsd, setFxRateToUsd] = useState("1");
  const [freight, setFreight] = useState("");
  const [freightAccountId, setFreightAccountId] = useState("");
  const [freightCurrencyCode, setFreightCurrencyCode] = useState("USD");
  const [freightFxRate, setFreightFxRate] = useState("1");
  const [freightFromContainer, setFreightFromContainer] = useState(false);
  const [freightFxRateLoading, setFreightFxRateLoading] = useState(false);
  const [otherCharges, setOtherCharges] = useState("");
  const [otherChargesAccountId, setOtherChargesAccountId] = useState("");
  const [otherChargesCurrencyCode, setOtherChargesCurrencyCode] = useState("USD");
  const [otherChargesFxRate, setOtherChargesFxRate] = useState("1");
  const [otherChargesFromContainer, setOtherChargesFromContainer] = useState(false);
  const [otherChargesFxRateLoading, setOtherChargesFxRateLoading] = useState(false);
  const [commissionFromContainer, setCommissionFromContainer] = useState(false);
  const [containerCommissionCcy, setContainerCommissionCcy] = useState("USD");
  const [commissionPersonName, setCommissionPersonName] = useState("");
  const [commissionType, setCommissionType] = useState<"PER_KG" | "FIXED">("PER_KG");
  const [commissionRate, setCommissionRate] = useState("");
  const [commissionLedgerAccountId, setCommissionLedgerAccountId] = useState("");
  // Commission-specific FX rate — kept independent from the container's material FX so a
  // EUR commission on an AUD container uses EUR/USD (1.18), not AUD/USD (0.67).
  const [commissionFxRate, setCommissionFxRate] = useState("1");
  const [commissionFxRateLoading, setCommissionFxRateLoading] = useState(false);
  const [commissionFxEffectiveDate, setCommissionFxEffectiveDate] = useState<string | null>(null);
  const [dutyAmount, setDutyAmount] = useState("");
  const [dutyAccountId, setDutyAccountId] = useState("");
  const [dutyPending, setDutyPending] = useState(false);
  const [dutyNotes, setDutyNotes] = useState("");
  const [additionalCharges, setAdditionalCharges] = useState<any[]>([]);
  const [mixBatchAllocations, setMixBatchAllocations] = useState<any[]>([]);

  const selectedContainer = useMemo(() => {
    return availableContainers?.find((c) => c.id.toString() === selectedContainerId);
  }, [availableContainers, selectedContainerId]);

  /** True when the selected container already has a partial receipt — charges are locked. */
  const isSubsequentReceipt = selectedContainer?.status === "PARTIALLY_RECEIVED";

  /** Breakdown info for PARTIALLY_RECEIVED containers. */
  const partialReceiptInfo = useMemo(() => {
    if (!isSubsequentReceipt || !selectedContainer) return null;
    const declared = parseFloat(selectedContainer.totalKg || "0");
    const alreadyReceived = parseFloat(selectedContainer.actualReceivedKg || "0");
    const remaining = Math.max(0, declared - alreadyReceived);
    return { declared, alreadyReceived, remaining };
  }, [isSubsequentReceipt, selectedContainer]);

  /** Live receipt value for subsequent receipts — receivingNow × fixedCostPerKgUsd (USD). */
  const receiptValue = useMemo(() => {
    if (!isSubsequentReceipt || !selectedContainer) return null;
    const kg = parseFloat(actualReceivedKg || "0");
    const rate = parseFloat((selectedContainer as any).fixedCostPerKgUsd || "0");
    if (!kg || !rate) return null;
    return kg * rate;
  }, [isSubsequentReceipt, selectedContainer, actualReceivedKg]);

  // Auto-fetch the live USD exchange rate whenever the freight currency is changed
  // away from USD (and isn't already pinned to the container's own fx rate). Without
  // this, entering e.g. a EUR freight amount with fxRate left at "1" would post it to
  // the ledger as if it were already USD, silently overstating (or understating) the
  // landed cost — mirrors the same auto-fetch on FactoryContainerCreate.tsx.
  useEffect(() => {
    if (freightFromContainer) return;
    if (freightCurrencyCode === "USD") {
      setFreightFxRate("1");
      return;
    }
    setFreightFxRateLoading(true);
    factoryApiRequest("GET", `/api/factory/fx-rates/latest/${freightCurrencyCode}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.rate) setFreightFxRate(String(data.rate));
      })
      .catch(() => {})
      .finally(() => setFreightFxRateLoading(false));
  }, [freightCurrencyCode, freightFromContainer]);

  // Same auto-fetch for Other Charges currency.
  useEffect(() => {
    if (otherChargesFromContainer) return;
    if (otherChargesCurrencyCode === "USD") {
      setOtherChargesFxRate("1");
      return;
    }
    setOtherChargesFxRateLoading(true);
    factoryApiRequest("GET", `/api/factory/fx-rates/latest/${otherChargesCurrencyCode}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.rate) setOtherChargesFxRate(String(data.rate));
      })
      .catch(() => {})
      .finally(() => setOtherChargesFxRateLoading(false));
  }, [otherChargesCurrencyCode, otherChargesFromContainer]);

  // Auto-fetch commission FX when commission currency differs from both USD and the
  // container currency.  A EUR commission on an AUD container must use EUR/USD (1.18),
  // not the container's AUD/USD rate (0.67).
  useEffect(() => {
    const commCcy = containerCommissionCcy.toUpperCase();
    const containerCcy = currencyCode.toUpperCase();
    if (commCcy === "USD") {
      setCommissionFxRate("1");
      setCommissionFxEffectiveDate(null);
      return;
    }
    if (commCcy === containerCcy) {
      // Same currency as container — reuse the already-resolved container FX
      setCommissionFxRate(fxRateToUsd || "1");
      setCommissionFxEffectiveDate(null);
      return;
    }
    // Different non-USD currency — resolve independently
    setCommissionFxRateLoading(true);
    factoryApiRequest("GET", `/api/factory/fx-rates/latest/${commCcy}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.rate) {
          setCommissionFxRate(String(data.rate));
          setCommissionFxEffectiveDate(data.date ?? null);
        }
      })
      .catch(() => {})
      .finally(() => setCommissionFxRateLoading(false));
  }, [containerCommissionCcy, currencyCode, fxRateToUsd]);

  const handleContainerSelect = (id: string) => {
    setSelectedContainerId(id);
    const container = availableContainers?.find((c) => c.id.toString() === id);
    if (!container) return;

    const ccy = container.currencyCode || "USD";
    setCurrencyCode(ccy);
    setFxRateToUsd(container.fxRateToUsd || "1");
    setCostPerKg(container.ratePerKg || "");

    // For PARTIALLY_RECEIVED containers the charges were posted at first offload.
    // Default the received-kg field to the remaining amount instead of the full declared weight.
    if (container.status === "PARTIALLY_RECEIVED") {
      const declared = parseFloat(container.totalKg || "0");
      const alreadyReceived = parseFloat(container.actualReceivedKg || "0");
      const remaining = Math.max(0, declared - alreadyReceived);
      setActualReceivedKg(String(remaining.toFixed(3)));
      // For continuation receipts, pre-fill the fixed landed rate from raw stock (informational —
      // the server uses the DB rate; the field is disabled so the user cannot override it).
      setCostPerKg((container as any).fixedCostPerKgUsd || container.ratePerKg || "");
      // Clear charge fields — they are locked for subsequent receipts
      setFreight(""); setFreightAccountId(""); setFreightFromContainer(false);
      setOtherCharges(""); setOtherChargesAccountId(""); setOtherChargesFromContainer(false);
      setCommissionPersonName(""); setCommissionRate(""); setCommissionFromContainer(false);
      setDutyAmount(""); setDutyAccountId(""); setDutyPending(false);
      setAdditionalCharges([]);
      idempotencyKeyRef.current = null; // reset key on new container selection
      return;
    }

    setActualReceivedKg(container.totalKg || "");

    const freightVal = parseFloat(container.freight || "0");
    setFreight(freightVal > 0 ? String(freightVal) : "");
    setFreightFromContainer(freightVal > 0);
    const effectiveFreightCcy = container.freightCurrencyCode || ccy;
    setFreightCurrencyCode(effectiveFreightCcy);
    setFreightFxRate(effectiveFreightCcy === "USD" ? "1" : container.fxRateToUsd || "1");
    if (container.freightSupplierId) setFreightAccountId(`SUP:${container.freightSupplierId}`);
    else if (container.freightAccountId) setFreightAccountId(String(container.freightAccountId));

    const ocVal = parseFloat(container.otherCharges || "0");
    setOtherCharges(ocVal > 0 ? String(ocVal) : "");
    setOtherChargesFromContainer(ocVal > 0);
    setOtherChargesCurrencyCode(ccy);
    setOtherChargesFxRate(ccy === "USD" ? "1" : container.fxRateToUsd || "1");
    if (container.otherChargesSupplierId) setOtherChargesAccountId(`SUP:${container.otherChargesSupplierId}`);
    else if (container.otherChargesAccountId) setOtherChargesAccountId(String(container.otherChargesAccountId));

    const commAmt = parseFloat(container.commissionAmount || "0");
    if (commAmt > 0) {
      setCommissionType("FIXED");
      setCommissionRate(String(commAmt));
      setCommissionFromContainer(true);
      const commCcy = (container.commissionCurrencyCode || ccy).toUpperCase();
      setContainerCommissionCcy(commCcy);
      const broker = container.commissionSupplierId
        ? factorySuppliers?.find((s: any) => s.id === container.commissionSupplierId)
        : null;
      setCommissionPersonName(broker?.name || "Commission");
      // Initialize commission FX: prefer the container's stored commission-specific rate,
      // then fall back to container material FX (valid only when same currency).
      const storedCommFx = parseFloat((container as any).commissionFxRateToUsd || "");
      const storedCommFxConfirmed = (container as any).commissionFxRateConfirmed === true;
      if (commCcy === "USD") {
        setCommissionFxRate("1");
      } else if (Number.isFinite(storedCommFx) && storedCommFx > 0 && storedCommFxConfirmed) {
        setCommissionFxRate(String(storedCommFx));
      } else if (commCcy === ccy.toUpperCase()) {
        // Same currency as container — container FX applies
        setCommissionFxRate(container.fxRateToUsd || "1");
      } else {
        // Different non-USD currency: will be fetched by the useEffect below
        setCommissionFxRate("");
      }
    }
  };

  const parseAccountValue = (val: string) => {
    if (!val) return null;
    if (val.startsWith("SUP:")) return { type: "supplier", id: parseInt(val.split(":")[1]) };
    return { type: "ledger", id: parseInt(val) };
  };

  const handleSubmit = () => {
    if (!selectedContainerId) return;
    const dutyStatus = dutyPending ? "PENDING" : parseFloat(dutyAmount || "0") > 0 ? "CONFIRMED" : "NONE";
    const fxRate = parseFloat(fxRateToUsd || "1");

    const payload: any = {
      containerId: selectedContainerId,
      offloadDate,
      destination: offloadDestination.trim() || null,
      receivedKg: actualReceivedKg,
      costPerKg,
      currencyCode,
      fxRateToUsd,
      freight: freight || "0",
      freightCurrencyCode,
      freightFxRate,
      ...(() => {
        const p = parseAccountValue(freightAccountId);
        return p?.type === "supplier" ? { freightSupplierId: p.id } : { freightAccountId: p?.id ?? null };
      })(),
      ...(() => {
        const p = parseAccountValue(otherChargesAccountId);
        return p?.type === "supplier"
          ? {
              otherChargesSupplierId: p.id,
              otherCharges: otherCharges || "0",
              otherChargesCurrencyCode,
              otherChargesFxRate,
            }
          : {
              otherChargesAccountId: p?.id ?? null,
              otherCharges: otherCharges || "0",
              otherChargesCurrencyCode,
              otherChargesFxRate,
            };
      })(),
      dutyAmount: (() => {
        const rawAmt = parseFloat(dutyAmount || "0");
        if (rawAmt === 0) return "0";
        if (currencyCode === "USD") return dutyAmount || "0";
        return String(rawAmt / (fxRate || 1));
      })(),
      dutyAccountId: dutyAccountId ? parseInt(dutyAccountId) : null,
      dutyStatus,
      dutyNotes: dutyNotes || null,
      additionalCharges: additionalCharges
        .filter((c) => parseFloat(c.amount || "0") > 0)
        .map((c) => {
          const p = parseAccountValue(c.ledgerAccountId);
          return {
            description: c.description || "Additional Charge",
            amount: c.amount,
            currencyCode: c.currencyCode || "USD",
            ledgerAccountId: p?.type === "ledger" ? p.id : null,
            supplierId: p?.type === "supplier" ? p.id : null,
          };
        }),
      mixBatchAllocations: mixBatchAllocations
        .filter((a) => a.mixBatchId && parseFloat(a.weightKg || "0") > 0)
        .map((a) => ({
          mixBatchId: parseInt(a.mixBatchId),
          weightKg: a.weightKg,
        })),
    };

    if (commissionPersonName.trim() && parseFloat(commissionRate || "0") > 0) {
      const commCcy = (commissionFromContainer ? containerCommissionCcy : "USD").toUpperCase();
      payload.commission = {
        personName: commissionPersonName.trim(),
        commissionType,
        commissionRate,
        currencyCode: commCcy,
        // Always send the commission-specific FX rate, not the container's material FX.
        // The server validates/resolves this independently and is the authoritative source.
        fxRateToUsd: commCcy === "USD" ? "1" : commissionFxRate,
        fxRateDate: commissionFxEffectiveDate,
        ledgerAccountId: commissionLedgerAccountId || null,
      };
    }

    // Generate idempotency key lazily on first submit; reuse on retries until dialog closes.
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }
    payload.idempotencyKey = idempotencyKeyRef.current;

    offloadMutation.mutate(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-emerald-600" />
            Offload Container
          </DialogTitle>
          <DialogDescription>
            Register received weight and link container costs to production raw stock.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Select Container</Label>
              <Select value={selectedContainerId} onValueChange={handleContainerSelect}>
                <SelectTrigger>
                  <SelectValue placeholder="Select container..." />
                </SelectTrigger>
                <SelectContent>
                  {availableContainers?.filter((c) => c.status !== "PARTIALLY_RECEIVED").map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.containerNumber} ({c.totalKg} kg — {c.supplierName})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Offload Date</Label>
              <Input type="date" value={offloadDate} onChange={(e) => setOffloadDate(e.target.value)} />
            </div>
          </div>

          {/* Subsequent receipt info banner */}
          {isSubsequentReceipt && partialReceiptInfo && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-blue-700 font-semibold text-sm">
                <Info className="h-4 w-4" />
                Subsequent Receipt — Partial Container
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm text-blue-800">
                <span>Declared: <strong>{formatNumber(partialReceiptInfo.declared)} kg</strong></span>
                <span>Already received: <strong>{formatNumber(partialReceiptInfo.alreadyReceived)} kg</strong></span>
                <span>Remaining: <strong>{formatNumber(partialReceiptInfo.remaining)} kg</strong></span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm text-blue-800">
                <span>Fixed Landed Cost/KG (USD): <strong>{selectedContainer?.fixedCostPerKgUsd ? formatNumber(parseFloat(selectedContainer.fixedCostPerKgUsd), 6) : "—"} USD/kg</strong></span>
                <span>Value of This Receipt: <strong>{receiptValue != null ? `${formatNumber(receiptValue, 2)} USD` : "—"}</strong></span>
              </div>
              <p className="text-xs text-blue-600 flex items-center gap-1">
                <Lock className="h-3 w-3" />
                Freight, charges, and commission are locked — they were posted on the first receipt. Only the received weight applies here.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Received Weight (KG){isSubsequentReceipt && partialReceiptInfo ? ` (max ${formatNumber(partialReceiptInfo.remaining)} kg remaining)` : ""}</Label>
              <Input
                type="number"
                step="0.001"
                value={actualReceivedKg}
                onChange={(e) => setActualReceivedKg(e.target.value)}
                placeholder="0.000"
              />
            </div>
            <div className="space-y-2">
              <Label>Base Cost per KG ({currencyCode})</Label>
              <Input
                type="number"
                step="0.0001"
                value={costPerKg}
                onChange={(e) => setCostPerKg(e.target.value)}
                placeholder="0.0000"
                disabled={isSubsequentReceipt}
              />
              {isSubsequentReceipt && (
                <p className="text-xs text-muted-foreground">Rate established at first offload — not editable here.</p>
              )}
            </div>
          </div>

          {isSubsequentReceipt ? (
            <div className="rounded-lg border border-muted bg-muted/30 p-4 text-sm text-muted-foreground flex items-center gap-2">
              <Lock className="h-4 w-4 shrink-0" />
              Freight, other charges, commission, duty, and additional charges were recorded on the first receipt and are not re-posted here. The fixed landed cost/kg ({selectedContainer?.currencyCode}) already covers the full container.
            </div>
          ) : (
          <>
          <Separator />
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <h3 className="font-semibold text-sm">Freight & Other Charges</h3>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <div className="space-y-2">
                  <Label>Freight Cost</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={freight}
                    onChange={(e) => setFreight(e.target.value)}
                    disabled={freightFromContainer}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Select value={freightCurrencyCode} onValueChange={setFreightCurrencyCode} disabled={freightFromContainer}>
                    <SelectTrigger className="w-24">
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
              {freightCurrencyCode !== "USD" && (
                <p className="text-xs text-muted-foreground -mt-2">
                  {freightFxRateLoading
                    ? "Fetching current exchange rate…"
                    : parseFloat(freightFxRate) > 0
                      ? `1 ${freightCurrencyCode} = ${formatNumber(parseFloat(freightFxRate))} USD — freight will be posted to the ledger in USD.`
                      : "Exchange rate unavailable — enter it manually to convert this charge to USD."}
                </p>
              )}
              <div className="space-y-2">
                <Label>Freight Account</Label>
                <AccountCombobox
                  value={freightAccountId}
                  onValueChange={setFreightAccountId}
                  accounts={ledgerAccounts}
                  suppliers={factorySuppliers}
                  disabled={freightFromContainer}
                />
              </div>

              <Separator />

              <div className="grid grid-cols-[1fr_auto] gap-2">
                <div className="space-y-2">
                  <Label>Other Charges</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={otherCharges}
                    onChange={(e) => setOtherCharges(e.target.value)}
                    disabled={otherChargesFromContainer}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Select
                    value={otherChargesCurrencyCode}
                    onValueChange={setOtherChargesCurrencyCode}
                    disabled={otherChargesFromContainer}
                  >
                    <SelectTrigger className="w-24">
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
              {otherChargesCurrencyCode !== "USD" && (
                <p className="text-xs text-muted-foreground -mt-2">
                  {otherChargesFxRateLoading
                    ? "Fetching current exchange rate…"
                    : parseFloat(otherChargesFxRate) > 0
                      ? `1 ${otherChargesCurrencyCode} = ${formatNumber(parseFloat(otherChargesFxRate))} USD — other charges will be posted to the ledger in USD.`
                      : "Exchange rate unavailable — enter it manually to convert this charge to USD."}
                </p>
              )}
              <div className="space-y-2">
                <Label>Other Charges Account</Label>
                <AccountCombobox
                  value={otherChargesAccountId}
                  onValueChange={setOtherChargesAccountId}
                  accounts={ledgerAccounts}
                  suppliers={factorySuppliers}
                  disabled={otherChargesFromContainer}
                />
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold text-sm">Duty Details</h3>
              <div className="space-y-2">
                <Label>Duty Amount (USD)</Label>
                <Input type="number" step="0.01" value={dutyAmount} onChange={(e) => setDutyAmount(e.target.value)} />
              </div>
              <div className="flex items-center space-x-2">
                <Switch checked={dutyPending} onCheckedChange={setDutyPending} />
                <Label>Duty Payment Pending</Label>
              </div>
            </div>
          </div>
          </>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => wrapAdminAction(handleSubmit, "Offload Container")}
              disabled={
                offloadMutation.isPending ||
                !selectedContainerId ||
                // Block when a non-USD commission has no resolved commission-specific FX rate
                (commissionFromContainer &&
                  containerCommissionCcy !== "USD" &&
                  containerCommissionCcy !== currencyCode &&
                  (commissionFxRateLoading || !(parseFloat(commissionFxRate) > 0)))
              }
            >
              {offloadMutation.isPending ? "Offloading..." : "Confirm Offload"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
