import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { useEscapeToParent } from "@/hooks/use-escape-to-parent";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ArrowLeft, Plus, Trash2, Upload, Download, FileCheck, Pencil, Save, X, AlertTriangle, CheckCircle2, ArrowUpRight, ArrowDownRight, MinusCircle, DollarSign, RefreshCw, List } from "lucide-react";
import * as XLSX from "xlsx";
import { PageHeader } from "@/components/PageHeader";

interface LoadedItem {
  id: number;
  containerId: number;
  barcode: string;
  itemName: string | null;
  qty: number;
  weightPerBale: string | null;
  pricePerBale: string | null;
}

interface ComparisonItem {
  barcode: string;
  itemName: string;
  expectedQty: number;
  loadedQty: number;
  expectedWeightPerBale: number;
  loadedWeightPerBale: number;
  expectedWeightTotal: number;
  loadedWeightTotal: number;
  expectedPricePerBale: number;
  loadedPricePerBale: number;
  expectedTotalValue: number;
  loadedTotalValue: number;
  statusQty: string;
  priceStatus: string;
  priceDiffPerBale: number;
  totalPriceDiff: number;
}

interface VerificationResult {
  proforma: { id: number; reference: string };
  containerId: number;
  supplierId: number;
  comparison: ComparisonItem[];
}

