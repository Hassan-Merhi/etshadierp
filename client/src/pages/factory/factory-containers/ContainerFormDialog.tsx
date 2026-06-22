import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { factoryApiRequest } from "@/lib/factoryApi";
import { enqueueRequest } from "@/lib/offlineQueue";
import { useAdminOverride } from "@/hooks/use-admin-override";
import type { FactorySupplier } from "@shared/schema";
import type { ContainerWithSupplier } from "./otwHelpers";
import { ContainerFormBody } from "./ContainerFormBody";

type FormData = {
  containerNumber: string; supplierId: string; origin: string; totalKg: string;
  ratePerKg: string; arrivalDate: string; notes: string; status: string;
  commissionAmount: string; commissionCurrencyCode: string; commissionAccountId: string;
  commissionSupplierId: string; commissionNotes: string; freight: string;
  freightCurrencyCode: string; freightAccountId: string; freightPaidBy: "supplier" | "own";
  freightOwnAccountId: string; otherCharges: string; otherChargesAccountId: string;
};

type OtherChargeLine = { amount: string; currencyCode: string; ledgerAccountId: string };

const BLANK_FORM: FormData = {
  containerNumber: "", supplierId: "", origin: "", totalKg: "", ratePerKg: "",
  arrivalDate: "", notes: "", status: "PENDING", commissionAmount: "",
  commissionCurrencyCode: "USD", commissionAccountId: "", commissionSupplierId: "",
  commissionNotes: "", freight: "", freightCurrencyCode: "USD", freightAccountId: "",
  freightPaidBy: "supplier", freightOwnAccountId: "", otherCharges: "", otherChargesAccountId: "",
};

interface ContainerFormDialogProps {
  open: boolean;
  editingContainer: ContainerWithSupplier | null;
  suppliers: FactorySupplier[] | undefined;
  ledgerAccounts: any[];
  onClose: () => void;
}

