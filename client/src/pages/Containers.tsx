import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Plus, Package, Eye, Search, Filter, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCompany } from "@/contexts/CompanyContext";
import { AddContainerDialog } from "../components/AddContainerDialog";
import type { Container, Supplier } from "@shared/schema";

export default function Containers() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("OTW");
  const [supplierFilter, setSupplierFilter] = useState("ALL");
  const [showFilters, setShowFilters] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const { selectedCompany } = useCompany();
  
  const { data: allContainers = [], isLoading } = useQuery<Container[]>({
    queryKey: ["/api/containers/active", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  // Apply all filters
  const containers = allContainers
    .filter((c) => {
      // Search filter
      if (searchTerm && !c.containerNumber.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }
      // Status filter
      if (statusFilter !== "ALL" && c.status !== statusFilter) {
        return false;
      }
      // Supplier filter
      if (supplierFilter !== "ALL" && c.supplierId.toString() !== supplierFilter) {
        return false;
      }
      return true;
    });

  const getSupplierName = (supplierId: number) => {
    const supplier = suppliers.find((s) => s.id === supplierId);
    return supplier ? supplier.legalName : "Unknown";
  };

  const clearFilters = () => {
    setStatusFilter("ALL");
    setSupplierFilter("ALL");
    setSearchTerm("");
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Container Tracking</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track containers and manage offloading
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setAddDialogOpen(true)}
            variant="outline"
            className="gap-2"
            data-testid="button-add-container"
          >
            <Plus className="h-4 w-4" />
            Add Container
          </Button>
          <Link href="/po-import">
            <Button className="gap-2" data-testid="button-import-po">
              <Plus className="h-4 w-4" />
              Import PO
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by container number..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
            data-testid="input-search-container"
          />
        </div>
        <Popover open={showFilters} onOpenChange={setShowFilters}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2" data-testid="button-filter">
              <Filter className="h-4 w-4" />
              Filter
              {(statusFilter !== "ALL" || supplierFilter !== "ALL") && (
                <Badge variant="secondary" className="ml-1 px-1 min-w-5 h-5">
                  {[statusFilter !== "ALL", supplierFilter !== "ALL"].filter(Boolean).length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" data-testid="popover-filters">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Filters</h4>
                {(statusFilter !== "ALL" || supplierFilter !== "ALL") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearFilters}
                    data-testid="button-clear-filters"
                  >
                    <X className="h-4 w-4 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger data-testid="select-status-filter">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Statuses</SelectItem>
                    <SelectItem value="OTW">OTW (On The Way)</SelectItem>
                    <SelectItem value="ARRIVED">Arrived</SelectItem>
                    <SelectItem value="OFFLOADED">Offloaded</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Supplier</label>
                <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                  <SelectTrigger data-testid="select-supplier-filter">
                    <SelectValue placeholder="All suppliers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Suppliers</SelectItem>
                    {suppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id.toString()}>
                        {supplier.legalName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {containers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="w-16 h-16 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">No containers found</h2>
            <p className="text-muted-foreground mb-4">
              {allContainers.length === 0 
                ? "Import your first purchase order to get started"
                : "Try adjusting your search or filters"}
            </p>
            {allContainers.length === 0 && (
              <Link href="/po-import">
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Import PO
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Total Containers</p>
                  <p className="text-2xl font-semibold" data-testid="text-total-containers">
                    {containers.length}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Total Amount</p>
                  <p className="text-2xl font-semibold font-mono" data-testid="text-total-amount">
                    ${containers.reduce((sum, c) => sum + parseFloat(c.grandTotal || "0"), 0).toFixed(2)}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Container Number</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Grand Total</TableHead>
                    <TableHead>Import Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {containers.map((container) => (
                    <TableRow key={container.id} data-testid={`row-container-${container.id}`}>
                      <TableCell className="font-mono font-medium">
                        {container.containerNumber}
                      </TableCell>
                      <TableCell>{getSupplierName(container.supplierId)}</TableCell>
                      <TableCell>
                        <Badge variant={container.status === "OTW" ? "default" : "secondary"}>
                          {container.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono">
                        ${parseFloat(container.grandTotal || "0").toFixed(2)}
                      </TableCell>
                      <TableCell className="font-mono">
                        {new Date(container.importDate).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/containers/${container.id}`}>
                          <Button size="sm" variant="outline" data-testid={`button-view-${container.id}`}>
                            <Eye className="h-4 w-4 mr-2" />
                            View
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <AddContainerDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
      />
    </div>
  );
}
