import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Container, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { formatNumber } from "@/lib/formatNumber";
import type { FactoryContainer, FactorySupplier } from "@shared/schema";

interface ContainerWithSupplier extends FactoryContainer {
  supplierName?: string | null;
}

export default function FactoryContainers() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editingContainer, setEditingContainer] = useState<ContainerWithSupplier | null>(null);
  const [formData, setFormData] = useState({
    containerNumber: "",
    supplierId: "",
    origin: "",
    totalKg: "",
    ratePerKg: "",
    arrivalDate: "",
    notes: "",
    status: "PENDING",
  });
  const { toast } = useToast();

  const { data: containers, isLoading } = useQuery<ContainerWithSupplier[]>({
    queryKey: ["/api/factory/containers"],
  });

  const { data: suppliers } = useQuery<FactorySupplier[]>({
    queryKey: ["/api/factory/suppliers"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const payload = {
        ...data,
        supplierId: data.supplierId ? parseInt(data.supplierId) : null,
      };
      const res = await apiRequest("POST", "/api/factory/containers", payload);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create container");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      toast({ title: "Created", description: "Container added successfully" });
      resetForm();
      setCreateOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof formData }) => {
      const payload = {
        ...data,
        supplierId: data.supplierId ? parseInt(data.supplierId) : null,
      };
      const res = await apiRequest("PATCH", `/api/factory/containers/${id}`, payload);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to update container");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      toast({ title: "Updated", description: "Container updated" });
      resetForm();
      setEditingContainer(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/factory/containers/${id}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to delete container");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      toast({ title: "Deleted", description: "Container removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      containerNumber: "",
      supplierId: "",
      origin: "",
      totalKg: "",
      ratePerKg: "",
      arrivalDate: "",
      notes: "",
      status: "PENDING",
    });
  };

  const openEdit = (c: ContainerWithSupplier) => {
    setEditingContainer(c);
    setFormData({
      containerNumber: c.containerNumber,
      supplierId: c.supplierId?.toString() || "",
      origin: c.origin || "",
      totalKg: c.totalKg || "",
      ratePerKg: c.ratePerKg || "",
      arrivalDate: c.arrivalDate || "",
      notes: c.notes || "",
      status: c.status,
    });
  };

  const handleSubmit = () => {
    if (editingContainer) {
      updateMutation.mutate({ id: editingContainer.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const activeSuppliers = suppliers?.filter((s) => s.isActive);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Factory Containers</h1>
          <p className="text-muted-foreground mt-1">
            Track incoming containers (separate from ERP containers)
          </p>
        </div>
        <Button
          onClick={() => { resetForm(); setCreateOpen(true); }}
          data-testid="button-add-factory-container"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Container
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Container className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">
              Containers ({containers?.length || 0})
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {containers && containers.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Container #</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Origin</TableHead>
                  <TableHead className="text-right">Total Kg</TableHead>
                  <TableHead className="text-right">Rate/Kg</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Arrival</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {containers.map((c) => (
                  <TableRow key={c.id} data-testid={`row-factory-container-${c.id}`}>
                    <TableCell className="font-medium font-mono">{c.containerNumber}</TableCell>
                    <TableCell className="text-muted-foreground">{c.supplierName || "-"}</TableCell>
                    <TableCell className="text-muted-foreground">{c.origin || "-"}</TableCell>
                    <TableCell className="text-right font-mono">
                      {c.totalKg ? formatNumber(parseFloat(c.totalKg)) : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {c.ratePerKg ? formatNumber(parseFloat(c.ratePerKg)) : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.status === "AVAILABLE" ? "default" : "secondary"}>
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {c.arrivalDate || "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(c)}
                          data-testid={`button-edit-container-${c.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(c.id)}
                          data-testid={`button-delete-container-${c.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Container className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-lg font-medium">No factory containers yet</p>
              <p className="text-sm mt-1">Add your first container to start tracking arrivals</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen || !!editingContainer} onOpenChange={(open) => {
        if (!open) { setCreateOpen(false); setEditingContainer(null); resetForm(); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingContainer ? "Edit Container" : "Add Factory Container"}</DialogTitle>
            <DialogDescription>
              {editingContainer ? "Update container details" : "Track a new incoming factory container"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Container Number *</Label>
              <Input
                value={formData.containerNumber}
                onChange={(e) => setFormData({ ...formData, containerNumber: e.target.value })}
                placeholder="e.g., CNTR-2024-001"
                data-testid="input-container-number"
              />
            </div>
            <div>
              <Label>Supplier</Label>
              <Select value={formData.supplierId} onValueChange={(val) => setFormData({ ...formData, supplierId: val })}>
                <SelectTrigger data-testid="select-container-supplier">
                  <SelectValue placeholder="Select factory supplier..." />
                </SelectTrigger>
                <SelectContent>
                  {activeSuppliers?.map((s) => (
                    <SelectItem key={s.id} value={s.id.toString()}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Origin</Label>
              <Input
                value={formData.origin}
                onChange={(e) => setFormData({ ...formData, origin: e.target.value })}
                placeholder="Country/city of origin"
                data-testid="input-container-origin"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Total Kg</Label>
                <Input
                  type="number"
                  value={formData.totalKg}
                  onChange={(e) => setFormData({ ...formData, totalKg: e.target.value })}
                  placeholder="0.000"
                  data-testid="input-container-total-kg"
                />
              </div>
              <div>
                <Label>Rate per Kg</Label>
                <Input
                  type="number"
                  value={formData.ratePerKg}
                  onChange={(e) => setFormData({ ...formData, ratePerKg: e.target.value })}
                  placeholder="0.00"
                  data-testid="input-container-rate"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Arrival Date</Label>
                <Input
                  type="date"
                  value={formData.arrivalDate}
                  onChange={(e) => setFormData({ ...formData, arrivalDate: e.target.value })}
                  data-testid="input-container-arrival"
                />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={(val) => setFormData({ ...formData, status: val })}>
                  <SelectTrigger data-testid="select-container-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="IN_TRANSIT">In Transit</SelectItem>
                    <SelectItem value="AVAILABLE">Available</SelectItem>
                    <SelectItem value="OFFLOADED">Offloaded</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Input
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Additional notes"
                data-testid="input-container-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setCreateOpen(false); setEditingContainer(null); resetForm(); }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!formData.containerNumber || createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-container"
            >
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingContainer ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