export function ContainerFormDialog({
  open, editingContainer, suppliers, ledgerAccounts, onClose,
}: ContainerFormDialogProps) {
  const { toast } = useToast();
  const { wrapAdminAction, AdminDialog } = useAdminOverride();
  const [formData, setFormData] = useState<FormData>(BLANK_FORM);
  const [currency, setCurrency] = useState("USD");
  const [fxRate, setFxRate] = useState("1");
  const [fxRateSource, setFxRateSource] = useState<"auto" | "manual">("auto");
  const [fxEffectiveDate, setFxEffectiveDate] = useState("");
  const [otherChargeLines, setOtherChargeLines] = useState<OtherChargeLine[]>([]);

  const resetForm = () => {
    setFormData(BLANK_FORM);
    setOtherChargeLines([]);
    setCurrency("USD");
    setFxRate("1");
    setFxRateSource("auto");
    setFxEffectiveDate("");
  };

  useEffect(() => {
    if (!editingContainer) { resetForm(); return; }
    const c = editingContainer as any;
    setFormData({
      containerNumber: c.containerNumber, supplierId: c.supplierId?.toString() || "",
      origin: c.origin || "", totalKg: c.totalKg || "", ratePerKg: c.ratePerKg || "",
      arrivalDate: c.arrivalDate || "", notes: c.notes || "", status: c.status,
      commissionAmount: c.commissionAmount || "", commissionCurrencyCode: c.commissionCurrencyCode || "USD",
      commissionAccountId: c.commissionAccountId ? String(c.commissionAccountId) : "",
      commissionSupplierId: c.commissionSupplierId ? String(c.commissionSupplierId) : "",
      commissionNotes: c.commissionNotes || "", freight: c.freight || "",
      freightCurrencyCode: c.freightCurrencyCode || "USD",
      freightAccountId: c.freightAccountId ? String(c.freightAccountId) : "",
      freightPaidBy: (c.freightPaidBy as "supplier" | "own") || "supplier",
      freightOwnAccountId: c.freightOwnAccountId ? String(c.freightOwnAccountId) : "",
      otherCharges: c.otherCharges || "", otherChargesAccountId: c.otherChargesAccountId ? String(c.otherChargesAccountId) : "",
    });
    setCurrency(c.currencyCode || "USD");
    setFxRate(c.fxRateToUsd || "1");
    setFxRateSource(c.fxRateSource || "auto");
    setFxEffectiveDate(c.fxRateDateImport || "");
  }, [editingContainer]);

  useEffect(() => {
    if (!editingContainer) { setOtherChargeLines([]); return; }
    const containerCcy = (editingContainer as any).currencyCode || "USD";
    factoryApiRequest("GET", `/api/factory/containers/${editingContainer.id}/other-charges`)
      .then(res => res.ok ? res.json() : [])
      .then((charges: any[]) => {
        setOtherChargeLines(charges.map((c: any) => ({
          amount: c.amount || "", currencyCode: c.currencyCode || containerCcy,
          ledgerAccountId: c.ledgerAccountId ? String(c.ledgerAccountId) : "",
        })));
      })
      .catch(() => setOtherChargeLines([]));
  }, [editingContainer?.id]);

  useEffect(() => {
    if (currency === "USD") { setFxRate("1"); setFxEffectiveDate(""); return; }
    if (fxRateSource === "manual") return;
    fetch(`/api/factory/fx-rates/latest/${currency}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.rate) { setFxRate(String(data.rate)); setFxEffectiveDate(data.effectiveDate || ""); } })
      .catch(() => {});
  }, [currency, fxRateSource]);

  useEffect(() => {
    if (!editingContainer) setFormData(f => ({ ...f, commissionCurrencyCode: currency }));
  }, [currency, editingContainer]);

  useEffect(() => {
    if (!formData.supplierId) { setFormData(f => ({ ...f, commissionSupplierId: "" })); return; }
    const sup = suppliers?.find(s => s.id === parseInt(formData.supplierId));
    if (sup?.parentId) setFormData(f => ({ ...f, commissionSupplierId: String(sup.parentId) }));
    else if (!formData.commissionSupplierId) setFormData(f => ({ ...f, commissionSupplierId: "" }));
  }, [formData.supplierId, suppliers]);

  const activeSuppliers = suppliers?.filter(s => s.isActive) ?? [];
  const brokerIdNum = formData.commissionSupplierId ? parseInt(formData.commissionSupplierId) : null;
  const filteredSupplierList = brokerIdNum
    ? activeSuppliers.filter(s => s.parentId === brokerIdNum || !s.parentId)
    : activeSuppliers;
  const selectedSupplier = formData.supplierId ? activeSuppliers.find(s => s.id === parseInt(formData.supplierId)) ?? null : null;
  const brokerMismatch = !!(selectedSupplier?.parentId && formData.commissionSupplierId && selectedSupplier.parentId !== parseInt(formData.commissionSupplierId));

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const payload = {
        ...data, supplierId: data.supplierId ? parseInt(data.supplierId) : null,
        currencyCode: currency, fxRateToUsd: fxRateSource === "manual" ? fxRate : undefined,
        fxRateSource, commissionAmount: data.commissionAmount || "0",
        commissionCurrencyCode: data.commissionCurrencyCode || currency,
        commissionAccountId: data.commissionAccountId ? parseInt(data.commissionAccountId) : null,
        commissionSupplierId: data.commissionSupplierId ? parseInt(data.commissionSupplierId) : null,
        commissionNotes: data.commissionNotes || null, freight: data.freight || "0",
        freightCurrencyCode: data.freightCurrencyCode || "USD",
        freightAccountId: data.freightAccountId ? parseInt(data.freightAccountId) : null,
        otherCharges: "0", otherChargesAccountId: null,
      };
      const res = await factoryApiRequest("POST", "/api/factory/containers", payload);
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to create container"); }
      const container = await res.json();
      await factoryApiRequest("POST", `/api/factory/containers/${container.id}/other-charges/sync`, {
        charges: otherChargeLines.filter(l => parseFloat(l.amount || "0") > 0).map(l => ({
          description: "Other Charge", amount: l.amount, currencyCode: l.currencyCode || currency,
          ledgerAccountId: l.ledgerAccountId ? parseInt(l.ledgerAccountId) : null,
        })),
      });
      return container;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
      toast({ title: "Container saved", description: parseFloat(vars.commissionAmount || "0") > 0 ? "Broker commission added." : "Container created successfully." });
      resetForm(); onClose();
    },
    onError: (err: Error) => { if ((err as any)?._handledGlobally) return; toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: FormData }) => {
      const payload = {
        ...data, supplierId: data.supplierId ? parseInt(data.supplierId) : null,
        currencyCode: currency, fxRateToUsd: fxRateSource === "manual" ? fxRate : undefined,
        fxRateSource, commissionAmount: data.commissionAmount || "0",
        commissionCurrencyCode: data.commissionCurrencyCode || currency,
        commissionAccountId: data.commissionAccountId ? parseInt(data.commissionAccountId) : null,
        commissionSupplierId: data.commissionSupplierId ? parseInt(data.commissionSupplierId) : null,
        commissionNotes: data.commissionNotes || null, freight: data.freight || "0",
        freightCurrencyCode: data.freightCurrencyCode || "USD",
        freightAccountId: data.freightAccountId ? parseInt(data.freightAccountId) : null,
        otherCharges: data.otherCharges || "0",
        otherChargesAccountId: data.otherChargesAccountId ? parseInt(data.otherChargesAccountId) : null,
      };
      const validCharges = otherChargeLines.filter(l => parseFloat(l.amount || "0") > 0).map(l => ({
        description: "Other Charge", amount: l.amount, currencyCode: l.currencyCode || currency,
        ledgerAccountId: l.ledgerAccountId ? parseInt(l.ledgerAccountId) : null,
      }));
      let container: any;
      try {
        const res = await factoryApiRequest("PATCH", `/api/factory/containers/${id}`, payload);
        if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to update container"); }
        container = await res.json();
      } catch (err: any) {
        if (err?.name === "OfflineQueued" && validCharges.length > 0) {
          enqueueRequest(`/api/factory/containers/${id}/other-charges/sync`, "POST", JSON.stringify({ charges: validCharges }), "Container Charges");
        }
        throw err;
      }
      await factoryApiRequest("POST", `/api/factory/containers/${id}/other-charges/sync`, { charges: validCharges });
      return container;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
      toast({ title: "Container saved", description: parseFloat(vars.data.commissionAmount || "0") > 0 ? "Commission linked." : "Container updated." });
      resetForm(); onClose();
    },
    onError: (err: Error) => { if ((err as any)?._handledGlobally) return; toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const handleSubmit = () => {
    if (editingContainer) wrapAdminAction(() => updateMutation.mutate({ id: editingContainer.id, data: formData }), "Update Container");
    else createMutation.mutate(formData);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) { resetForm(); onClose(); } }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingContainer ? "Edit Container" : "Add Factory Container"}</DialogTitle>
            <DialogDescription>
              {editingContainer ? "Update container details" : "Track a new incoming factory container"}
            </DialogDescription>
          </DialogHeader>

          <ContainerFormBody
            formData={formData}
            setFormData={setFormData}
            currency={currency}
            setCurrency={setCurrency}
            fxRate={fxRate}
            setFxRate={setFxRate}
            fxRateSource={fxRateSource}
            setFxRateSource={setFxRateSource}
            fxEffectiveDate={fxEffectiveDate}
            otherChargeLines={otherChargeLines}
            setOtherChargeLines={setOtherChargeLines}
            activeSuppliers={activeSuppliers}
            filteredSupplierList={filteredSupplierList}
            selectedSupplier={selectedSupplier}
            brokerMismatch={brokerMismatch}
            ledgerAccounts={ledgerAccounts}
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); onClose(); }}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={!formData.containerNumber || brokerMismatch || createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-container"
            >
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingContainer ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {AdminDialog}
    </>
  );
}