export default function ContainerVerification() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const params = useParams<{ containerId: string }>();
  useEscapeToParent();
  const containerId = parseInt(params.containerId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [selectedProformaId, setSelectedProformaId] = useState<string>("");
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [addingItem, setAddingItem] = useState(false);
  const [newItem, setNewItem] = useState({ barcode: "", itemName: "", qty: "0", weightPerBale: "0", pricePerBale: "0" });
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editItemData, setEditItemData] = useState({ barcode: "", itemName: "", qty: "0", weightPerBale: "0", pricePerBale: "0" });
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

  const addItemMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/containers/${containerId}/loaded-items`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/containers", containerId, "loaded-items"] });
      setAddingItem(false);
      setNewItem({ barcode: "", itemName: "", qty: "0", weightPerBale: "0", pricePerBale: "0" });
    },
    onError: (e: any) => { if (e?._handledGlobally) return; toast({ title: "Error", description: e.message, variant: "destructive" }); },
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/container-loaded-items/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/containers", containerId, "loaded-items"] });
      setEditingItemId(null);
    },
    onError: (e: any) => { if (e?._handledGlobally) return; toast({ title: "Error", description: e.message, variant: "destructive" }); },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/container-loaded-items/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/containers", containerId, "loaded-items"] });
    },
    onError: (e: any) => { if (e?._handledGlobally) return; toast({ title: "Error", description: e.message, variant: "destructive" }); },
  });

  const autoPopulateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/containers/${containerId}/auto-populate-loaded-items`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/containers", containerId, "loaded-items"] });
      const skippedMsg = data.skipped > 0 ? ` (${data.skipped} skipped - missing barcodes)` : "";
      toast({ title: "Items loaded", description: `${data.imported} items imported from purchase orders${skippedMsg}` });
    },
    onError: (e: any) => { if (e?._handledGlobally) return; toast({ title: "Error", description: e.message, variant: "destructive" }); },
  });

  const importMutation = useMutation({
    mutationFn: async (items: any[]) => {
      const res = await apiRequest("POST", `/api/containers/${containerId}/import-loaded-items`, { items });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/containers", containerId, "loaded-items"] });
      toast({ title: "Import complete", description: `${data.imported} items imported` });
    },
    onError: (e: any) => { if (e?._handledGlobally) return; toast({ title: "Import error", description: e.message, variant: "destructive" }); },
  });

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(ws);
        const items = rows.map((r) => ({
          barcode: String(r.Barcode || r.barcode || "").trim(),
          itemName: String(r["Item Name"] || r.itemName || r.Name || "").trim(),
          qty: parseInt(r.Qty || r.qty || r.Quantity || 0) || 0,
          weightPerBale: String(r["Weight per Bale"] || r.weightPerBale || r.Weight || "0"),
          pricePerBale: String(r["Price per Bale"] || r.pricePerBale || r.Price || "0"),
        })).filter((l) => l.barcode);
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

  const generateComparison = async () => {
    if (!selectedSupplierId || !selectedProformaId) {
      toast({ title: "Select supplier and proforma first", variant: "destructive" });
      return;
    }
    try {
      const res = await fetch(`/api/suppliers/${selectedSupplierId}/containers/${containerId}/verification-summary?proformaId=${selectedProformaId}`, { credentials: "include" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      const data = await res.json();
      setVerificationResult(data);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const exportToExcel = () => {
    if (!selectedSupplierId || !selectedProformaId) return;
    if (!navigator.onLine) { toast({ title: "Not available offline", description: "Exports require a connection" }); return; }
    window.open(`/api/suppliers/${selectedSupplierId}/containers/${containerId}/verification-export.xlsx?proformaId=${selectedProformaId}`, "_blank");
  };

  const exportSummaryExcel = () => {
    if (!selectedSupplierId || !selectedProformaId) return;
    if (!navigator.onLine) { toast({ title: "Not available offline", description: "Exports require a connection" }); return; }
    window.open(`/api/suppliers/${selectedSupplierId}/containers/${containerId}/verification-summary-export.xlsx?proformaId=${selectedProformaId}`, "_blank");
  };

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

  useEffect(() => {
    const container = containerData?.container;
    if (container?.supplierId && suppliers.length > 0 && !selectedSupplierId) {
      const supplierMatch = suppliers.find((s: any) => s.id === container.supplierId);
      if (supplierMatch) {
        setSelectedSupplierId(String(supplierMatch.id));
      }
    }
  }, [containerData, suppliers, selectedSupplierId]);

  useEffect(() => {
    if (loadedItems.length === 0 && !loadingItems && containerData?.container && !autoPopulateMutation.isPending && !autoPopulateMutation.isSuccess && navigator.onLine) {
      autoPopulateMutation.mutate();
    }
  }, [loadedItems, loadingItems, containerData]);

  const container = containerData?.container;
  const overloaded = verificationResult?.comparison.filter((c) => c.statusQty === "OVER_LOADED") || [];
  const lessLoaded = verificationResult?.comparison.filter((c) => c.statusQty === "UNDER_LOADED" || c.statusQty === "MISSING_FROM_LOADED") || [];
  const notRequested = verificationResult?.comparison.filter((c) => c.statusQty === "LOADED_NOT_IN_PROFORMA") || [];
  const priceDiffs = verificationResult?.comparison.filter((c) => c.priceStatus === "PRICE_DIFF") || [];

  return (
    <div className="flex flex-col h-full p-4 lg:p-6 overflow-y-auto">
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileImport} />

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/containers/${containerId}`)} data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <PageHeader title="Container Verification" />
            <p className="text-muted-foreground text-sm">
              {container?.containerNumber || `Container #${containerId}`} - Proforma vs Loaded Items
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-sm">Loaded Items ({loadedItems.length})</CardTitle>
            <div className="flex items-center gap-2">
              {loadedItems.length === 0 && (
                <Button variant="outline" size="sm" onClick={() => { if (!navigator.onLine) { toast({ title: "Not available offline", description: "Auto-populate requires a connection" }); return; } autoPopulateMutation.mutate(); }} disabled={autoPopulateMutation.isPending} data-testid="button-load-from-pos">
                  <RefreshCw className={`mr-1 h-3 w-3 ${autoPopulateMutation.isPending ? "animate-spin" : ""}`} />
                  Load from POs
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} data-testid="button-import-loaded">
                <Upload className="mr-1 h-3 w-3" />
                Import
              </Button>
              <Button size="sm" onClick={() => setAddingItem(true)} data-testid="button-add-loaded">
                <Plus className="mr-1 h-3 w-3" />
                Add
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-80 overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-30 bg-background">
                  <TableRow>
                    <TableHead>Barcode</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Wt/Bale</TableHead>
                    <TableHead className="text-right">Price/Bale</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {addingItem && (
                    <TableRow>
                      <TableCell><Input value={newItem.barcode} onChange={(e) => setNewItem({ ...newItem, barcode: e.target.value })} placeholder="Barcode" className="h-8 text-xs" data-testid="input-new-loaded-barcode" /></TableCell>
                      <TableCell><Input value={newItem.itemName} onChange={(e) => setNewItem({ ...newItem, itemName: e.target.value })} placeholder="Name" className="h-8 text-xs" data-testid="input-new-loaded-name" /></TableCell>
                      <TableCell><Input type="number" value={newItem.qty} onChange={(e) => setNewItem({ ...newItem, qty: e.target.value })} className="h-8 text-xs w-14 text-right" data-testid="input-new-loaded-qty" /></TableCell>
                      <TableCell><Input type="number" step="0.001" value={newItem.weightPerBale} onChange={(e) => setNewItem({ ...newItem, weightPerBale: e.target.value })} className="h-8 text-xs w-16 text-right" /></TableCell>
                      <TableCell><Input type="number" step="0.01" value={newItem.pricePerBale} onChange={(e) => setNewItem({ ...newItem, pricePerBale: e.target.value })} className="h-8 text-xs w-16 text-right" /></TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" onClick={() => addItemMutation.mutate(newItem)}><Save className="h-3 w-3" /></Button>
                          <Button size="icon" variant="ghost" onClick={() => setAddingItem(false)}><X className="h-3 w-3" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {loadedItems.map((item) => (
                    <TableRow key={item.id}>
                      {editingItemId === item.id ? (
                        <>
                          <TableCell><Input value={editItemData.barcode} onChange={(e) => setEditItemData({ ...editItemData, barcode: e.target.value })} className="h-8 text-xs" /></TableCell>
                          <TableCell><Input value={editItemData.itemName} onChange={(e) => setEditItemData({ ...editItemData, itemName: e.target.value })} className="h-8 text-xs" /></TableCell>
                          <TableCell><Input type="number" value={editItemData.qty} onChange={(e) => setEditItemData({ ...editItemData, qty: e.target.value })} className="h-8 text-xs w-14 text-right" /></TableCell>
                          <TableCell><Input type="number" step="0.001" value={editItemData.weightPerBale} onChange={(e) => setEditItemData({ ...editItemData, weightPerBale: e.target.value })} className="h-8 text-xs w-16 text-right" /></TableCell>
                          <TableCell><Input type="number" step="0.01" value={editItemData.pricePerBale} onChange={(e) => setEditItemData({ ...editItemData, pricePerBale: e.target.value })} className="h-8 text-xs w-16 text-right" /></TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button size="icon" variant="ghost" onClick={() => updateItemMutation.mutate({ id: item.id, data: editItemData })}><Save className="h-3 w-3" /></Button>
                              <Button size="icon" variant="ghost" onClick={() => setEditingItemId(null)}><X className="h-3 w-3" /></Button>
                            </div>
                          </TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell className="font-mono text-xs">{item.barcode}</TableCell>
                          <TableCell className="text-xs">{item.itemName || "-"}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{item.qty}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{item.weightPerBale ? parseFloat(item.weightPerBale).toFixed(3) : "-"}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{item.pricePerBale ? parseFloat(item.pricePerBale).toFixed(2) : "-"}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button size="icon" variant="ghost" onClick={() => startEdit(item)}><Pencil className="h-3 w-3" /></Button>
                              <Button size="icon" variant="ghost" onClick={() => deleteItemMutation.mutate(item.id)}><Trash2 className="h-3 w-3" /></Button>
                            </div>
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                  {loadedItems.length === 0 && !addingItem && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-6">No loaded items. Add manually or import from Excel.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Generate Comparison</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-xs font-medium mb-1 block">Supplier</label>
              <Select value={selectedSupplierId} onValueChange={(v) => { setSelectedSupplierId(v); setSelectedProformaId(""); setVerificationResult(null); }}>
                <SelectTrigger data-testid="select-supplier">
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s: any) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.legalName || s.name || s.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Proforma</label>
              <Select value={selectedProformaId} onValueChange={setSelectedProformaId} disabled={!selectedSupplierId}>
                <SelectTrigger data-testid="select-proforma">
                  <SelectValue placeholder={selectedSupplierId ? "Select proforma" : "Select a supplier first"} />
                </SelectTrigger>
                <SelectContent>
                  {proformas.map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.reference}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={generateComparison} disabled={!selectedSupplierId || !selectedProformaId} className="flex-1" data-testid="button-generate-comparison">
                <FileCheck className="mr-2 h-4 w-4" />
                Generate Comparison
              </Button>
              {verificationResult && (
                <>
                  <Button variant="outline" onClick={exportToExcel} data-testid="button-export-excel">
                    <Download className="mr-1 h-4 w-4" />
                    Excel
                  </Button>
                  <Button variant="outline" onClick={exportSummaryExcel} data-testid="button-export-summary-excel">
                    <Download className="mr-1 h-4 w-4" />
                    Summary
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {verificationResult && (
        <>
          <div className="flex items-center gap-2 mb-4">
            <Button
              variant={viewMode === "summary" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode(viewMode === "summary" ? "detailed" : "summary")}
              className="toggle-elevate"
              data-testid="button-toggle-summary"
            >
              <List className="mr-1.5 h-3.5 w-3.5" />
              {viewMode === "summary" ? "Hide Summary" : "Show Summary"}
            </Button>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                  <div className="flex items-center gap-2">
                    <ArrowUpRight className="h-4 w-4 text-red-500" />
                    <CardTitle className="text-sm">Overloaded ({overloaded.length})</CardTitle>
                  </div>
                  <Badge variant="secondary">{overloaded.length}</Badge>
                </CardHeader>
                <CardContent>
                  {overloaded.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">None</p>
                  ) : (
                    <div className="max-h-[400px] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 z-30 bg-background">
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right">Expected</TableHead>
                          <TableHead className="text-right">Loaded</TableHead>
                          <TableHead className="text-right">Excess</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {overloaded.map((c) => (
                          <TableRow key={c.barcode}>
                            <TableCell>
                              <div className="text-xs font-medium">{c.itemName}</div>
                              <div className="text-xs text-muted-foreground font-mono">{c.barcode}</div>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">{c.expectedQty}</TableCell>
                            <TableCell className="text-right font-mono text-xs text-red-600 dark:text-red-400">{c.loadedQty}</TableCell>
                            <TableCell className="text-right font-mono text-xs text-red-600 dark:text-red-400">+{c.loadedQty - c.expectedQty}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-muted/50 font-bold">
                          <TableCell className="text-xs font-bold">Total ({overloaded.length} items)</TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold">{overloaded.reduce((s, c) => s + c.expectedQty, 0)}</TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold text-red-600 dark:text-red-400">{overloaded.reduce((s, c) => s + c.loadedQty, 0)}</TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold text-red-600 dark:text-red-400">+{overloaded.reduce((s, c) => s + (c.loadedQty - c.expectedQty), 0)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                  <div className="flex items-center gap-2">
                    <ArrowDownRight className="h-4 w-4 text-amber-500" />
                    <CardTitle className="text-sm">Less Loaded / Missing ({lessLoaded.length})</CardTitle>
                  </div>
                  <Badge variant="secondary">{lessLoaded.length}</Badge>
                </CardHeader>
                <CardContent>
                  {lessLoaded.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">None</p>
                  ) : (
                    <div className="max-h-[400px] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 z-30 bg-background">
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right">Expected</TableHead>
                          <TableHead className="text-right">Loaded</TableHead>
                          <TableHead className="text-right">Short</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lessLoaded.map((c) => (
                          <TableRow key={c.barcode}>
                            <TableCell>
                              <div className="text-xs font-medium">{c.itemName}</div>
                              <div className="text-xs text-muted-foreground font-mono">{c.barcode}</div>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">{c.expectedQty}</TableCell>
                            <TableCell className="text-right font-mono text-xs text-amber-600 dark:text-amber-400">{c.loadedQty}</TableCell>
                            <TableCell className="text-right font-mono text-xs text-amber-600 dark:text-amber-400">-{c.expectedQty - c.loadedQty}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-muted/50 font-bold">
                          <TableCell className="text-xs font-bold">Total ({lessLoaded.length} items)</TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold">{lessLoaded.reduce((s, c) => s + c.expectedQty, 0)}</TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold text-amber-600 dark:text-amber-400">{lessLoaded.reduce((s, c) => s + c.loadedQty, 0)}</TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold text-amber-600 dark:text-amber-400">-{lessLoaded.reduce((s, c) => s + (c.expectedQty - c.loadedQty), 0)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-500" />
                    <CardTitle className="text-sm">Not Requested ({notRequested.length})</CardTitle>
                  </div>
                  <Badge variant="secondary">{notRequested.length}</Badge>
                </CardHeader>
                <CardContent>
                  {notRequested.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">None</p>
                  ) : (
                    <div className="max-h-[400px] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 z-30 bg-background">
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right">Loaded Qty</TableHead>
                          <TableHead className="text-right">Total Weight</TableHead>
                          <TableHead className="text-right">Total Value</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {notRequested.map((c) => (
                          <TableRow key={c.barcode}>
                            <TableCell>
                              <div className="text-xs font-medium">{c.itemName}</div>
                              <div className="text-xs text-muted-foreground font-mono">{c.barcode}</div>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-orange-600 dark:text-orange-400">{c.loadedQty}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{c.loadedWeightTotal.toFixed(3)}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{c.loadedTotalValue.toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-muted/50 font-bold">
                          <TableCell className="text-xs font-bold">Total ({notRequested.length} items)</TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold text-orange-600 dark:text-orange-400">{notRequested.reduce((s, c) => s + c.loadedQty, 0)}</TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold">{notRequested.reduce((s, c) => s + c.loadedWeightTotal, 0).toFixed(3)}</TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold">{notRequested.reduce((s, c) => s + c.loadedTotalValue, 0).toFixed(2)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-blue-500" />
                    <CardTitle className="text-sm">Price Differences ({priceDiffs.length})</CardTitle>
                  </div>
                  <Badge variant="secondary">{priceDiffs.length}</Badge>
                </CardHeader>
                <CardContent>
                  {priceDiffs.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">None</p>
                  ) : (
                    <div className="max-h-[400px] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 z-30 bg-background">
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right">Proforma</TableHead>
                          <TableHead className="text-right">Loaded</TableHead>
                          <TableHead className="text-right">Diff/Bale</TableHead>
                          <TableHead className="text-right">Total Diff</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {priceDiffs.map((c) => (
                          <TableRow key={c.barcode}>
                            <TableCell>
                              <div className="text-xs font-medium">{c.itemName}</div>
                              <div className="text-xs text-muted-foreground font-mono">{c.barcode}</div>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">{c.expectedPricePerBale.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{c.loadedPricePerBale.toFixed(2)}</TableCell>
                            <TableCell className={`text-right font-mono text-xs ${c.priceDiffPerBale > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                              {c.priceDiffPerBale > 0 ? "+" : ""}{c.priceDiffPerBale.toFixed(2)}
                            </TableCell>
                            <TableCell className={`text-right font-mono text-xs ${c.totalPriceDiff > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                              {c.totalPriceDiff > 0 ? "+" : ""}{c.totalPriceDiff.toFixed(2)}
                            </TableCell>
                          </TableRow>
                        ))}
                        {(() => {
                          const totalDiff = priceDiffs.reduce((s, c) => s + c.totalPriceDiff, 0);
                          return (
                            <TableRow className="bg-muted/50 font-bold">
                              <TableCell className="text-xs font-bold">Total ({priceDiffs.length} items)</TableCell>
                              <TableCell></TableCell>
                              <TableCell></TableCell>
                              <TableCell></TableCell>
                              <TableCell className={`text-right font-mono text-xs font-bold ${totalDiff > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                                {totalDiff > 0 ? "+" : ""}{totalDiff.toFixed(2)}
                              </TableCell>
                            </TableRow>
                          );
                        })()}
                      </TableBody>
                    </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

          {viewMode === "summary" && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-6">
              <Card className="flex flex-col">
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <div className="flex items-center gap-2">
                    <ArrowUpRight className="h-4 w-4 text-red-500" />
                    <CardTitle className="text-xs">Overloaded</CardTitle>
                  </div>
                  <Badge variant="secondary">{overloaded.length}</Badge>
                </CardHeader>
                <CardContent className="flex-1 p-0">
                  {overloaded.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-3">None</p>
                  ) : (
                    <div className="max-h-[300px] overflow-y-auto">
                      <Table>
                        <TableHeader className="sticky top-0 z-30 bg-background">
                          <TableRow>
                            <TableHead className="text-xs py-1.5 px-3">Name</TableHead>
                            <TableHead className="text-xs text-right py-1.5 px-3">Excess</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {overloaded.map((c) => (
                            <TableRow key={c.barcode}>
                              <TableCell className="text-xs py-1.5 px-3">{c.itemName}</TableCell>
                              <TableCell className="text-right font-mono text-xs py-1.5 px-3 text-red-600 dark:text-red-400">+{c.loadedQty - c.expectedQty}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  {overloaded.length > 0 && (
                    <div className="border-t bg-muted/50 px-3 py-2 flex items-center justify-between gap-2 text-xs font-bold">
                      <span>Total ({overloaded.length})</span>
                      <span className="font-mono text-red-600 dark:text-red-400">+{overloaded.reduce((s, c) => s + (c.loadedQty - c.expectedQty), 0)}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="flex flex-col">
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <div className="flex items-center gap-2">
                    <ArrowDownRight className="h-4 w-4 text-amber-500" />
                    <CardTitle className="text-xs">Less Loaded</CardTitle>
                  </div>
                  <Badge variant="secondary">{lessLoaded.length}</Badge>
                </CardHeader>
                <CardContent className="flex-1 p-0">
                  {lessLoaded.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-3">None</p>
                  ) : (
                    <div className="max-h-[300px] overflow-y-auto">
                      <Table>
                        <TableHeader className="sticky top-0 z-30 bg-background">
                          <TableRow>
                            <TableHead className="text-xs py-1.5 px-3">Name</TableHead>
                            <TableHead className="text-xs text-right py-1.5 px-3">Short</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {lessLoaded.map((c) => (
                            <TableRow key={c.barcode}>
                              <TableCell className="text-xs py-1.5 px-3">{c.itemName}</TableCell>
                              <TableCell className="text-right font-mono text-xs py-1.5 px-3 text-amber-600 dark:text-amber-400">-{c.expectedQty - c.loadedQty}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  {lessLoaded.length > 0 && (
                    <div className="border-t bg-muted/50 px-3 py-2 flex items-center justify-between gap-2 text-xs font-bold">
                      <span>Total ({lessLoaded.length})</span>
                      <span className="font-mono text-amber-600 dark:text-amber-400">-{lessLoaded.reduce((s, c) => s + (c.expectedQty - c.loadedQty), 0)}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="flex flex-col">
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-500" />
                    <CardTitle className="text-xs">Not Requested</CardTitle>
                  </div>
                  <Badge variant="secondary">{notRequested.length}</Badge>
                </CardHeader>
                <CardContent className="flex-1 p-0">
                  {notRequested.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-3">None</p>
                  ) : (
                    <div className="max-h-[300px] overflow-y-auto">
                      <Table>
                        <TableHeader className="sticky top-0 z-30 bg-background">
                          <TableRow>
                            <TableHead className="text-xs py-1.5 px-3">Name</TableHead>
                            <TableHead className="text-xs text-right py-1.5 px-3">Qty</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {notRequested.map((c) => (
                            <TableRow key={c.barcode}>
                              <TableCell className="text-xs py-1.5 px-3">{c.itemName}</TableCell>
                              <TableCell className="text-right font-mono text-xs py-1.5 px-3 text-orange-600 dark:text-orange-400">{c.loadedQty}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  {notRequested.length > 0 && (
                    <div className="border-t bg-muted/50 px-3 py-2 flex items-center justify-between gap-2 text-xs font-bold">
                      <span>Total ({notRequested.length})</span>
                      <span className="font-mono text-orange-600 dark:text-orange-400">{notRequested.reduce((s, c) => s + c.loadedQty, 0)}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="flex flex-col">
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-blue-500" />
                    <CardTitle className="text-xs">Price Diff</CardTitle>
                  </div>
                  <Badge variant="secondary">{priceDiffs.length}</Badge>
                </CardHeader>
                <CardContent className="flex-1 p-0">
                  {priceDiffs.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-3">None</p>
                  ) : (
                    <div className="max-h-[300px] overflow-y-auto">
                      <Table>
                        <TableHeader className="sticky top-0 z-30 bg-background">
                          <TableRow>
                            <TableHead className="text-xs py-1.5 px-3">Name</TableHead>
                            <TableHead className="text-xs text-right py-1.5 px-3">Diff/Bale</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {priceDiffs.map((c) => (
                            <TableRow key={c.barcode}>
                              <TableCell className="text-xs py-1.5 px-3">{c.itemName}</TableCell>
                              <TableCell className={`text-right font-mono text-xs py-1.5 px-3 ${c.priceDiffPerBale > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                                {c.priceDiffPerBale > 0 ? "+" : ""}{c.priceDiffPerBale.toFixed(2)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  {priceDiffs.length > 0 && (() => {
                    const totalDiff = priceDiffs.reduce((s, c) => s + c.totalPriceDiff, 0);
                    return (
                      <div className="border-t bg-muted/50 px-3 py-2 flex items-center justify-between gap-2 text-xs font-bold">
                        <span>Total ({priceDiffs.length})</span>
                        <span className={`font-mono ${totalDiff > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                          {totalDiff > 0 ? "+" : ""}{totalDiff.toFixed(2)}
                        </span>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
