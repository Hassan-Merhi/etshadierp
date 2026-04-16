import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient, keyStartsWith } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Star, Pencil, FileText, Check, LayoutGrid, Download, RefreshCw, Search, BookOpen, PenLine, Truck, ArrowRightLeft, Clock } from "lucide-react";
import { DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { DeleteConfirmDialog } from "@/components/ConfirmationDialog";

interface ProformaLine {
  id: number;
  proformaId: number;
  articleCode: string;
  productName: string;
  quantity: number;
  pricePerBale: string;
  weightPerBaleKg?: string | null;
}

interface Proforma {
  id: number;
  customerId: number;
  companyId: number;
  name: string;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  lines: ProformaLine[];
}

interface Customer {
  id: number;
  legalName: string;
  balance: number;
  balanceSide: string;
}

export default function FactoryProformas() {
  const { toast } = useToast();
  const { formatAmount } = useCurrencyContext();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const [, navigate] = useLocation();
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("customerId") || "";
  });
  const [expandedProformaId, setExpandedProformaId] = useState<number | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newProformaName, setNewProformaName] = useState("");
  const [isAddLineOpen, setIsAddLineOpen] = useState(false);
  const [addLineProformaId, setAddLineProformaId] = useState<number | null>(null);
  const [newLine, setNewLine] = useState({ articleCode: "", productName: "", quantity: "", pricePerBale: "" });
  const [editingLine, setEditingLine] = useState<ProformaLine | null>(null);
  const [editLineValues, setEditLineValues] = useState({ productName: "", quantity: "", pricePerBale: "" });
  const [pendingDelete, setPendingDelete] = useState<(() => void) | null>(null);
  const [inlineQtyLineId, setInlineQtyLineId] = useState<number | null>(null);
  const [inlineQtyValue, setInlineQtyValue] = useState<string>("");
  const [renamingProforma, setRenamingProforma] = useState<Proforma | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [addLineMode, setAddLineMode] = useState<"manual" | "catalog">("catalog");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogSelectedItem, setCatalogSelectedItem] = useState<any | null>(null);
  const [createLoadingProforma, setCreateLoadingProforma] = useState<Proforma | null>(null);
  const [createLoadingLocationId, setCreateLoadingLocationId] = useState<string>("");
  const [transferProforma, setTransferProforma] = useState<Proforma | null>(null);
  const [transferTargetCustomerId, setTransferTargetCustomerId] = useState<string>("");

  const customerId = selectedCustomerId ? parseInt(selectedCustomerId) : null;

  const { data: customers = [], isLoading: customersLoading } = useQuery<Customer[]>({
    queryKey: ["/api/factory/customers"],
  });

  const { data: proformas = [], isLoading: proformasLoading } = useQuery<Proforma[]>({
    queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId],
    enabled: !!customerId,
  });

  const { data: allStockItems = [] } = useQuery<any[]>({
    queryKey: ["/api/stock-items"],
    enabled: isAddLineOpen && addLineMode === "catalog",
  });

  const { data: locations = [] } = useQuery<{ id: number; name: string; code: string }[]>({
    queryKey: ["/api/locations"],
    enabled: !!createLoadingProforma,
  });

  const createLoadingMutation = useMutation({
    mutationFn: async ({ proformaId, locationId }: { proformaId: number; locationId: string }) => {
      const res = await modeApiRequest("POST", `/api/factory/customer-proformas/${proformaId}/create-loading`, { locationId: parseInt(locationId) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: (data) => {
      const balesAdded = data.balesAdded ?? 0;
      toast({
        title: "Pending Loading Created",
        description: `Loading #${data.order.id} created — ${balesAdded} bale${balesAdded !== 1 ? "s" : ""} added from stock`,
      });
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-orders") });
      setCreateLoadingProforma(null);
      setCreateLoadingLocationId("");
      navigate("/factory/sales/loadings");
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createProformaMutation = useMutation({
    mutationFn: async (data: { customerId: number; name: string; isActive: boolean }) => {
      return await modeApiRequest("POST", "/api/factory/customer-proformas", data);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Proforma created successfully" });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId] });
      setIsCreateOpen(false);
      setNewProformaName("");
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      return await modeApiRequest("PUT", `/api/factory/customer-proformas/${id}`, { isActive });
    },
    onSuccess: (_, vars) => {
      toast({ title: vars.isActive ? "Proforma activated" : "Proforma deactivated" });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId] });
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteProformaMutation = useMutation({
    mutationFn: async (id: number) => {
      return await modeApiRequest("DELETE", `/api/factory/customer-proformas/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Proforma deleted" });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId] });
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const renameProformaMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      return await modeApiRequest("PUT", `/api/factory/customer-proformas/${id}`, { name });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Proforma renamed successfully" });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId] });
      setRenamingProforma(null);
      setRenameValue("");
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const transferProformaMutation = useMutation({
    mutationFn: async ({ id, targetCustomerId }: { id: number; targetCustomerId: number }) => {
      return await modeApiRequest("PATCH", `/api/factory/customer-proformas/${id}/transfer`, { targetCustomerId });
    },
    onSuccess: (data: any) => {
      toast({ title: "Proforma transferred", description: `Proforma moved to ${data.targetCustomerName}` });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId] });
      setTransferProforma(null);
      setTransferTargetCustomerId("");
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Transfer failed", description: error.message, variant: "destructive" });
    },
  });

  const addLineMutation = useMutation({
    mutationFn: async (data: { proformaId: number; articleCode: string; productName: string; quantity: number; pricePerBale: string }) => {
      return await modeApiRequest("POST", "/api/factory/customer-proforma-lines", data);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Line added" });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId] });
      setIsAddLineOpen(false);
      setAddLineProformaId(null);
      setNewLine({ articleCode: "", productName: "", quantity: "", pricePerBale: "" });
      setCatalogSelectedItem(null);
      setCatalogSearch("");
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const editLineMutation = useMutation({
    mutationFn: async (data: { id: number; pricePerBale: string; productName: string; quantity: string }) => {
      return await modeApiRequest("PUT", `/api/factory/customer-proforma-lines/${data.id}`, {
        pricePerBale: data.pricePerBale,
        productName: data.productName,
        quantity: data.quantity,
      });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Line updated" });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId] });
      setEditingLine(null);
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteLineMutation = useMutation({
    mutationFn: async (id: number) => {
      return await modeApiRequest("DELETE", `/api/factory/customer-proforma-lines/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Line deleted" });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId] });
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const inlineQtyMutation = useMutation({
    mutationFn: async ({ id, quantity }: { id: number; quantity: number }) => {
      const res = await modeApiRequest("PUT", `/api/factory/customer-proforma-lines/${id}`, { quantity });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId] });
      setInlineQtyLineId(null);
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setInlineQtyLineId(null);
    },
  });

  const commitInlineQty = (lineId: number) => {
    const qty = parseInt(inlineQtyValue);
    if (!isNaN(qty) && qty >= 1) {
      inlineQtyMutation.mutate({ id: lineId, quantity: qty });
    } else {
      setInlineQtyLineId(null);
    }
  };

  const formatProformaDate = (createdAt: string | null, updatedAt: string | null): { label: string; value: string } => {
    const created = createdAt ? new Date(createdAt) : null;
    const updated = updatedAt ? new Date(updatedAt) : null;
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    if (updated && created && (updated.getTime() - created.getTime() > 60_000)) {
      return { label: "Edited", value: fmt(updated) };
    }
    if (created) {
      return { label: "Created", value: fmt(created) };
    }
    return { label: "", value: "" };
  };

  const applyCatalogPricesMutation = useMutation({
    mutationFn: async (proformaId: number) => {
      const res = await modeApiRequest("POST", `/api/factory/customer-proformas/${proformaId}/apply-catalog-prices`, {});
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId] });
      const msg = result.skipped > 0
        ? `${result.updated} line(s) updated, ${result.skipped} skipped (no catalog price)`
        : `${result.updated} line(s) updated with catalog prices`;
      toast({ title: "Prices Applied", description: msg });
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateProforma = () => {
    if (!newProformaName.trim() || !customerId) return;
    createProformaMutation.mutate({
      customerId,
      name: newProformaName.trim(),
      isActive: false,
    });
  };

  const handleAddLine = () => {
    if (!addLineProformaId || !newLine.articleCode.trim() || !newLine.productName.trim() || !newLine.quantity || !newLine.pricePerBale) return;
    addLineMutation.mutate({
      proformaId: addLineProformaId,
      articleCode: newLine.articleCode.trim(),
      productName: newLine.productName.trim(),
      quantity: parseInt(newLine.quantity),
      pricePerBale: newLine.pricePerBale,
    });
  };

  const handleEditLine = () => {
    if (!editingLine || !editLineValues.pricePerBale || !editLineValues.quantity) return;
    editLineMutation.mutate({
      id: editingLine.id,
      pricePerBale: editLineValues.pricePerBale,
      productName: editLineValues.productName,
      quantity: editLineValues.quantity,
    });
  };

  return (
    <div className="flex flex-col h-full p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold" data-testid="text-page-title">Customer Proformas</h1>
          <p className="text-muted-foreground text-sm sm:text-base">Manage customer-specific price lists for bale sales</p>
        </div>
        {customerId && (
          <Button
            data-testid="button-create-proforma"
            onClick={() => setIsCreateOpen(true)}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Proforma
          </Button>
        )}
      </div>

      <div className="mb-6 max-w-sm">
        <label className="text-sm font-medium mb-2 block">Select Customer</label>
        {customersLoading ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <Select value={selectedCustomerId} onValueChange={(val) => {
            setSelectedCustomerId(val);
            setExpandedProformaId(null);
          }}>
            <SelectTrigger data-testid="select-customer">
              <SelectValue placeholder="Choose a customer..." />
            </SelectTrigger>
            <SelectContent>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id.toString()} data-testid={`select-customer-option-${c.id}`}>
                  {c.legalName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {customerId && proformasLoading && (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton className="h-24 w-full" key={i} />
          ))}
        </div>
      )}

      {customerId && !proformasLoading && proformas.length === 0 && (
        <div className="text-center py-12 text-muted-foreground" data-testid="text-no-proformas">
          <FileText className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p>No proformas found for this customer</p>
          <p className="text-sm mt-1">Create one to get started</p>
        </div>
      )}

      {!customerId && !customersLoading && (
        <div className="text-center py-12 text-muted-foreground" data-testid="text-select-customer">
          <FileText className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p>Select a customer to manage their proformas</p>
        </div>
      )}

      {customerId && !proformasLoading && proformas.length > 0 && (
        <div className="space-y-4">
          {proformas.map((proforma) => {
            const isExpanded = expandedProformaId === proforma.id;
            return (
              <Card key={proforma.id} data-testid={`card-proforma-${proforma.id}`}>
                <div className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      className="flex items-center gap-2 cursor-pointer text-left"
                      onClick={() => setExpandedProformaId(isExpanded ? null : proforma.id)}
                      data-testid={`button-expand-proforma-${proforma.id}`}
                    >
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold">{proforma.name}</span>
                      {proforma.isActive && (
                        <Badge variant="default" className="bg-green-600 text-white no-default-hover-elevate no-default-active-elevate" data-testid={`badge-active-${proforma.id}`}>
                          Active
                        </Badge>
                      )}
                      <Badge variant="secondary" data-testid={`badge-lines-count-${proforma.id}`}>
                        {proforma.lines?.length || 0} lines
                      </Badge>
                      {(() => {
                        const d = formatProformaDate(proforma.createdAt, proforma.updatedAt);
                        return d.value ? (
                          <span className="text-xs text-muted-foreground" data-testid={`text-proforma-date-${proforma.id}`}>
                            {d.label} {d.value}
                          </span>
                        ) : null;
                      })()}
                    </button>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setCreateLoadingProforma(proforma); setCreateLoadingLocationId(""); }}
                        data-testid={`button-create-loading-${proforma.id}`}
                        title="Create pending loading from this proforma"
                      >
                        <Truck className="h-4 w-4 mr-1" />
                        Create Loading
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleActiveMutation.mutate({ id: proforma.id, isActive: !proforma.isActive })}
                        disabled={toggleActiveMutation.isPending}
                        data-testid={`button-toggle-active-proforma-${proforma.id}`}
                        title={proforma.isActive ? "Deactivate proforma" : "Set as active"}
                      >
                        <Star className={proforma.isActive ? "h-4 w-4 fill-yellow-400 text-yellow-500" : "h-4 w-4"} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setRenamingProforma(proforma);
                          setRenameValue(proforma.name);
                        }}
                        data-testid={`button-rename-proforma-${proforma.id}`}
                        title="Rename proforma"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setTransferProforma(proforma);
                          setTransferTargetCustomerId("");
                        }}
                        data-testid={`button-transfer-proforma-${proforma.id}`}
                        title="Transfer to another customer"
                      >
                        <ArrowRightLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setPendingDelete(() => () => deleteProformaMutation.mutate(proforma.id));
                        }}
                        disabled={deleteProformaMutation.isPending}
                        data-testid={`button-delete-proforma-${proforma.id}`}
                        title="Delete proforma"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4">
                      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                        <span className="text-sm font-medium text-muted-foreground">Price Lines</span>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              navigate(`/factory/location-inventory?editProformaId=${proforma.id}&editProformaName=${encodeURIComponent(proforma.name)}&editCustomerId=${proforma.customerId}`);
                            }}
                            data-testid={`button-edit-in-inventory-${proforma.id}`}
                          >
                            <LayoutGrid className="mr-1 h-3 w-3" />
                            Edit in Inventory
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => window.open(`/api/factory/customer-proformas/${proforma.id}/export/excel`, "_blank")}
                            data-testid={`button-export-excel-${proforma.id}`}
                          >
                            <Download className="mr-1 h-3 w-3" />
                            Excel
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (!navigator.onLine) { window.print(); return; }
                              window.open(`/api/factory/customer-proformas/${proforma.id}/export/pdf`, "_blank");
                            }}
                            data-testid={`button-export-pdf-${proforma.id}`}
                          >
                            <Download className="mr-1 h-3 w-3" />
                            PDF
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              navigate(`/factory/sales/proformas/${proforma.id}/add-line?customerId=${proforma.customerId}&proformaName=${encodeURIComponent(proforma.name)}`);
                            }}
                            data-testid={`button-add-line-${proforma.id}`}
                          >
                            <Plus className="mr-1 h-3 w-3" />
                            Add Line
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => applyCatalogPricesMutation.mutate(proforma.id)}
                            disabled={applyCatalogPricesMutation.isPending}
                            data-testid={`button-apply-catalog-prices-${proforma.id}`}
                          >
                            <RefreshCw className="mr-1 h-3 w-3" />
                            Apply Catalog Prices
                          </Button>
                        </div>
                      </div>

                      {proforma.lines && proforma.lines.length > 0 ? (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Article Code</TableHead>
                                <TableHead>Product Name</TableHead>
                                <TableHead className="text-right">Qty</TableHead>
                                <TableHead className="text-right">Kg/Bale</TableHead>
                                <TableHead className="text-right">Total Kg</TableHead>
                                <TableHead className="text-right">Price/Bale</TableHead>
                                <TableHead className="w-[80px]"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {proforma.lines.map((line) => {
                                const lineWt = parseFloat(line.weightPerBaleKg || "0");
                                const lineTotal = line.quantity * lineWt;
                                const isEditingQty = inlineQtyLineId === line.id;
                                return (
                                <TableRow key={line.id} data-testid={`row-line-${line.id}`}>
                                  <TableCell className="font-mono text-sm" data-testid={`text-article-code-${line.id}`}>
                                    {line.articleCode}
                                  </TableCell>
                                  <TableCell data-testid={`text-product-name-${line.id}`}>
                                    {line.productName}
                                  </TableCell>
                                  <TableCell className="text-right font-mono" data-testid={`text-quantity-${line.id}`}>
                                    {isEditingQty ? (
                                      <Input
                                        type="number"
                                        min="1"
                                        className="w-20 h-7 text-right font-mono text-sm ml-auto"
                                        value={inlineQtyValue}
                                        onChange={(e) => setInlineQtyValue(e.target.value)}
                                        onBlur={() => commitInlineQty(line.id)}
                                        onKeyDown={(e) => {
                                          if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault();
                                          if (e.key === "Enter") commitInlineQty(line.id);
                                          if (e.key === "Escape") setInlineQtyLineId(null);
                                        }}
                                        autoFocus
                                        data-testid={`input-inline-qty-${line.id}`}
                                      />
                                    ) : (
                                      <button
                                        className="font-mono hover:underline hover:text-primary cursor-pointer w-full text-right"
                                        title="Click to edit quantity"
                                        onClick={() => { setInlineQtyLineId(line.id); setInlineQtyValue(String(line.quantity)); }}
                                        data-testid={`button-inline-qty-${line.id}`}
                                      >
                                        {line.quantity}
                                      </button>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm" data-testid={`text-kg-bale-${line.id}`}>
                                    {lineWt % 1 === 0 ? lineWt.toLocaleString() : lineWt.toFixed(2)}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm text-muted-foreground" data-testid={`text-total-kg-${line.id}`}>
                                    {lineTotal > 0 ? (lineTotal % 1 === 0 ? lineTotal.toLocaleString() : lineTotal.toFixed(1)) : "—"}
                                  </TableCell>
                                  <TableCell className="text-right font-mono" data-testid={`text-price-${line.id}`}>
                                    {formatAmount(parseFloat(line.pricePerBale))}
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-1">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => {
                                          setEditingLine(line);
                                          setEditLineValues({
                                            productName: line.productName,
                                            quantity: String(line.quantity),
                                            pricePerBale: line.pricePerBale,
                                          });
                                        }}
                                        data-testid={`button-edit-line-${line.id}`}
                                      >
                                        <Pencil className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => {
                                          setPendingDelete(() => () => deleteLineMutation.mutate(line.id));
                                        }}
                                        disabled={deleteLineMutation.isPending}
                                        data-testid={`button-delete-line-${line.id}`}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                              })}
                            </TableBody>
                          </Table>
                          {(() => {
                            const totalQty = proforma.lines.reduce((s, l) => s + l.quantity, 0);
                            const totalWeight = proforma.lines.reduce((s, l) => s + l.quantity * parseFloat(l.weightPerBaleKg || "0"), 0);
                            const totalAmount = proforma.lines.reduce((s, l) => s + l.quantity * parseFloat(l.pricePerBale), 0);
                            return (
                              <div className="flex items-center gap-4 mt-3 pt-3 border-t flex-wrap">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs text-muted-foreground">Total Bales:</span>
                                  <span className="text-sm font-semibold" data-testid={`text-total-qty-${proforma.id}`}>{totalQty.toLocaleString()}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs text-muted-foreground">Total Weight:</span>
                                  <span className="text-sm font-semibold" data-testid={`text-total-weight-${proforma.id}`}>{totalWeight.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs text-muted-foreground">Total Amount:</span>
                                  <span className="text-sm font-semibold" data-testid={`text-total-amount-${proforma.id}`}>{formatAmount(totalAmount)}</span>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-4" data-testid={`text-no-lines-${proforma.id}`}>
                          No price lines yet
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Proforma</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Proforma Name</label>
              <Input
                placeholder="e.g. Summer 2024 Pricing"
                value={newProformaName}
                onChange={(e) => setNewProformaName(e.target.value)}
                data-testid="input-proforma-name"
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setIsCreateOpen(false)} data-testid="button-cancel-create">Cancel</Button>
              <Button
                onClick={handleCreateProforma}
                disabled={!newProformaName.trim() || createProformaMutation.isPending}
                data-testid="button-confirm-create"
              >
                Create Proforma
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renamingProforma} onOpenChange={(open) => { if (!open) { setRenamingProforma(null); setRenameValue(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Proforma</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">New Name</label>
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                placeholder="e.g. Summer 2024 Pricing"
                data-testid="input-rename-proforma"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && renameValue.trim() && renameValue.trim() !== renamingProforma?.name) {
                    renameProformaMutation.mutate({ id: renamingProforma!.id, name: renameValue.trim() });
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => { setRenamingProforma(null); setRenameValue(""); }} data-testid="button-cancel-rename">Cancel</Button>
              <Button
                onClick={() => renameProformaMutation.mutate({ id: renamingProforma!.id, name: renameValue.trim() })}
                disabled={renameProformaMutation.isPending || !renameValue.trim() || renameValue.trim() === renamingProforma?.name}
                data-testid="button-submit-rename"
              >
                {renameProformaMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Transfer Proforma Dialog ────────────────────────────────────── */}
      <Dialog open={!!transferProforma} onOpenChange={(open) => { if (!open) { setTransferProforma(null); setTransferTargetCustomerId(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Transfer Proforma</DialogTitle>
            <DialogDescription>
              Move <strong>{transferProforma?.name}</strong> to a different customer. All lines and reservations will be moved with it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Current Customer</label>
              <p className="text-sm text-muted-foreground">
                {customers.find((c: Customer) => c.id === transferProforma?.customerId)?.legalName ?? "—"}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Transfer To</label>
              <Select
                value={transferTargetCustomerId}
                onValueChange={setTransferTargetCustomerId}
              >
                <SelectTrigger data-testid="select-transfer-customer">
                  <SelectValue placeholder="Select customer..." />
                </SelectTrigger>
                <SelectContent>
                  {customers
                    .filter((c: Customer) => c.id !== transferProforma?.customerId)
                    .map((c: Customer) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.legalName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => { setTransferProforma(null); setTransferTargetCustomerId(""); }}
                data-testid="button-cancel-transfer"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (!transferProforma || !transferTargetCustomerId) return;
                  transferProformaMutation.mutate({ id: transferProforma.id, targetCustomerId: parseInt(transferTargetCustomerId) });
                }}
                disabled={!transferTargetCustomerId || transferProformaMutation.isPending}
                data-testid="button-confirm-transfer"
              >
                {transferProformaMutation.isPending ? "Transferring..." : "Transfer"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddLineOpen} onOpenChange={(open) => {
        setIsAddLineOpen(open);
        if (!open) { setCatalogSelectedItem(null); setCatalogSearch(""); }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Price Line</DialogTitle>
          </DialogHeader>

          {/* Mode toggle */}
          <div className="flex rounded-md border overflow-hidden w-full">
            <button
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors ${addLineMode === "catalog" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover-elevate"}`}
              onClick={() => { setAddLineMode("catalog"); setCatalogSelectedItem(null); setCatalogSearch(""); setNewLine({ articleCode: "", productName: "", quantity: newLine.quantity, pricePerBale: newLine.pricePerBale }); }}
              data-testid="button-mode-catalog"
            >
              <BookOpen className="h-4 w-4" />
              From Catalog
            </button>
            <button
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors ${addLineMode === "manual" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover-elevate"}`}
              onClick={() => { setAddLineMode("manual"); setCatalogSelectedItem(null); setNewLine({ articleCode: "", productName: "", quantity: "", pricePerBale: "" }); }}
              data-testid="button-mode-manual"
            >
              <PenLine className="h-4 w-4" />
              Manual Entry
            </button>
          </div>

          <div className="space-y-4 py-1">
            {addLineMode === "catalog" ? (
              <>
                {/* Item picker */}
                {!catalogSelectedItem ? (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by name or article code..."
                        value={catalogSearch}
                        onChange={(e) => setCatalogSearch(e.target.value)}
                        className="pl-8"
                        autoFocus
                        data-testid="input-catalog-search"
                      />
                    </div>
                    <div className="border rounded-md overflow-hidden max-h-64 overflow-y-auto">
                      {allStockItems.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">Loading items...</p>
                      ) : (() => {
                        const q = catalogSearch.toLowerCase().trim();
                        const filtered = q
                          ? allStockItems.filter((item: any) =>
                              item.name?.toLowerCase().includes(q) ||
                              item.code?.toLowerCase().includes(q)
                            )
                          : allStockItems;
                        if (filtered.length === 0) return (
                          <p className="text-sm text-muted-foreground text-center py-6">No items match "{catalogSearch}"</p>
                        );
                        return filtered.map((item: any) => (
                          <button
                            key={item.id}
                            className="w-full flex items-center justify-between px-3 py-2.5 text-left hover-elevate border-b last:border-b-0"
                            onClick={() => {
                              setCatalogSelectedItem(item);
                              setNewLine((prev) => ({ ...prev, articleCode: item.code || "", productName: item.name || "" }));
                            }}
                            data-testid={`button-catalog-item-${item.id}`}
                          >
                            <div>
                              <p className="text-sm font-medium">{item.name}</p>
                              {item.code && <p className="text-xs text-muted-foreground font-mono">{item.code}</p>}
                            </div>
                            {item.stockGroup?.name && (
                              <span className="text-xs text-muted-foreground ml-2 shrink-0">{item.stockGroup.name}</span>
                            )}
                          </button>
                        ));
                      })()}
                    </div>
                    <p className="text-xs text-muted-foreground">{allStockItems.length} items in catalog</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Selected item chip with change button */}
                    <div className="flex items-center gap-2 p-3 rounded-md bg-muted">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{catalogSelectedItem.name}</p>
                        {catalogSelectedItem.code && <p className="text-xs text-muted-foreground font-mono">{catalogSelectedItem.code}</p>}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setCatalogSelectedItem(null); setCatalogSearch(""); setNewLine((prev) => ({ ...prev, articleCode: "", productName: "", quantity: "", pricePerBale: "" })); }}
                        data-testid="button-change-item"
                      >
                        Change
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-1 block">Quantity</label>
                        <Input
                          type="number"
                          placeholder="e.g. 10"
                          value={newLine.quantity}
                          onChange={(e) => setNewLine({ ...newLine, quantity: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault(); }}
                          autoFocus
                          data-testid="input-line-quantity"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Price per Bale</label>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="e.g. 45.00"
                          value={newLine.pricePerBale}
                          onChange={(e) => setNewLine({ ...newLine, pricePerBale: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault(); }}
                          data-testid="input-line-price"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* Manual mode — existing form */
              <>
                <div>
                  <label className="text-sm font-medium mb-1 block">Article Code</label>
                  <Input
                    placeholder="e.g. 101"
                    value={newLine.articleCode}
                    onChange={(e) => setNewLine({ ...newLine, articleCode: e.target.value })}
                    data-testid="input-line-article-code"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Product Name</label>
                  <Input
                    placeholder="e.g. Mixed Cotton"
                    value={newLine.productName}
                    onChange={(e) => setNewLine({ ...newLine, productName: e.target.value })}
                    data-testid="input-line-product-name"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Quantity</label>
                    <Input
                      type="number"
                      value={newLine.quantity}
                      onChange={(e) => setNewLine({ ...newLine, quantity: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault(); }}
                      data-testid="input-line-quantity"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Price per Bale</label>
                    <Input
                      type="number"
                      step="0.01"
                      value={newLine.pricePerBale}
                      onChange={(e) => setNewLine({ ...newLine, pricePerBale: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault(); }}
                      data-testid="input-line-price"
                    />
                  </div>
                </div>
              </>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setIsAddLineOpen(false)} data-testid="button-cancel-add-line">Cancel</Button>
              <Button
                onClick={handleAddLine}
                disabled={
                  !newLine.articleCode ||
                  !newLine.productName ||
                  !newLine.quantity ||
                  !newLine.pricePerBale ||
                  addLineMutation.isPending ||
                  (addLineMode === "catalog" && !catalogSelectedItem)
                }
                data-testid="button-confirm-add-line"
              >
                {addLineMutation.isPending ? "Adding..." : "Add Line"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingLine} onOpenChange={(open) => !open && setEditingLine(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Price Line</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-muted p-3 rounded-md mb-2">
              <p className="text-sm font-semibold">{editingLine?.articleCode}</p>
              <p className="text-xs text-muted-foreground">{editingLine?.productName}</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Product Name</label>
              <Input
                value={editLineValues.productName}
                onChange={(e) => setEditLineValues({ ...editLineValues, productName: e.target.value })}
                data-testid="input-edit-line-product-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Quantity</label>
                <Input
                  type="number"
                  value={editLineValues.quantity}
                  onChange={(e) => setEditLineValues({ ...editLineValues, quantity: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault(); }}
                  data-testid="input-edit-line-quantity"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Price per Bale</label>
                <Input
                  type="number"
                  step="0.01"
                  value={editLineValues.pricePerBale}
                  onChange={(e) => setEditLineValues({ ...editLineValues, pricePerBale: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault(); }}
                  data-testid="input-edit-line-price"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setEditingLine(null)} data-testid="button-cancel-edit-line">Cancel</Button>
              <Button
                onClick={handleEditLine}
                disabled={!editLineValues.pricePerBale || !editLineValues.quantity || editLineMutation.isPending}
                data-testid="button-confirm-edit-line"
              >
                Save Changes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!createLoadingProforma} onOpenChange={(open) => { if (!open) { setCreateLoadingProforma(null); setCreateLoadingLocationId(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Pending Loading</DialogTitle>
            <DialogDescription>
              A new loading will be created from <strong>{createLoadingProforma?.name}</strong>. Bales matching each proforma line will be automatically reserved from the selected location.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-sm font-medium mb-1 block">Warehouse Location</Label>
              <Select value={createLoadingLocationId} onValueChange={setCreateLoadingLocationId}>
                <SelectTrigger data-testid="select-loading-location">
                  <SelectValue placeholder="Select a location..." />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id.toString()} data-testid={`select-location-option-${loc.id}`}>
                      {loc.name} {loc.code ? `(${loc.code})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateLoadingProforma(null); setCreateLoadingLocationId(""); }} data-testid="button-cancel-create-loading">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!createLoadingProforma || !createLoadingLocationId) return;
                createLoadingMutation.mutate({ proformaId: createLoadingProforma.id, locationId: createLoadingLocationId });
              }}
              disabled={!createLoadingLocationId || createLoadingMutation.isPending}
              data-testid="button-confirm-create-loading"
            >
              {createLoadingMutation.isPending ? "Creating..." : "Create Loading"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        onConfirm={() => { pendingDelete?.(); setPendingDelete(null); }}
      />
    </div>
  );
}
