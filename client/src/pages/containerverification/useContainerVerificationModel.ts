/**
 * Controller hook for the container verification page.
 *
 * Owns the loaded-items editor (manual add/edit/delete, Excel import and the
 * auto-populate from purchase orders), the supplier/proforma selection with
 * its auto-compare deep link, and the proforma-vs-loaded comparison buckets.
 */
import { useState, useRef, useEffect, useCallback, type ChangeEvent } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation, useSearch } from "wouter";
import { useEscapeToParent } from "@/hooks/use-escape-to-parent";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import * as XLSX from "@/lib/excelHelper";
import type { LoadedItem, VerificationResult } from "./types";

const EMPTY_ITEM = { barcode: "", itemName: "", qty: "0", weightPerBale: "0", pricePerBale: "0" };

export function useContainerVerificationModel() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const autoCompare = new URLSearchParams(searchString).get("autoCompare") === "true";
  const autoSupplierId = new URLSearchParams(searchString).get("supplierId") || "";
  const params = useParams<{ containerId: string }>();
  useEscapeToParent();
  const containerId = parseInt(params.containerId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [selectedProformaId, setSelectedProformaId] = useState<string>("");
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [autoCompareTriggered, setAutoCompareTriggered] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [newItem, setNewItem] = useState({ ...EMPTY_ITEM });
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editItemData, setEditItemData] = useState({ ...EMPTY_ITEM });
  const [viewMode, setViewMode] = useState<"detailed" | "summary">("detailed");

  const { data: containerData } = useQuery<any>({
    queryKey: [`/api/containers/${containerId}`],
    enabled: !!containerId,
  });

  const { data: suppliers = [] } = useQuery<any[]>({
    queryKey: ["/api/suppliers"],
  });

  const { data: proformas = [] } = useQuery<any[]>({
    queryKey: ["/api/suppliers", selectedSupplierId, "proformas"],
    queryFn: async () => {
      if (!selectedSupplierId) return [];
      const res = await fetch(`/api/suppliers/${selectedSupplierId}/proformas`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch proformas");
      return res.json();
    },
    enabled: !!selectedSupplierId,
  });

  const { data: loadedItems = [], isLoading: loadingItems } = useQuery<LoadedItem[]>({
    queryKey: ["/api/containers", containerId, "loaded-items"],
    queryFn: async () => {
      const res = await fetch(`/api/containers/${containerId}/loaded-items`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch loaded items");
      return res.json();
    },
    enabled: !!containerId,
  });

  const reportError = (e: any, title = "Error") => {
    if (e?._handledGlobally) return;
    toast({ title, description: e.message, variant: "destructive" });
  };

  const invalidateLoadedItems = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/containers", containerId, "loaded-items"] });

  const addItemMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/containers/${containerId}/loaded-items`, data);
      return res.json();
    },
    onSuccess: () => {
      invalidateLoadedItems();
      setAddingItem(false);
      setNewItem({ ...EMPTY_ITEM });
      if (verificationResult) generateComparison();
    },
    onError: (e: any) => reportError(e),
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/container-loaded-items/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      invalidateLoadedItems();
      setEditingItemId(null);
      if (verificationResult) generateComparison();
    },
    onError: (e: any) => reportError(e),
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/container-loaded-items/${id}`);
    },
    onSuccess: () => {
      invalidateLoadedItems();
      if (verificationResult) generateComparison();
    },
    onError: (e: any) => reportError(e),
  });

  const autoPopulateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/containers/${containerId}/auto-populate-loaded-items`);
      return res.json();
    },
    onSuccess: (data: any) => {
      invalidateLoadedItems();
      const skippedMsg = data.skipped > 0 ? ` (${data.skipped} skipped - missing barcodes)` : "";
      toast({
        title: "Items loaded",
        description: `${data.imported} items imported from purchase orders${skippedMsg}`,
      });
      if (verificationResult) generateComparison();
    },
    onError: (e: any) => reportError(e),
  });

  const importMutation = useMutation({
    mutationFn: async (items: any[]) => {
      const res = await apiRequest("POST", `/api/containers/${containerId}/import-loaded-items`, { items });
      return res.json();
    },
    onSuccess: (data: any) => {
      invalidateLoadedItems();
      toast({ title: "Import complete", description: `${data.imported} items imported` });
      if (verificationResult) generateComparison();
    },
    onError: (e: any) => reportError(e, "Import error"),
  });

  const handleFileImport = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const wb = await XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws);
        const items = rows
          .map((r) => ({
            barcode: String(r.Barcode || r.barcode || "").trim(),
            itemName: String(r["Item Name"] || r.itemName || r.Name || "").trim(),
            qty: parseInt(r.Qty || r.qty || r.Quantity || 0) || 0,
            weightPerBale: String(r["Weight per Bale"] || r.weightPerBale || r.Weight || "0"),
            pricePerBale: String(r["Price per Bale"] || r.pricePerBale || r.Price || "0"),
          }))
          .filter((l) => l.barcode);
        if (items.length === 0) {
          toast({ title: "No data found", variant: "destructive" });
          return;
        }
        importMutation.mutate(items);
      } catch (err: any) {
        toast({ title: "Parse error", description: err.message, variant: "destructive" });
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const generateComparison = useCallback(
    async (supplierId?: string, proformaId?: string) => {
      const sid = supplierId ?? selectedSupplierId;
      const pid = proformaId ?? selectedProformaId;
      if (!sid || !pid) {
        toast({ title: "Select supplier and proforma first", variant: "destructive" });
        return;
      }
      try {
        const res = await fetch(
          `/api/suppliers/${sid}/containers/${containerId}/verification-summary?proformaId=${pid}`,
          { credentials: "include", cache: "no-store" }
        );
        if (!res.ok) {
          const e = await res.json();
          throw new Error(e.message);
        }
        const data = await res.json();
        setVerificationResult(data);
      } catch (err: any) {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    },
    [selectedSupplierId, selectedProformaId, containerId, toast]
  );

  /** Both exports are server-rendered downloads and need a live connection. */
  const openExport = (path: string) => {
    if (!selectedSupplierId || !selectedProformaId) return;
    if (!navigator.onLine) {
      toast({ title: "Not available offline", description: "Exports require a connection" });
      return;
    }
    window.open(
      `/api/suppliers/${selectedSupplierId}/containers/${containerId}/${path}?proformaId=${selectedProformaId}`,
      "_blank"
    );
  };

  const exportToExcel = () => openExport("verification-export.xlsx");
  const exportSummaryExcel = () => openExport("verification-summary-export.xlsx");

  const startEdit = (item: LoadedItem) => {
    setEditingItemId(item.id);
    setEditItemData({
      barcode: item.barcode,
      itemName: item.itemName || "",
      qty: String(item.qty),
      weightPerBale: item.weightPerBale || "0",
      pricePerBale: item.pricePerBale || "0",
    });
  };

  const runAutoPopulate = () => {
    if (!navigator.onLine) {
      toast({ title: "Not available offline", description: "Auto-populate requires a connection" });
      return;
    }
    autoPopulateMutation.mutate();
  };

  useEffect(() => {
    const container = containerData?.container;
    if (container?.supplierId && suppliers.length > 0 && !selectedSupplierId) {
      const supplierMatch = suppliers.find((s) => s.id === container.supplierId);
      if (supplierMatch) {
        setSelectedSupplierId(String(supplierMatch.id));
      }
    }
  }, [containerData, suppliers, selectedSupplierId]);

  useEffect(() => {
    if (
      loadedItems.length === 0 &&
      !loadingItems &&
      containerData?.container &&
      !autoPopulateMutation.isPending &&
      !autoPopulateMutation.isSuccess &&
      navigator.onLine
    ) {
      autoPopulateMutation.mutate();
    }
  }, [loadedItems, loadingItems, containerData]);

  // Auto-select supplier when opened via "Compare" from Daybook (supplierId URL param).
  useEffect(() => {
    if (!autoSupplierId || selectedSupplierId || suppliers.length === 0) return;
    const found = suppliers.find((s) => String(s.id) === autoSupplierId);
    if (found) setSelectedSupplierId(autoSupplierId);
  }, [autoSupplierId, selectedSupplierId, suppliers]);

  // Auto-select proforma when opened via "Compare" button from Daybook.
  // Prefers the starred proforma; falls back to the most recent if none is starred.
  useEffect(() => {
    if (!autoCompare || !selectedSupplierId || proformas.length === 0 || selectedProformaId) return;
    const starred = proformas.find((p) => p.isStarred);
    const pick = starred ?? proformas[proformas.length - 1];
    if (pick) setSelectedProformaId(String(pick.id));
  }, [autoCompare, selectedSupplierId, proformas, selectedProformaId]);

  // Auto-generate comparison once supplier + proforma are both set
  useEffect(() => {
    if (!autoCompare || !selectedSupplierId || !selectedProformaId || autoCompareTriggered) return;
    setAutoCompareTriggered(true);
    generateComparison(selectedSupplierId, selectedProformaId);
  }, [autoCompare, selectedSupplierId, selectedProformaId, autoCompareTriggered, generateComparison]);

  const container = containerData?.container;
  const overloaded = verificationResult?.comparison.filter((c) => c.statusQty === "OVER_LOADED") || [];
  const lessLoaded =
    verificationResult?.comparison.filter(
      (c) => c.statusQty === "UNDER_LOADED" || c.statusQty === "MISSING_FROM_LOADED"
    ) || [];
  const notRequested = verificationResult?.comparison.filter((c) => c.statusQty === "LOADED_NOT_IN_PROFORMA") || [];
  const priceDiffs = verificationResult?.comparison.filter((c) => c.priceStatus === "PRICE_DIFF") || [];

  const selectSupplier = (v: string) => {
    setSelectedSupplierId(v);
    setSelectedProformaId("");
    setVerificationResult(null);
  };

  return {
    navigate,
    containerId,
    container,
    fileInputRef,
    handleFileImport,
    // loaded items editor
    loadedItems,
    addingItem,
    setAddingItem,
    newItem,
    setNewItem,
    editingItemId,
    setEditingItemId,
    editItemData,
    setEditItemData,
    startEdit,
    addItemMutation,
    updateItemMutation,
    deleteItemMutation,
    autoPopulateMutation,
    runAutoPopulate,
    // comparison setup
    suppliers,
    proformas,
    selectedSupplierId,
    selectSupplier,
    selectedProformaId,
    setSelectedProformaId,
    generateComparison,
    exportToExcel,
    exportSummaryExcel,
    // results
    verificationResult,
    overloaded,
    lessLoaded,
    notRequested,
    priceDiffs,
    viewMode,
    setViewMode,
  };
}

export type ContainerVerificationModel = ReturnType<typeof useContainerVerificationModel>;
