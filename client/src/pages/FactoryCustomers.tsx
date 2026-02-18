import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCompany } from "@/contexts/CompanyContext";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Search, Phone, User } from "lucide-react";

interface Customer {
  id: number;
  code: string;
  legalName: string;
  phone: string | null;
  openingBalance: string | null;
  openingBalanceSide: string | null;
  active: boolean;
  balance?: number;
  balanceSide?: string;
}

export default function FactoryCustomers() {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formData, setFormData] = useState({
    legalName: "",
    phone: "",
    openingBalance: "",
    openingBalanceSide: "Dr",
  });

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ["/api/factory/customers", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { legalName: string; phone?: string; openingBalance?: string; openingBalanceSide?: string }) => {
      return await apiRequest("POST", "/api/factory/customers", data);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Customer created" });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customers", selectedCompany?.id] });
      setIsCreateOpen(false);
      resetForm();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      return await apiRequest("PUT", `/api/factory/customers/${id}`, data);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Customer updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customers", selectedCompany?.id] });
      setEditingCustomer(null);
      resetForm();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({ legalName: "", phone: "", openingBalance: "", openingBalanceSide: "Dr" });
  };

  const openCreate = () => {
    resetForm();
    setIsCreateOpen(true);
  };

  const openEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setFormData({
      legalName: customer.legalName,
      phone: customer.phone || "",
      openingBalance: customer.openingBalance || "",
      openingBalanceSide: customer.openingBalanceSide || "Dr",
    });
  };

  const handleCreate = () => {
    if (!formData.legalName.trim()) return;
    createMutation.mutate({
      legalName: formData.legalName.trim(),
      phone: formData.phone.trim() || undefined,
      openingBalance: formData.openingBalance || undefined,
      openingBalanceSide: formData.openingBalanceSide || undefined,
    });
  };

  const handleUpdate = () => {
    if (!editingCustomer || !formData.legalName.trim()) return;
    updateMutation.mutate({
      id: editingCustomer.id,
      data: {
        legalName: formData.legalName.trim(),
        phone: formData.phone.trim() || null,
      },
    });
  };

  const filtered = customers.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.legalName.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) || (c.phone && c.phone.includes(q));
  });

  if (isLoading) {
    return (
      <div className="flex flex-col h-full p-6 gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Customers</h1>
          <p className="text-sm text-muted-foreground">{customers.length} total customers</p>
        </div>
        <Button onClick={openCreate} data-testid="button-add-customer">
          <Plus className="h-4 w-4 mr-2" />
          Add Customer
        </Button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, code, or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          data-testid="input-search-customers"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      {search ? "No customers match your search" : "No customers yet"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((customer) => (
                    <TableRow key={customer.id} data-testid={`row-customer-${customer.id}`}>
                      <TableCell className="font-mono text-sm" data-testid={`text-customer-code-${customer.id}`}>
                        {customer.code}
                      </TableCell>
                      <TableCell className="font-medium" data-testid={`text-customer-name-${customer.id}`}>
                        {customer.legalName}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {customer.phone || "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {customer.balance !== undefined ? (
                          <span data-testid={`text-customer-balance-${customer.id}`}>
                            {customer.balance.toFixed(2)}{" "}
                            <span className="text-xs text-muted-foreground">{customer.balanceSide}</span>
                          </span>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={customer.active ? "default" : "secondary"} data-testid={`badge-customer-status-${customer.id}`}>
                          {customer.active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(customer)}
                          data-testid={`button-edit-customer-${customer.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isCreateOpen} onOpenChange={(open) => { if (!open) { setIsCreateOpen(false); resetForm(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Add Customer
            </DialogTitle>
            <DialogDescription>
              A unique customer code will be generated automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Name</label>
              <Input
                value={formData.legalName}
                onChange={(e) => setFormData({ ...formData, legalName: e.target.value })}
                placeholder="Customer name"
                data-testid="input-customer-name"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Phone</label>
              <Input
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="Phone number"
                data-testid="input-customer-phone"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Opening Balance</label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.openingBalance}
                  onChange={(e) => setFormData({ ...formData, openingBalance: e.target.value })}
                  placeholder="0.00"
                  data-testid="input-customer-opening-balance"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Side</label>
                <Select
                  value={formData.openingBalanceSide}
                  onValueChange={(v) => setFormData({ ...formData, openingBalanceSide: v })}
                >
                  <SelectTrigger data-testid="select-balance-side">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Dr">Debit (Dr)</SelectItem>
                    <SelectItem value="Cr">Credit (Cr)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setIsCreateOpen(false); resetForm(); }} data-testid="button-cancel-create">
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={createMutation.isPending || !formData.legalName.trim()}
                data-testid="button-submit-customer"
              >
                {createMutation.isPending ? "Creating..." : "Create Customer"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingCustomer} onOpenChange={(open) => { if (!open) { setEditingCustomer(null); resetForm(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5" />
              Edit Customer
            </DialogTitle>
            <DialogDescription>
              {editingCustomer ? `Editing ${editingCustomer.code}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Name</label>
              <Input
                value={formData.legalName}
                onChange={(e) => setFormData({ ...formData, legalName: e.target.value })}
                placeholder="Customer name"
                data-testid="input-edit-customer-name"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Phone</label>
              <Input
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="Phone number"
                data-testid="input-edit-customer-phone"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setEditingCustomer(null); resetForm(); }} data-testid="button-cancel-edit">
                Cancel
              </Button>
              <Button
                onClick={handleUpdate}
                disabled={updateMutation.isPending || !formData.legalName.trim()}
                data-testid="button-submit-edit-customer"
              >
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
