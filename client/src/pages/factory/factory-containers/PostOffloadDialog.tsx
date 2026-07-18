import { useState, Fragment } from "react";
import { useMutation } from "@tanstack/react-query";
import { PlusCircle, Plus, X, CheckCircle2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { factoryApiRequest } from "@/lib/factoryApi";
import { formatNumber } from "@/lib/formatNumber";
import { useAdminOverride } from "@/hooks/use-admin-override";
import type { ContainerWithSupplier } from "./otwHelpers";

type PostOffloadCharge = {
  id: string;
  description: string;
  amount: string;
  currencyCode: string;
  ledgerAccountId: string;
  supplierId: string;
};

type PostOffloadResult = {
  message: string;
  containerId: number;
  oldContainerCostPerKgUsd: number;
  newContainerCostPerKgUsd: number;
  oldContainerTotalUsd: number;
  newContainerTotalUsd: number;
  rawStockRowsUpdated: number;
  supplierLockedRateOld: number | null;
  supplierLockedRateNew: number | null;
  // Exact-precision breakdown
  supplierRemainingKg?: number;
  containerReceivedKg?: number;
  containerRemainingKg?: number;
  remainingFraction?: number;
  fullContainerValueDeltaUsd?: string;
  supplierInventoryValueDeltaUsd?: string;
  supplierValueBeforeUsd?: string | null;
  supplierValueAfterUsd?: string | null;
  supplierLockedRateOldExact?: string | null;
  supplierLockedRateNewExact?: string | null;
  oldRawStockCostPerKgUsd?: number | null;
  rawStockRateWasStale?: boolean;
  affectedBatches: {
    batchId: number;
    batchCode: string;
    status: string | null;
    wasCompleted: boolean;
    weightKgFromContainer: number;
    oldCostPerKg: number;
    newCostPerKg: number;
  }[];
  affectedBalesCount: number;
};

interface PostOffloadDialogProps {
  container: ContainerWithSupplier | null;
  ledgerAccounts: any[];
  onClose: () => void;
}

export function PostOffloadDialog({ container, ledgerAccounts, onClose }: PostOffloadDialogProps) {
  const { toast } = useToast();
  const { wrapAdminAction, AdminDialog } = useAdminOverride();
  const [charges, setCharges] = useState<PostOffloadCharge[]>([]);
  const [txDate, setTxDate] = useState<string>(() => new Date().toLocaleDateString("en-CA"));
  const [result, setResult] = useState<PostOffloadResult | null>(null);

  const handleClose = () => {
    setCharges([]);
    setResult(null);
    onClose();
  };

  const postOffloadMutation = useMutation({
    mutationFn: async ({
      containerId,
      charges: c,
      txDate: d,
    }: {
      containerId: number;
      charges: any[];
      txDate: string;
    }) => {
      const res = await factoryApiRequest("POST", `/api/factory/containers/${containerId}/post-offload-charges`, {
        charges: c,
        txDate: d,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to save charges");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/by-container"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"], refetchType: "active" });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      setResult(data);
      setCharges([]);
    },
    onError: (err: Error) => {
      if ((err as any)?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <>
      <Dialog
        open={!!container}
        onOpenChange={(v) => {
          if (!v) handleClose();
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PlusCircle className="h-5 w-5 text-blue-500" />
              Add Post-Offload Charges
            </DialogTitle>
            <DialogDescription>
              Container <strong>{container?.containerNumber}</strong> — charges added here will update the cost per kg
              and retroactively adjust all mix batches made from this container.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-5 py-2">
            {result ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-3 rounded-md bg-green-50 dark:bg-green-950/20 text-green-800 dark:text-green-300 text-sm">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">Charges saved successfully</p>
                    {result.rawStockRowsUpdated > 0 && (
                      <p className="text-xs mt-0.5 opacity-80">
                        The container cost per kg and all related mix batch costs have been updated.
                      </p>
                    )}
                  </div>
                </div>

                {/* Cost summary table */}
                <div className="rounded-md border text-sm divide-y">
                  <div className="grid grid-cols-3 gap-2 px-3 py-1.5 text-xs text-muted-foreground font-medium bg-muted/30">
                    <span>Metric</span>
                    <span className="text-right">Previous</span>
                    <span className="text-right">New</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 px-3 py-2">
                    <span className="text-muted-foreground">Container cost/kg (USD)</span>
                    <span className="text-right font-mono">${result.oldContainerCostPerKgUsd.toFixed(6)}</span>
                    <span className="text-right font-mono font-semibold text-green-700 dark:text-green-400">
                      ${result.newContainerCostPerKgUsd.toFixed(6)}
                    </span>
                  </div>
                  {result.supplierLockedRateOld !== null && (
                    <>
                      <div className="grid grid-cols-3 gap-2 px-3 py-2">
                        <span className="text-muted-foreground">Supplier locked rate (USD/kg)</span>
                        <span className="text-right font-mono">
                          ${(result.supplierLockedRateOldExact
                            ? parseFloat(result.supplierLockedRateOldExact)
                            : (result.supplierLockedRateOld ?? 0)
                          ).toFixed(6)}
                        </span>
                        <span className="text-right font-mono font-semibold">
                          ${(result.supplierLockedRateNewExact
                            ? parseFloat(result.supplierLockedRateNewExact)
                            : (result.supplierLockedRateNew ?? 0)
                          ).toFixed(6)}
                        </span>
                      </div>
                      {/* Calculation breakdown */}
                      {result.supplierValueBeforeUsd != null && result.supplierInventoryValueDeltaUsd != null && result.supplierRemainingKg != null && (
                        <div className="px-3 py-2 bg-muted/30 text-xs text-muted-foreground space-y-0.5">
                          <div className="flex justify-between">
                            <span>Supplier remaining</span>
                            <span className="font-mono">{formatNumber(result.supplierRemainingKg)} kg</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Inventory value added</span>
                            <span className="font-mono">${parseFloat(result.supplierInventoryValueDeltaUsd).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Formula</span>
                            <span className="font-mono">
                              (${parseFloat(result.supplierValueBeforeUsd).toLocaleString("en", { minimumFractionDigits: 6, maximumFractionDigits: 6 })} + ${parseFloat(result.supplierInventoryValueDeltaUsd).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) ÷ {formatNumber(result.supplierRemainingKg)} kg
                            </span>
                          </div>
                          {result.remainingFraction != null && result.remainingFraction < 0.9999 && result.fullContainerValueDeltaUsd != null && (
                            <div className="mt-1 text-amber-700 dark:text-amber-400">
                              Only {(result.remainingFraction * 100).toFixed(0)}% of this container remains in inventory, so ${parseFloat(result.supplierInventoryValueDeltaUsd).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} of the ${parseFloat(result.fullContainerValueDeltaUsd).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} charge was applied to the current supplier locked rate.
                            </div>
                          )}
                          {result.rawStockRateWasStale && (
                            <div className="mt-1 text-blue-700 dark:text-blue-400">
                              Note: the container rate and raw-stock rate differed before this charge. Only the new charge value was applied to the supplier rate — the pre-existing divergence was not included.
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  <div className="grid grid-cols-3 gap-2 px-3 py-2 text-muted-foreground">
                    <span>Raw-stock rows updated</span>
                    <span className="text-right">—</span>
                    <span className="text-right font-mono">{result.rawStockRowsUpdated}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 px-3 py-2 text-muted-foreground">
                    <span>Bales updated</span>
                    <span className="text-right">—</span>
                    <span className="text-right font-mono">{result.affectedBalesCount}</span>
                  </div>
                </div>

                {result.affectedBatches.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">Affected Mix Batches</p>
                    <div className="border rounded-md divide-y text-sm">
                      <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 px-3 py-1.5 text-xs text-muted-foreground font-medium bg-muted/30">
                        <span>Batch</span>
                        <span className="text-right">Old Cost/kg</span>
                        <span className="text-right">New Cost/kg</span>
                        <span className="text-right">Wt from container</span>
                      </div>
                      {result.affectedBatches.map((b) => (
                        <div key={b.batchId} className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 px-3 py-2 items-center">
                          <span className="font-mono font-medium flex items-center gap-1.5 flex-wrap">
                            {b.batchCode}
                            {b.wasCompleted && (
                              <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded whitespace-nowrap">
                                Completed
                              </span>
                            )}
                          </span>
                          <span className="text-right font-mono text-muted-foreground">
                            ${b.oldCostPerKg.toFixed(4)}
                          </span>
                          <span className="text-right font-mono font-semibold">${b.newCostPerKg.toFixed(4)}</span>
                          <span className="text-right font-mono text-muted-foreground">
                            {formatNumber(b.weightKgFromContainer)} kg
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 bg-muted/40 rounded-md">
                    <Info className="h-4 w-4 shrink-0" />
                    No mix batches were linked to this container — only the container and raw stock costs were updated.
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-start gap-3 p-3 rounded-md bg-blue-50 dark:bg-blue-950/20 text-blue-800 dark:text-blue-300 text-sm">
                  <Info className="h-4 w-4 mt-0.5 shrink-0" />
                  <p>
                    Enter any charges that arrived after the original offload — port fees, duties, handling, etc. Each
                    charge will be added to the container's cost and will cascade into any mix batches already made from
                    it.
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Date</label>
                  <Input
                    type="date"
                    value={txDate}
                    onChange={(e) => setTxDate(e.target.value)}
                    className="w-48"
                    data-testid="input-post-offload-date"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <label className="text-sm font-medium">Charges</label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCharges((prev) => [
                          ...prev,
                          {
                            id: Date.now().toString(),
                            description: "",
                            amount: "",
                            currencyCode: (container as any)?.currencyCode || "USD",
                            ledgerAccountId: "",
                            supplierId: "",
                          },
                        ])
                      }
                      data-testid="button-add-post-offload-charge-row"
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add Row
                    </Button>
                  </div>
                  {charges.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center border rounded-md">
                      No charges added yet — click "Add Row" to begin.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      <div className="grid grid-cols-[2fr_1fr_auto_2fr_auto] gap-x-2 gap-y-1 items-center">
                        <div className="text-xs text-muted-foreground font-medium">Description</div>
                        <div className="text-xs text-muted-foreground font-medium">Amount</div>
                        <div className="text-xs text-muted-foreground font-medium">CCY</div>
                        <div className="text-xs text-muted-foreground font-medium">Account / Broker</div>
                        <div />
                        {charges.map((charge, idx) => (
                          <Fragment key={charge.id}>
                            <Input
                              value={charge.description}
                              onChange={(e) =>
                                setCharges((prev) =>
                                  prev.map((c) => (c.id === charge.id ? { ...c, description: e.target.value } : c))
                                )
                              }
                              placeholder="e.g. Port duty"
                              data-testid={`input-poc-description-${idx}`}
                            />
                            <Input
                              type="number"
                              value={charge.amount}
                              onChange={(e) =>
                                setCharges((prev) =>
                                  prev.map((c) => (c.id === charge.id ? { ...c, amount: e.target.value } : c))
                                )
                              }
                              placeholder="0.00"
                              step="0.01"
                              data-testid={`input-poc-amount-${idx}`}
                            />
                            <Select
                              value={charge.currencyCode || "USD"}
                              onValueChange={(v) =>
                                setCharges((prev) =>
                                  prev.map((c) => (c.id === charge.id ? { ...c, currencyCode: v } : c))
                                )
                              }
                            >
                              <SelectTrigger className="w-20" data-testid={`select-poc-currency-${idx}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {["USD", "EUR", "GBP", "AUD", "LBP"].map((ccy) => (
                                  <SelectItem key={ccy} value={ccy}>
                                    {ccy}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Select
                              value={charge.ledgerAccountId || ""}
                              onValueChange={(v) =>
                                setCharges((prev) =>
                                  prev.map((c) =>
                                    c.id === charge.id ? { ...c, ledgerAccountId: v, supplierId: "" } : c
                                  )
                                )
                              }
                            >
                              <SelectTrigger data-testid={`select-poc-account-${idx}`}>
                                <SelectValue placeholder="Select account (optional)" />
                              </SelectTrigger>
                              <SelectContent>
                                {ledgerAccounts.map((a: any) => (
                                  <SelectItem key={a.id} value={String(a.id)}>
                                    {a.code ? `${a.code} - ${a.name}` : a.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setCharges((prev) => prev.filter((c) => c.id !== charge.id))}
                              data-testid={`button-remove-poc-${idx}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </Fragment>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 pt-2 border-t">
            <Button variant="outline" onClick={handleClose}>
              {result ? "Close" : "Cancel"}
            </Button>
            {!result && (
              <Button
                onClick={() => {
                  if (!container) return;
                  const valid = charges.filter((c) => parseFloat(c.amount || "0") > 0);
                  if (valid.length === 0) {
                    toast({
                      title: "No charges",
                      description: "Add at least one charge with an amount.",
                      variant: "destructive",
                    });
                    return;
                  }
                  wrapAdminAction(
                    () =>
                      postOffloadMutation.mutate({
                        containerId: container.id,
                        txDate: txDate || new Date().toLocaleDateString("en-CA"),
                        charges: valid.map((c) => ({
                          description: c.description || "Post-offload charge",
                          amount: c.amount,
                          currencyCode: c.currencyCode || "USD",
                          ledgerAccountId: c.ledgerAccountId ? parseInt(c.ledgerAccountId) : null,
                          supplierId: c.supplierId ? parseInt(c.supplierId) : null,
                        })),
                      }),
                    "Add Post-Offload Charges"
                  );
                }}
                disabled={postOffloadMutation.isPending || charges.every((c) => parseFloat(c.amount || "0") <= 0)}
                data-testid="button-confirm-post-offload-charges"
              >
                {postOffloadMutation.isPending ? "Saving..." : "Save Charges"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {AdminDialog}
    </>
  );
}
