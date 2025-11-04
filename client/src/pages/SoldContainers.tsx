import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HandCoins, Search, Eye } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/contexts/CompanyContext";
import type { ContainerSale, Container, Customer, Supplier } from "@shared/schema";

export default function SoldContainers() {
  const [searchTerm, setSearchTerm] = useState("");
  const { selectedCompany, companyId } = useCompany();
  
  const { data: containerSales = [], isLoading: salesLoading } = useQuery<ContainerSale[]>({
    queryKey: ["/api/container-sales", companyId],
    enabled: !!companyId,
  });

  const { data: containers = [], isLoading: containersLoading } = useQuery<Container[]>({
    queryKey: ["/api/containers"],
  });

  const { data: customers = [], isLoading: customersLoading } = useQuery<Customer[]>({
    queryKey: ["/api/customers", companyId],
    enabled: !!companyId,
  });

  const { data: suppliers = [], isLoading: suppliersLoading } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const isLoading = salesLoading || containersLoading || customersLoading || suppliersLoading;

  // Create enriched data by joining sales with containers, customers, and suppliers
  const enrichedSales = containerSales.map((sale) => {
    const container = containers.find((c) => c.id === sale.containerId);
    const customer = customers.find((c) => c.id === sale.customerId);
    const supplier = suppliers.find((s) => s.id === container?.supplierId);
    
    return {
      ...sale,
      containerNumber: container?.containerNumber || "Unknown",
      customerName: customer?.legalName || "Unknown",
      supplierName: supplier?.legalName || "Unknown",
    };
  });

  // Filter based on search term
  const filteredSales = enrichedSales.filter((sale) => {
    if (!searchTerm) return true;
    
    const searchLower = searchTerm.toLowerCase();
    return (
      sale.containerNumber.toLowerCase().includes(searchLower) ||
      sale.customerName.toLowerCase().includes(searchLower) ||
      sale.supplierName.toLowerCase().includes(searchLower)
    );
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sold Containers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            View all containers that have been sold to customers
          </p>
        </div>
        <HandCoins className="h-8 w-8 text-muted-foreground" />
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by container number, customer, or supplier..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
          data-testid="input-search-sold-containers"
        />
      </div>

      {filteredSales.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <HandCoins className="w-16 h-16 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">No sold containers found</h2>
            <p className="text-muted-foreground">
              {containerSales.length === 0 
                ? "No containers have been sold yet"
                : "Try adjusting your search"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Container Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Sale Date</TableHead>
                  <TableHead className="text-right">Sale Price</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="text-right">Total Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSales.map((sale) => (
                  <TableRow key={sale.id} data-testid={`row-sale-${sale.id}`}>
                    <TableCell className="font-mono font-medium">
                      {sale.containerNumber}
                    </TableCell>
                    <TableCell data-testid={`text-supplier-${sale.id}`}>
                      {sale.supplierName}
                    </TableCell>
                    <TableCell data-testid={`text-customer-${sale.id}`}>
                      {sale.customerName}
                    </TableCell>
                    <TableCell className="font-mono" data-testid={`text-sale-date-${sale.id}`}>
                      {new Date(sale.saleDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right font-mono" data-testid={`text-sale-price-${sale.id}`}>
                      ${parseFloat(sale.containerCost).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono" data-testid={`text-commission-${sale.id}`}>
                      ${parseFloat(sale.commission).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold" data-testid={`text-total-${sale.id}`}>
                      ${parseFloat(sale.totalAmount).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/containers/${sale.containerId}`}>
                        <Button size="sm" variant="outline" data-testid={`button-view-${sale.id}`}>
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
      )}
    </div>
  );
}
