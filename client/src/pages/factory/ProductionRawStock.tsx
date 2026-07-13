import { useState, useMemo, useRef } from "react";
import { useAdminOverride } from "@/hooks/use-admin-override";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FlaskConical, ArrowDown, Plus, Tag, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { formatNumber } from "@/lib/formatNumber";
import type { FactoryMixBatch } from "@shared/schema";

import { SupplierCategoriesDialog } from "./production-raw-stock/ProductionRawStockHelpers";
import { RawStockTable } from "./production-raw-stock/RawStockTable";
import { MixBatchList } from "./production-raw-stock/MixBatchList";
import { KpiCards } from "./production-raw-stock/KpiCards";
import { OffloadDialog } from "./production-raw-stock/OffloadDialog";
import { OpeningBalanceDialog } from "./production-raw-stock/OpeningBalanceDialog";
import { StockAdjustmentDialog } from "./production-raw-stock/StockAdjustmentDialog";
import { DeductStockDialog } from "./production-raw-stock/DeductStockDialog";
import { AddToBatchDialog } from "./production-raw-stock/AddToBatchDialog";
import { CreateMixBatchDialog } from "@/components/CreateMixBatchDialog";
import { EditMixBatchDialog } from "@/components/EditMixBatchDialog";

export default function ProductionRawStock() {
  const { wrapAdminAction, AdminDialog } = useAdminOverride();
  const { formatDisplayDate } = useDateFormat();
  const { toast } = useToast();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);

  // Dialog States
  const [offloadDialogOpen, setOffloadDialogOpen] = useState(false);
  const [obDialogOpen, setObDialogOpen] = useState(false);
  const [categoriesDialogOpen, setCategoriesDialogOpen] = useState(false);
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [deductDialogOpen, setDeductDialogOpen] = useState(false);
  const [addToBatchOpen, setAddToBatchOpen] = useState(false);
  const [createMixBatchOpen, setCreateMixBatchOpen] = useState(false);
  const [editBatch, setEditBatch] = useState<FactoryMixBatch | null>(null);

  // Data States
  const [adjustingRow, setAdjustingRow] = useState<any>(null);
  const [adjIsNewMaterial, setAdjIsNewMaterial] = useState(false);
  const [deductingRow, setDeductingRow] = useState<any>(null);
  const [addToBatchSource, setAddToBatchSource] = useState<any>(null);
  const [mixBatchDate, setMixBatchDate] = useState(() => new Date().toISOString().substring(0, 10));

  // Ref for WhatsApp printable card
  const mixBatchPrintRef = useRef<HTMLDivElement>(null);

  // Queries
  const { data: rawStock, isLoading: rawStockLoading } = useQuery<any[]>({
    queryKey: ["/api/factory/raw-stock"],
  });

  const { data: mixBatches, isLoading: mixBatchesLoading } = useQuery<any[]>({
    queryKey: ["/api/factory/mix-batches"],
  });

  const { data: factorySuppliers = [] } = useQuery<any[]>({
    queryKey: ["/api/factory/suppliers"],
  });

  const { data: ledgerAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger-accounts"],
  });

  const { data: availableContainers = [] } = useQuery<any[]>({
    queryKey: ["/api/factory/raw-stock/available-containers"],
  });

  const { data: mixBatchesByDate = [], isLoading: mixBatchesByDateLoading } = useQuery<any[]>({
    queryKey: [`/api/factory/mix-batches-by-date?date=${encodeURIComponent(mixBatchDate)}`],
    enabled: !!mixBatchDate,
  });

  // Mutations
  const offloadMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await modeApiRequest("POST", "/api/factory/raw-stock/offload", data);
      if (!res.ok) throw new Error((await res.json()).message || "Failed to offload");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/available-containers"] });
      setOffloadDialogOpen(false);
      toast({ title: "Success", description: "Container offloaded successfully." });
    },
  });

  const openingBalanceMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await modeApiRequest("POST", "/api/factory/raw-stock/opening-balance", data);
      if (!res.ok) throw new Error((await res.json()).message || "Failed to add OB");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      setObDialogOpen(false);
      toast({ title: "Success", description: "Opening balance added." });
    },
  });

  const createAdjustmentMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await modeApiRequest("POST", "/api/factory/raw-stock/adjustment", payload);
      if (!res.ok) throw new Error((await res.json()).message || "Failed to save adjustment");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      setAdjustDialogOpen(false);
      toast({ title: "Saved", description: "Stock adjustment recorded." });
    },
  });

  const deductReceivedMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await modeApiRequest("POST", "/api/factory/raw-stock/deduct-received", payload);
      if (!res.ok) throw new Error((await res.json()).message || "Failed to deduct");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      setDeductDialogOpen(false);
      toast({ title: "Deducted", description: "Stock deducted successfully." });
    },
  });

  const updateCostMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await modeApiRequest("POST", "/api/factory/raw-stock/update-cost", payload);
      if (!res.ok) throw new Error((await res.json()).message || "Failed to update cost");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      setAdjustDialogOpen(false);
      toast({ title: "Cost Updated", description: "Cost updated successfully." });
    },
  });

  const addToBatchMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await modeApiRequest("POST", `/api/factory/mix-batches/${data.batchId}/top-up`, {
        supplierSources: [{ supplierId: data.supplierId, weightKg: data.weightKg, costPerKg: data.costPerKg }],
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to add to batch");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      setAddToBatchOpen(false);
      toast({ title: "Success", description: "Added to batch successfully." });
    },
  });

  const deleteMixBatchMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await modeApiRequest("DELETE", `/api/factory/mix-batches/${id}`);
      if (!res.ok) throw new Error((await res.json()).message || "Failed to delete batch");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      toast({ title: "Deleted", description: "Mix batch deleted." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const sendWhatsAppMutation = useMutation({
    mutationFn: async () => {
      if (!mixBatchPrintRef.current) throw new Error("Nothing to capture");
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(mixBatchPrintRef.current, { backgroundColor: "#111827", scale: 2 });
      const imageBase64 = canvas.toDataURL("image/png");
      const res = await modeApiRequest("POST", "/api/factory/send-mix-batch-image-whatsapp", {
        imageBase64,
        date: mixBatchDate,
        fileName: `MixBatch_${mixBatchDate}.png`,
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to send");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sent", description: "Mix batch details sent to WhatsApp group." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const kpiData = useMemo(() => {
    const rs = rawStock || [];
    const mb = mixBatches || [];
    // Total Used $ mirrors the "Combined Total" blended cost shown under Recent Mix
    // Batches — the blended cost/kg across all mix batches (weighted by each batch's own
    // total weight) times the kg actually used — not the supplier-level received rate,
    // which doesn't reflect what a mix batch actually cost to produce.
    const mbSumTotal = mb.reduce((s, b) => s + (parseFloat(b.totalWeightKg) || 0), 0);
    const mbWeightedCost = mb.reduce(
      (s, b) => s + (parseFloat(b.totalWeightKg) || 0) * (parseFloat(b.costPerKg) || 0),
      0
    );
    const mbBlendedCost = mbSumTotal > 0 ? mbWeightedCost / mbSumTotal : 0;
    const totalUsed = rs.reduce((sum, r) => sum + parseFloat(r.usedKg || "0"), 0);
    return {
      totalReceived: rs.reduce((sum, r) => sum + parseFloat(r.receivedKg || "0"), 0),
      totalReceivedValue: rs.reduce(
        (sum, r) => sum + parseFloat(r.receivedKg || "0") * parseFloat(r.costPerKgUsd || r.costPerKg || "0"),
        0
      ),
      totalUsed,
      totalUsedValue: mbBlendedCost * totalUsed,
      totalFree: rs.reduce((sum, r) => sum + parseFloat(r.freeKg || "0"), 0),
      totalValue: rs.reduce((sum, r) => sum + parseFloat(r.valueRemainingUsd || r.valueRemaining || "0"), 0),
    };
  }, [rawStock, mixBatches]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-gradient-to-br from-amber-500/30 to-amber-600/10 border border-amber-500/25 shrink-0">
            <FlaskConical className="h-4.5 w-4.5 text-amber-500" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">Raw Production</h1>
            <p className="text-xs text-muted-foreground leading-tight">
              Raw stock inventory and daily mix batch management
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            onClick={() => setCreateMixBatchOpen(true)}
            className="gap-2"
            data-testid="button-create-mix-batch"
          >
            <Layers className="h-4 w-4" /> New Mix Batch
          </Button>
          <Button
            onClick={() => setOffloadDialogOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-600 text-white gap-2"
          >
            <ArrowDown className="h-4 w-4" /> Offload Container
          </Button>
          <Button variant="outline" onClick={() => setObDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Add OB Stock
          </Button>
          <Button variant="outline" onClick={() => setCategoriesDialogOpen(true)} className="gap-2">
            <Tag className="h-4 w-4" /> Categories
          </Button>
        </div>
      </div>

      <KpiCards {...kpiData} />

      <div className="grid gap-6">
        <section className="space-y-4">
          <RawStockTable
            rawStock={rawStock || []}
            onAdjust={(row) => {
              setAdjIsNewMaterial(false);
              setAdjustingRow(row);
              setAdjustDialogOpen(true);
            }}
            onDeduct={(row) => {
              setDeductingRow(row);
              setDeductDialogOpen(true);
            }}
            onAddToBatch={(row) => {
              setAddToBatchSource({
                supplierId: row.supplierId,
                supplierName: row.supplierName,
                costPerKg: String(parseFloat(row.costPerKgUsd || row.costPerKg || "0")),
                remainingKg: row.freeKg || row.remainingKg || "0",
              });
              setAddToBatchOpen(true);
            }}
            onNewMaterial={() => {
              setAdjIsNewMaterial(true);
              setAdjustingRow(null);
              setAdjustDialogOpen(true);
            }}
          />
        </section>

        <section className="space-y-4">
          <MixBatchList
            mixBatches={mixBatches || []}
            isLoading={mixBatchesLoading}
            onEdit={(batch) => setEditBatch(batch as unknown as FactoryMixBatch)}
            onDelete={(id) => deleteMixBatchMutation.mutate(id)}
            onViewDetail={(batch) => setEditBatch(batch as unknown as FactoryMixBatch)}
            onSendWhatsApp={() => sendWhatsAppMutation.mutate()}
            isSendingWhatsApp={sendWhatsAppMutation.isPending}
            mixBatchDate={mixBatchDate}
            setMixBatchDate={setMixBatchDate}
            mixBatchesByDate={mixBatchesByDate}
            mixBatchesByDateLoading={mixBatchesByDateLoading}
            mixBatchPrintRef={mixBatchPrintRef}
            formatDisplayDate={formatDisplayDate}
          />
        </section>
      </div>

      {/* Dialogs */}
      <CreateMixBatchDialog
        open={createMixBatchOpen}
        onOpenChange={setCreateMixBatchOpen}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
          queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
        }}
      />

      <EditMixBatchDialog
        batch={editBatch}
        open={editBatch !== null}
        onOpenChange={(open) => { if (!open) setEditBatch(null); }}
      />

      <OffloadDialog
        open={offloadDialogOpen}
        onOpenChange={setOffloadDialogOpen}
        availableContainers={availableContainers}
        factorySuppliers={factorySuppliers}
        ledgerAccounts={ledgerAccounts}
        offloadMutation={offloadMutation}
        wrapAdminAction={wrapAdminAction}
        mixBatches={mixBatches || []}
      />

      <OpeningBalanceDialog
        open={obDialogOpen}
        onOpenChange={setObDialogOpen}
        factorySuppliers={factorySuppliers}
        openingBalanceMutation={openingBalanceMutation}
        wrapAdminAction={wrapAdminAction}
      />

      <StockAdjustmentDialog
        open={adjustDialogOpen}
        onOpenChange={setAdjustDialogOpen}
        adjustingRow={adjustingRow}
        isNewMaterial={adjIsNewMaterial}
        factorySuppliers={factorySuppliers}
        createAdjustmentMutation={createAdjustmentMutation}
        updateCostMutation={updateCostMutation}
        wrapAdminAction={wrapAdminAction}
      />

      <DeductStockDialog
        open={deductDialogOpen}
        onOpenChange={setDeductDialogOpen}
        deductingRow={deductingRow}
        deductReceivedMutation={deductReceivedMutation}
        wrapAdminAction={wrapAdminAction}
      />

      <AddToBatchDialog
        open={addToBatchOpen}
        onOpenChange={setAddToBatchOpen}
        addToBatchSource={addToBatchSource}
        setAddToBatchSource={setAddToBatchSource}
        mixBatches={mixBatches || []}
        rawStock={rawStock || []}
        addToBatchMutation={addToBatchMutation}
        wrapAdminAction={wrapAdminAction}
      />

      <SupplierCategoriesDialog open={categoriesDialogOpen} onClose={() => setCategoriesDialogOpen(false)} />

      {AdminDialog}
    </div>
  );
}
