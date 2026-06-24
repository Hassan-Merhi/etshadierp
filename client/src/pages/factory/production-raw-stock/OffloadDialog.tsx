import { useState, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { Plus, X, Gavel } from "lucide-react";
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
  const [otherCharges, setOtherCharges] = useState("");
  const [otherChargesAccountId, setOtherChargesAccountId] = useState("");
  const [otherChargesCurrencyCode, setOtherChargesCurrencyCode] = useState("USD");
  const [otherChargesFxRate, setOtherChargesFxRate] = useState("1");
  const [otherChargesFromContainer, setOtherChargesFromContainer] = useState(false);
  const [commissionFromContainer, setCommissionFromContainer] = useState(false);
  const [containerCommissionCcy, setContainerCommissionCcy] = useState("USD");
  const [commissionPersonName, setCommissionPersonName] = useState("");
  const [commissionType, setCommissionType] = useState<"PER_KG" | "FIXED">("PER_KG");
  const [commissionRate, setCommissionRate] = useState("");
  const [commissionLedgerAccountId, setCommissionLedgerAccountId] = useState("");
  const [dutyAmount, setDutyAmount] = useState("");
  const [dutyAccountId, setDutyAccountId] = useState("");
  const [dutyPending, setDutyPending] = useState(false);
  const [dutyNotes, setDutyNotes] = useState("");
  const [additionalCharges, setAdditionalCharges] = useState<any[]>([]);
  const [mixBatchAllocations, setMixBatchAllocations] = useState<any[]>([]);

  const selectedContainer = useMemo(() => {
    return availableContainers?.find((c) => c.id.toString() === selectedContainerId);
  }, [availableContainers, selectedContainerId]);

  const handleContainerSelect = (id: string) => {
    setSelectedContainerId(id);
    const container = availableContainers?.find((c) => c.id.toString() === id);
    if (!container) return;

    setActualReceivedKg(container.totalKg || "");
    setCostPerKg(container.ratePerKg || "");
    const ccy = container.currencyCode || "USD";
    setCurrencyCode(ccy);
    setFxRateToUsd(container.fxRateToUsd || "1");

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
      setContainerCommissionCcy(container.commissionCurrencyCode || ccy);
      const broker = container.commissionSupplierId
        ? factorySuppliers?.find((s: any) => s.id === container.commissionSupplierId)
        : null;
      setCommissionPersonName(broker?.name || "Commission");
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
      payload.commission = {
        personName: commissionPersonName.trim(),
        commissionType,
        commissionRate,
        currencyCode: commissionFromContainer ? containerCommissionCcy : "USD",
        fxRateToUsd: (commissionFromContainer ? containerCommissionCcy : "USD") === "USD" ? "1" : fxRateToUsd,
        ledgerAccountId: commissionLedgerAccountId || null,
      };
    }

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
                  {availableContainers?.map((c) => (
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Received Weight (KG)</Label>
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
              />
            </div>
          </div>

          <Separator />
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <h3 className="font-semibold text-sm">Freight & Other Charges</h3>
              <div className="space-y-2">
                <Label>Freight Cost ({freightCurrencyCode})</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={freight}
                  onChange={(e) => setFreight(e.target.value)}
                  disabled={freightFromContainer}
                />
              </div>
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

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => wrapAdminAction(handleSubmit, "Offload Container")}
              disabled={offloadMutation.isPending || !selectedContainerId}
            >
              {offloadMutation.isPending ? "Offloading..." : "Confirm Offload"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
