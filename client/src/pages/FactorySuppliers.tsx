import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { FactorySupplier } from "@shared/schema";

export default function FactorySuppliers() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<FactorySupplier | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    contactPerson: "",
    phone: "",
    email: "",
    address: "",
    notes: "",
  });
  const { toast } = useToast();

  const { data: suppliers, isLoading } = useQuery<FactorySupplier[]>({
    queryKey: ["/api/factory/suppliers"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/factory/suppliers", data);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create supplier");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
      toast({ title: "Created", description: "Supplier added successfully" });
      resetForm();
      setCreateOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof formData }) => {
      const res = await apiRequest("PATCH", `/api/factory/suppliers/${id}`, data);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to update supplier");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
      toast({ title: "Updated", description: "Supplier updated successfully" });
      resetForm();
      setEditingSupplier(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/factory/suppliers/${id}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to delete supplier");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
      toast({ title: "Deleted", description: "Supplier deactivated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({ name: "", contactPerson: "", phone: "", email: "", address: "", notes: "" });
  };

  const openEdit = (s: FactorySupplier) => {
    setEditingSupplier(s);
    setFormData({
      name: s.name,
      contactPerson: s.contactPerson || "",
      phone: s.phone || "",
      email: s.email || "",
      address: s.address || "",
      notes: s.notes || "",
    });
  };

  const handleSubmit = () => {
    if (editingSupplier) {
      updateMutation.mutate({ id: editingSupplier.id, data: formData });
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
          <h1 className="text-3xl font-bold tracking-tight">Factory Suppliers</h1>
          <p className="text-muted-foreground mt-1">
            Manage suppliers for factory operations (separate from ERP suppliers)
          </p>
        </div>
        <Button
          onClick={() => { resetForm(); setCreateOpen(true); }}
          data-testid="button-add-factory-supplier"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Supplier
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">
              Suppliers ({activeSuppliers?.length || 0})
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {activeSuppliers && activeSuppliers.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeSuppliers.map((s) => (
                  <TableRow key={s.id} data-testid={`row-factory-supplier-${s.id}`}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-muted-foreground">{s.contactPerson || "-"}</TableCell>
                    <TableCell className="text-muted-foreground">{s.phone || "-"}</TableCell>
                    <TableCell className="text-muted-foreground">{s.email || "-"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(s)}
                          data-testid={`button-edit-supplier-${s.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(s.id)}
                          data-testid={`button-delete-supplier-${s.id}`}
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
              <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-lg font-medium">No factory suppliers yet</p>
              <p className="text-sm mt-1">Add your first factory supplier to get started</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen || !!editingSupplier} onOpenChange={(open) => {
        if (!open) { setCreateOpen(false); setEditingSupplier(null); resetForm(); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSupplier ? "Edit Supplier" : "Add Factory Supplier"}</DialogTitle>
            <DialogDescription>
              {editingSupplier ? "Update supplier details" : "Create a new factory supplier (separate from ERP suppliers)"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Supplier name"
                data-testid="input-supplier-name"
              />
            </div>
            <div>
              <Label>Contact Person</Label>
              <Input
                value={formData.contactPerson}
                onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                placeholder="Contact person name"
                data-testid="input-supplier-contact"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Phone</Label>
                <Input
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="Phone number"
                  data-testid="input-supplier-phone"
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="Email address"
                  data-testid="input-supplier-email"
                />
              </div>
            </div>
            <div>
              <Label>Address</Label>
              <Input
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Address"
                data-testid="input-supplier-address"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Input
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Notes"
                data-testid="input-supplier-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setCreateOpen(false); setEditingSupplier(null); resetForm(); }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!formData.name || createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-supplier"
            >
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingSupplier ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
