import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCompany } from "@/contexts/CompanyContext";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Star, Pencil, FileText, Check } from "lucide-react";

interface ProformaLine {
  id: number;
  proformaId: number;
  articleCode: string;
  productName: string;
  pricePerBale: string;
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
  const { selectedCompany } = useCompany();
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [expandedProformaId, setExpandedProformaId] = useState<number | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newProformaName, setNewProformaName] = useState("");
  const [isAddLineOpen, setIsAddLineOpen] = useState(false);
  const [addLineProformaId, setAddLineProformaId] = useState<number | null>(null);
  const [newLine, setNewLine] = useState({ articleCode: "", productName: "", pricePerBale: "" });
  const [editingLine, setEditingLine] = useState<ProformaLine | null>(null);
  const [editLineValues, setEditLineValues] = useState({ productName: "", pricePerBale: "" });

  const customerId = selectedCustomerId ? parseInt(selectedCustomerId) : null;

  const { data: customers = [], isLoading: customersLoading } = useQuery<Customer[]>({
    queryKey: ["/api/customers/stats", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
  });

  const { data: proformas = [], isLoading: proformasLoading } = useQuery<Proforma[]>({
    queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId],
    enabled: !!customerId,
  });

  const createProformaMutation = useMutation({
    mutationFn: async (data: { customerId: number; companyId: number; name: string; isActive: boolean }) => {
      return await apiRequest("POST", "/api/factory/customer-proformas", data);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Proforma created successfully" });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId] });
      setIsCreateOpen(false);
      setNewProformaName("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const activateProformaMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("PUT", `/api/factory/customer-proformas/${id}`, { isActive: true });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Proforma set as active" });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteProformaMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/factory/customer-proformas/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Proforma deleted" });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const addLineMutation = useMutation({
    mutationFn: async (data: { proformaId: number; articleCode: string; productName: string; pricePerBale: string }) => {
      return await apiRequest("POST", "/api/factory/customer-proforma-lines", data);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Line added" });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId] });
      setIsAddLineOpen(false);
      setAddLineProformaId(null);
      setNewLine({ articleCode: "", productName: "", pricePerBale: "" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const editLineMutation = useMutation({
    mutationFn: async (data: { id: number; pricePerBale: string; productName: string }) => {
      return await apiRequest("PUT", `/api/factory/customer-proforma-lines/${data.id}`, {
        pricePerBale: data.pricePerBale,
        productName: data.productName,
      });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Line updated" });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId] });
      setEditingLine(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteLineMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/factory/customer-proforma-lines/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Line deleted" });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateProforma = () => {
    if (!newProformaName.trim() || !customerId || !selectedCompany?.id) return;
    createProformaMutation.mutate({
      customerId,
      companyId: selectedCompany.id,
      name: newProformaName.trim(),
      isActive: false,
    });
  };

  const handleAddLine = () => {
    if (!addLineProformaId || !newLine.articleCode.trim() || !newLine.productName.trim() || !newLine.pricePerBale) return;
    addLineMutation.mutate({
      proformaId: addLineProformaId,
      articleCode: newLine.articleCode.trim(),
      productName: newLine.productName.trim(),
      pricePerBale: newLine.pricePerBale,
    });
  };

  const handleEditLine = () => {
    if (!editingLine || !editLineValues.pricePerBale) return;
    editLineMutation.mutate({
      id: editingLine.id,
      pricePerBale: editLineValues.pricePerBale,
      productName: editLineValues.productName,
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
                          if (confirm("Delete this proforma?")) {
                            deleteProformaMutation.mutate(proforma.id);
                          }
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
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span className="text-sm font-medium text-muted-foreground">Price Lines</span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setAddLineProformaId(proforma.id);
                            setNewLine({ articleCode: "", productName: "", pricePerBale: "" });
                            setIsAddLineOpen(true);
                          }}
                          data-testid={`button-add-line-${proforma.id}`}
                        >
                          <Plus className="mr-1 h-3 w-3" />
                          Add Line
                        </Button>
                      </div>

                      {proforma.lines && proforma.lines.length > 0 ? (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Article Code</TableHead>
                                <TableHead>Product Name</TableHead>
                                <TableHead className="text-right">Price/Bale</TableHead>
                                <TableHead className="w-[80px]"></TableHead>
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
                                  <TableCell className="text-right font-mono" data-testid={`text-price-${line.id}`}>
                                    {parseFloat(line.pricePerBale).toFixed(2)}
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
                                          if (confirm("Delete this line?")) {
                                            deleteLineMutation.mutate(line.id);
                                          }
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
                disabled={addLineMutation.isPending || !newLine.articleCode.trim() || !newLine.productName.trim() || !newLine.pricePerBale}
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
                disabled={editLineMutation.isPending || !editLineValues.pricePerBale}
                data-testid="button-submit-edit-line"
              >
                <Check className="mr-1 h-4 w-4" />
                {editLineMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}