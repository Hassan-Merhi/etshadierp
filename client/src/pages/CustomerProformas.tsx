import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { useLocation } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Star, Pencil, FileText, Check, LayoutGrid, Download, RefreshCw, Lock, LockOpen } from "lucide-react";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { DeleteConfirmDialog } from "@/components/ConfirmationDialog";
import { PageHeader } from "@/components/PageHeader";

interface ProformaLine {
  id: number;
  proformaId: number;
  articleCode: string;
  productName: string;
  quantity: number;
  pricePerBale: string;
  priceFixed?: boolean;
  weightPerBaleKg?: string | null;
}

interface Proforma {
  id: number;
  customerId: number;
  companyId: number;
  name: string;
  isActive: boolean;
  lines: ProformaLine[];
}

interface Customer {
  id: number;
  legalName: string;
  balance: number;
  balanceSide: string;
}

export default function CustomerProformas() {
  const { toast } = useToast();
  const { formatAmount } = useCurrencyContext();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const [, navigate] = useLocation();
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [expandedProformaId, setExpandedProformaId] = useState<number | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newProformaName, setNewProformaName] = useState("");
  const [isAddLineOpen, setIsAddLineOpen] = useState(false);
  const [addLineProformaId, setAddLineProformaId] = useState<number | null>(null);
  const [newLine, setNewLine] = useState({ articleCode: "", productName: "", quantity: "", pricePerBale: "" });
  const [editingLine, setEditingLine] = useState<ProformaLine | null>(null);
  const [editLineValues, setEditLineValues] = useState({ productName: "", quantity: "", pricePerBale: "" });
  const [pendingDelete, setPendingDelete] = useState<(() => void) | null>(null);
  const [renamingProforma, setRenamingProforma] = useState<Proforma | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const customerId = selectedCustomerId ? parseInt(selectedCustomerId) : null;

  const { data: customers = [], isLoading: customersLoading } = useQuery<Customer[]>({
    queryKey: ["/api/factory/customers"],
  });

  const { data: proformas = [], isLoading: proformasLoading } = useQuery<Proforma[]>({
    queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId],
    enabled: !!customerId,
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
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const activateProformaMutation = useMutation({
    mutationFn: async (id: number) => {
      return await modeApiRequest("PUT", `/api/factory/customer-proformas/${id}`, { isActive: true });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Proforma set as active" });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId] });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
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
      if ((error as any)?._handledGlobally) return;
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
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
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
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
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
      if ((error as any)?._handledGlobally) return;
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
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const applyCatalogPricesMutation = useMutation({
    mutationFn: async (proformaId: number) => {
      const res = await modeApiRequest("POST", `/api/factory/customer-proformas/${proformaId}/apply-catalog-prices`, {});
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId] });
      const parts: string[] = [];
      if (result.updated) parts.push(`${result.updated} line(s) updated`);
      if (result.skipped) parts.push(`${result.skipped} skipped (no catalog price)`);
      if (result.fixed) parts.push(`${result.fixed} locked (price fixed)`);
      toast({ title: "Prices Applied", description: parts.join(", ") || "No changes made" });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleFixedMutation = useMutation({
    mutationFn: async (lineId: number) => {
      const res = await modeApiRequest("PATCH", `/api/factory/customer-proforma-lines/${lineId}/toggle-fixed`, {});
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId] });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
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
          <PageHeader title="Customer Proformas" subtitle="Manage customer-specific price lists for bale sales" />
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
            <Skeleton key={i} className="h-24 w-full" />
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
                    </button>
                    <div className="flex items-center gap-1">
                      {!proforma.isActive && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => activateProformaMutation.mutate(proforma.id)}
                          disabled={activateProformaMutation.isPending}
                          data-testid={`button-activate-proforma-${proforma.id}`}
                          title="Set as active"
                        >
                          <Star className="h-4 w-4" />
                        </Button>
                      )}
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
                              setAddLineProformaId(proforma.id);
                              setNewLine({ articleCode: "", productName: "", quantity: "", pricePerBale: "" });
                              setIsAddLineOpen(true);
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
                        <div className="table-responsive">
                          <Table>
                            <TableHeader className="sticky top-0 z-30 bg-background">
                              <TableRow>
                                <TableHead>Article Code</TableHead>
                                <TableHead>Product Name</TableHead>
                                <TableHead className="text-right">Qty</TableHead>
                                <TableHead className="text-right">Kg/Bale</TableHead>
                                <TableHead className="text-right">Price/Bale</TableHead>
                                <TableHead className="w-[100px]"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {proforma.lines.map((line) => (
                                <TableRow key={line.id} data-testid={`row-line-${line.id}`}>
                                  <TableCell className="font-mono text-sm" data-testid={`text-article-code-${line.id}`}>
                                    {line.articleCode}
                                  </TableCell>
                                  <TableCell data-testid={`text-product-name-${line.id}`}>
                                    {line.productName}
                                  </TableCell>
                                  <TableCell className="text-right font-mono" data-testid={`text-quantity-${line.id}`}>
                                    {line.quantity}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm" data-testid={`text-kg-bale-${line.id}`}>
                                    {(() => { const w = parseFloat(line.weightPerBaleKg || "0"); return w % 1 === 0 ? w.toLocaleString() : w.toFixed(2); })()}
                                  </TableCell>
                                  <TableCell className="text-right font-mono" data-testid={`text-price-${line.id}`}>
                                    <div className="flex items-center justify-end gap-1.5">
                                      {line.priceFixed && (
                                        <Lock className="h-3 w-3 text-amber-500 shrink-0" />
                                      )}
                                      <span>{formatAmount(parseFloat(line.pricePerBale))}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-1">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        title={line.priceFixed ? "Price is locked — click to unlock" : "Lock this price (won't change on Apply Catalog Prices)"}
                                        onClick={() => toggleFixedMutation.mutate(line.id)}
                                        disabled={toggleFixedMutation.isPending}
                                        data-testid={`button-toggle-fixed-${line.id}`}
                                      >
                                        {line.priceFixed
                                          ? <Lock className="h-3 w-3 text-amber-500" />
                                          : <LockOpen className="h-3 w-3 text-muted-foreground" />
                                        }
                                      </Button>
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
                              ))}
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
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Proforma Name</label>
              <Input
                value={newProformaName}
                onChange={(e) => setNewProformaName(e.target.value)}
                placeholder="e.g. Standard Prices Q1"
                data-testid="input-proforma-name"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsCreateOpen(false)} data-testid="button-cancel-create">
                Cancel
              </Button>
              <Button
                onClick={handleCreateProforma}
                disabled={createProformaMutation.isPending || !newProformaName.trim()}
                data-testid="button-submit-proforma"
              >
                {createProformaMutation.isPending ? "Creating..." : "Create"}
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
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">New Name</label>
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                placeholder="e.g. Standard Prices Q2"
                data-testid="input-rename-proforma"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && renameValue.trim() && renameValue.trim() !== renamingProforma?.name) {
                    renameProformaMutation.mutate({ id: renamingProforma!.id, name: renameValue.trim() });
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setRenamingProforma(null); setRenameValue(""); }} data-testid="button-cancel-rename">
                Cancel
              </Button>
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

      <Dialog open={isAddLineOpen} onOpenChange={(open) => {
        setIsAddLineOpen(open);
        if (!open) setAddLineProformaId(null);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Price Line</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Article Code</label>
              <Input
                value={newLine.articleCode}
                onChange={(e) => setNewLine({ ...newLine, articleCode: e.target.value })}
                placeholder="e.g. ART-001"
                data-testid="input-line-article-code"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Product Name</label>
              <Input
                value={newLine.productName}
                onChange={(e) => setNewLine({ ...newLine, productName: e.target.value })}
                placeholder="e.g. Mixed Grade A"
                data-testid="input-line-product-name"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Quantity</label>
              <Input
                type="number"
                step="1"
                min="1"
                value={newLine.quantity}
                onChange={(e) => setNewLine({ ...newLine, quantity: e.target.value })}
                placeholder="0"
                data-testid="input-line-quantity"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Price Per Bale</label>
              <Input
                type="number"
                step="0.01"
                value={newLine.pricePerBale}
                onChange={(e) => setNewLine({ ...newLine, pricePerBale: e.target.value })}
                placeholder="0.00"
                data-testid="input-line-price"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsAddLineOpen(false)} data-testid="button-cancel-add-line">
                Cancel
              </Button>
              <Button
                onClick={handleAddLine}
                disabled={addLineMutation.isPending || !newLine.articleCode.trim() || !newLine.productName.trim() || !newLine.quantity || !newLine.pricePerBale}
                data-testid="button-submit-line"
              >
                {addLineMutation.isPending ? "Adding..." : "Add Line"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingLine} onOpenChange={(open) => { if (!open) setEditingLine(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Price Line</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Article Code</label>
              <Input value={editingLine?.articleCode || ""} disabled data-testid="input-edit-article-code" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Product Name</label>
              <Input
                value={editLineValues.productName}
                onChange={(e) => setEditLineValues({ ...editLineValues, productName: e.target.value })}
                data-testid="input-edit-product-name"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Quantity</label>
              <Input
                type="number"
                step="1"
                min="1"
                value={editLineValues.quantity}
                onChange={(e) => setEditLineValues({ ...editLineValues, quantity: e.target.value })}
                data-testid="input-edit-quantity"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Price Per Bale</label>
              <Input
                type="number"
                step="0.01"
                value={editLineValues.pricePerBale}
                onChange={(e) => setEditLineValues({ ...editLineValues, pricePerBale: e.target.value })}
                data-testid="input-edit-price"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingLine(null)} data-testid="button-cancel-edit-line">
                Cancel
              </Button>
              <Button
                onClick={handleEditLine}
                disabled={editLineMutation.isPending || !editLineValues.pricePerBale || !editLineValues.quantity}
                data-testid="button-submit-edit-line"
              >
                <Check className="mr-1 h-4 w-4" />
                {editLineMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
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